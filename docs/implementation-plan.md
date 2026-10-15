# Orbital X — Implementation Plan

**Product:** Orbital X (Windows-first AI-powered Desktop IDE)  
**Technology Stack:** Tauri 2 (Rust) + Vanilla HTML / CSS / Modern JavaScript (ES Modules, No React, No TypeScript) + Monaco Editor  
**Date:** October 2026  
**Status:** In Progress (Milestone 0 Complete, Moving to Milestone 1 & 2)

---

## 1. System Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                              Orbital X Desktop Shell                              |
+-----------------------------------------------------------------------------------+
|  Frontend (WebView2 / Tauri 2 Client)                                             |
|  - Vanilla HTML5 / Modern CSS (Custom Design System, Tokens, 3 Themes)            |
|  - Vanilla JavaScript ES Modules (State Store, Event Bus, UI Components)          |
|  - Monaco Editor Integration (Tabs, Syntax Highlighting, Diff Editor, Markers)   |
|  - AI Agent Panel (Pro / Dev / User Modes, Timeline, Approval Cards, Diff Review) |
|  - Output Panels (Integrated Terminal/Runner, Logs, Problems, Memory)             |
+----------------------------------------+------------------------------------------+
                                         | Tauri IPC (Strictly Scoped Commands)
+----------------------------------------v------------------------------------------+
|  Rust Core (src-tauri)                                                            |
|  - Policy & Permission Engine: Centrally enforces Pro / Dev / User mode policies  |
|  - Workspace & File System Service: Canonicalized paths, boundary checks, diffs   |
|  - Agent Engine & Tool Registry: Validated tools (read, search, edit, patch, cmd) |
|  - Process & Terminal Runner: Safe subprocess execution, timeouts, cancellation   |
|  - Provider Adapters: Anthropic Claude, OpenAI, Google Gemini, Ollama (Local)     |
|  - Secure Storage: Windows Credential Manager integration for keys, SQLite/JSON   |
|  - Local Project Memory & Change Journal: Reversible edits, persistent settings   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Core Decisions & Technical Trade-offs

1. **Frontend Architecture:**
   - **Choice:** Pure Vanilla JavaScript (ES Modules) + Semantic HTML5 + Custom CSS Tokens.
   - **Rationale:** Strict adherence to PRD. Zero framework overhead, ultra-fast rendering, low idle memory footprint, long-term stability.
   - **Design Aesthetics:** Dark-first ("Orbit Dark", "Nebula Light", "Solarized / Midnight Blue"), glassmorphism highlights, glowing accents, polished typography (Inter / JetBrains Mono), responsive panel resizers.

2. **Editor Engine:**
   - **Choice:** Monaco Editor via local distribution.
   - **Rationale:** Native VS Code editing feel, rock-solid diff editor (essential for agent change reviews), syntax highlighting for 50+ languages, find/replace, minimap, line numbers.

3. **Security & Autonomy Boundaries:**
   - **Choice:** All permissions and tool calls evaluated inside Rust, NOT in the WebView.
   - **Modes:**
     - **Agent Pro Mode:** High autonomy within workspace. File reads, searches, and allowlisted edits/commands run without friction; destructive commands and external transfers blocked.
     - **Dev Mode:** Default mode. Reads and searches automatic; file edits show diffs; terminal commands and consequential actions require approval cards.
     - **User Mode:** Explicit per-operation approval card for each file read, file edit, or command.
   - Path traversal (`..`), symlink escapes outside the workspace root, and credential file leaks are strictly rejected in Rust.

4. **Model Provider Strategy:**
   - Unified internal tool interface: `read_file`, `write_file`, `apply_patch`, `search_files`, `list_files`, `run_command`, `get_diff`, `save_project_memory`, `search_project_memory`, `run_tests`, `run_build`.
   - Streaming text and function/tool-calling supported across:
     - **Anthropic Claude** (Official Messages API)
     - **OpenAI** (Chat Completions tool-calling API)
     - **Google Gemini** (Gemini API with function calling)
     - **Ollama** (Local HTTP server with model discovery and tool calling)
   - Fallback graceful handling if a local model does not support tool calling.

