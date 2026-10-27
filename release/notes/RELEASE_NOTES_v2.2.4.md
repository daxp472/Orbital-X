# Orbital X v2.2.4 — Terminal Overhaul, Mode Switcher & Workspace Reliability

> **Code with Autonomy. Zero Cloud Lock-in. Zero RAM Waste.**  
> High-performance, memory-conscious AI pair-programming desktop IDE built on Tauri 2 and Rust.

---

## 🚀 What's New in v2.2.4

### 🖥️ Integrated Terminal Architecture & Bottom Panel Overhaul
- **Panel Collapse Prevention:** Complete CSS flexbox and split-pane layout overhaul preventing bottom panel squashing or clipping during multi-tab editing.
- **Dynamic Terminal Tabs:** Responsive tab management supporting multiple simultaneous terminal sessions with reliable active tab routing and clean cleanup.
- **Native Execution Routing:** Terminal keystrokes and shell commands route directly through native system PTY threads without input handler leaks.

### 📊 Context Window Usage Meter & Telemetry
- **Circular Context Meter:** Live circular progress indicator showing real-time token utilization against active model context limits.
- **Floating Details:** Instant visibility into prompt tokens, budget headroom, and model capacity.

### 🎭 Triple Operating Mode Switcher
- **Polished Mode Switcher:** Smooth glassmorphic selector in the agent composer to toggle between:
  - 🟣 **Agent Pro Mode:** Autonomous generation, multi-file editing, and safe dev command execution inside workspace boundaries.
  - 🟢 **Dev Mode:** Default balanced pair programming with Monaco Diff approval cards on any file write or risky command.
  - 🟠 **User Mode:** Strict per-operation auditing where all file reads, searches, and commands require explicit approval.

### 📁 Native File Dialog Integration
- **Platform-Native Dialogs:** Integrated `@tauri-apps/plugin-dialog` to launch native Windows, macOS, and Linux file and directory pickers.
- **Removed Legacy Prompts:** Browser-style `window.prompt` dialogs for path entry are completely removed.

### 📖 Markdown Document Previewer
- **Integrated Markdown Preview:** Split-pane rendered markdown viewer with GitHub-flavored styling for instant documentation and README previewing.

---

## 🛠️ Upgrades & Removals Summary

### Upgraded
- Integrated terminal panel flex layout and multi-tab system.
- Real-time circular context usage meter.
- Operating mode switcher (Agent Pro, Dev, User).
- Native OS dialogs for workspace and file selection.
- Split-pane markdown document viewer.

### Removed
- **Browser-Style Window Prompt for Paths:** This feature is removed in favor of native OS file and folder picker dialogs.
- **Hardcoded Terminal Height Constraints:** This feature is removed and replaced with dynamic flexbox sizing and draggable split dividers.

### Fixed
- **Workspace Reopening Error:** Resolved "Could not reopen workspace" error where non-canonical Windows paths failed verbatim prefix resolution.
- **Bottom Panel Squish:** Fixed CSS flexbox min-height bug that collapsed the terminal panel to 0px.
- **Terminal Input Event Listener Leaks:** Cleaned up tab switching listener bindings.
