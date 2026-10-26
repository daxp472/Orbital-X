# Orbital X: Terminal, Context Management, Memory, Chat Export, Icons & Markdown Viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Orbital X into an Antigravity/VS Code-grade IDE by overhauling the bottom terminal to a dedicated Command Prompt console, adding context compacting/auto-pruning and persistent task memory to eliminate agent hallucinations and repeated questions, enabling a native save dialog for chat export, replacing raw emojis across settings and tabs with modern SVG icons, and implementing a rich Markdown preview viewer.

**Architecture:**
- **Terminal:** Focus bottom panel directly on a single, clean Terminal panel defaulting to `cmd.exe` on Windows with an integrated inline prompt, session tabs, and split support.
- **Context & Memory:** Interactive Context Meter with manual `Compact` and `Clear` controls, proactive auto-compaction before token overflow on 8k/16k models, and an execution memory tracker preventing hallucination and question repetition.
- **Chat Export:** Native file dialog via Tauri `pick_save_file` allowing users to choose their save destination.
- **Design & Icons:** SVG/Codicon icon system replacing unicode emojis in Settings and Agent tabs.
- **Markdown Viewer:** Integrated Markdown live preview panel in Monaco with toggle button (`Ctrl+Shift+V`) and GitHub/Antigravity-styled rendering.

**Tech Stack:** JavaScript (ES Modules), HTML5, CSS3, Monaco Editor, Rust (Tauri v2), Windows Command Prompt / PowerShell.

---

## Global Constraints
- Keep all paths relative to workspace root for file operations.
- Avoid external npm dependencies; use vanilla JavaScript and CSS tokens already in the project.
- Native file operations must use Tauri IPC `invoke`.

---

## Tasks

### Task 1: Native Chat Export with File Picker Dialog
**Files:**
- Modify: `src-tauri/src/lib.rs` (ensure `pick_save_file` Tauri command is clean and registered)
- Modify: `src/js/components/chat-sessions.js:104-154`
- Modify: `src/js/services/tauri.js` (expose `pickSaveFile` helper)

- [ ] **Step 1: Verify `pick_save_file` command in `src-tauri/src/lib.rs`**
  Check that `pick_save_file(app, default_name, description)` returns `Result<Option<String>, String>` using `tauri_plugin_dialog::DialogExt`.
- [ ] **Step 2: Add `pickSaveFile` helper in `src/js/services/tauri.js`**
  Add `export async function pickSaveFile(defaultName, filters)` that calls `invoke('pick_save_file', { default_name: defaultName })`.
- [ ] **Step 3: Update `exportActiveSessionMarkdown` in `chat-sessions.js`**
  Prompt user with `pickSaveFile`, save via `invoke('save_file', { path, content })`, and show toast confirmation.
- [ ] **Step 4: Verify chat export flow**
  Test clicking export chat in the UI and confirm it opens the native save dialog.

---

### Task 2: Terminal Overhaul (Dedicated Command Prompt, Remove Extra Tabs)
**Files:**
- Modify: `index.html:470-525`
- Modify: `src/js/components/terminal.js`
- Modify: `src/styles/layout.css` and `src/styles/polish.css`

- [ ] **Step 1: Simplify Panel Header in `index.html`**
  Replace the 6 panel tabs (`Problems`, `Output`, `Debug Console`, `Terminal`, `Ports`, `Validation Suite`) with a clean single `TERMINAL` header title with session tab integration.
- [ ] **Step 2: Set Windows default shell to `cmd`**
  In `src/js/components/terminal.js`, set default shell on Windows to `cmd` (`Command Prompt`) so it opens directly with `cmd.exe`.
- [ ] **Step 3: Polish the inline terminal prompt**
  Ensure the prompt line sits seamlessly at the bottom of the output scroll buffer with no disjointed "Run" button or standalone bar.
- [ ] **Step 4: Verify terminal interaction**
  Run commands (`dir`, `echo hello`, `cls`) and test Arrow Up/Down history and Ctrl+L clear.

---

### Task 3: Context Compacting & Auto-Pruning for 8k/16k Models
**Files:**
- Modify: `index.html:610-645`
- Modify: `src/js/components/agent.js`
- Modify: `src/styles/layout.css`

