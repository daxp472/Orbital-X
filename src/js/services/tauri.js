// ==========================================================================
// Orbital X — Tauri IPC Service (tauri.js)
// ==========================================================================

let invokeFn = null;

/**
 * Creates a Tauri event Channel for streaming progress (tokens, pull status)
 * from backend commands. Returns null in plain-browser preview mode, where
 * channels don't exist and commands return complete results instead.
 */
export async function makeEventChannel() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
    try {
      const { Channel } = await import('@tauri-apps/api/core');
      return new Channel();
    } catch (e) {
      console.warn('Channel unavailable, falling back to non-streaming:', e);
      return null;
    }
  }
  return null;
}

async function getInvoke() {
  if (invokeFn) return invokeFn;

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    invokeFn = window.__TAURI__.core.invoke;
    return invokeFn;
  }

  try {
    const api = await import('@tauri-apps/api/core');
    if (api && api.invoke) {
      invokeFn = api.invoke;
      return invokeFn;
    }
  } catch (e) {
    console.warn("Tauri API not directly loaded, using mock fallback if in standard browser:", e);
  }

  // Browser preview fallback mock
  invokeFn = async (cmd, args = {}) => {
    console.log(`[IPC Mock] ${cmd}`, args);
    switch (cmd) {
      case 'get_workspace_meta':
        return null;
      case 'set_workspace':
        return {
          root_path: args.path,
          name: args.path.split(/[/\\]/).pop() || 'Workspace',
          total_files: 10,
          languages_detected: ['JavaScript', 'HTML', 'CSS', 'Rust', 'Markdown'],
        };
      case 'get_file_tree':
        return {
          name: "Workspace",
          path: "/workspace",
          relative_path: "",
          is_directory: true,
          children: [
            { name: "index.html", path: "/workspace/index.html", relative_path: "index.html", is_directory: false },
            { name: "package.json", path: "/workspace/package.json", relative_path: "package.json", is_directory: false },
            { name: "README.md", path: "/workspace/README.md", relative_path: "README.md", is_directory: false },
          ]
        };
      case 'read_file':
        return {
          path: args.path,
          relative_path: args.path,
          content: `// Sample content for ${args.path}\nconsole.log("Hello from Orbital X!");\n`,
          is_binary: false,
          total_lines: 3,
          size_bytes: 65,
        };
      case 'save_file':
        return {
          path: args.path,
          old_content: "",
          new_content: args.content,
          diff_unified: `+${args.content}`,
          additions: 1,
          deletions: 0,
        };
      case 'run_command':
        return {
          command: args.command,
          exit_code: 0,
          stdout: `Executed: ${args.command}\nEverything built cleanly.\n`,
          stderr: "",
          duration_ms: 120,
          timed_out: false,
          success: true,
        };
      case 'test_provider_connection':
        return {
          success: true,
          provider: args.provider,
          message: `Connected successfully to ${args.provider}!`,
          models_available: ['default-model'],
        };
      case 'agent_dispatch_turn':
        return {
          content: "I have analyzed your workspace and everything looks configured properly.",
          tool_calls: [],
          finish_reason: "stop",
        };
      case 'evaluate_tool_policy':
        return {
          allowed: true,
          requires_approval: false,
          risk: "low",
          reason: "Permitted in browser fallback",
        };
      case 'create_interactive_terminal':
        return {
          session_id: args.session_id || 'term_1',
          name: args.shell || 'cmd',
          cwd: args.cwd || 'D:\\1work\\YT\\Orbital X',
          is_alive: true,
        };
      case 'send_terminal_input':
        return true;
      case 'poll_terminal_output':
        return `${args.session_id ? 'D:\\1work\\YT\\Orbital X' : ''}> \n`;
      case 'close_interactive_terminal':
        return true;
      case 'list_terminal_sessions':
        return [{ session_id: 'term_1', name: 'cmd', cwd: 'D:\\1work\\YT\\Orbital X', is_alive: true }];
      case 'record_token_usage':
        return true;
      case 'get_token_usage_stats':
        return {
          total_tokens: 12450,
          total_prompt_tokens: 8200,
          total_completion_tokens: 4250,
          total_requests: 18,
          today_tokens: 4850,
          today_prompt_tokens: 3100,
          today_completion_tokens: 1750,
          today_requests: 7,
          month_tokens: 12450,
          seven_days: [
            { date: '2026-10-15', total_tokens: 1200, prompt_tokens: 800, completion_tokens: 400, requests: 2 },
            { date: '2026-10-16', total_tokens: 1800, prompt_tokens: 1200, completion_tokens: 600, requests: 3 },
            { date: '2026-10-17', total_tokens: 950, prompt_tokens: 600, completion_tokens: 350, requests: 1 },
            { date: '2026-10-18', total_tokens: 2100, prompt_tokens: 1400, completion_tokens: 700, requests: 3 },
            { date: '2026-10-19', total_tokens: 1550, prompt_tokens: 1100, completion_tokens: 450, requests: 2 },
            { date: '2026-10-20', total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, requests: 0 },
            { date: '2026-10-21', total_tokens: 4850, prompt_tokens: 3100, completion_tokens: 1750, requests: 7 }
          ],
          by_provider: { 'Ollama': 7800, 'Claude': 4650 },
          by_model: { 'llama3': 7800, 'claude-3-5-sonnet-20241022': 4650 },
          reported_tokens: 7800,
          estimated_tokens: 4650,
          last_request_time: new Date().toISOString()
        };
      case 'isolation_get_status':
        return {
          is_active: true,
          platform: 'Windows Job Object',
          max_memory_mb: 1536,
          max_cpu_percent: 75,
          max_active_processes: 24,
          active_staging_files: 0,
        };
      case 'isolation_execute_command':
        return {
          command: args.command,
          exit_code: 0,
          stdout: `[Sandboxed] ${args.command}\nExecution verified in Job Object sandbox.`,
          stderr: '',
          duration_ms: 120,
          timed_out: false,
          success: true,
          memory_capped: false,
        };
      case 'isolation_stage_write':
        return { staged: true, path: args.path };
      case 'isolation_validate_staged':
        return {
          is_valid: true,
          total_mutations: 0,
          violations: [],
          bytes_affected: 0,
        };
      case 'graph_get_stats':
        return {
          total_symbols: 142,
          total_edges: 89,
          total_files: 28,
          is_indexing: false,
        };
      case 'graph_get_callers':
        return [
          { id: 'src/main.rs:function:run:12', name: 'run', kind: 'function', file_path: 'src/main.rs', signature: 'pub fn run()', line: 12 }
        ];
      case 'graph_get_callees':
        return [
          { id: 'src/auth.rs:function:verify:8', name: 'verify', kind: 'function', file_path: 'src/auth.rs', signature: 'pub fn verify()', line: 8 }
        ];
      case 'graph_get_dependencies':
        return [
          { id: 'src/auth.rs:struct:AuthService:4', name: 'AuthService', kind: 'struct', file_path: 'src/auth.rs', signature: 'pub struct AuthService', line: 4 }
        ];
      case 'graph_get_focused_context':
        return {
          target_symbol: args.symbol || 'AppService',
          target_file: 'src/service.rs',
          definition_snippet: `// File: src/service.rs:15\npub struct ${args.symbol || 'AppService'}`,
          callers: [{ id: 'src/main.rs:10', name: 'main', kind: 'function', file_path: 'src/main.rs', signature: 'fn main()', line: 10 }],
          callees: [{ id: 'src/util.rs:20', name: 'init_logger', kind: 'function', file_path: 'src/util.rs', signature: 'pub fn init_logger()', line: 20 }],
          dependencies: [],
          estimated_tokens: 180,
        };
      case 'diagnostics_run_check':
      case 'diagnostics_run_compiler_check':
        return [];
      case 'diagnostics_get_status':
        return {
          toolchain: 'cargo',
          is_available: true,
          last_error_count: 0,
          is_loop_detected: false,
          consecutive_failures: 0,
        };
      case 'diagnostics_reset_loop':
        return true;
      case 'diagnostics_evaluate_healing':
        return null;
      case 'vfs_get_status':
        return {
          is_active: true,
          dirty_count: 0,
          checkpoint_count: 0,
          dirty_files: [],
        };
      case 'vfs_get_pending_diffs':
      case 'vfs_get_all_diffs':
        return [];
      case 'vfs_create_checkpoint':
        return {
          id: `ckpt_${Date.now()}`,
          timestamp: Date.now(),
          description: args.description || 'Mock checkpoint',
          snapshot_count: 0,
        };
      case 'vfs_rollback_checkpoint':
      case 'vfs_rollback_all':
      case 'vfs_discard_changes':
        return true;
      case 'vfs_commit_all':
      case 'vfs_commit_transaction':
        return {
          committed_count: 0,
          backup_path: '.orbital/vfs_backups/backup_mock',
          files: [],
        };
      case 'clear_token_usage':
        return true;
      case 'open_folder_dialog':
        // Return a path string that extractPath can handle
        return 'D:\\1work\\YT\\Orbital X';
      case 'list_memories':
        return [];
      case 'cancel_agent_operation':
        return false;
      case 'load_chat_sessions':
        return null;
      case 'save_chat_sessions':
        return true;
      case 'get_ollama_models':
        return ['llama3.2:3b', 'qwen3-coder:latest', 'qwen3:latest'];
      case 'auto_detect_draft_model':
        return 'llama3.2:3b';
      case 'get_live_telemetry':
        return {
          cpuPercent: 12.0,
          ramTotalMb: 16384,
          ramUsedMb: 8192,
          ramFreeMb: 8192,
          ramPercent: 50.0,
          vramTotalMb: 8192,
          vramUsedMb: 2048,
          vramFreeMb: 6144,
          vramPercent: 25.0,
          activeModelVramMb: 2048,
          activeModelName: 'qwen3:latest',
          tokensPerSecond: 38.5,
          gpuName: 'NVIDIA GeForce RTX',
          timestampMs: Date.now()
        };
      case 'test_provider_connection':
        return {
          success: true,
          provider: 'Ollama (Local)',
          message: 'Connected to Ollama! Found 3 local models.',
          models_available: ['llama3.2:3b', 'qwen3-coder:latest', 'qwen3:latest']
        };
      case 'ollama_pull_model':
        return { success: true, status: 'success' };
      case 'ollama_delete_model':
        return { success: true };
      case 'ollama_model_info':
        return { name: args.name, context_length: null, parameter_size: null, quantization: null, supports_tools: null };
      case 'ollama_running_models':
        return { models: [] };
      case 'complete_code':
        return { completion: '' };
      case 'search_workspace_advanced':
        return [];
      case 'get_hardware_info':
        return { totalRamBytes: null, gpus: [] };
      case 'open_dev_tools':
        // In browser fallback, simulate opening dev tools
        console.log('[IPC Mock] open_dev_tools - would open DevTools in Tauri');
        return { success: true, message: 'Dev tools would open in Tauri build' };
      case 'reload':
        // In browser fallback, simulate reload
        console.log('[IPC Mock] reload - would reload in Tauri');
        return { success: true };
      case 'check_latest_release':
        try {
          const resp = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases/latest');
          if (resp.ok) {
            const data = await resp.json();
            const assets = data.assets || [];
            const exeAsset = assets.find(a => a.name?.endsWith('.exe') && a.name?.includes('setup')) || assets.find(a => a.name?.endsWith('.exe'));
            return {
              tag: data.tag_name,
              changelog: data.body,
              asset_url: exeAsset?.browser_download_url || data.html_url,
              download_url: data.html_url
            };
          }
        } catch (_) {}
        return null;
      case 'download_update':
        return 'browser-preview-download-fallback';
      case 'install_update':
        return { success: true };
      case 'open_url':
        if (args?.url && typeof window !== 'undefined') {
          window.open(args.url, '_blank');
        }
        return { success: true };
      default:
        return { success: true };
    }
  };

  return invokeFn;
}

