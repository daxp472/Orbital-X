# Orbital X — Five Major Feature Upgrades Implementation Plan

**Author:** Google Antigravity  
**Project:** Orbital X (Windows-first AI-powered Desktop Coding IDE)  
**Date:** October 2026  
**Status:** Approved for Implementation (Executing Phase by Phase)  

---

## 1. Executive Summary & Scope

This implementation plan details the architecture, code modifications, testing procedures, and acceptance criteria for delivering **Five Major Feature Upgrades** to Orbital X without regressions to existing functionality:

1. **Feature 1 — Token Usage Counter & Analytics Dashboard**
2. **Feature 2 — Real Legacy-Style Interactive Terminal (VS Code-style session sidebar, live shell processes)**
3. **Feature 3 — Complete, Visually Consistent Light Mode (Comprehensive UI, Monaco & Terminal audit)**
4. **Feature 4 — Native Folder-Selection Dialog (Zero manual path entry, clean workspace lifecycle)**
5. **Feature 5 — Agent Implementation Plan Generation (Repo-aware planning workflow, interactive plan card, progress tracking)**

---

## 2. Baseline Architecture Audit & Current Defects

| Area | Current Implementation | Identified Defects / Limitations |
|---|---|---|
| **AI Providers & Tokens** | `src-tauri/src/providers.rs` drops token metadata from Ollama/OpenAI/Anthropic/Gemini. | Zero token tracking; users have no visibility into token consumption across day/week/month/lifetime. |
| **Terminal Subsystem** | `src-tauri/src/terminal.rs` spawns one-shot non-interactive `powershell.exe -Command` per line. | Not a real shell: `cd` state was spoofed in JS; variables do not persist; no live streaming or interactive stdin; no sessions sidebar. |
| **Light Theme** | `[data-theme="nebula-light"]` in `themes.css` with partial CSS tokens. | Low contrast on multiple surfaces, hardcoded dark backgrounds in modals, cards, status bar, and unreadable light terminal ANSI text. |
| **Workspace Folder Open** | `pickFolder()` in `src/js/services/tauri.js` falls back to `prompt()` when plugin isn't mounted. | Prompts user to type absolute Windows path; no native OS folder picker invoked directly from Rust backend. |
| **Agent Planning** | `agent.js` executes prompt turns immediately without structured multi-step planning. | Complex/architectural requests immediately start making ad-hoc file writes without a grounded, user-approved plan. |

---

## 3. Detailed Technical Plan per Feature

### Feature 1: Token Usage Counter & Dashboard
- **Backend (`src-tauri/src/providers.rs` & `src-tauri/src/usage.rs`)**:
  - Add `TokenUsage` struct: `prompt_tokens: Option<u64>`, `completion_tokens: Option<u64>`, `total_tokens: Option<u64>`, `is_estimated: bool`.
  - Extract reported tokens from:
    - **Ollama**: `prompt_eval_count`, `eval_count`.
    - **OpenAI**: `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`.
    - **Anthropic**: `usage.input_tokens`, `usage.output_tokens`.
    - **Gemini**: `usageMetadata.promptTokenCount`, `usageMetadata.candidatesTokenCount`, `usageMetadata.totalTokenCount`.
  - If a provider does not supply counts, calculate an estimated count (~4 chars/token) and explicitly flag `is_estimated = true`.
  - Create `UsageManager` with persistent storage in `~/.orbital/token_usage.json` (global, surviving restarts).
  - Tauri commands: `record_token_usage`, `get_token_usage_stats`, `clear_token_usage`.
- **Frontend (`src/js/components/usage.js` & `src/styles/components.css`)**:
  - Activity rail icon & status bar clickable token badge (`Tokens: 12.4K`).
  - Usage Dashboard Panel:
    - Today's Tokens, Input vs Output, Total Requests, Most Recent Request.
    - 7-Day interactive trend chart/bars.
    - Monthly and Lifetime counts.
    - Provider & Model breakdown with exact and formatted numbers.
    - Reported vs. Estimated ratio.

### Feature 2: Real Legacy-Style Interactive Terminal
- **Backend (`src-tauri/src/terminal.rs`)**:
  - Replace one-shot commands with a stateful `InteractiveTerminalManager`.
  - On Windows: Spawns real, long-running `powershell.exe` with `Stdio::piped()` for stdin, stdout, and stderr.
  - Asynchronously streams output to a lock-free session buffer and emits events to WebView.
  - Commands: `create_terminal_session`, `write_terminal_input`, `poll_terminal_output`, `close_terminal_session`, `list_terminal_sessions`.
  - Supports environment variables, working directory persistence (`cd` actually changes directory in the OS shell), `Ctrl+C` interrupt, and graceful cleanup on exit.
