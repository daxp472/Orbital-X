# Orbital X v2.3.5 Release Notes

### Four Architectural Pillars Hardening, Reactor Panic Fix & Native Fullscreen

Orbital X v2.3.5 brings enterprise architectural isolation, real-time semantic context, autonomous diagnostic healing, and virtual file system diffing, along with critical runtime stability fixes and native window management.

---

### Highlights in v2.3.5

#### 1. Four Architectural Pillars
- **Enterprise Workspace Isolation**: Native Windows Job Object sandbox (`PlatformJobSandbox`) with strict memory caps (1.5 GB), 75% CPU rate limits, maximum active process controls, and environment variable scrubbing.
- **Semantic Code Graph & Context Engine**: Local AST indexing for Rust, TypeScript/JavaScript, and Python. Efficient dependency mapping, caller/callee resolution, and focused context slicing.
- **Deterministic Diagnostics & Healing Loop**: Automatic compiler checks (`cargo check`, `tsc`, `npm run build`), structured ANSI error extraction, and hallucination loop detection to guide model corrections.
- **Virtual File System (VFS) Diff Bridge**: In-memory Copy-on-Write overlay layer, atomic checkpoints, rollback, unified diff generation, and clean two-phase commits.

#### 2. Runtime Stability & Crash Prevention
- Fixed runtime panic on workspace load: `there is no reactor running, must be called from the context of a Tokio 1.x runtime`.
- Background indexing now runs cleanly on a dedicated thread pool with `std::sync::RwLock`, completely immune to async context panics.

#### 3. Native Window Controls & Fullscreen
- Native Tauri window commands for Minimize, Maximize, Close, and Fullscreen.
- Restored window control buttons in the custom titlebar.
- Added global `F11` fullscreen toggle shortcut.
- Added `Toggle Full Screen (F11)` to the menubar View dropdown.
- Configured Tauri desktop window permissions.

---

### Downloads
- **Windows Setup**: `Orbital.X_2.3.5_x64-setup.exe` / `Orbital X_2.3.5_x64-setup.exe` (7.15 MB)
- **Standalone Binary**: `orbital-x.exe` (21.6 MB)
