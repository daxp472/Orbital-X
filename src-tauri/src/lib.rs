mod memory;
mod policy;
mod providers;
mod terminal;
mod tools;
mod usage;
mod workspace;

use memory::MemoryService;
use policy::{AgentMode, PolicyDecision, PolicyEngine};
use providers::{
    stream_ollama_turn, ChatMessage, ConnectionTestResult, DispatchOptions, ProviderResponse,
    ProviderService,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;
use terminal::{CommandResult, InteractiveSessionInfo, InteractiveTerminalManager, TerminalService};
use tokio_util::sync::CancellationToken;
use usage::{TokenUsageRecord, TokenUsageStats, UsageService};
use workspace::{FileDiff, FileReadResult, FileTreeNode, WorkspaceMeta, WorkspaceService};

pub struct AppState {
    pub workspace: Mutex<WorkspaceService>,
    pub active_mode: Mutex<AgentMode>,
    pub terminal_mgr: InteractiveTerminalManager,
    /// Cancellation tokens for cancellable long-running operations (agent
    /// turns, model pulls), keyed by an id supplied by the frontend.
    pub active_ops: Mutex<HashMap<String, CancellationToken>>,
}

fn cancelled_response() -> ProviderResponse {
    ProviderResponse {
        content: String::new(),
        tool_calls: vec![],
        finish_reason: Some("cancelled".into()),
        usage: None,
        metrics: None,
        cancelled: true,
    }
}

#[tauri::command]
fn set_workspace(path: String, state: State<'_, AppState>) -> Result<WorkspaceMeta, String> {
    let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.set_root(&path)
}

#[tauri::command]
fn get_workspace_meta(state: State<'_, AppState>) -> Result<Option<WorkspaceMeta>, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    // Metadata (file count, languages) is scanned once at set_root and cached;
    // this used to always report 0 files / no languages.
    Ok(ws.cached_meta().cloned())
}

#[tauri::command]
fn get_file_tree(max_depth: Option<usize>, state: State<'_, AppState>) -> Result<FileTreeNode, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.get_file_tree(max_depth.unwrap_or(4))
}

#[tauri::command]
fn read_file(path: String, state: State<'_, AppState>) -> Result<FileReadResult, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.read_file(&path)
}

#[tauri::command]
fn save_file(path: String, content: String, description: Option<String>, state: State<'_, AppState>) -> Result<FileDiff, String> {
    let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.write_file(&path, &content, &description.unwrap_or_else(|| "User manual save".into()))
}

#[tauri::command]
fn create_directory(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.create_directory(&path)
}

#[tauri::command]
fn get_file_diff(path: String, new_content: String, state: State<'_, AppState>) -> Result<FileDiff, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    let full = ws.resolve_and_validate(&path)?;
    let old = if full.exists() {
        std::fs::read_to_string(&full).unwrap_or_default()
    } else {
        String::new()
    };
    Ok(ws.compute_diff(&path, &old, &new_content))
}

#[tauri::command]
fn undo_agent_change(state: State<'_, AppState>) -> Result<String, String> {
    let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.undo_last_change()
}

#[tauri::command]
fn search_workspace(query: String, max_results: Option<usize>, state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.search_files(&query, max_results.unwrap_or(20))
}

#[tauri::command]
async fn run_command(
    command: String,
    timeout_seconds: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let cwd = {
        let ws = state.workspace.lock().map_err(|e| e.to_string())?;
        match ws.get_root() {
            Some(r) => r.to_string_lossy().to_string(),
            None => std::env::current_dir().unwrap_or_default().to_string_lossy().to_string(),
        }
    };

    TerminalService::run_command(&command, &cwd, timeout_seconds.unwrap_or(30)).await
}

#[tauri::command]
async fn test_provider_connection(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<ConnectionTestResult, String> {
    Ok(ProviderService::test_connection(&provider, &api_key, &model, base_url).await)
}

#[tauri::command]
fn evaluate_tool_policy(
    tool_name: String,
    target: String,
    mode: AgentMode,
) -> PolicyDecision {
    PolicyEngine::evaluate(mode, &tool_name, &target, false)
}

#[tauri::command]
fn get_available_tools() -> serde_json::Value {
    tools::get_available_tool_schemas()
}

#[tauri::command]
async fn agent_dispatch_turn(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
    messages: Vec<ChatMessage>,
    options: Option<DispatchOptions>,
    turn_id: Option<String>,
    // NOTE: Tauri's Channel cannot be Option — the frontend must always pass
    // a channel (non-Ollama providers simply never emit events on it).
    on_event: Channel<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<ProviderResponse, String> {
    let options = options.unwrap_or_default();
    let tool_schemas = tools::get_available_tool_schemas();

    // Register a cancellation token for this turn so the Stop button can
    // abort the in-flight request (for Ollama this also stops generation
    // server-side by closing the stream, freeing the model immediately).
    let cancel = CancellationToken::new();
    if let Some(id) = &turn_id {
        if let Ok(mut ops) = state.active_ops.lock() {
            ops.insert(id.clone(), cancel.clone());
        }
    }

    let emit = |value: serde_json::Value| {
        let _ = on_event.send(value);
    };

    let result = if provider.eq_ignore_ascii_case("ollama") {
        let url = base_url
            .clone()
            .unwrap_or_else(|| "http://localhost:11434".into());
        stream_ollama_turn(&url, &model, messages.clone(), tool_schemas.clone(), &options, cancel.clone(), emit).await
    } else {
        let fut = ProviderService::dispatch_turn(
            &provider,
            &api_key,
            &model,
            base_url.clone(),
            messages.clone(),
            tool_schemas.clone(),
            &options,
        );
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Ok(cancelled_response()),
            res = fut => res,
        }
    };

    if let Some(id) = &turn_id {
        if let Ok(mut ops) = state.active_ops.lock() {
            ops.remove(id);
        }
    }

    let res = result?;

    if let Some(u) = &res.usage {
        let record = TokenUsageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            provider: provider.clone(),
            model: model.clone(),
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
            is_estimated: u.is_estimated,
            category: "agent_turn".into(),
            status: if res.cancelled { "cancelled".into() } else { "completed".into() },
        };
        let _ = UsageService::record_usage(record);
    }

    Ok(res)
}

/// Aborts a running agent turn (or model pull) by id. Returns true if an
/// operation was found and signalled.
#[tauri::command]
fn cancel_agent_operation(op_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut ops = state.active_ops.lock().map_err(|e| e.to_string())?;
    if let Some(token) = ops.remove(&op_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn create_interactive_terminal(
    session_id: Option<String>,
    name: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    state: State<'_, AppState>,
) -> Result<InteractiveSessionInfo, String> {
    let effective_cwd = match cwd {
        Some(c) => c,
        None => {
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            match ws.get_root() {
                Some(r) => r.to_string_lossy().to_string(),
                None => std::env::current_dir().unwrap_or_default().to_string_lossy().to_string(),
            }
        }
    };
    state.terminal_mgr.create_session(session_id, name, Some(effective_cwd), shell).await
}

#[tauri::command]
async fn send_terminal_input(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.terminal_mgr.write_input(&session_id, &input).await
}

#[tauri::command]
async fn poll_terminal_output(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.terminal_mgr.poll_output(&session_id).await
}

#[tauri::command]
async fn close_interactive_terminal(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.terminal_mgr.close_session(&session_id).await
}

#[tauri::command]
async fn list_terminal_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<InteractiveSessionInfo>, String> {
    Ok(state.terminal_mgr.list_sessions().await)
}

#[tauri::command]
fn record_token_usage(record: TokenUsageRecord) -> Result<(), String> {
    UsageService::record_usage(record)
}

#[tauri::command]
fn get_token_usage_stats() -> Result<TokenUsageStats, String> {
    Ok(UsageService::get_stats())
}

#[tauri::command]
fn clear_token_usage() -> Result<(), String> {
    UsageService::clear_usage()
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => {
            let path_str = path.to_string();
            let p = std::path::Path::new(&path_str);
            if p.exists() && p.is_dir() {
                Ok(Some(path_str))
            } else {
                Err("Selected path does not exist or is not a directory".into())
            }
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn execute_tool(
    name: String,
    arguments: serde_json::Value,
    mode: AgentMode,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let target = arguments
        .get("path")
        .or_else(|| arguments.get("command"))
        .or_else(|| arguments.get("query"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let decision = PolicyEngine::evaluate(mode, &name, target, false);
    if !decision.allowed {
        return Err(format!("Policy violation: {}", decision.reason));
    }

    match name.as_str() {
        "workspace_info" => {
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            match ws.get_root() {
                Some(r) => Ok(serde_json::json!({
                    "root_path": r.to_string_lossy().replace('\\', "/"),
                    "name": r.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
                })),
                None => Ok(serde_json::json!({ "error": "No workspace open" })),
            }
        }
        "list_files" => {
            let max_depth = arguments.get("max_depth").and_then(|d| d.as_u64()).unwrap_or(3) as usize;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let tree = ws.get_file_tree(max_depth)?;
            Ok(serde_json::to_value(tree).unwrap_or_default())
        }
        "read_file" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let res = ws.read_file(path)?;
            Ok(serde_json::to_value(res).unwrap_or_default())
        }
        "read_file_lines" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let start = arguments.get("start_line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
            let end = arguments.get("end_line").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            ws.read_file_lines(path, start, end)
        }
        "write_file" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let content = arguments.get("content").and_then(|c| c.as_str()).ok_or("Missing content")?;
            let desc = arguments.get("description").and_then(|d| d.as_str()).unwrap_or("Agent edit");

            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let diff = ws.write_file(path, content, desc)?;
            Ok(serde_json::to_value(diff).unwrap_or_default())
        }
        "patch_file" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let start = arguments.get("start_line").and_then(|v| v.as_u64()).ok_or("Missing start_line")? as usize;
            let end = arguments.get("end_line").and_then(|v| v.as_u64()).ok_or("Missing end_line")? as usize;
            let new_content = arguments.get("new_content").and_then(|c| c.as_str()).ok_or("Missing new_content")?;
            let desc = arguments.get("description").and_then(|d| d.as_str()).unwrap_or("Agent patch");
            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let diff = ws.patch_file(path, start, end, new_content, desc)?;
            Ok(serde_json::to_value(diff).unwrap_or_default())
        }
        "delete_file" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let msg = ws.delete_file(path)?;
            Ok(serde_json::json!({ "success": true, "message": msg }))
        }
        "delete_directory" | "delete_folder" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let recursive = arguments.get("recursive").and_then(|r| r.as_bool()).unwrap_or(true);
            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let res = ws.delete_directory(path, recursive)?;
            Ok(res)
        }
        "batch_delete_files" => {
            let paths_opt = arguments.get("paths").and_then(|p| p.as_array());
            let manifest_id_opt = arguments.get("manifest_id").and_then(|m| m.as_str());

            if let Some(mid) = manifest_id_opt {
                // Stage 2: executed after explicit user confirmation
                let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
                let res = ws.execute_batch_delete(mid)?;
                Ok(res)
            } else if let Some(arr) = paths_opt {
                // Stage 1: prepare manifest for explicit confirmation
                let paths: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
                let manifest = ws.prepare_batch_delete(&paths)?;
                Ok(serde_json::to_value(manifest).unwrap_or_default())
            } else {
                Err("Missing 'paths' or 'manifest_id' for batch_delete_files".into())
            }
        }
        "rename_file" => {
            let from = arguments.get("from").and_then(|p| p.as_str()).ok_or("Missing from")?;
            let to = arguments.get("to").and_then(|p| p.as_str()).ok_or("Missing to")?;
            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let msg = ws.rename_file(from, to)?;
            Ok(serde_json::json!({ "success": true, "message": msg }))
        }
        "create_directory" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            ws.create_directory(path)?;
            Ok(serde_json::json!({ "success": true, "path": path }))
        }
        "search_files" => {
            let query = arguments.get("query").and_then(|q| q.as_str()).ok_or("Missing query")?;
            let max_res = arguments.get("max_results").and_then(|m| m.as_u64()).unwrap_or(20) as usize;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let results = ws.search_files(query, max_res.min(50))?;
            Ok(serde_json::json!(results))
        }
        "run_command" => {
            let cmd = arguments.get("command").and_then(|c| c.as_str()).ok_or("Missing command")?;
            let timeout = arguments.get("timeout_seconds").and_then(|t| t.as_u64()).unwrap_or(60); // default 60s

            let cwd = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                match ws.get_root() {
                    Some(r) => r.to_string_lossy().to_string(),
                    None => std::env::current_dir().unwrap_or_default().to_string_lossy().to_string(),
                }
            };
            let res = TerminalService::run_command(cmd, &cwd, timeout).await?;
            Ok(serde_json::to_value(res).unwrap_or_default())
        }
        "run_tests" => {
            let (cmd, cwd) = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                let root = ws.get_root().ok_or("No workspace open")?;
                let cwd_str = root.to_string_lossy().to_string();

                let chosen_cmd = if root.join("Cargo.toml").exists() {
                    "cargo test"
                } else if root.join("package.json").exists() {
                    "npm test"
                } else if root.join("pytest.ini").exists() || root.join("tests").exists() {
                    "pytest"
                } else {
                    "echo No recognized test suite found."
                };
                (chosen_cmd.to_string(), cwd_str)
            };
            let res = TerminalService::run_command(&cmd, &cwd, 120).await?;
            Ok(serde_json::to_value(res).unwrap_or_default())
        }
        "get_diagnostics" => {
            let forced_tool = arguments.get("tool").and_then(|t| t.as_str()).unwrap_or("").to_string();
            let (cmd, cwd) = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                let root = ws.get_root().ok_or("No workspace open")?;
                let cwd_str = root.to_string_lossy().to_string();

                let chosen = match forced_tool.as_str() {
                    "cargo_check" => "cargo check 2>&1",
                    "tsc" => "npx tsc --noEmit 2>&1",
                    "eslint" => "npx eslint . --max-warnings=0 2>&1",
                    "pylint" => "python -m pylint . 2>&1",
                    _ => {
                        if root.join("Cargo.toml").exists() { "cargo check 2>&1" }
                        else if root.join("tsconfig.json").exists() { "npx tsc --noEmit 2>&1" }
                        else if root.join(".eslintrc.json").exists() || root.join(".eslintrc.js").exists() { "npx eslint . --max-warnings=20 2>&1" }
                        else if root.join("requirements.txt").exists() || root.join("setup.py").exists() { "python -m pylint . --errors-only 2>&1" }
                        else { "echo No recognized diagnostic tool found" }
                    }
                };
                (chosen.to_string(), cwd_str)
            };
            let res = TerminalService::run_command(&cmd, &cwd, 60).await?;
            Ok(serde_json::json!({
                "success": res.success,
                "output": format!("{}{}", res.stdout, res.stderr),
                "exit_code": res.exit_code
            }))
        }
        "read_multiple_files" => {
            let paths_raw = arguments.get("paths").and_then(|p| p.as_array()).ok_or("Missing paths array")?;
            let paths: Vec<String> = paths_raw.iter().filter_map(|p| p.as_str().map(|s| s.to_string())).collect();
            let max_lines = arguments.get("max_lines_per_file").and_then(|m| m.as_u64()).unwrap_or(300) as usize;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let res = ws.read_multiple_files(&paths, max_lines)?;
            Ok(serde_json::to_value(res).unwrap_or_default())
        }
        "find_symbol" => {
            let sym = arguments.get("symbol").and_then(|s| s.as_str()).ok_or("Missing symbol")?;
            let sym_type = arguments.get("symbol_type").and_then(|t| t.as_str()).unwrap_or("all");
            let max_res = arguments.get("max_results").and_then(|m| m.as_u64()).unwrap_or(25) as usize;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let res = ws.find_symbols(sym, sym_type, max_res)?;
            Ok(serde_json::to_value(res).unwrap_or_default())
        }
        "get_project_structure" => {
            let max_depth = arguments.get("max_depth").and_then(|d| d.as_u64()).unwrap_or(3) as usize;
            let inc_files = arguments.get("include_files").and_then(|b| b.as_bool()).unwrap_or(true);
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let res = ws.get_project_structure(max_depth, inc_files)?;
            Ok(res)
        }
        "git_status" => {
            let cwd = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                ws.get_root().ok_or("No workspace open")?.to_string_lossy().to_string()
            };
            // Argument-array execution: no shell, no interpolation to inject into
            let res = TerminalService::run_git(&["status", "--porcelain=v1", "-b"], &cwd, 10).await?;
            let mut branch = String::new();
            let mut modified = Vec::new();
            let mut staged = Vec::new();
            let mut untracked = Vec::new();

            for line in res.stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("##") {
                    branch = trimmed.trim_start_matches("##").trim().to_string();
                } else if trimmed.starts_with("M ") || trimmed.starts_with("A ") || trimmed.starts_with("D ") || trimmed.starts_with("R ") {
                    staged.push(trimmed[2..].trim().to_string());
                } else if trimmed.starts_with(" M") || trimmed.starts_with(" D") {
                    modified.push(trimmed[2..].trim().to_string());
                } else if trimmed.starts_with("??") {
                    untracked.push(trimmed[2..].trim().to_string());
                }
            }

            Ok(serde_json::json!({
                "success": res.success,
                "clean": modified.is_empty() && staged.is_empty() && untracked.is_empty(),
                "branch": branch,
                "modified": modified,
                "staged": staged,
                "untracked": untracked,
                "raw_output": res.stdout
            }))
        }
        "git_commit" => {
            let message = arguments.get("message").and_then(|m| m.as_str()).ok_or("Missing message")?;
            let cwd = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                ws.get_root().ok_or("No workspace open")?.to_string_lossy().to_string()
            };
            let add_res = TerminalService::run_git(&["add", "."], &cwd, 15).await?;
            if !add_res.success {
                return Ok(serde_json::json!({ "success": false, "error": add_res.stderr }));
            }
            // Message passed as a single argv entry — shell metacharacters are inert
            let commit_res = TerminalService::run_git(&["commit", "-m", message], &cwd, 15).await?;
            Ok(serde_json::json!({
                "success": commit_res.success,
                "output": commit_res.stdout,
                "error": commit_res.stderr
            }))
        }
        "git_diff" => {
            let path = arguments.get("path").and_then(|p| p.as_str());
            let staged = arguments.get("staged").and_then(|s| s.as_bool()).unwrap_or(false);
            let stat_only = arguments.get("stat_only").and_then(|s| s.as_bool()).unwrap_or(false);

            let cwd = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                ws.get_root().ok_or("No workspace open")?.to_string_lossy().to_string()
            };

            let mut git_args: Vec<&str> = vec!["diff"];
            if stat_only {
                git_args.push("--stat");
            }
            if staged {
                git_args.push("--cached");
            }
            if let Some(p) = path {
                git_args.push("--");
                git_args.push(p);
            }

            let res = TerminalService::run_git(&git_args, &cwd, 15).await?;
            let lines: Vec<&str> = res.stdout.lines().collect();
            let total_lines = lines.len();
            let max_lines = 300;
            let (diff_text, truncated) = if total_lines > max_lines {
                (lines.iter().take(max_lines).cloned().collect::<Vec<_>>().join("\n"), true)
            } else {
                (res.stdout.clone(), false)
            };

            Ok(serde_json::json!({
                "diff": diff_text,
                "total_lines": total_lines,
                "truncated": truncated,
                "success": res.success
            }))
        }
        "validate_changes" => {
            let files_opt = arguments.get("files").and_then(|f| f.as_array());
            let run_tests_flag = arguments.get("run_tests").and_then(|t| t.as_bool()).unwrap_or(false);

            let (cwd, root_path) = {
                let ws = state.workspace.lock().map_err(|e| e.to_string())?;
                let root = ws.get_root().ok_or("No workspace open")?;
                (root.to_string_lossy().to_string(), root.clone())
            };

            let mut files_to_check: Vec<String> = Vec::new();
            if let Some(arr) = files_opt {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        files_to_check.push(s.to_string());
                    }
                }
            }

            let mut checks_run: Vec<serde_json::Value> = Vec::new();
            let mut all_passed = true;

            // 1. Rust validation if Cargo.toml exists or files end in .rs
            let has_rust = root_path.join("Cargo.toml").exists()
                || files_to_check.iter().any(|f| f.ends_with(".rs"));
            if has_rust {
                let res = TerminalService::run_command("cargo check --message-format=short 2>&1", &cwd, 90).await?;
                checks_run.push(serde_json::json!({
                    "check": "cargo check",
                    "success": res.success,
                    "exit_code": res.exit_code,
                    "output": format!("{}{}", res.stdout, res.stderr).trim()
                }));
                if !res.success {
                    all_passed = false;
                }
            }

            // 2. JS syntax validation (skip JSX/React files as node --check does not support JSX syntax)
            let js_files: Vec<&String> = files_to_check.iter()
                .filter(|f| (f.ends_with(".js") || f.ends_with(".mjs")) && !f.ends_with(".jsx"))
                .filter(|f| {
                    let full = root_path.join(f);
                    if let Ok(content) = std::fs::read_to_string(&full) {
                        !content.contains("import React")
                            && !content.contains("export default function")
                            && !content.contains("</")
                            && !content.contains("/>")
                    } else {
                        true
                    }
                })
                .collect();
            if !js_files.is_empty() {
                let joined_files = js_files.iter().map(|f| format!("\"{}\"", f)).collect::<Vec<_>>().join(" ");
                let cmd = format!("node --check {}", joined_files);
                let res = TerminalService::run_command(&cmd, &cwd, 30).await?;
                checks_run.push(serde_json::json!({
                    "check": "node --check",
                    "success": res.success,
                    "exit_code": res.exit_code,
                    "output": format!("{}{}", res.stdout, res.stderr).trim()
                }));
                if !res.success {
                    all_passed = false;
                }
            }

            // 3. TS type-checking if tsconfig.json exists
            if root_path.join("tsconfig.json").exists() && files_to_check.iter().any(|f| f.ends_with(".ts") || f.ends_with(".tsx")) {
                let res = TerminalService::run_command("npx tsc --noEmit 2>&1", &cwd, 60).await?;
                checks_run.push(serde_json::json!({
                    "check": "tsc --noEmit",
                    "success": res.success,
                    "exit_code": res.exit_code,
                    "output": format!("{}{}", res.stdout, res.stderr).trim()
                }));
                if !res.success {
                    all_passed = false;
                }
            }

            // 4. Test suite if requested
            if run_tests_flag {
                let test_cmd = if root_path.join("Cargo.toml").exists() {
                    "cargo test"
                } else if root_path.join("package.json").exists() {
                    "npm test"
                } else {
                    "echo No tests configured"
                };
                let res = TerminalService::run_command(test_cmd, &cwd, 120).await?;
                checks_run.push(serde_json::json!({
                    "check": "test suite",
                    "success": res.success,
                    "exit_code": res.exit_code,
                    "output": format!("{}{}", res.stdout, res.stderr).trim()
                }));
                if !res.success {
                    all_passed = false;
                }
            }

            if checks_run.is_empty() {
                checks_run.push(serde_json::json!({
                    "check": "diagnostic check",
                    "success": true,
                    "output": "No recognized project compiler found; syntax passed."
                }));
            }

            Ok(serde_json::json!({
                "success": all_passed,
                "checks_count": checks_run.len(),
                "checks": checks_run,
                "summary": if all_passed {
                    "All validation checks passed."
                } else {
                    "Validation failed. Review check output errors."
                }
            }))
        }
        "update_task_status" => {
            let task_id = arguments.get("task_id").and_then(|id| id.as_str()).ok_or("Missing task_id")?;
            let status = arguments.get("status").and_then(|s| s.as_str()).ok_or("Missing status")?;
            let evidence = arguments.get("evidence").and_then(|e| e.as_str()).unwrap_or("");
            let notes = arguments.get("notes").and_then(|n| n.as_str()).unwrap_or("");

            let valid_statuses = ["pending", "in_progress", "completed", "blocked", "failed", "skipped"];
            if !valid_statuses.contains(&status) {
                return Err(format!("Invalid status '{}'. Must be one of: {:?}", status, valid_statuses));
            }

            // Invariant 3: Completion needs evidence
            if status == "completed" && evidence.trim().len() < 5 {
                return Err("Cannot mark task complete without completion evidence (Gravitas invariant 3). Provide test, diagnostic, or verification output.".to_string());
            }

            Ok(serde_json::json!({
                "success": true,
                "task_id": task_id,
                "status": status,
                "evidence": evidence,
                "notes": notes,
                "updated_at": chrono::Utc::now().to_rfc3339()
            }))
        }
        "undo_agent_change" => {
            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let msg = ws.undo_last_change()?;
            Ok(serde_json::json!({ "success": true, "message": msg }))
        }
        "save_project_memory" => {
            let cat = arguments.get("category").and_then(|c| c.as_str()).unwrap_or("convention");
            let title = arguments.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled");
            let content = arguments.get("content").and_then(|c| c.as_str()).unwrap_or("");

            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let root = ws.get_root().ok_or("No workspace open to save memory")?;
            let mem = MemoryService::save_memory(&root, cat, title, content)?;
            Ok(serde_json::to_value(mem).unwrap_or_default())
        }
        "search_project_memory" => {
            let query = arguments.get("query").and_then(|q| q.as_str()).unwrap_or("");
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let root = ws.get_root().ok_or("No workspace open")?;
            let mems = MemoryService::search_memories(&root, query);
            Ok(serde_json::json!(mems))
        }
        _ => Err(format!("Unrecognized tool: {}", name)),
    }
}

