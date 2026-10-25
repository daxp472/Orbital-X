# ZCODE PROMPT 4/4 — ORBITAL X: Polish, Performance, UI/UX & Production-Readiness
## Branch: `Zcode/agent` — ALL commits go here. NEVER push to main.

---

## MISSION BRIEF

This is the final and most important prompt. It makes Orbital X feel like a **premium, production-quality IDE** that developers love to use every day. Focus on visual polish, performance, accessibility, notifications, onboarding, and every small detail that separates a good IDE from a great one.

Repository: `d:\1work\YT\Orbital X`
Branch: `Zcode/agent` — switch first: `git checkout Zcode/agent`

**READ THESE FILES BEFORE STARTING:**
- `src/js/app.js` — main app initialization
- `index.html` — full HTML structure
- `src/styles/components.css` — component styles
- `src/styles/themes.css` — theme variables
- `src/js/onboarding/wizard.js` — onboarding wizard

---

## PART K: Notifications & Activity Center (~2,000 LOC)

### K1. Toast Notification System (Premium)
**Create:** `src/js/services/notifications.js`
```javascript
export function showToast(message, type = 'info', durationMs = 3000, actions = [])
// types: 'info' | 'success' | 'warning' | 'error'
// actions: [{ label: 'Undo', onClick: fn }, { label: 'Open', onClick: fn }]
```
- Toasts appear bottom-right, animate in from right (slide + fade)
- Stack vertically with 8px gap between them (newest on top)
- Each toast has: icon matching type, message, optional action buttons, close button
- Auto-dismiss after durationMs with a progress bar animation
- Hover pauses the timer; mouse-out resumes
- Max 5 toasts visible at once (oldest auto-dismissed when 6th arrives)
- Use `showToast` everywhere alerts/console.log are used for user feedback:
  - File saved → success toast "Saved src/main.rs"
  - Agent tool success → info toast (for write_file, run_command)
  - Build errors → error toast with "Show" button
  - Git push success → success toast "Pushed to origin/main"

### K2. Activity Center Panel
- A bell icon (🔔) in the right area of the titlebar
- Clicking opens a slide-in panel from the right ("Activity Center")
- Shows ALL recent notifications (last 50) with timestamp, icon, message
- "Clear All" button at top
- Click a notification to navigate to the relevant file/location
- Unread count badge on the bell icon
- Store all notifications in `state.notifications` array (max 50)