export async function invoke(cmd, args = {}) {
  const inv = await getInvoke();
  return inv(cmd, args);
}

// Native Dialog picker for workspace folder
export async function pickFolder() {
  function extractPath(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.trim()) return res.trim();
    if (Array.isArray(res) && res.length > 0) {
      const first = res[0];
      return typeof first === 'string' ? first.trim() : (first?.path || first?.filePath || null);
    }
    if (typeof res === 'object' && res !== null) {
      return res.path || res.filePath || res.fsPath || null;
    }
    return null;
  }

  // 1. Primary: backend Rust command with native Windows dialog support
  try {
    const res = await invoke('open_folder_dialog');
    const path = extractPath(res);
    if (path) {
      console.log('[pickFolder] Selected path:', path);
      return path;
    }
  } catch (e) {
    console.warn("[pickFolder] open_folder_dialog IPC failed:", e);
  }

  // 2. Client-side Tauri dialog plugin fallback
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (dialog && typeof dialog.open === 'function') {
      const res = await dialog.open({ directory: true, multiple: false, title: 'Select Workspace Folder' });
      const path = extractPath(res);
      if (path) return path;
    }
  } catch (e) {
    console.warn("[pickFolder] @tauri-apps/plugin-dialog fallback failed:", e);
  }

  // 3. window.__TAURI__.dialog fallback
  try {
    if (window.__TAURI__?.dialog?.open) {
      const res = await window.__TAURI__.dialog.open({ directory: true, multiple: false, title: 'Select Workspace Folder' });
      const path = extractPath(res);
      if (path) return path;
    }
  } catch (e) {
    console.warn("[pickFolder] window.__TAURI__.dialog failed:", e);
  }

  // 4. Pure browser preview fallback only (never in Tauri)
  if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) {
    const input = prompt("Enter workspace directory path:", "D:/1work/YT/Orbital X");
    if (input !== null) {
      return input.trim() || null;
    }
    return null;
  }

  return null;
}

