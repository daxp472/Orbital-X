# Orbital X v2.2.2 - Official Multi-Platform Release

> **Code with Autonomy. Zero Cloud Lock-in. Zero RAM Waste.**  
> High-performance, memory-conscious AI pair-programming desktop IDE built on Tauri 2 and Rust.

---

## 🚀 What's New in v2.2.2

### 🛡️ Strict Backend Workspace Confinement & Root Deletion Protection
- **Workspace Boundary Enforcement:** All agent file inspections, searches, modifications, and deletions are strictly resolved against the canonical workspace boundary with Windows verbatim `\\?\` prefix normalization and trailing slash boundaries.
- **Root Wipe Prevention:** Explicit kernel-level check blocks the agent from ever targeting or deleting the workspace root (`ensure_not_workspace_root`), preventing catastrophic hallucinated directory wipes.
- **Symlink & Traversal Guards:** Comprehensive defense against symbolic links, NTFS junctions, and path traversal (`..`) escapes outside the project directory.

### ⚡ Intelligent Agent Pro Execution Fix
- **Safe React/JSX Parsing:** Fixed the root cause of the 25% execution blocker where React JSX files (`<div />`) triggered false syntax failures during validation.
- **Self-Healing Diagnostics:** When an agent task encounters an obstacle, it now displays rich diagnostics (task ID, title, and exact reason) with an intuitive `▶️ Resume & Retry Blocked Task` button to continue execution without losing state.
- **Elapsed Time Accuracy:** Fixed timer calculation so execution duration is tracked accurately.

### 🔒 Hardened Command Policy & Administrative Elevation Shield
- **Three-Tier Command Classification (`CommandClassifier`):**
  - **Prohibited:** Destructive wipes (`rm -rf /`, `rmdir /s /q`), administrative elevation (`runas`, `takeown`, `sudo`, `icacls /grant`), registry alterations (`reg add`, `reg delete`), and encoded PowerShell scripts (`-enc`, `-encodedcommand`) are blocked unconditionally before shell spawn.
  - **Approval Required:** Git mutations (`git reset`, `git clean`) and file deletions require explicit user confirmation.
  - **Safe Autonomy:** Legitimate project inspection, package managers, and development build tools (`cargo`, `npm`, `npx`, `node`, `pytest`, `git status/diff/log`, `dir`, `ls`) run smoothly in Agent Pro mode.

### 🗑️ Dedicated Directory & Two-Stage Batch File Deletion Tools
- **`delete_directory` Tool:** Workspace-relative folder deletion with safety boundary validation, directory byte/file footprint calculation, undo journal logging, and mandatory approval across all operating modes.
- **Two-Stage `batch_delete_files` Tool:**
  1. *Stage 1 (Manifest & Preview):* Previews affected files, path existence, and total byte footprint before deletion.
  2. *Stage 2 (Filesystem Revalidation):* Re-checks every file path immediately before deletion execution, ensuring only confirmed targets are removed and preventing stale target races.

### 🎨 Visual Category Color Coding & Distinct Approval Flows
- **Category Badge Colors:** Instant recognition for tool actions:
  - 🟢 **Create / Write (Emerald):** `➕` File generation and writes
  - 🔵 **Read / Inspect (Cyan / Sky):** `🔍` Directory listing, symbol reading, and file inspection
  - 🔴 **Delete / Destructive (Red / Rose):** `🗑️` File, folder, and batch deletions
  - 🟡 **Command / Shell (Amber / Orange):** `⚡` Terminal build and test commands
  - 🟣 **Mode / Privilege (Purple):** `🔒` Mode elevation requests
- **Distinct Approval Cards:**
  - Standard Emerald/Cyan card for code edits with Monaco Diff inspection.
  - High-visibility Red Warning card with pulse badge for destructive deletions with safe default button (`Reject & Keep Safe`).
  - Strict mode immutability: the agent cannot elevate or alter modes autonomously.

---

## 📦 Downloads & Installers

| Platform | Format | Architecture | Description |
|---|---|---|---|
| **Windows** | `.exe` NSIS Setup | x64 (64-bit) | Official Windows Setup Wizard with License Agreement & Desktop Shortcut |
| **Windows** | `.exe` Portable | x64 (64-bit) | Standalone single-file binary (`orbital-x.exe`) |
| **macOS** | `.dmg` Disk Image | Apple Silicon & Intel | Universal macOS drag-and-drop installer |
| **Linux** | `.AppImage` | x86_64 / amd64 | Portable, zero-install Linux desktop binary |
| **Linux** | `.deb` Package | x86_64 / amd64 | Debian / Ubuntu native package |

---

## 🔒 Verification & System Specs
- **Desktop Runtime:** Tauri v2.2.0 + Rust 1.90
- **Editor Engine:** Monaco Editor 0.52.2
- **RAM Footprint:** ~95 MB idle
- **Local AI Provider:** Ollama (Zero Telemetry)