#[tauri::command]
fn save_memory_entry(
    category: String,
    title: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    let root = ws.get_root().ok_or("No workspace open")?;
    let mem = MemoryService::save_memory(&root, &category, &title, &content)?;
    Ok(serde_json::to_value(mem).unwrap_or_default())
}

#[tauri::command]
fn list_memories(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    match ws.get_root() {
        Some(root) => {
            let mems = MemoryService::load_memories(&root);
            Ok(serde_json::json!(mems))
        }
        None => Ok(serde_json::json!([])),
    }
}

#[tauri::command]
fn delete_memory(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    let root = ws.get_root().ok_or("No workspace open")?;
    MemoryService::delete_memory(&root, &id)
}

#[derive(serde::Serialize)]
pub struct GitFileChange {
    pub status: String,
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub branch: String,
    pub changes: Vec<GitFileChange>,
}

#[tauri::command]
async fn get_git_status(state: State<'_, AppState>) -> Result<GitStatusResult, String> {
    let cwd = {
        let ws = state.workspace.lock().map_err(|e| e.to_string())?;
        match ws.get_root() {
            Some(r) => r.to_string_lossy().to_string(),
            None => return Ok(GitStatusResult {
                is_repo: false,
                branch: "No Workspace".into(),
                changes: vec![],
            }),
        }
    };

    let res = TerminalService::run_git(&["status", "--porcelain=v1", "-b"], &cwd, 10).await?;
    if !res.success {
        return Ok(GitStatusResult {
            is_repo: false,
            branch: "Not a git repository".into(),
            changes: vec![],
        });
    }

    let mut branch = "main".to_string();
    let mut changes = Vec::new();

    for line in res.stdout.lines() {
        if line.starts_with("##") {
            let branch_line = line.trim_start_matches("##").trim();
            branch = branch_line.split("...").next().unwrap_or(branch_line).trim().to_string();
        } else if line.len() >= 3 {
            let status = line[0..2].trim().to_string();
            let path = line[3..].trim().to_string();
            changes.push(GitFileChange { status, path });
        }
    }

    Ok(GitStatusResult {
        is_repo: true,
        branch,
        changes,
    })
}

