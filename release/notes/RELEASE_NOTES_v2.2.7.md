# Orbital X v2.2.7 — Open Workspace Overhaul, COM Apartment Isolation, Operating Mode Engine & Changelog Architecture

> **Code with Autonomy. Zero Cloud Lock-in. Zero RAM Waste.**  
> High-performance, memory-conscious AI pair-programming desktop IDE built on Tauri 2 and Rust.

---

## 🚀 What's New in v2.2.7

### 📂 Open Workspace Overhaul & Win32 COM Apartment Isolation
- **Dedicated Threaded COM Apartment:** Solved Windows `RPC_E_CHANGED_MODE` errors by delegating native folder picker invocations to a dedicated OS thread (`orbital-folder-picker`) with pristine COM apartment initialization.
- **Parent Window Modal Attachment:** Attached native file dialogs directly to the main WebviewWindow handle (`dialog.set_parent(&win)`), guaranteeing that directory pickers always display in the foreground and never open behind the IDE or lose focus.
- **Flexible Path Extraction:** Added resilient extraction for directory responses across strings, single-item arrays (`res[0]`), and path objects (`res.path`), preventing silent aborts.
- **Zero-Interruption Trust Flow:** Replaced intrusive blocking `confirm()` dialogs on directory opening with non-blocking auto-trust for user-selected paths (`rememberWorkspaceTrust(meta.root_path, true)`).
- **All Entrypoints Connected:** Verified reliable folder opening from the titlebar badge (`#btn-open-workspace`), Welcome modal button, File Tree empty state, Explorer header action, Sidebar root header, File Menu, and keyboard shortcut <kbd>Ctrl+O</kbd>.

### 🎛️ Interactive Triple-Mode Switcher Synchronization
- **Status Bar Integration:** Added interactive click trigger to the bottom status bar mode pill (`#status-mode`), allowing instant mode switching from the footer as well as the titlebar header.
- **Real-Time Color Synchronization:** Synchronized status indicator dots and accent glows across **Agent Pro Mode** (purple), **Developer Mode** (cyan), and **User Mode** (green).
- **Settings State Alignment:** Dynamic bidirectional synchronization with Settings security mode cards and `localStorage` persistence across sessions.

### 📝 Production Changelog Subsystem
- **Standalone Iteration Logs:** Established the dedicated `changelogs/` folder in the project root containing complete, numbered audit entries (beginning with `001.md`).
- **Comprehensive Rollback Documentation:** Every changelog entry specifies exact files modified, functions touched, completion verification, and zero-downtime production recovery procedures.

### 🛠️ Core Features Carried Forward
- **Source Control UI/UX:** High-fidelity vector SVG icons, per-row stage/discard/diff buttons, bulk controls, and commit composer.
- **Run & Debug Codebase Engine:** Automatic project script detection and 1-click execution chips.
- **Apple-Inspired Keyboard Shortcuts:** Searchable, categorized keybinding cards with tactile keycaps and conflict detection.
- **Chat History Management:** Full export and import support for timestamped AI agent chat sessions.

---

## 📦 Downloads & Verification

| Platform | Installer Package | Architecture | Verification Hash |
| :--- | :--- | :--- | :--- |
| **Windows Installer** | `Orbital X_2.2.7_x64-setup.exe` | x86_64 / x64 | Verified Release v2.2.7 |
| **Windows Setup Alias** | `Orbital.X_2.2.7_x64-setup.exe` | x86_64 / x64 | Verified Release v2.2.7 |
| **Windows Standalone** | `orbital-x.exe` | x64 Portable | Verified Portable v2.2.7 |

---

*Orbital X — Pure Desktop Performance. Local AI Autonomy. Zero Telemetry.*

