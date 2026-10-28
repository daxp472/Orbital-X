# Orbital X v2.2.6 — Source Control, Run & Debug Engine, Shortcuts Overhaul & Top-Bar Controls

> **Code with Autonomy. Zero Cloud Lock-in. Zero RAM Waste.**  
> High-performance, memory-conscious AI pair-programming desktop IDE built on Tauri 2 and Rust.

---

## 🚀 What's New in v2.2.6

### ⑂ Source Control UI & UX Overhaul
- **Vector SVG Icons:** Replaced all file extension emojis with inline SVG file icons from the native file-tree icon pack.
- **Per-Row Quick Actions:** Every file row in Changes and Untracked files now provides direct action buttons: **Stage (`+`)**, **Discard (`↺`)**, and **Diff (`📄`)** without needing checkboxes.
- **Section-Level Bulk Actions:** Section headers feature 1-click **Stage All (`+`)** and **Discard All (`↺`)** for Changes, and **Unstage All (`−`)** for Staged Changes.
- **Commit Composer & Branch Sync:** Added conventional commit prefix selector (`feat:`, `fix:`, etc.), character count indicator, `<kbd>Ctrl+Enter</kbd>` keyboard badge, and quick sync action buttons for **Fetch**, **Pull**, **Push**, and **Stash**.

### 🐞 Run & Debug Codebase Engine
- **Workspace Auto-Detection:** Automatically inspects project manifests (`package.json` scripts, `Cargo.toml` targets) and the active editor tab (JavaScript, TypeScript, Python, Rust, Shell, HTML).
- **Quick Command Runner:** Added command input bar supporting arbitrary run and test commands with <kbd>Enter</kbd> trigger, plus quick launch chips (`npm run dev`, `npm test`, `npm run build`, `cargo test`).
- **Terminal Execution:** Executes directly inside the integrated terminal PTY, switching to the Terminal tab with real-time status indicators (`● RUNNING` / `○ IDLE`).

### ⌨️ Apple-Inspired Keyboard Shortcuts UI in Settings
- **Live Search Filtering:** Real-time filter box (`#shortcuts-search-input`) searching across action names, categories, scopes, and key combinations.
- **Categorized Cards:** Neatly grouped into visual category cards: *AI Agent & Assistant*, *Editor & Navigation*, *Views, Panels & Terminals*, *File & Workspace*, *Source Control & Git*, and *Tools & General*.
- **Tactile Keycaps:** Styled key combinations with Apple Design `<kbd class="apple-keycap">` keycaps with inset shadows, subtle gradients, and monospace typography.
- **Interactive Rebinding:** Full in-app keypress recording, automatic conflict detection with warning alerts, and instant reset.

### 🪟 Clean Top Bar Layout & Workspace Folder Picker Fix
- **Restored Clean Top Bar:** Restored the clean, non-duplicated top bar layout with native traffic lights on the left, brand logo, menu bar (`File`, `Edit`, `Selection`, `View`, `Go`, `Run`, `Terminal`, `Help`), centered workspace badge, and layout/theme/mode controls on the right, eliminating duplicate window controls.
- **Robust Native Workspace Folder Dialog:** Replaced fragile blocking async dialog calls with dedicated OS thread worker (`tokio::task::spawn_blocking`) using direct native `rfd::FileDialog` and `into_path()` fallback. Workspace folder selection now works instantly without errors.
- **Multiple Open Folder Entrypoints:** Open any folder with 1-click via the top bar workspace badge, Explorer header "Open Folder" button (`#btn-explorer-open-folder`), Explorer root folder header, `File` menu, or <kbd>Ctrl+O</kbd>.

### 💬 Export & Import Chat History
- **Header Action Buttons:** Added Export and Import SVG buttons in the AI agent dock header and inside the recent chats popover.
- **Complete Markdown Export:** Exports full conversation timelines into timestamped Markdown files (`.md`).
- **Session Restorer:** Imports existing `.md` or `.txt` chat logs and restores them directly into active memory.

### 🧹 Removed Bloat
- **Project Overview Subview Removed:** Completely removed the unused "Project Overview" icon and subview from the Activity Rail and sidebar.

---

## 📦 Downloads & Verification

| Platform | Installer Package | Architecture | Verification Hash |
| :--- | :--- | :--- | :--- |
| **Windows** | `Orbital.X_2.2.6_x64-setup.exe` | x86_64 / x64 | Verified Release v2.2.6 |
| **Windows Standalone** | `orbital-x.exe` | x64 Portable | Verified Portable v2.2.6 |
| **macOS** | `Orbital.X_2.2.6_aarch64.dmg` | Apple Silicon / Intel | Verified Release v2.2.6 |
| **Linux** | `Orbital.X_2.2.6_amd64.AppImage` | x86_64 Universal | Verified Release v2.2.6 |

---

*Orbital X — Pure Desktop Performance. Local AI Autonomy. Zero Telemetry.*
