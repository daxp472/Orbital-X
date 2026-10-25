# ZCODE PROMPT 2/4 — ORBITAL X: Terminal, Git, Extensions & Settings
## Branch: `Zcode/agent` — ALL commits go here. NEVER push to main.

---

## MISSION BRIEF

You are continuing Orbital X IDE development. This prompt covers the Integrated Terminal, Git panel, Extensions system, and Settings system — making them match VS Code quality.

Repository: `d:\1work\YT\Orbital X`
Branch: `Zcode/agent` — switch first: `git checkout Zcode/agent`

**READ THESE FILES BEFORE STARTING:**
- `src/js/components/terminal.js` — current terminal implementation
- `src/js/components/source-control.js` — current git panel
- `src/js/components/extensions.js` — current extensions system
- `src/js/components/settings.js` — current settings panel
- `src-tauri/src/terminal.rs` — Rust terminal backend
- `src-tauri/src/lib.rs` — all Tauri IPC commands

---

## PART E: Professional Integrated Terminal (~4,000 LOC)

### E1. Multi-Tab Terminal with Named Sessions
**Files:** `src/js/components/terminal.js`, `index.html`, `src/styles/components.css`
- Already has multi-session — verify it works, then extend:
- Each terminal tab is renameable: double-click the tab label to rename inline
- Terminal tabs show a colored dot indicating the shell type:
  - PowerShell = blue dot, cmd = yellow dot, bash/wsl = green dot, custom = gray dot
- "+" button creates a new terminal, "×" button closes the active terminal
- Keyboard shortcut: Ctrl+` toggles terminal panel, Ctrl+Shift+` creates new terminal

### E2. Terminal Profile Selector
- A dropdown/popup when clicking the "+" button in the terminal tab bar
- Options: PowerShell (default on Windows), Command Prompt, Git Bash, WSL Ubuntu, Custom...
- "Custom" opens a text input for the shell path
- Store profiles in `state.terminal.profiles`, persist to localStorage
- Settings > Terminal: "Default Shell" dropdown with same options

### E3. Terminal Split (Side by Side)
- Add a split button (⊞ icon) in the terminal header
- Splits the terminal panel vertically, showing two terminals side by side
- Each half has its own session and tab bar
- Resizable divider between the two halves

### E4. Terminal Font & Appearance Settings
- Settings > Terminal:
  - Font Family (default: `JetBrains Mono, Cascadia Code, monospace`)
  - Font Size (default: 13px)
  - Line Height (default: 1.5)
  - Cursor Style: block / underline / bar
  - Cursor Blink: on/off
  - Scrollback Lines (default: 1000)
- Apply all settings to the terminal CSS and behavior live

