# Orbital X — Menubar Overhaul, Docs Hub, Browser Links & v2.2.9 Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Orbital X's top menubar into a native-grade IDE system matching VS Code / Cursor styling (compact dropdowns for File, Edit, Selection, View, Go, Run, Terminal, Developer, Help), fix Report Issue to directly launch Chrome, implement 1-click Check for Updates, overhaul the showcase website and create a full Documentation Hub (`docs/docs.html`), provide website backend recommendations, and produce the `v2.2.9` release installer.

---

## Subsystem & File Breakdown

| Subsystem | Target Files | Responsibility |
| :--- | :--- | :--- |
| **Menubar System** | `src/js/components/menubar.js`<br>`src/styles/components.css`<br>`index.html` | Unified native IDE menubar dropdowns with compact width, keyboard shortcut indicators, grouped dividers, and working handlers for all 9 menus. |
| **Developer Menu** | `src/js/components/developer-menu.js` | Refactor developer menu into the unified menubar structure (compact styling matching Screenshot 2, not stretched). |
| **External Links & Updates** | `src/js/app.js`<br>`src/js/services/tauri.js` | Direct browser launch via `open_url` without blocking CORS checks; 1-click update check dialog and notification flow. |
| **Docs Hub & Website** | `docs/docs.html`<br>`docs/index.html`<br>`docs/report-issue.html`<br>`docs/style.css`<br>`docs/app.js` | Creation of developer & user documentation hub; mobile navigation fixes; table responsiveness; backend architecture analysis. |
| **Version & Release** | `package.json`<br>`src-tauri/tauri.conf.json`<br>`src-tauri/Cargo.toml`<br>`changelogs/003.md`<br>`release/` | Synchronize version to `2.2.9`, create audit changelog, build and package NSIS installer in `release/`. |

---

## Tasks

### Task 1: Unified Native-Grade Menubar System (Matching Screenshot 2)
- [ ] Create `src/js/components/menubar.js` with comprehensive action registries for all 9 menus:
  - **File**: New File, Open File, Open Workspace Folder, Save, Save As, Close Tab, Settings, Exit.
  - **Edit**: Undo, Redo, Cut, Copy, Paste, Find in File, Replace.
  - **Selection**: Select All, Expand Selection, Shrink Selection, Add Cursor Above/Below.
  - **View**: Command Palette, Explorer, Search, Source Control, Run & Debug, Extensions, Toggle Terminal, Toggle Agent Panel, Fullscreen.
  - **Go**: Go to File (Quick Open), Go to Symbol, Go to Line.
  - **Run**: Start Debugging, Run Without Debugging, Run Active File.
  - **Terminal**: New Terminal, Split Terminal, Run Build Task, Run Active File, Clear Terminal.
  - **Developer**: Inspect / DevTools (F12), In-App Debug Console, Reload Window, Verbose Agent Logs, Copy Diagnostics.
  - **Help**: Documentation (Docs), Report Issue, Check for Updates..., Keyboard Shortcuts Reference (F1), Welcome Screen, About Orbital X.
- [ ] Add compact styling in `src/styles/components.css`:
  - Fixed width `240px - 280px`, dark glass background `rgba(20, 24, 34, 0.98)` with backdrop blur.
  - Clean row height (28px), crisp font (12px), smooth full-width hover background.
  - Right-aligned keyboard shortcuts in muted monospace font.
  - Smooth hover switching between adjacent menus when one menu is open.
  - Outside-click and `Escape` key dismiss handlers.
- [ ] Wire up `initMenubar()` in `src/js/app.js`.

### Task 2: Direct Browser Trigger for "Report Issue" & 1-Click "Check for Updates"
- [ ] In `src/js/app.js`, remove the failing `fetch(..., { method: 'HEAD' })` CORS check from `sb-report-issue` and modal triggers.
- [ ] Make all "Report Issue" buttons directly call `invoke('open_url', { url: 'https://daxp472.github.io/Orbital-X/report-issue.html' })` with `window.open` fallback, guaranteeing external browser launch.
- [ ] Implement `initUpdateSystem()` with:
  - Manual check trigger from Help menu and Settings.
  - Compares current version (`2.2.9`) against remote GitHub release API.
  - Interactive modal dialog showing version delta, release highlights, and a **"1-Click Download & Update"** button.
  - Fallback notification when running the latest version.

### Task 3: Comprehensive Documentation Hub (`docs/docs.html`) & Website UI Overhaul
- [ ] Create `docs/docs.html` with:
  - Apple-grade documentation layout: fixed sticky sidebar with section anchors, search filter, smooth scrolling.
  - Detailed documentation sections:
    1. Overview & Architecture (Tauri 2 + Rust, memory efficiency).
    2. Installation & Quickstart (Windows, macOS, Linux, winget).
    3. Tri-Mode Safety System (Dev Mode, Agent Pro, User Mode).
    4. Local Offline AI with Ollama (Hardware requirements, models, setup).
    5. Workspace, Editor & Terminal Guide.
    6. Keyboard Shortcuts & Developer Tools.
    7. Troubleshooting, Crash Logs & Reporting Issues.
- [ ] Update `docs/index.html` and `docs/report-issue.html`:
  - Add "Docs" to navigation header and footer.
  - Fix any broken links or mobile layout discrepancies.
- [ ] In `docs/style.css`, polish documentation sidebar, syntax highlighting, callout cards, and mobile responsiveness.

### Task 4: Website Backend Assessment
- [ ] Provide a clear, factual architectural analysis of website backend options:
  - Current static GitHub Pages capabilities and limitations.
  - Optional backend services (Serverless API for GitHub Issue creation, release redirector, or crash report ingestion).
  - Recommended zero-cost serverless approach preserving user privacy and zero cloud telemetry.

### Task 5: Version Bump to v2.2.9 & Release Packaging
- [ ] Bump versions to `2.2.9` across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/js/app.js`, `index.html`, and `docs/`.
- [ ] Create `changelogs/003.md` detailing all architectural improvements, bug fixes, and feature additions.
- [ ] Run verification tests (`node --check`, `npm test`, `cargo check`).
- [ ] Build production assets with Vite (`npm run build`) and package release with Tauri (`npm run tauri build`).
- [ ] Verify generated installer `Orbital X_2.2.9_x64-setup.exe` in root `release/`.
- [ ] Stage, commit, and push changes to GitHub with tag `v2.2.9`.

