// ==========================================================================
// Orbital X — Tauri IPC Service (tauri.js)
// ==========================================================================

let invokeFn = null;

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
          name: args.shell || 'powershell',
          cwd: args.cwd || 'D:\\1work\\YT\\Orbital X',
          is_alive: true,
        };
      case 'send_terminal_input':
        return true;
      case 'poll_terminal_output':
        return `PS ${args.session_id ? 'D:\\1work\\YT\\Orbital X' : ''}> \n`;
      case 'close_interactive_terminal':
        return true;
      case 'list_terminal_sessions':
        return [{ session_id: 'term_1', name: 'powershell', cwd: 'D:\\1work\\YT\\Orbital X', is_alive: true }];
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
      case 'clear_token_usage':
        return true;
      case 'open_folder_dialog':
        return 'D:\\1work\\YT\\Orbital X';
      case 'list_memories':
        return [];
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
  try {
    const res = await invoke('open_folder_dialog');
    if (res !== undefined) {
      return res; // either path string or null if cancelled
    }
  } catch (e) {
    console.warn("open_folder_dialog IPC failed, attempting client plugin dialog fallback:", e);
  }

  if (window.__TAURI__ && window.__TAURI__.dialog) {
    const res = await window.__TAURI__.dialog.open({ directory: true, multiple: false });
    return res || null;
  }

  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (dialog && dialog.open) {
      const res = await dialog.open({ directory: true, multiple: false });
      return res || null;
    }
  } catch (e) {
    console.warn("Tauri dialog plugin not available:", e);
  }

  // Pure browser preview fallback only (never in Tauri)
  if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) {
    return prompt("Enter workspace directory path:", "D:/1work/YT/Orbital X");
  }

  return null;
}