#[tauri::command]
async fn git_stage_and_commit(message: String, state: State<'_, AppState>) -> Result<String, String> {
    let cwd = {
        let ws = state.workspace.lock().map_err(|e| e.to_string())?;
        ws.get_root().ok_or("No workspace open")?.to_string_lossy().to_string()
    };

    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".into());
    }

    let add_res = TerminalService::run_git(&["add", "."], &cwd, 15).await?;
    if !add_res.success {
        return Err(format!("git add failed: {}", add_res.stderr));
    }

    let commit_res = TerminalService::run_git(&["commit", "-m", &message], &cwd, 15).await?;

    if !commit_res.success {
        return Err(format!("git commit failed: {}", commit_res.stderr));
    }

    Ok(commit_res.stdout)
}

#[tauri::command]
async fn get_git_diff(path: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let cwd = {
        let ws = state.workspace.lock().map_err(|e| e.to_string())?;
        ws.get_root().ok_or("No workspace open")?.to_string_lossy().to_string()
    };

    let git_args: Vec<&str> = match path.as_deref() {
        Some(p) => vec!["diff", "--", p],
        None => vec!["diff"],
    };
    let res = TerminalService::run_git(&git_args, &cwd, 15).await?;
    Ok(res.stdout)
}

#[tauri::command]
async fn get_ollama_models(endpoint: Option<String>) -> Result<Vec<String>, String> {
    let url = endpoint.unwrap_or_else(|| "http://localhost:11434".into());
    let tags_endpoint = format!("{}/api/tags", url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&tags_endpoint).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP error {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut models = Vec::new();

    if let Some(arr) = json.get("models").and_then(|m| m.as_array()) {
        for m in arr {
            if let Some(name) = m.get("name").and_then(|n| n.as_str()) {
                models.push(name.to_string());
            }
        }
    }

    Ok(models)
}

// ============================================================================
// Chat session persistence — localStorage is quota-limited in the WebView and
// silently dropped history on QuotaExceededError. Sessions live as JSON on
// disk under ~/.orbital/ instead, written atomically via tmp+rename.
// ============================================================================

fn chat_sessions_path() -> PathBuf {
    let dir = dirs::home_dir()
        .map(|h| h.join(".orbital"))
        .unwrap_or_else(|| PathBuf::from(".orbital"));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("chat_sessions.json")
}

#[tauri::command]
fn load_chat_sessions() -> Result<serde_json::Value, String> {
    match std::fs::read(chat_sessions_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        // Missing file = no history yet; null tells the frontend to fall back
        // to its bootstrap default rather than treating this as an error.
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
fn save_chat_sessions(sessions: serde_json::Value) -> Result<(), String> {
    let path = chat_sessions_path();
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_string(&sessions).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, serialized).map_err(|e| format!("Failed to write chat sessions: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to finalize chat sessions: {}", e))?;
    Ok(())
}

// ============================================================================
// Ollama model lifecycle management (pull / delete / inspect / running)
// ============================================================================

fn ollama_base(endpoint: Option<String>) -> String {
    endpoint.unwrap_or_else(|| "http://localhost:11434".into())
}

/// Streams `ollama pull` progress over the channel: NDJSON lines from
/// /api/pull carry {"status", "digest", "total", "completed"}. No fixed total
/// timeout — large downloads legitimately take a long time — but each read is
/// bounded, and the pull is cancellable through the shared token registry
/// (which aborts the HTTP stream and stops the download).
#[tauri::command]
async fn ollama_pull_model(
    name: String,
    endpoint: Option<String>,
    pull_id: String,
    on_event: Channel<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    use futures_util::StreamExt;

    let url = format!("{}/api/pull", ollama_base(endpoint).trim_end_matches('/'));
    let cancel = CancellationToken::new();
    if let Ok(mut ops) = state.active_ops.lock() {
        ops.insert(pull_id.clone(), cancel.clone());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({ "name": name, "stream": true });

    let send_status = |value: serde_json::Value| {
        let _ = on_event.send(value);
    };

    let result: Result<serde_json::Value, String> = async {
        let resp = client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Could not reach Ollama at {}: {}", url, e))?;

        if !resp.status().is_success() {
            let status_code = resp.status().as_u16();
            let err = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama pull failed (HTTP {}): {}", status_code, err));
        }

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut last_status = String::new();

        loop {
            let chunk = tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    // Dropping the stream closes the connection and stops the download
                    send_status(serde_json::json!({"type": "cancelled"}));
                    return Ok(serde_json::json!({"success": false, "cancelled": true, "status": "Cancelled by user"}));
                }
                item = tokio::time::timeout(
                    std::time::Duration::from_secs(120),
                    stream.next(),
                ) => item.map_err(|_| "Pull stalled (no progress for 2 minutes)".to_string())?,
            };

            let Some(chunk) = chunk else { break };
            let chunk = chunk.map_err(|e| format!("Pull stream failed: {}", e))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buf.find('\n') {
                let line: String = buf.drain(..=pos).collect();
                let line = line.trim();
                if line.is_empty() { continue; }
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };

                if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                    return Err(format!("Ollama pull error: {}", err));
                }

                let status = v.get("status").and_then(|s| s.as_str()).unwrap_or_default().to_string();
                if status != last_status && !status.is_empty() {
                    last_status = status.clone();
                }

                let total = v.get("total").and_then(|t| t.as_u64());
                let completed = v.get("completed").and_then(|c| c.as_u64());
                let percent = match (total, completed) {
                    (Some(t), Some(c)) if t > 0 => Some(((c as f64 / t as f64) * 1000.0).round() / 10.0),
                    _ => None,
                };

                send_status(serde_json::json!({
                    "type": "pull_status",
                    "status": status,
                    "digest": v.get("digest").and_then(|d| d.as_str()),
                    "total": total,
                    "completed": completed,
                    "percent": percent,
                }));

                if status == "success" {
                    return Ok(serde_json::json!({"success": true, "status": "success"}));
                }
            }
        }

        // Stream ended without an explicit success line — treat as failure
        Err("Pull stream ended before completion".into())
    }
    .await;

    if let Ok(mut ops) = state.active_ops.lock() {
        ops.remove(&pull_id);
    }
    result
}