5. **Storage & Memory:**
   - Project instructions & durable memories stored in `.orbital/memory.json` or local SQLite within project.
   - Global application settings and secret keys stored in OS-secure local store.

---

## 3. Implementation Milestones

- [x] **Milestone 0: Audit & Architecture Blueprint**
  - Toolchain verified: Rust 1.98.1, Cargo 1.98.1, Node v24.12.0, npm 11.6.2, Tauri CLI 2.12.3.
  - Stack confirmed: Tauri 2 + Rust backend + Vanilla JS/CSS/HTML frontend + Monaco Editor.
  - Implementation plan committed.

- [ ] **Milestone 1: Desktop Shell, Window Chrome & Visual Foundation**
  - Initialize Tauri 2 project structure (`src-tauri` and `src`).
  - Original Orbital X vector branding / logo (SVG, ICO/PNG for Windows).
  - Main IDE Layout: Activity rail, File Explorer sidebar, Tabbed Editor region, Agent Dock/Panel, Bottom Terminal/Validation panel, Status bar.
  - Theming engine with 3 themes: Orbit Dark (default), Nebula Light, Midnight Blue.
  - Smooth panel splitter / resizer controls.

- [ ] **Milestone 2: Workspace Management & Monaco Editor Integration**
  - Rust Tauri commands for workspace folder picking, file tree recursion, file reading, file saving.
  - Monaco editor mounting with tab management, dirty-state indicators, keyboard shortcuts (Ctrl+S, Ctrl+P, Ctrl+F).
  - Unsaved change warnings, binary file detection, and boundary checks.

- [ ] **Milestone 3: Model Provider Layer & Settings**
  - Provider abstraction in Rust / JS (`ProviderAdapter` trait / contract).
  - Connectors for Anthropic, OpenAI, Gemini, and Ollama.
  - Dedicated "Models & Providers" settings UI with masked API key inputs, test connection buttons, model listings.
  - Safe credential handling.

- [ ] **Milestone 4: Agent Orchestrator & Read/Context Loop**
  - Tool registry: `workspace_info`, `list_files`, `search_files`, `read_file`, `read_file_range`.
  - Context collector (workspace map, file summaries, ignore rules like `.git`, `node_modules`).
  - Agent chat interface with multiline composer, token usage, streaming response, and live tool activity timeline.

- [ ] **Milestone 5: Multi-File Editing, Diffs & Undo Engine**
  - Tools: `create_file`, `write_file`, `apply_patch`, `get_diff`, `undo_agent_change`.
  - Monaco Diff Editor modal / inline view for reviewing proposed changes before or after application.
  - Journaled change history to revert agent edits safely without wiping manual changes.

- [ ] **Milestone 6: Terminal Runner, Git & Validation Loop**
  - Rust process execution engine with stdout/stderr streaming, timeouts, process kill.
  - Tools: `run_command`, `git_status`, `git_diff`, `git_stage`, `git_commit`.
  - Automated project validation: `run_tests`, `run_build`, `run_linter`.
  - Bounded automatic repair loops (up to 3 retries).

- [ ] **Milestone 7: Centrally Enforced 3 Modes (Pro, Dev, User) & Memory**
  - Rust policy engine validating every tool call against current active mode.
  - Approval cards in the UI for Dev and User modes with risk badges, target preview, and diff view.
  - Persistent project memory: `save_project_memory`, `search_project_memory`, memory viewer/editor.

- [ ] **Milestone 8: Onboarding Wizard, Settings Import/Export & Polish**
  - First-run guided setup modal (Welcome -> AI Setup -> Mode Selection -> Theme -> Open Workspace -> Mini-tour).
  - Settings import/export (JSON, sanitizing API keys).
  - Diagnostics and logging view.

- [ ] **Milestone 9: Windows Packaging, Verification & Documentation**
  - Verify cargo build and Tauri bundling configuration.
  - Complete README, user guide, and troubleshooting documentation.
  - Acceptance criteria validation.