export async function openInExplorer(path = null) {
  try {
    await invoke('open_in_explorer', { path });
  } catch (e) {
    console.warn('[openInExplorer] failed:', e);
  }
}

// Native Dialog picker for saving files
export async function pickSaveFile(defaultName = 'chat.md', filterName = 'Markdown', filterExtensions = ['md']) {
  try {
    const res = await invoke('pick_save_file', {
      default_name: defaultName,
      filter_name: filterName,
      filter_extensions: filterExtensions
    });
    if (res !== undefined) {
      return res; // either path string or null if cancelled
    }
  } catch (e) {
    console.warn("pick_save_file IPC failed, attempting client plugin dialog fallback:", e);
  }

  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (dialog && dialog.save) {
      const res = await dialog.save({
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions: filterExtensions }]
      });
      return res || null;
    }
  } catch (e) {
    console.warn("Tauri dialog plugin save not available:", e);
  }

  return null;
}

// ============================================================================
// Pillar 1: Enterprise Workspace Isolation Wrappers
// ============================================================================

export async function getSandboxStatus() {
  try {
    return await invoke('isolation_get_status');
  } catch (e) {
    console.warn('[getSandboxStatus] IPC failed:', e);
    return {
      is_active: false,
      platform: 'Host OS',
      max_memory_mb: 0,
      max_cpu_percent: 0,
      max_active_processes: 0,
      active_staging_files: 0,
    };
  }
}