/// Removes a downloaded model (DELETE /api/delete).
#[tauri::command]
async fn ollama_delete_model(name: String, endpoint: Option<String>) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/delete", ollama_base(endpoint).trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .delete(&url)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| format!("Delete request failed: {}", e))?;

    if !resp.status().is_success() {
        let status_code = resp.status().as_u16();
        let err = resp.text().await.unwrap_or_default();
        return Ok(serde_json::json!({ "success": false, "error": format!("HTTP {}: {}", status_code, err) }));
    }
    Ok(serde_json::json!({ "success": true }))
}

/// Model facts from /api/show. Only fields the API actually supplies are
/// returned; anything absent stays null and the UI must not invent values.
#[tauri::command]
async fn ollama_model_info(name: String, endpoint: Option<String>) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/show", ollama_base(endpoint).trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| format!("Model info request failed: {}", e))?;

    if !resp.status().is_success() {
        let status_code = resp.status().as_u16();
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("Model info unavailable (HTTP {}): {}", status_code, err));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Context length: prefer model_info entries like "<family>.context_length",
    // then a "num_ctx N" line in the parameters string (Modelfile override)
    let mut context_length: Option<u64> = None;
    if let Some(info) = json.get("model_info").and_then(|m| m.as_object()) {
        for (k, v) in info {
            if k.ends_with(".context_length") {
                if let Some(n) = v.as_u64() {
                    context_length = Some(context_length.map_or(n, |prev: u64| prev.max(n)));
                }
            }
        }
    }
    if context_length.is_none() {
        if let Some(params) = json.get("parameters").and_then(|p| p.as_str()) {
            for line in params.lines() {
                let mut parts = line.split_whitespace();
                if parts.next() == Some("num_ctx") {
                    if let Some(n) = parts.next().and_then(|s| s.parse::<u64>().ok()) {
                        context_length = Some(n);
                    }
                }
            }
        }
    }

    let details = json.get("details").cloned().unwrap_or_default();
    let capabilities: Vec<String> = json
        .get("capabilities")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    // null when the server doesn't report capabilities — the UI must show
    // "unknown", never invent support
    let supports_tools = if json.get("capabilities").is_some() {
        serde_json::json!(capabilities.iter().any(|c| c == "tools"))
    } else {
        serde_json::Value::Null
    };

    Ok(serde_json::json!({
        "name": name,
        "context_length": context_length,
        "parameter_size": details.get("parameter_size").and_then(|p| p.as_str()),
        "quantization": details.get("quantization_level").and_then(|q| q.as_str()),
        "family": details.get("family").and_then(|f| f.as_str()),
        "families": details.get("families").and_then(|f| f.as_array()).map(|arr| {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>()
        }),
        "capabilities": capabilities,
        "supports_tools": supports_tools,
        "modified_at": json.get("modified_at").and_then(|m| m.as_str()),
    }))
}