- **Frontend (`src/js/components/terminal.js` & `index.html`)**:
  - Restructure bottom panel to match VS Code integrated terminal:
    - Left/Center: Main terminal console with real command prompt `PS C:\...>`, smooth scrolling, ANSI rendering.
    - Right: Terminal Sessions Sidebar:
      - Header with `+` (New Terminal), Trash (Kill Session), Split indicator.
      - Session list: `1: powershell`, `2: powershell`, with active badge and process status indicator.

### Feature 3: Complete, Visually Consistent Light Mode
- **Theme Tokens (`src/styles/themes.css`)**:
  - Audit and refine all tokens for `[data-theme="nebula-light"]`:
    - `--bg-app: #f6f8fa`, `--bg-sidebar: #ffffff`, `--bg-editor: #ffffff`, `--bg-panel: #f6f8fa`, `--bg-surface: #ffffff`, `--bg-card: #f8fafc`.
    - `--border-color: #d0d7de`, `--border-subtle: #e1e4e8`.
    - `--text-primary: #1f2328`, `--text-secondary: #57606a`, `--text-muted: #6e7781`.
- **Monaco & Terminal Integration**:
  - Define custom Monaco theme `orbital-light-theme` with accessible syntax tokens and diff backgrounds.
  - Provide dedicated light-mode terminal ANSI color palette so black text renders crisply on light backgrounds.
- **Component Audit**:
  - Update all cards, modals, approval diff cards, popovers, status bar items, and tree nodes to use theme tokens rather than hardcoded dark hexes.

### Feature 4: Native Folder Picker & Clean Workspace Lifecycle
- **Backend (`src-tauri/src/lib.rs`)**:
  - Implement `#[tauri::command] async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String>` using `tauri_plugin_dialog::DialogExt`.
  - Native OS directory dialog opens directly without web prompt fallbacks.
- **Frontend Workspace Lifecycle**:
  - Connect all "Open Folder" triggers (`Ctrl+O`, Titlebar, Welcome Screen, Explorer button) to `open_folder_dialog()`.
  - Safe transition:
    - Check for unsaved changes and warn user.
    - Close previous tabs and clear editor models.
    - Update workspace root and file tree.
    - Reset project memory and update terminal default directory.
    - Update recent projects in `localStorage`.

### Feature 5: Agent Implementation Plan Generation
- **Analysis & Trigger**:
  - Detect high-complexity tasks: multi-file modifications, architecture refactors, new feature additions, or explicit `/plan` requests.
  - Preliminary repository inspection: runs workspace tools (`list_files`, `search_files`, `read_file`) before planning.
- **Structured Plan Model**:
  - `Objective`, `Current State`, `Proposed Solution`, `Affected Files` (with status), `Phases` (ordered steps with outcomes and verification), `Risks & Edge Cases`, `Testing Strategy`, `Acceptance Criteria`, `Scope Boundaries`.
- **UI & Execution Workflow**:
  - Render an interactive **Implementation Plan Card** in the agent timeline:
    - Action buttons: **Approve & Execute**, **Revise Plan**, **Cancel**.
    - Live progress badges per step (`not_started` ➔ `in_progress` ➔ `completed` / `failed`).
    - Step-by-step verified execution obeying active Agent Pro / Dev / User permission policies.

---

## 4. Execution Phases & Dependencies

```
Phase 1: Backend Providers & Token Usage Architecture (Feature 1)
  ↓
Phase 2: Real Interactive Shell Backend & Sessions Sidebar UI (Feature 2)
  ↓
Phase 3: Native Folder Picker Command & Workspace Lifecycle (Feature 4)
  ↓
Phase 4: Light Mode Visual Audit & Monaco/Terminal Styling (Feature 3)
  ↓
Phase 5: Agent Implementation Plan Generation Engine & UI (Feature 5)
  ↓
Phase 6: Integration, Testing, Regression Checks & Build Verification
```

---

## 5. Verification & Acceptance Criteria
- [ ] Real token usage recorded for Ollama, OpenAI, Anthropic, Gemini; visible in Dashboard.
- [ ] Interactive PowerShell session accepts stdin, executes long-running commands, preserves `cd` state.
- [ ] Light mode visually consistent across all panels, Monaco, and terminal with zero unreadable text.
- [ ] Native OS folder picker opens on `Ctrl+O` / Open Folder; cleans up previous project state cleanly.
- [ ] Agent generates structured, repo-grounded plans for complex tasks; updates real step progress on approval.
- [ ] All Cargo and Vite tests pass; production build succeeds.
