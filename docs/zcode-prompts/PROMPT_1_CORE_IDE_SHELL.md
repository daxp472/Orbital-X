# ZCODE PROMPT 1/4 — ORBITAL X: Core IDE Shell & Editor Infrastructure
## Branch: `Zcode/agent` — ALL commits go here. NEVER push to main.

---

## MISSION BRIEF

You are a senior IDE engineer. Orbital X is a real community IDE competing with VS Code and Cursor. Real developers are using it. Every feature must work completely — no placeholders, no "coming soon", no half-implementations.

Repository: `d:\1work\YT\Orbital X` (already cloned and set up)
Branch: `Zcode/agent` — switch first: `git checkout Zcode/agent`
Stack: Tauri 2 (Rust backend) + Vanilla JS frontend + Monaco Editor + Vite

**RULES:**
1. `git checkout Zcode/agent` before starting
2. Inspect every file before editing — use read_file / search_files / list_files
3. Commit each feature separately with conventional commit messages
4. Never skip features — implement every single item listed
5. Push to `origin/Zcode/agent` every 5 commits
6. DO NOT stop until every feature in this file is implemented

---

## PART A: Advanced Tab System (~3,000 LOC)

### A1. Tab Drag & Drop Reordering
**Files:** `src/js/editor/monaco.js`, `index.html`, `src/styles/components.css`
- Make editor tabs draggable using HTML5 Drag and Drop API
- `draggable="true"` on each tab element
- On `dragstart` store the dragged tab index
- On `dragover`: show blue left/right border indicating insertion point
- On `drop`: reorder `state.editor.tabs`, re-render, keep active file open
- Animate with CSS transition
- Persist tab order

### A2. Tab Context Menu (Right-Click)
- Right-click on any editor tab shows a context menu with:
  - Close Tab (Ctrl+W)
  - Close Other Tabs
  - Close Tabs to the Right
  - Close All Tabs
  - Copy File Path
  - Copy Relative Path
  - Reveal in File Explorer (highlights file in left panel)
- Dark rounded menu, 12px font, same style as the existing file-tree context menu in `file-tree.js`
- Dismiss on click-outside or Escape

### A3. Split Editor (Side by Side)
**Files:** `index.html`, `src/js/editor/monaco.js`, `src/styles/components.css`
- "Split Right" button in tab bar, icon: two columns, shortcut: Ctrl+\
- Divides editor area into two equal panels using CSS grid
- Each panel has its own Monaco editor instance and tab bar
- Files open independently in either panel
- Clicking in file tree opens in the focused panel
- Thin vertical resizer between panels — drag to resize
- "Close Split" button to merge back
- State: `state.editor.splitMode`, `state.editor.rightTabs`, `state.editor.rightActiveTabId`

### A4. Pin Tabs
- 📌 pin icon on each tab (visible on hover)
- Pinned tabs: move to left side of tab bar, show dot instead of close button
- Pinned tabs excluded from "Close All" unless unpinned first
- `isPinned` property on tab object, persisted

### A5. Tab Preview Mode
- Single-click in file tree = preview mode (italic tab title, only ONE preview tab at a time)
- User editing, double-clicking tab, or opening another file makes it permanent
- New single-click replaces the existing preview tab
- `isPreview: true` property on tab state object

---

## PART B: Editor Enhancements (~4,000 LOC)

### B1. AI-Powered Inline Autocomplete (Ghost Text)
**Files:** `src/js/editor/monaco.js`, `src/js/components/agent.js`
- Register a Monaco `InlineCompletionsProvider` for all languages
- When user pauses typing for 600ms: take last 200 chars before cursor as context
- Call currently configured AI provider with system prompt:
  `"You are a code completion engine. Complete the code at the cursor. Return ONLY the completion text, no explanation. 1-5 lines max."`
- Display as Monaco ghost text (greyed inline suggestion)
- Tab = accept, Escape = dismiss
- Small spinner in status bar while loading
- Settings > Models: "Inline Autocomplete" toggle + provider selector
- State: `state.settings.inlineComplete = { enabled: false, provider: 'ollama' }`
- IMPORTANT: Only trigger when user stops for 600ms and line is not blank

### B2. Code Folding Keyboard Shortcuts
- Ctrl+Shift+[ — Fold current region
- Ctrl+Shift+] — Unfold current region
- Ctrl+K, Ctrl+0 — Fold all
- Ctrl+K, Ctrl+J — Unfold all
- Ctrl+K, Ctrl+1 through Ctrl+K, Ctrl+5 — Fold by level
- Add via `editorInstance.addCommand(...)` in monaco.js
- Add to Settings > Shortcuts table