### K3. System Tray Integration (via Tauri)
- Show Orbital X in the system tray when minimized (Tauri's `tauri-plugin-notification` or custom)
- Tray icon menu: Open / Recent Files / Quit
- When a long-running agent task completes while the window is minimized: send a native system notification "✅ Orbital X: Task completed" using Tauri's notification API

---

## PART L: File Manager Panel (~2,500 LOC)

### L1. File Explorer Improvements
**Files:** `src/js/components/file-tree.js`, `src/styles/components.css`

- **File creation:** Right-click on folder → "New File" → inline text input appears in the tree at that location, user types filename and presses Enter to create. Call `invoke('save_file', { path, content: '', description: 'New file' })`
- **Folder creation:** Right-click → "New Folder" → inline input, call `invoke('create_directory', { path })`
- **Drag & drop in file tree:** Drag files/folders to move them. Use the existing `rename_file` tool to perform the move. Show a drop indicator (blue line) where the item will be placed.
- **Multi-select in file tree:** Hold Ctrl and click to select multiple files. Hold Shift+click to select a range. Actions (delete, move, copy path) work on all selected files.
- **File icons using Devicons:** Load the [Devicons](https://devicons.github.io) CSS font (CDN) and use proper file-type icons instead of emoji. Map extensions to devicon classes: `.js→devicon-javascript-plain`, `.ts→devicon-typescript-plain`, `.rs→devicon-rust-plain`, `.py→devicon-python-plain`, `.html→devicon-html5-plain`, `.css→devicon-css3-plain`, `.json→devicon-json-plain`, `.md→markdown icon`, etc.
- **Search in file tree:** A filter input at the top of the explorer panel. As user types, the tree filters to show only matching file names (hide non-matching, keep folder hierarchy). Highlight the matched substring.

### L2. Recent Files
- A "Recent" section at the top of the file explorer (collapsible)
- Shows last 10 opened files with filename and relative path
- Store in `state.recentFiles` array (persist to localStorage, max 10 items)
- Clicking a recent file opens it in the editor
- "Clear Recents" button

### L3. Bookmarks / Favorites
- Right-click a file → "Add to Favorites" → adds a ⭐ next to it in the tree and to a "Favorites" section at the top of the file explorer
- Favorites section: collapsible, shows all bookmarked files
- Right-click a bookmark → "Remove from Favorites"
- Persist favorites to `.orbital/favorites.json` in the workspace

### L4. File Properties Panel
- Right-click a file → "Properties" → shows a small panel with:
  - Full path
  - File size (human-readable: KB, MB)
  - Last modified date
  - Line count
  - Language detected
  - Encoding
  - Git status (modified/staged/untracked/clean)

---

## PART M: Workspace & Project Management (~2,000 LOC)

### M1. Recent Workspaces
- When no workspace is open: show a "Welcome" screen with:
  - Orbital X logo (centered, large)
  - "Open Folder" button (main CTA)
  - "Recent Workspaces" list (last 5 workspaces with name, path, last-opened time)
  - Click recent workspace to re-open it
- Store in localStorage: `orbital_recent_workspaces`
- Also add "Recent Workspaces" to the titlebar menu

### M2. Workspace Trust
- When a new workspace is opened: show a one-time trust dialog
  "Do you trust the authors of this workspace? This will allow the agent to execute code in this directory."
  - "Trust Workspace" → grant full permissions (Agent Pro mode allowed)
  - "Open in Restricted Mode" → force User mode, agent cannot execute commands
- Store trust decision per workspace path in localStorage
- Show trust indicator in status bar: 🔒 or 🔓

### M3. .orbital/settings.json (Workspace Settings)
- When a workspace is opened, check for `.orbital/settings.json`
- If it exists: merge with global settings (workspace settings take priority)
- If it doesn't exist: offer to create it when user changes a setting to "workspace" scope
- Settings that make sense as workspace-level: tabSize, wordWrap, formatOnSave, linting options, default terminal shell

### M4. Project Overview Panel
- A new activity rail section "Overview" (📊 icon)
- Shows:
  - Workspace name, path, git remote URL
  - Language breakdown (pie chart using a simple canvas/SVG chart)
  - File count breakdown by type
  - Total workspace size
  - Top 5 largest files
  - README.md preview (render markdown inline)
  - package.json / Cargo.toml / pyproject.toml key info (name, version, dependencies count)

---

## PART N: Performance & Developer Experience (~2,500 LOC)

### N1. Large File Handling
- Files > 500 KB: show a warning banner above the editor "⚠️ Large file: some features disabled"
- Disable: IntelliSense, minimap, syntax highlighting for files > 2 MB
- Disable Monaco entirely for binary files, show a hex viewer fallback or just the binary notice

### N2. Workspace Indexing (Background)
- On workspace open: run a background index of all files (in a Tauri background task or Web Worker)
- Index: all file paths, file sizes, last modified, language type
- Use the index to power:
  - Instant Ctrl+P file search (no round-trip to Rust)
  - Find in Files pre-filtering
  - Project stats in Overview panel
- Show an indexing indicator in status bar "Indexing... (N files)" that disappears when done
- Re-index when files change (triggered by `orbital:file-written` events)

### N3. Keyboard-First Navigation
Make EVERY feature accessible without a mouse:
- Tab key navigates between panels (File Explorer → Editor → Chat → Terminal)
- All context menus fully keyboard navigable (arrows + Enter + Escape)
- All modals: Tab between inputs, Escape closes, Enter submits
- Focus trapping in modals (Tab wraps around)
- Visible focus rings on ALL interactive elements (already partially done — verify completeness)
- `aria-label` on all icon buttons (screen reader support)
- Add full ARIA roles to panels: `role="tree"` for file explorer, `role="log"` for terminal, `role="dialog"` for modals

### N4. Drag to Resize Panels (Professional Layout)
- The sidebar (file explorer panel) is currently fixed width — make it resizable:
  - A drag handle on the right edge of the sidebar
  - Drag left/right to resize, min 150px, max 600px
  - Persist width to localStorage
- The bottom panel (terminal) — resizable drag handle on the top edge, min 80px, max 60vh
- The AI chat panel (right side, if it's separate) — resizable left edge
- All resize handles: cursor: col-resize or row-resize, 4px width, highlight on hover

### N5. Zen Mode / Focus Mode
- Command: "Toggle Zen Mode" (Ctrl+K Z)
- Hides: activity rail, sidebar, status bar, titlebar
- Fullscreen Monaco editor with a centered, max-width content area
- Dim overlay on all UI except the editor
- Press Escape twice to exit Zen Mode
- Show a subtle "Press Esc to exit Zen Mode" hint at bottom

### N6. Breadcrumb Navigation
- Already planned in Prompt 1 — verify it's implemented. If not, implement:
  - A breadcrumb bar above the editor showing: ProjectName > src > components > agent.js
  - Each segment is clickable (opens a mini-picker for that directory's contents)
  - Active file's name shows in bold

### N7. Format on Save
- Settings > Editor: "Format on Save" toggle (off by default)
- When on: after Ctrl+S or auto-save, run `editor.getAction('editor.action.formatDocument').run()`
- Also: "Format on Paste" toggle — format pasted code automatically

---

## PART O: Onboarding & Welcome Experience (~1,500 LOC)

### O1. Improved Welcome Screen
**Files:** `src/js/onboarding/wizard.js`, `index.html`, `src/styles/components.css`
- When no workspace is open, show a professional welcome screen:
  - Left side: Orbital X logo + version number + tagline "The AI-native IDE for everyone"
  - Start section: "Open Folder", "New File", "Clone Repository" (runs `git clone <url>`)
  - Recent section: last 5 workspaces (from localStorage)
  - Learn section: links to docs, keyboard shortcut reference, what's new
  - Right side: "What's New in v2.2.3" changelog summary

### O2. First-Run Onboarding Wizard
- Already exists — improve it:
  - Step 1: Welcome + "Choose your vibe" (theme selection — dark/light/hc with live preview)
  - Step 2: Set up AI provider (Ollama detection already exists — keep, improve UI)
  - Step 3: Open or create a workspace
  - Step 4: Quick tutorial (3 things): how to chat, how to open files, how to use the terminal
  - Progress dots at bottom (click to jump to step)
  - "Skip" button on every step
  - "Import settings from VS Code" button (reads `~/AppData/Roaming/Code/User/settings.json` and maps common settings)

### O3. Changelog / What's New Modal
- On first launch after an update: show a "What's New" modal
- Content: formatted markdown from `release/notes/RELEASE_NOTES_v*.md` (read latest)
- "Got it" button dismisses, stores seen version in localStorage: `orbital_seen_version`
- Also accessible from Help menu or titlebar

---

## PART P: Production Hardening (~1,500 LOC)

### P1. Error Boundary & Crash Recovery
- Wrap all major UI sections in try/catch with `window.onerror` and `window.onunhandledrejection`
- On any unhandled error:
  - Show an error toast: "Something went wrong. Click to report."
  - Click logs the error details to a local file: `.orbital/crash.log`
  - The IDE does NOT crash — the affected component shows a "Reload component" button
- Tauri-side: catch all panics, log to `.orbital/orbital.log`

### P2. Performance Monitoring
- Settings > Developer: "Show Performance Monitor" toggle
- When on: show a small floating panel with:
  - CPU time for each agent turn
  - Memory usage (JS heap via `performance.memory`)
  - Frame rate (rAF counter)
  - IPC call counts
- Use `performance.mark()` and `performance.measure()` around key operations

### P3. Auto-Update Notification
- On app launch: fetch `https://api.github.com/repos/daxp472/Orbital-X/releases/latest`
- Compare the tag_name with the current app version (read from `__APP_VERSION__` injected by Vite)
- If a newer version exists: show a banner notification at the top of the window:
  "✨ Orbital X v2.x.x is available! [Download] [Dismiss]"
- Download button opens the release page in the browser
- Dismiss hides the banner for 7 days (localStorage)

### P4. Keyboard Shortcut Conflict Detection
- On app startup, scan all registered keyboard shortcuts for conflicts
- If two commands share the same binding: log a warning to the developer console
- In the Settings > Shortcuts table: highlight conflicting shortcuts in orange

---

## FINAL COMMIT INSTRUCTIONS

After all parts (K, L, M, N, O, P) are done:

```bash
git checkout Zcode/agent
git add -A
git commit -m "feat(ui/ux): complete IDE polish, notifications, file manager, performance, onboarding"
git push origin Zcode/agent
```

Then create a Pull Request on GitHub:
- FROM: `Zcode/agent`
- TO: `main`
- Title: `feat: ZCode Agent — 100k+ LOC IDE overhaul: editor, terminal, git, AI, UI polish, production hardening`
- Body: summarize all features added across all 4 prompts

DO NOT merge the PR yourself — the project owner will review and merge, triggering a release.

---

## THE MISSION

Cursor said "Try it, kid." We're not trying. We're shipping.

Every feature in all 4 prompts must be working, committed, and pushed to `Zcode/agent`.
When you open the PR, real developers should look at the diff and say: "This is serious."

Go build it.