export async function executeSandboxedCommand(command, timeoutSecs = 60) {
  return await invoke('isolation_execute_command', { command, timeout_secs: timeoutSecs });
}

export async function stageSandboxedWrite(path, content) {
  return await invoke('isolation_stage_write', { path, content });
}

export async function validateSandboxedStaged() {
  return await invoke('isolation_validate_staged');
}

// ============================================================================
// Pillar 2: Native Semantic Graph & Context Wrappers
// ============================================================================

export async function getGraphStats() {
  try {
    return await invoke('graph_get_stats');
  } catch (e) {
    console.warn('[getGraphStats] IPC failed:', e);
    return {
      total_symbols: 0,
      total_edges: 0,
      total_files: 0,
      is_indexing: false,
    };
  }
}

export async function getGraphCallers(target) {
  try {
    return await invoke('graph_get_callers', { target });
  } catch (e) {
    console.warn('[getGraphCallers] IPC failed:', e);
    return [];
  }
}

export async function getGraphCallees(source) {
  try {
    return await invoke('graph_get_callees', { source });
  } catch (e) {
    console.warn('[getGraphCallees] IPC failed:', e);
    return [];
  }
}

export async function getGraphDependencies(symbol, maxDepth = 2) {
  try {
    return await invoke('graph_get_dependencies', { symbol, max_depth: maxDepth });
  } catch (e) {
    console.warn('[getGraphDependencies] IPC failed:', e);
    return [];
  }
}