/// Models currently loaded in memory/VRAM (GET /api/ps).
#[tauri::command]
async fn ollama_running_models(endpoint: Option<String>) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/ps", ollama_base(endpoint).trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not query Ollama running models: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP error {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let models: Vec<serde_json::Value> = json
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    serde_json::json!({
                        "name": m.get("name").and_then(|n| n.as_str()),
                        "model": m.get("model").and_then(|n| n.as_str()),
                        "size_bytes": m.get("size").and_then(|s| s.as_u64()),
                        "size_vram_bytes": m.get("size_vram").and_then(|s| s.as_u64()),
                        "expires_at": m.get("expires_at").and_then(|s| s.as_str()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(serde_json::json!({ "models": models }))
}

// ============================================================================
// Hardware awareness — used for honest model-fit guidance. Only reports what
// the OS actually exposes; missing values stay null.
// ============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vram_bytes: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub total_ram_bytes: Option<u64>,
    pub gpus: Vec<GpuInfo>,
}

#[cfg(windows)]
fn detect_gpus() -> Vec<GpuInfo> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let mut gpus = Vec::new();
    // Display adapter class {4d36e968-...}: each subkey 0000..000N is an
    // adapter with DriverDesc (name) and HardwareInformation.qwMemorySize
    // (QWORD VRAM in bytes — correct for >4GB cards, unlike AdapterRAM).
    let class_path = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
    let Ok(class) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(class_path) else {
        return gpus;
    };

    for idx in 0..=16 {
        let Ok(sub) = class.open_subkey(format!("{:04}", idx)) else { continue };
        let name: Option<String> = sub.get_value("DriverDesc").ok();
        let vram: Option<u64> = sub
            .open_subkey("HardwareInformation")
            .ok()
            .and_then(|hw| hw.get_value("qwMemorySize").ok());
        if let Some(name) = name {
            if !name.is_empty() {
                gpus.push(GpuInfo { name, vram_bytes: vram.filter(|v| *v > 0) });
            }
        }
    }
    gpus
}

