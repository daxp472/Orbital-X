mod memory;
mod policy;
mod providers;
mod terminal;
mod tools;
mod workspace;

use memory::MemoryService;
use policy::{AgentMode, PolicyDecision, PolicyEngine};
use providers::{ChatMessage, ConnectionTestResult, ProviderResponse, ProviderService};
use std::sync::Mutex;
use tauri::State;
use terminal::{CommandResult, TerminalService};
use workspace::{FileDiff, FileReadResult, FileTreeNode, WorkspaceMeta, WorkspaceService};

pub struct AppState {
    pub workspace: Mutex<WorkspaceService>,
    pub active_mode: Mutex<AgentMode>,
}

#[tauri::command]
fn set_workspace(path: String, state: State<'_, AppState>) -> Result<WorkspaceMeta, String> {
    let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
    ws.set_root(&path)
}

#[tauri::command]
fn get_workspace_meta(state: State<'_, AppState>) -> Result<Option<WorkspaceMeta>, String> {
    let ws = state.workspace.lock().map_err(|e| e.to_string())?;
    match ws.get_root() {
        Some(root) => {
            let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Workspace".into());
            let meta = WorkspaceMeta {
                root_path: root.to_string_lossy().replace('\\', "/"),
                name,
                total_files: 0,
                languages_detected: vec![],
            };
            Ok(Some(meta))
        }
        None => Ok(None),
    }
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
) -> Result<ProviderResponse, String> {
    let tool_schemas = tools::get_available_tool_schemas();
    ProviderService::dispatch_turn(&provider, &api_key, &model, base_url, messages, tool_schemas).await
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
        "write_file" => {
            let path = arguments.get("path").and_then(|p| p.as_str()).ok_or("Missing path")?;
            let content = arguments.get("content").and_then(|c| c.as_str()).ok_or("Missing content")?;
            let desc = arguments.get("description").and_then(|d| d.as_str()).unwrap_or("Agent edit");

            let mut ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let diff = ws.write_file(path, content, desc)?;
            Ok(serde_json::to_value(diff).unwrap_or_default())
        }
        "search_files" => {
            let query = arguments.get("query").and_then(|q| q.as_str()).ok_or("Missing query")?;
            let max_res = arguments.get("max_results").and_then(|m| m.as_u64()).unwrap_or(20) as usize;
            let ws = state.workspace.lock().map_err(|e| e.to_string())?;
            let results = ws.search_files(query, max_res)?;
            Ok(serde_json::json!(results))
        }
        "run_command" => {
            let cmd = arguments.get("command").and_then(|c| c.as_str()).ok_or("Missing command")?;
            let timeout = arguments.get("timeout_seconds").and_then(|t| t.as_u64()).unwrap_or(30);

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
            let res = TerminalService::run_command(&cmd, &cwd, 45).await?;
            Ok(serde_json::to_value(res).unwrap_or_default())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        workspace: Mutex::new(WorkspaceService::new()),
        active_mode: Mutex::new(AgentMode::Dev),
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
            get_file_diff,
            undo_agent_change,
            search_workspace,
            run_command,
            test_provider_connection,
            evaluate_tool_policy,
            get_available_tools,
            agent_dispatch_turn,
            execute_tool,
            save_memory_entry,
            list_memories,
            delete_memory
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