### B3. Sticky Scroll
- Enable Monaco sticky scroll: `stickyScroll: { enabled: true }` in Monaco options
- Settings > Appearance: "Sticky Scroll" toggle
- Wire to `editor.updateOptions({ stickyScroll: { enabled: value } })`

### B4. Multiple Cursors & Column Selection
- Verify Alt+Click places additional cursors (Monaco built-in)
- Shift+Alt+Down/Up — add cursor above/below
- Alt+Shift+I — cursor at end of each selected line
- Ctrl+Alt+Down/Up — add cursor above/below
- Column selection: Shift+Alt+drag (Monaco built-in)
- Add all to Shortcuts table

### B5. Global Find & Replace in Files
**Create:** `src/js/components/search.js`, add panel to `index.html`
- Activity rail: "Search" panel (🔍 icon, Ctrl+Shift+F)
- Panel contents:
  - Search input with regex toggle 🔣
  - Replace input with "Replace All" button
  - Case-sensitive toggle (Aa), Whole word toggle (Ab|)
  - Include/Exclude glob pattern inputs
  - Results grouped by file, with matched line + highlight
  - Click result: open file and navigate to that line
- Backend: use existing `invoke('search_workspace', { query, max_results: 200 })`
- Replace: read each matched file, do string replacement, call `invoke('save_file', ...)`
- Summary: "5 files, 12 matches"

### B6. Minimap Customization
- Settings > Appearance: Minimap toggle, Side (right/left), Scale (1-3), Slider (always/mouseover)
- Wire all to `editor.updateOptions({ minimap: { ... } })`

### B7. Word Wrap Settings
- Settings > Editor: Word Wrap dropdown (off/on/wordWrapColumn/bounded), Word Wrap Column input
- Wire to `editor.updateOptions({ wordWrap, wordWrapColumn })`

### B8. Indent Detection & Configuration
- Settings > Editor: Tab Size input, Use Spaces toggle, Detect Indent toggle
- Status bar: show current file indent ("Spaces: 2" or "Tab: 4")
- Wire to `editor.updateOptions({ tabSize, insertSpaces, detectIndentation })`

### B9. Editor Font Settings
- Settings > Editor: Font Family input, Font Size, Font Ligatures toggle, Line Height, Letter Spacing
- Wire all to `editor.updateOptions({ fontFamily, fontSize, fontLigatures, lineHeight, letterSpacing })`

### B10. Go to Symbol
- Ctrl+Shift+O: `editorInstance.getAction('editor.action.gotoSymbol').run()`
- Ctrl+T: workspace symbol search
- Add both to shortcuts table

---

## PART C: Status Bar Enhancements (~1,500 LOC)

### C1. Rich Status Bar
Add to the right side of the status bar:
- Language mode of active file (e.g. "JavaScript") — clickable to open language picker
- Encoding ("UTF-8") — static
- Line ending (LF/CRLF) — detect from file content (`\r\n` vs `\n`)
- Cursor position ("Ln 42, Col 7") — live from `onDidChangeCursorPosition`
- Selection info ("23 chars" or "3 lines selected") — live from `onDidChangeCursorSelection`
- Indent size ("Spaces: 2") — from Monaco model options
- Format button (🖊️) — triggers `editor.getAction('editor.action.formatDocument').run()`

### C2. Language Mode Picker
- Click language name in status bar → dropdown/modal
- Lists Monaco languages from `monaco.languages.getLanguages()`
- Filter input at top
- Click a language: `monaco.editor.setModelLanguage(editor.getModel(), langId)`

---

## PART D: Full Command Palette (~2,000 LOC)

**Create:** `src/js/components/command-palette.js`

- **Ctrl+Shift+P** — Command Palette (commands)
- Shows searchable list of ALL IDE commands with icon, name, keybinding
- Groups: Editor, View, Agent, Git, File commands
- Commands include: Save, Close Tab, Toggle Terminal, Open Settings, Run Tests, Git Commit, Switch Theme, Format Document, Toggle Minimap, Split Editor, etc.
- Fuzzy search across all command names
- Arrow navigation, Enter to execute, Escape to close
- Most-recently-used commands at top
- Style: 600px wide, centered at top, dark background, like VS Code

---

## COMMIT TEMPLATE
```bash
git checkout Zcode/agent
# after each section:
git add -A
git commit -m "feat(editor): [what you built]"
git push origin Zcode/agent
```

Complete ALL parts A, B, C, D before stopping.