### E5. ANSI Color Support
- The current terminal renders HTML. Parse ANSI escape codes properly:
  - Standard 16 colors (30-37 fg, 40-47 bg)
  - Bright colors (90-97 fg, 100-107 bg)
  - 256-color mode (\x1b[38;5;Nm)
  - Bold, italic, underline, strikethrough
  - Reset (\x1b[0m)
- Create a function `parseAnsiToHtml(text)` that converts ANSI sequences to HTML spans with inline styles
- Use it in the terminal output rendering

### E6. Terminal Copy/Paste Improvements
- Select text in terminal: standard mouse selection
- Right-click in terminal: context menu with Copy / Paste / Select All / Clear
- Ctrl+Shift+C = Copy selection in terminal
- Ctrl+Shift+V = Paste in terminal
- Ctrl+A = Select all terminal text

### E7. Terminal Search (Ctrl+F in Terminal)
- When terminal is focused and Ctrl+F is pressed: show a small search bar at the top of the terminal
- Highlights all matches in the terminal buffer
- Previous/Next match navigation
- Clear button to dismiss

### E8. Terminal Working Directory Display
- Below the terminal tab bar, show the current working directory in a small breadcrumb
- Parse `cwd` from the Rust `CommandResult` if available, or run `pwd` / `cd` periodically
- Clicking a segment in the breadcrumb opens File Explorer to that path

### E9. Run Last Command (Up Arrow History — already done, extend it)
- Ctrl+R opens a searchable history picker (like bash reverse-i-search)
- Shows a small popup listing last 50 commands, filterable
- Enter selects and pastes the command into the input

### E10. Terminal Link Detection
- Detect URLs (http://, https://) and file paths in terminal output
- Make them clickable: URL opens browser, file path opens the file in the editor
- Underline on hover

---

## PART F: Professional Git Panel (~3,500 LOC)

### F1. Complete Git Status Panel
**Files:** `src/js/components/source-control.js`, `src/styles/components.css`
- Already shows changed files — extend significantly:
- Group files into sections: Staged Changes / Unstaged Changes / Merge Conflicts / Untracked Files
- Each file shows: file icon, filename, status badge (M modified, A added, D deleted, R renamed, U untracked, C conflict)
- Click file: shows inline diff preview (already implemented — keep and improve)
- Checkboxes next to each file for selective staging
- "Stage All" / "Unstage All" buttons
- "Discard Changes" button per file (with confirmation dialog)

### F2. Git Staging & Selective Staging
- Checkbox next to each file in the unstaged section
- "Stage Selected" button: runs `git add <checked files>`
- "Stage All" button: runs `git add .`
- "Unstage" button per staged file: runs `git restore --staged <file>`
- After staging, refresh the status panel

### F3. Rich Commit UI
- Already has a basic commit textarea — extend it:
- Character counter (GitHub recommends <50 chars for subject line — show warning in orange when >50)
- Amend last commit toggle: "Amend" checkbox — changes the commit button to "Amend Commit"
- Co-author input: "Co-authored-by: Name <email>" appended automatically
- Commit type dropdown: feat / fix / docs / style / refactor / test / chore (prepends to message)
- "Commit & Push" button: commits then immediately pushes

### F4. Branch Management Panel
- Show current branch prominently at top of git panel
- Branch switcher: click branch name → dropdown showing all local branches
  - Click a branch to checkout: runs `git checkout <branch>`
  - "New Branch" input at top of dropdown: creates and switches in one step
- Show remote tracking info ("ahead 2, behind 1")
- "Publish Branch" button when the branch has no remote tracking
- "Pull" button (git pull), "Push" button (git push), "Fetch" button (git fetch)

### F5. Git Log / History Panel
- A "History" tab in the Git panel (next to "Changes" tab)
- Shows last 50 commits in a log:
  - Hash (7 chars), commit message, author name, relative time ("2 hours ago")
  - Colored branch/tag labels
- Click a commit: shows the full diff for that commit in the diff preview area
- "Copy Hash" button on each commit
- Load more button / scroll to load next 50

### F6. Git Graph (ASCII or Canvas)
- A "Graph" tab in the Git panel
- Shows a simple ASCII or Canvas-drawn git branch graph
- Run `git log --oneline --graph --all -30` and display the output in a monospace pre block with ANSI colors parsed
- Color branches differently

### F7. Conflict Resolution UI
- When there are merge conflicts (detected by "C" status in git status):
  - Show a "CONFLICT" badge on the file
  - Click the file: show a 3-way diff view (current / base / incoming) using Monaco diff editor
  - "Accept Current" / "Accept Incoming" / "Accept Both" buttons
  - After accepting, mark the file as resolved and stage it

### F8. Git Blame in Editor
- Add a "Toggle Blame" button in the editor tab bar (or right-click context menu)
- When enabled: show git blame info in the editor gutter (author, date, commit hash)
- Implementation: run `git blame --line-porcelain <file>`, parse output, use Monaco's `deltaDecorations` to render in gutter margin
- Hover on a blame line: show tooltip with full commit message

### F9. Stash Management
- "Stash" button in git panel header
- Opens a stash menu: "Stash Changes" (prompts for stash name), "Pop Stash", "Apply Stash", "Drop Stash"
- Lists all stashes with: name, timestamp, "Apply" / "Drop" buttons per stash

---

## PART G: Settings System Overhaul (~2,000 LOC)

### G1. Settings JSON Editor Mode
- A "settings.json" button in the settings footer
- Opens a Monaco editor with the full settings object as JSON
- User can edit any setting directly in JSON
- On save: parse and validate the JSON, apply all settings, close

### G2. Settings Search
- A search input at the top of the settings dialog (already has sidebar navigation — add search)
- Typing in search: filters ALL settings across all tabs to show only matching ones
- Matched settings highlight the search term
- Works across setting labels, descriptions, and values

### G3. Settings Import/Export (already exists — improve it)
- Export: downloads a `orbital-settings.json` file with ALL current settings
- Import: file picker, validates JSON schema, applies settings with confirmation
- Reset to Defaults: button at bottom of settings with confirmation dialog
- Settings sync: show last modified timestamp

### G4. Keybinding Editor
- Settings > Shortcuts tab (already exists — extend it from read-only to editable)
- Each shortcut row has an "Edit" button
- Click Edit: the shortcut cell becomes a keyboard shortcut recorder
  "Press your key combination..."
  User presses keys → they're captured and displayed
  Conflicts shown in red (another command uses the same binding)
- "Reset" button per keybinding to restore default
- Persist custom keybindings to localStorage: `orbital_custom_keybindings`

### G5. Workspace Settings
- In addition to global settings: workspace-level settings stored in `.orbital/settings.json` in workspace root
- Workspace settings override global for: tab size, word wrap, linting options
- A toggle in Settings: "Workspace Settings" section at bottom
- Show "Workspace" badge next to settings that are overridden at workspace level

---

## COMMIT INSTRUCTIONS

After each Part (E, F, G), commit and push:
```bash
git checkout Zcode/agent
git add -A
git commit -m "feat(terminal|git|settings): [descriptive message]"
git push origin Zcode/agent
```

Complete ALL parts E, F, G before stopping. Every feature must be fully working.
