# Plan: IDE Chat UX Improvements + Agent Power-Ups

## Issues Identified & Fixes

### 5. Drag & Drop Files to AI Chat
**Problem**: No drop zone on the chat panel — users can't drag files from explorer into the chat.
**Fix**: Add `dragover`/`dragleave`/`drop` handlers on the agent panel (`.composer-box` + `#agent-timeline`). When a file is dropped:
- Read the file via the existing `read_file` IPC
- Add it as a context attachment chip (reusing the existing `addAttachment` system)
- Show a glowing drop-zone highlight during dragover so users know it's a valid target

### 6. Attach Context Menu Goes Below Screen
**Problem**: `openAttachmentMenu()` positions the menu at `rect.bottom + 4` — the paperclip button is near the bottom of the window, so the 6-item menu renders off-screen.
**Fix**: Smart positioning — if `rect.bottom + menuHeight > window.innerHeight`, position ABOVE the button (`rect.top - menuHeight - 4`). Same flip logic for the slash-command and @-mention dropdowns which have the same issue.

### 7. Chat & Checkpoints Tabs
**Problem**: The tab bar only has 2 tabs (Chat, Checkpoints) — works but is minimal.
**Fix**: Keep the existing 2 tabs working cleanly, ensure tab state properly restores (Chat active by default on app start).

### 8. Resize AI Chat Sidebar — Wider Range
**Problem**: Agent panel max width is capped at 600px — too narrow for users who want a big chat.
**Fix**:
- Increase max from 600px → 50% of window width (dynamic, so on a 1920px screen users can go up to ~960px)
- Add **double-click on the resizer handle** to reset to default width (380px)
- Add a visual width indicator tooltip while dragging
- Persist the width (already exists via `initResizerPersistence`)

### 9. Outline & Timeline Buttons (Sidebar)
**Problem**: "Outline" and "Timeline" in the file explorer sidebar are static text headers with zero functionality.
**Fix**: Convert them into clickable, collapsible sections:
- **Outline**: Live symbol outline of the currently open file — lists functions, classes, variables with line numbers (parsed via Monaco's symbol API or regex). Click a symbol → jump to that line.
- **Timeline**: Git history for the currently open file — last 10 commits that touched it (hash, message, relative time). Click → show that commit's diff for the file.

### 10. Inline Diff View (VS Code Copilot Style)
**Problem**: File changes from the agent show as plain colored text lines in a small tool box — nothing like the polished green/red diff users expect.
**Fix** (two layers):
- **In the chat tool box**: When agent writes/patches a file, render a proper **side-by-side inline diff** using the unified diff data already returned by the backend — left column (old, red bg) / right column (new, green bg), with line numbers, collapsible to first 15 lines, "Show all" expands.
- **In the editor**: After the agent patches a file that's open, apply **Monaco deltaDecorations** with green/red line backgrounds showing exactly what changed (fades after 10 seconds). The file auto-scrolls to the first change.

### 11. Agent Finishes Real, Bigger Tasks
**Problem**: Agent caps at 30 iterations and the plan generator creates only 2-6 tasks — insufficient for multi-file project builds (e.g., "build me a full e-commerce app").
**Fix**:
- Increase default `maxIterations` from 30 → 60 (configurable in Settings)
- Increase plan task cap from 8 → 12 tasks per plan
- When the agent hits max iterations, show a **"Continue Task"** button in the summary card (one click resumes the loop for another 60 steps without losing context)
- Improve the system prompt to explicitly tell the model to break large projects into sequential phases and keep working through ALL of them

### Bonus Polish
- Add loading spinner on the Chat tab while the agent is running
- Smooth scroll to bottom when new tool results arrive (only if user is already near bottom)

## Files Modified
- `src/js/components/agent.js` — drag-drop, attach menu fix, diff rendering, continuation, iteration increase
- `src/js/components/file-tree.js` — Outline & Timeline sections
- `src/js/editor/monaco.js` — inline diff decorations
- `src/js/app.js` — resizer range increase + double-click reset
- `src/styles/polish.css` — drop-zone highlight, diff styles, outline/timeline styles
- `src-tauri/src/tools.rs` — no changes needed (diff data already returned)

## Verification
- `node --check` on all modified files
- `npm run build` pass
- `cargo test` 36/36 (no Rust changes expected)
- Commit + push to `Zcode/agent` branch only