export async function getGraphFocusedContext(symbol) {
  try {
    return await invoke('graph_get_focused_context', { symbol });
  } catch (e) {
    console.warn('[getGraphFocusedContext] IPC failed:', e);
    return null;
  }
}

// ============================================================================
// Pillar 3: Deterministic Diagnostics & Healing Loop Wrappers
// ============================================================================

export async function runDiagnosticsCheck(timeoutSecs = 30) {
  try {
    return await invoke('diagnostics_run_check', { timeout_secs: timeoutSecs });
  } catch (e) {
    console.warn('[runDiagnosticsCheck] IPC failed:', e);
    return [];
  }
}

export async function getDiagnosticsStatus() {
  try {
    return await invoke('diagnostics_get_status');
  } catch (e) {
    console.warn('[getDiagnosticsStatus] IPC failed:', e);
    return {
      toolchain: 'generic',
      is_available: false,
      last_error_count: 0,
      is_loop_detected: false,
      consecutive_failures: 0,
    };
  }
}

export async function resetDiagnosticsLoop() {
  try {
    return await invoke('diagnostics_reset_loop');
  } catch (e) {
    console.warn('[resetDiagnosticsLoop] IPC failed:', e);
    return false;
  }
}

export async function evaluateDiagnosticsHealing(timeoutSecs = 30) {
  try {
    return await invoke('diagnostics_evaluate_healing', { timeout_secs: timeoutSecs });
  } catch (e) {
    console.warn('[evaluateDiagnosticsHealing] IPC failed:', e);
    return null;
  }
}

// ============================================================================
// Pillar 4: Virtual File System (VFS) Diff Bridge & Checkpoints Wrappers
// ============================================================================

export async function getVfsStatus() {
  try {
    return await invoke('vfs_get_status');
  } catch (e) {
    console.warn('[getVfsStatus] IPC failed:', e);
    return {
      is_active: false,
      dirty_count: 0,
      checkpoint_count: 0,
      dirty_files: [],
    };
  }
}

export async function getVfsPendingDiffs() {
  try {
    return await invoke('vfs_get_pending_diffs');
  } catch (e) {
    console.warn('[getVfsPendingDiffs] IPC failed:', e);
    return [];
  }
}

export async function commitVfsAll() {
  try {
    return await invoke('vfs_commit_all');
  } catch (e) {
    console.warn('[commitVfsAll] IPC failed:', e);
    return null;
  }
}

export async function rollbackVfsAll() {
  try {
    return await invoke('vfs_rollback_all');
  } catch (e) {
    console.warn('[rollbackVfsAll] IPC failed:', e);
    return false;
  }
}

export async function createVfsCheckpoint(description) {
  try {
    return await invoke('vfs_create_checkpoint', { description });
  } catch (e) {
    console.warn('[createVfsCheckpoint] IPC failed:', e);
    return null;
  }
}

export async function rollbackVfsCheckpoint(checkpointId) {
  try {
    return await invoke('vfs_rollback_checkpoint', { checkpoint_id: checkpointId });
  } catch (e) {
    console.warn('[rollbackVfsCheckpoint] IPC failed:', e);
    return false;
  }
}