- [ ] **Step 1: Context Meter & Compact/Clear Controls in `index.html`**
  Verify `#agent-context-meter`, `#btn-compact-context`, and `#btn-clear-agent-context` in the agent panel header.
- [ ] **Step 2: Implement Intelligent Compaction in `agent.js`**
  Condense middle turns into a summary while preserving the first user message (task anchor), active orchestrator plan, and the last 6 messages.
- [ ] **Step 3: Implement Auto-Compaction Before Turn Dispatch**
  In `dispatchAgentTurn`, if estimated prompt tokens exceed `numCtx * 0.75`, automatically trigger `compactAgentContext()` before making the API request.
- [ ] **Step 4: Test context meter updates and compaction**
  Verify context meter percentage and bar colors (green -> orange -> red) as turns progress.

---

### Task 4: Persistent Task Memory & Anti-Repetition Guard
**Files:**
- Modify: `src/js/components/agent.js`
- Modify: `src/js/services/orchestrator.js`

- [ ] **Step 1: Add Session Task Memory and Decision Store in `agent.js`**
  Maintain `activeSessionMemory = { completedActions: [], userDecisions: [] }`.
- [ ] **Step 2: Record Tool Executions & User Answers**
  Whenever a tool succeeds, add it to `completedActions`. Whenever the user answers a question, record it in `userDecisions`.
- [ ] **Step 3: Inject Memory into System Prompt**
  Add `## COMPLETED ACTIONS (DO NOT REPEAT)` and `## USER DECISIONS & ANSWERS (NEVER RE-ASK)` sections with strict anti-hallucination and anti-repetition rules.
- [ ] **Step 4: Verify agent behavior**
  Verify the agent acknowledges previous decisions without asking the user again.

---

### Task 5: Replace Settings & App Emojis with Clean SVG Icons
**Files:**
- Modify: `index.html:775-810` (Settings sidebar tabs)
- Modify: `index.html:625-645` (Agent tabs & buttons)
- Modify: `src/js/components/settings.js`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Replace Settings sidebar emojis with SVGs**
  Replace `⚙️`, `🧠`, `🎨`, `🛡️`, `💻`, `📦` with clean 16x16 SVG icons.
- [ ] **Step 2: Replace Agent tabs emojis with SVGs**
  Replace `💬 Chat`, `🕘 Checkpoints`, `🗜️ Compact`, `✕ Clear` with sleek SVG icons and clean typography.
- [ ] **Step 3: Replace Terminal action emojis with SVGs**
  Replace `🤖 Share with AI` and profile dots with clean SVGs.
- [ ] **Step 4: Verify visual consistency**
  Inspect the modal settings and main interface to ensure no awkward unicode emojis remain.

---

### Task 6: Rich Markdown (.md) Viewer & Previewer
**Files:**
- Modify: `index.html:435-465` (Editor tab action buttons)
- Modify: `src/js/editor/monaco.js`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Add Markdown Preview Toggle Button in Editor Header**
  Add `#btn-toggle-markdown-preview` icon button (and register `Ctrl+Shift+V`).
- [ ] **Step 2: Add Markdown Preview Container in Editor Pane**
  Create `#markdown-preview-pane` styled with GitHub/Antigravity typography, headings, code syntax highlights, tables, and task lists.
- [ ] **Step 3: Wire Live Markdown Rendering**
  When a `.md` file is open, clicking the preview button toggles between Monaco text editor and rich rendered view. Live-update preview on typing.
- [ ] **Step 4: Test opening `.md` files**
  Open `README.md` or `RELEASE_NOTES_v2.2.2.md` and verify preview rendering.

---

### Task 7: Build & Full Verification
**Files:**
- Run: `npm run build`
- Run: `cargo test` in `src-tauri`
- Run: `npx tauri build --bundles nsis`

- [ ] **Step 1: Build frontend and verify no bundling errors**
- [ ] **Step 2: Run Rust backend test suite**
- [ ] **Step 3: Rebuild release installer and copy to `release/`**
- [ ] **Step 4: Verify all 8 items function seamlessly**
