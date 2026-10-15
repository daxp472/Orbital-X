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

// Dialog picker for workspace folder
export async function pickFolder() {
  if (window.__TAURI__ && window.__TAURI__.dialog) {
    return window.__TAURI__.dialog.open({ directory: true, multiple: false });
  }

  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (dialog && dialog.open) {
      return await dialog.open({ directory: true, multiple: false });
    }
  } catch (e) {
    console.warn("Tauri dialog plugin not available:", e);
  }

  // Fallback prompt for web preview or manual entry
  return prompt("Enter workspace directory path:", "D:/1work/YT/Orbital X");
}