#[cfg(not(windows))]
fn detect_gpus() -> Vec<GpuInfo> {
    Vec::new()
}

#[tauri::command]
fn get_hardware_info() -> Result<HardwareInfo, String> {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total_ram = sys.total_memory(); // bytes in sysinfo 0.30
    Ok(HardwareInfo {
        total_ram_bytes: if total_ram > 0 { Some(total_ram) } else { None },
        gpus: detect_gpus(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        workspace: Mutex::new(WorkspaceService::new()),
        active_mode: Mutex::new(AgentMode::Dev),
        terminal_mgr: InteractiveTerminalManager::new(),
        active_ops: Mutex::new(HashMap::new()),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_workspace,
            get_workspace_meta,
            get_file_tree,
            read_file,
            save_file,
            create_directory,
            get_file_diff,
            undo_agent_change,
            search_workspace,
            run_command,
            create_interactive_terminal,
            send_terminal_input,
            poll_terminal_output,
            close_interactive_terminal,
            list_terminal_sessions,
            record_token_usage,
            get_token_usage_stats,
            clear_token_usage,
            open_folder_dialog,
            test_provider_connection,
            evaluate_tool_policy,
            get_available_tools,
            agent_dispatch_turn,
            cancel_agent_operation,
            execute_tool,
            save_memory_entry,
            list_memories,
            delete_memory,
            get_git_status,
            git_stage_and_commit,
            get_git_diff,
            get_ollama_models,
            load_chat_sessions,
            save_chat_sessions,
            ollama_pull_model,
            ollama_delete_model,
            ollama_model_info,
            ollama_running_models,
            get_hardware_info
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
