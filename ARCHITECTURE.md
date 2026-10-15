# Orbital X — Architecture Guide

> Deep technical reference for contributors and integrators.

---

## Table of Contents

- [Technology Stack](#technology-stack)
- [High-Level Architecture](#high-level-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [AI Agent System](#ai-agent-system)
- [Permission & Policy Engine](#permission--policy-engine)
- [Memory System](#memory-system)
- [Workspace & File System Layer](#workspace--file-system-layer)
- [Provider Abstraction Layer](#provider-abstraction-layer)
- [Terminal Engine](#terminal-engine)
- [Chat Session Management](#chat-session-management)
- [IPC Command Registry](#ipc-command-registry)
- [Build Pipeline](#build-pipeline)

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Desktop Shell** | Tauri 2 (Rust) | Native Windows integration, minimal memory, no Electron bloat |
| **UI Runtime** | WebView2 (Microsoft Edge) | Ships with Windows 10/11, zero install overhead |
| **Frontend** | Vanilla HTML/CSS/JS (ES Modules) | Zero build-time complexity, direct DOM control, fastest iteration |
| **Code Editor** | Monaco Editor v0.52 | Same engine as VS Code, 50+ language grammars, full API |
| **Styling** | Vanilla CSS with design tokens | Complete control, zero runtime overhead |
| **AI Providers** | reqwest + custom adapters | Unified request/response normalization across providers |
| **Persistence** | Local filesystem (`~/.orbital/`) + localStorage | Offline-first, no cloud dependency |
| **IPC** | Tauri `invoke()` commands | Type-safe async bridge between WebView and Rust |
| **Diffing** | `similar` Rust crate | Fast, accurate unified diff generation |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Orbital X Desktop App                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  WebView2 (Frontend)                  │  │
│  │                                                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │  │
│  │  │  Monaco  │  │ AI Agent │  │   Chat Sessions    │ │  │
│  │  │  Editor  │  │ Panel    │  │   & History        │ │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘ │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │  │
│  │  │ File     │  │ Terminal │  │   Memory Sidebar   │ │  │
│  │  │ Explorer │  │ Engine   │  │   & Settings       │ │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘ │  │
│  │                                                      │  │
│  │              Tauri IPC Bridge (invoke())              │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                               │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │                   Rust Backend (lib.rs)               │  │
│  │                                                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │  │
│  │  │ Policy   │  │Workspace │  │   Memory Service   │ │  │
│  │  │ Engine   │  │ Service  │  │   (CRUD + Dedup)   │ │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘ │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │  │
│  │  │ Provider │  │Terminal  │  │   Git Integration  │ │  │
│  │  │ Adapters │  │ Service  │  │   (status, diff)   │ │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              External Services (optional)               │ │
│  │   Anthropic API  │  OpenAI API  │  Gemini API          │ │
│  │                  Ollama (local)                        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Module Dependency Graph

```
app.js (DOMContentLoaded entry)
  ├── state/store.js          (global state + localStorage)
  ├── services/tauri.js       (IPC bridge)
  ├── editor/monaco.js        (editor + tabs)
  ├── onboarding/wizard.js    (first-launch flow)
  ├── components/
  │   ├── agent.js            (AI agent orchestrator)
  │   │   ├── chat-sessions.js (session persistence)
  │   │   └── memory.js       (memory refresh trigger)
  │   ├── terminal.js         (terminal engine)
  │   ├── file-tree.js        (file explorer + workspace load)
  │   ├── memory.js           (memory sidebar)
  │   ├── model-picker.js     (LLM model selector)
  │   ├── settings.js         (settings modal)
  │   ├── source-control.js   (git panel)
  │   └── extensions.js       (extensions catalog)
  └── styles/
      ├── tokens.css
      ├── themes.css
      ├── layout.css
      └── components.css
```

### State Management (`store.js`)

The global state object is a plain JS object:

```js
state = {
  workspace: { rootPath: null, files: [], openFolders: {} },
  editor: { tabs: [], activeTabId: null, unsavedContent: {} },
  ai: {
    provider: 'ollama',        // active provider
    model: 'llama3:latest',    // active model
    endpoint: 'http://localhost:11434',
    keys: { ollama:'', claude:'', openai:'', gemini:'' },
    defaultModels: { ollama:'llama3:latest', claude:'claude-3-5-sonnet-20241022', ... },
    isGenerating: false,
  },
  agentMode: 'agent_pro',     // 'agent_pro' | 'dev' | 'user'
  conversation: [],            // OpenAI-compatible message array
  memories: [],                // Cached list of ProjectMemory objects
  theme: 'orbit-dark',
}
```

Mutations call `persistState()` which writes relevant slices to `localStorage`.

---

## Backend Architecture

### Rust Module Overview (`src-tauri/src/`)

| File | Responsibility |
|------|--------------|
| `main.rs` | App entry: creates Tauri builder and launches window |
| `lib.rs` | All `#[tauri::command]` handlers — the public IPC surface |
| `policy.rs` | `PolicyEngine`: evaluates tool calls against the active mode |
| `workspace.rs` | `WorkspaceService`: safe path resolution, file I/O, diff gen |
| `memory.rs` | `MemoryService`: CRUD + smart deduplication for `.orbital/memory.json` |
| `terminal.rs` | `TerminalService`: async process spawning with timeout + safety filter |
| `providers.rs` | `AIProvider`: unified adapter for Claude, OpenAI, Gemini, Ollama |
| `tools.rs` | Tool definitions in OpenAI function-calling JSON schema format |

---

## AI Agent System

### Execution Loop (`agent.js → runAgentLoop`)

```
runAgentLoop(initialUserPrompt)
  │
  ├── 1. Load memories from invoke('list_memories')
  │        → inject as "## Durable Project Knowledge" in system prompt
  │
  ├── 2. Load active editor file context
  │        → append as "## Focused Editor Context" in system prompt
  │
  ├── 3. Build OpenAI-compatible message array:
  │        [ { role: 'system', content: enrichedSystemPrompt },
  │          ...state.conversation ]
  │
  ├── 4. invoke('agent_dispatch_turn', { provider, model, messages, ... })
  │        → Rust providers.rs sends HTTP request to AI API
  │        → Returns { content, tool_calls[] }
  │
  ├── 5. Append assistant message to conversation
  │
  └── 6. For each tool_call:
           ├── invoke('evaluate_tool_policy', { toolName, target, mode })
           │       → policy.rs returns { requires_approval, risk, reason }
           ├── If requires_approval: show approval card UI, await user
           ├── invoke('execute_tool', { name, arguments, mode })
           └── Append tool result to conversation
               └── If tool = save_project_memory: refresh memory sidebar
```

### Auto Memory Extraction

After each agent turn that does NOT explicitly call `save_project_memory`, the system checks `checkAndAutoExtractMemory(prompt, response)`:
- Detects architecture/structure/overview keywords in the user prompt.
- If matched and response is substantial (>100 chars), auto-upserts to project memory.
- Deduplication in `MemoryService.save_memory()` prevents accumulation.

---

## Permission & Policy Engine

### File: `src-tauri/src/policy.rs`

The `PolicyEngine` maps `(tool_name, agent_mode)` → `PolicyDecision`:

```rust
struct PolicyDecision {
    allows: bool,
    requires_approval: bool,
    risk: RiskLevel,   // "Low" | "Medium" | "High"
    reason: String,
}
```

**Mode × Tool Matrix:**

| Tool Category | Agent Pro | Dev Mode | User Mode |
|--------------|-----------|----------|-----------|
| `read_file`, `search_files`, `list_directory` | Auto | Auto | Approval |
| `write_file`, `create_file` | Auto | Approval + Diff | Approval + Diff |
| `run_command` (safe: test/build) | Auto | Approval | Approval |
| `run_command` (arbitrary) | Approval | Approval | Approval |
| `save_project_memory` | Auto | Auto | Auto |
| Destructive (`format`, `rmdir /s`, etc.) | **Blocked** | **Blocked** | **Blocked** |

All decisions are enforced in Rust — the WebView cannot bypass them.

---

## Memory System

### File: `src-tauri/src/memory.rs`

**Storage:** `.orbital/memory.json` in the workspace root.

```json
[
  {
    "id": "uuid-v4",
    "timestamp": "2026-10-15T09:14:52Z",
    "category": "architecture",
    "title": "Project Structure Overview",
    "content": "The project uses Tauri 2 + Vite frontend..."
  }
]
```

**Deduplication Strategy:**
- `save_memory(category, title, content)` normalizes category and title (trim + lowercase).
- If an entry with matching `(category, title)` exists → **upsert in place** (update content + timestamp).
- If no match → **append new entry**.
- `load_memories()` also runs a deduplication pass on load, writing cleaned results back to disk if duplicates are found.

---

## Workspace & File System Layer

### File: `src-tauri/src/workspace.rs`

**Path Security:** Every path operation calls `validate_path(root, target)`:
```rust
fn validate_path(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let canonical = target.canonicalize()?;
    if !canonical.starts_with(root) {
        return Err("Path traversal outside workspace is not permitted");
    }
    Ok(canonical)
}
```

**Diff Generation:** Uses the `similar` crate for unified diffs:
```rust
fn compute_diff(old: &str, new: &str) -> String {
    TextDiff::from_lines(old, new)
        .unified_diff()
        .header("original", "proposed")
        .to_string()
}
```

---

## Provider Abstraction Layer

### File: `src-tauri/src/providers.rs`

Each provider implements the same normalized request/response contract:

```
agent_dispatch_turn(provider, api_key, model, base_url, messages)
  │
  ├── "ollama"     → POST /api/chat (stream=false)
  ├── "anthropic"  → POST /v1/messages (anthropic-version: 2023-06-01)
  ├── "openai"     → POST /v1/chat/completions
  └── "gemini"     → POST /v1beta/models/{model}:generateContent
       ↓
  Returns: AgentResponse { content: String, tool_calls: Vec<ToolCall> }
```

Tool calls from providers are normalized to a common `ToolCall { id, name, arguments }` shape regardless of the provider's native format.

---

## Terminal Engine

### File: `src/js/components/terminal.js`

**Multi-instance Architecture:**
- `TerminalSession` class: tracks `id`, `name`, `cwd`, `history[]`, `historyIndex`, `buffer`.
- Multiple instances displayed as tabs in the terminal header.
- `createTerminalInstance()` → new session, `switchTerminalInstance(id)` → swap active.

**Built-in Commands (handled client-side, no IPC):**
- `cls` / `clear` → clears buffer
- `cd <dir>` → updates `session.cwd` + prompt label
- `exit` → closes terminal instance

**Execution flow (non-built-in commands):**
1. Append `\nPS {cwd}> {command}\n` to buffer.
2. `invoke('run_command', { command, timeout_seconds: 60 })`
3. Backend spawns PowerShell (Windows) or sh (Unix) via `tokio::process::Command`.
4. Stdout + stderr streamed back, appended to buffer.
5. `updatePromptDisplay()` refreshes the CWD prompt label.

---

## Chat Session Management

### File: `src/js/components/chat-sessions.js`

Sessions stored in `localStorage['orbital_chat_sessions']` as:

```json
[
  {
    "id": "session-1728970000000",
    "title": "Refactor the file tree module",
    "createdAt": "2026-10-15T09:00:00Z",
    "updatedAt": "2026-10-15T09:45:00Z",
    "mode": "agent_pro",
    "messages": [ { "role": "user", "content": "..." }, ... ]
  }
]
```

**Auto-title:** If a session's title is still generic, the first user message becomes the title (truncated at 34 chars).

**Switch/Restore:** `switchSession(id)` saves the current session, loads the target session's `messages[]` into `state.conversation`, and calls `renderFullTimeline(messages)` to rebuild the agent chat UI.

---

## IPC Command Registry

All commands registered in `lib.rs`:

| Command | Parameters | Returns | Module |
|---------|-----------|---------|--------|
| `get_workspace_meta` | — | `WorkspaceMeta` | workspace |
| `read_file` | `path` | `FileData` | workspace |
| `write_file` | `path, content` | `bool` | workspace |
| `list_directory` | `path` | `[FileEntry]` | workspace |
| `get_file_diff` | `path, new_content` | `DiffResult` | workspace |
| `run_command` | `command, timeout_seconds` | `CommandResult` | terminal |
| `agent_dispatch_turn` | `provider, api_key, model, base_url, messages` | `AgentResponse` | providers |
| `evaluate_tool_policy` | `tool_name, target, mode` | `PolicyDecision` | policy |
| `execute_tool` | `name, arguments, mode` | `serde_json::Value` | lib |
| `save_memory_entry` | `category, title, content` | `ProjectMemory` | memory |
| `list_memories` | — | `[ProjectMemory]` | memory |
| `delete_memory` | `id` | `bool` | memory |
| `get_git_status` | — | `GitStatus` | lib (git2) |
| `git_stage_and_commit` | `message` | `String` | lib (git2) |
| `get_git_diff` | `path` | `String` | lib (git2) |
| `get_ollama_models` | — | `[String]` | providers |
| `test_provider_connection` | `provider, api_key, model, base_url` | `ConnectionTestResult` | providers |

---

## Build Pipeline

```
npx tauri build --bundles nsis
  │
  ├── 1. beforeBuildCommand: npm run build
  │        → Vite bundles frontend → dist/
  │
  ├── 2. cargo build --release
  │        → Compiles Rust backend
  │        → Embeds dist/ into binary via Tauri asset protocol
  │
  ├── 3. Patching: embed bundle type metadata into binary
  │
  └── 4. makensis
           → Packages binary + icons + license into NSIS installer
           → Output: src-tauri/target/release/bundle/nsis/
                     Orbital X_<version>_x64-setup.exe
```

**Installer features (NSIS):**
- Scope selector: Current User (no elevation) or All Users (Admin)
- License agreement step (LICENSE.txt)
- Custom install directory picker
- Start Menu + Desktop shortcuts
- Uninstaller registered in Windows Settings → Installed Apps
