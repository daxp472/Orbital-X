# Changelog

All notable changes to Orbital X are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [v2.3.1] — 2026-11-03

### Added & Upgraded
- **Multi-Model Speculative Streaming:** Run ultra-fast draft models (0.5B/1.5B/3B) concurrently with heavy verifier models (7B/14B) via Ollama, streaming instant speculative code completions into Monaco while the background thread validates logic.
- **Zero-Allocation Token Telemetry & VRAM Tracker:** Native Rust crate sysinfo monitoring real-time host CPU, RAM, GPU VRAM allocation, and tokens per second embedded directly into the status bar HUD.
- **The "Time-Travel" Agent Journal:** Atomic Virtual File System snapshot patches before and after every agent turn with visual scrubber timeline and 1-click rollback of multi-file modifications.
- **Strict Context Window Allocation:** Enforced strict allocation where the exact user-specified context number (e.g. 8,192 or 16,384 tokens) is assigned directly to the model as primary context without downscaling or clamping for laptop hardware or VRAM limits.
- **In-Chat Auto Mode & Speculative Toggle:** Added one-click toggle pill in the chat composer bar and dropdown card in the model picker, enabling seamless switching into dual-model speculative mode.
- **Agent Self-Identity & Architecture Awareness:** System prompt expanded with rich creator facts (created by Dax Patel and the Orbital X Team), native Rust/Tauri v2 architecture details, and conversational guidance for curious non-programmers.

---

## [v2.3.0] — 2026-11-02

### Added & Upgraded
- **In-App 1-Click Update System:** Complete native streaming downloader with live percentage and transfer speed reporting, paired with a non-blocking "Restart Application" flow that cleanly replaces Windows executables.
- **Persistent Sticky Task Progress Banner:** Real-time task progress tracker anchored directly above the chat composer input, replacing action chips while tasks are in flight and displaying animated progress, live timers, and cancel controls.

---

## [v2.2.8] — 2026-11-01

### Upgraded
- **Auto-Update System:** Native Tauri updater integration with automatic release checking, progress tracking, download management, and seamless installer execution. Users are notified when updates are available and guided through the download/installation process.
- **Report Issue Feature:** Added "Report Issue" button in the Help menu, About dialog, and Status Bar. Opens the public docs issue portal with pre-filled system information for streamlined bug reporting.
- **Documentation Website:** Comprehensive docs site upgrade with deep product documentation, feature guides, installation walkthroughs, FAQ section, and responsive Apple-inspired design with glassmorphic navigation.

### Fixed
- **Monaco Editor Memory Leak:** Fixed unbounded memory growth when closing tabs by properly disposing of model references via `editorModels.delete(path)` only when no other tab references the same file path in either panel.
- **Change Journal Memory Accumulation:** Added automatic eviction when change journal exceeds 100 entries, preserving the most recent history for undo/checkpoint functionality.
- **API Key Storage Security:** Implemented base64 obfuscation for API keys before `localStorage` persistence, with backward compatibility for existing plaintext keys on load.

### Changed
- Updated all version references to v2.2.8 across `package.json`, `Cargo.toml`, `tauri.conf.json`, `index.html`, and `src/js/app.js`.
- Added `check_for_updates`, `download_update`, `install_update`, and `open_url` IPC commands to the Rust backend for native update functionality.
- Updated What's New modal to accurately reflect v2.2.8 release notes.

---

## [v2.2.7] — 2026-11-01

### Upgraded & Fixed
- **Native Workspace Folder Picker & COM Apartment Isolation:** Overhauled the Open Workspace system to prevent native dialog freezing, silent aborts, and bouncing back on Windows. Spawned a dedicated OS thread (`orbital-folder-picker`) with fresh Win32 COM apartment initialization, parent window handle attachment (`dialog.set_parent(&win)`), and robust path unpackers for strings, arrays, and object paths.
- **Zero-Interruption Workspace Trust Gate:** Resolved `rememberWorkspaceTrust` runtime reference errors and eliminated intrusive blocking `confirm()` dialogs when opening directories. Explicitly opened workspaces are automatically marked trusted for seamless navigation.
- **Interactive Triple-Mode Switcher Synchronization:** Added click interaction to the bottom status bar mode badge and synchronized the Apple-style Mode Switcher dropdown across both titlebar and status bar. Ensured real-time accent color synchronization (`agent_pro`: purple, `dev`: cyan, `user`: green) across UI indicators and stored states.
- **Top-Bar Customization & Window Controls Cleanliness:** Verified and preserved the clean traffic light layout with brand logo, menu bar, and centered workspace badge without redundant window control overlays.
- **Production Changelog Subsystem:** Initialized the automated `changelogs/` directory with detailed, standalone audit files (`001.md`) documenting all code changes, modified files, verification results, and zero-downtime production recovery guides.

---

## [v2.2.6] — 2026-10-28

### Upgraded
- **Source Control UI & UX Overhaul:** Upgraded the Git panel with crisp vector SVG file and action icons. Added direct per-row Stage (`+`), Discard (`↺`), and Diff (`📄`) actions, section-level bulk controls (Stage All, Discard All, Unstage All), and a conventional commit composer with character counter and `<kbd>Ctrl+Enter</kbd>` keyboard badge. Modernized the Branch Header with quick sync action buttons (Fetch, Pull, Push, Stash).
- **Run & Debug Codebase Engine:** Added a dedicated Run and Debug runner (`debug.js`) that auto-detects `package.json` scripts, `Cargo.toml` targets, and active open files (JavaScript, TypeScript, Python, Rust, Shell, HTML). Added a Quick Command Runner with 1-click execution chips (`npm run dev`, `npm test`, `npm run build`, `cargo test`) running straight into the integrated terminal sandbox.
- **Apple-Inspired Keyboard Shortcuts UI:** Rebuilt the Settings Keyboard Shortcuts tab with categorised cards (AI Agent, Editor, View & Terminal, File, Git, Tools), tactile `<kbd class="apple-keycap">` typography, real-time live search filtering, conflict detection, and interactive key recording.
- **Top Bar Layout & Workspace Folder Picker Fix:** Restored the clean, non-duplicated top bar layout with traffic lights on the left, brand logo, menu bar, and centered workspace badge, removing redundant window controls. Replaced fragile blocking async dialog calls with dedicated OS thread worker (`tokio::task::spawn_blocking`) using direct native `rfd::FileDialog` and `into_path()` fallback. Added dedicated "Open Folder" button in Explorer header and multiple quick-open entrypoints.
- **Export & Import Chat History:** Restored native chat history export and import buttons in the AI agent header and recent chats popover, allowing users to save and load timestamped Markdown (`.md`) conversation logs.

### Removed
- **Project Overview Subview:** This feature is removed from the Activity Rail and sidebar to eliminate visual clutter and align the IDE experience with core developer workflows.

---

## [v2.2.5] — 2026-10-27

### Upgraded
- **File Explorer UI & Vector SVG Icon Pack:** Upgraded the file tree with a high-fidelity vector SVG icon pack covering 15+ file types (Rust, JavaScript, TypeScript, HTML, CSS, JSON, Markdown, TOML, Git, Locks, Media, Shell, License) and directory open/close states. The hierarchy now aligns to a sleek, compact 22px lineup with subtle vertical indent guide lines and rotating chevron indicators.
- **Inline Suggestion Speed & Token Cap:** Capped inline code autocompletions to 64 tokens (`num_predict: 64`, `max_tokens: 64`, `temperature: 0.15`) targeting 30–35 tokens/sec for near-instant completion latency in active editor sessions without interrupting flow.
- **Local Ollama Inference Speed:** Accelerated Ollama chat generation to >20 tokens/sec by enabling 8-thread (`num_thread: 8`) CPU evaluation by default.
- **Longer File & Code Generation:** Expanded code generation ceiling from 2048 to 8192 tokens (`num_predict: 8192`), enabling the agent to write complete, unclipped files and complex multi-function implementations without unexpected cutoffs.
- **Codebase Tagging & Context Resolution (`@codebase` / `@workspace`):** Added `@codebase` and `@workspace` mention resolution in the AI chat composer. When tagged (or triggered via `Alt+Enter` / the new composer action chip), the engine compiles a structured workspace map with file counts, directory tree, and package manifests directly into the prompt.
- **Automated Build & Code Verification Tool (`verify_build`):** Implemented a native Rust/Tauri verification command (`verify_workspace_build`) and agent tool (`verify_build`) with an interactive composer chip (`⚙️ Verify Build`) to test and compile project code (`cargo test`, `npm test`, `npm run build`) before committing changes.
- **Global Dark Glassmorphic Context Menu:** Intercepts standard right-click actions across the entire IDE (File Tree, Editor, Terminal, Chat) to render a custom Apple-inspired glassmorphic context menu with native action routing (Open, Delete, Rename, Copy Path, Clear Terminal, Split Terminal).

### Removed
- **Filter Files Search Box in File Explorer:** This feature is removed from the explorer tree header to eliminate visual clutter and vertical bloat in favor of instant, direct hierarchy navigation.
- **Persistent Recent Files Accordion:** This feature is removed from the explorer sidebar root to streamline project navigation and adhere to professional IDE standards.
- **Emoji File & Folder Icons:** This feature is removed across all tree components and replaced by crisp, scalable vector SVG icons.

### Fixed
- **AI Chat Infinite Repetition & Looping:** Fixed recursive loop in `agent.js` where conversational responses or questions without tool calls triggered repetitive tool re-invocation; added duplicate response suppression and conversational break conditions.
- **Context Window Usage Popover:** Fixed circle indicator click behavior to display an elevated floating glassmorphic popover directly above the context meter badge instead of opening detached dialogs.
- **AI Chat Timeline Scroll:** Restored smooth, uninterrupted scrolling during active token streaming and user interaction.

---

## [v2.2.4] — 2026-10-26

### Upgraded
- **Integrated Terminal Architecture:** Complete bottom panel layout overhaul. Terminal tabs now use responsive flex sizing that prevents panel collapsing, squashing, or clipping during resize operations.
- **Context Window Usage Meter:** Added interactive circular usage indicator displaying real-time context token consumption and budget limits relative to active model capacity.
- **Triple Operating Mode Switcher:** Polished mode selection dropdown supporting **Agent Pro** (autonomous generation), **Dev** (interactive diff approvals), and **User** (strict per-operation auditing).
- **Native File Dialog Picker:** Integrated `@tauri-apps/plugin-dialog` to launch native Windows/macOS/Linux system dialogs for workspace folder and file selection.
- **Markdown Document Previewer:** Added integrated split-pane markdown preview mode for instant documentation and README inspection.

### Removed
- **Browser-Style Window Prompt for Paths:** This feature is removed in favor of native OS file and folder picker dialogs.
- **Hardcoded Terminal Height Constraints:** This feature is removed and replaced with dynamic CSS flex-grow layouts and draggable split-pane dividers.

### Fixed
- **Workspace Reopening Error:** Resolved "Could not reopen workspace" error where relative or non-canonical paths failed Windows verbatim path resolution in `workspace.rs`.
- **Bottom Panel Squish:** Fixed CSS flexbox min-height bug that caused the terminal panel to shrink to 0px when multiple editor tabs were open.
- **Terminal Input Event Listener Leaks:** Cleaned up tab switching listener bindings so keystrokes route reliably to the focused terminal instance.

---

## [v2.2.3] — 2026-10-24

### Upgraded
- **Extension System:** Real declarative extension packs (themes, prompt packs, command packs) with a bundled registry, folder import, enable/disable, uninstall, and details views. VS Code `.vsix`/code-executing extensions explicitly unsupported with clear messaging.
- **Agent Skills:** Claude Code-style `SKILL.md` instruction packs — context digest + `list_skills`/`read_skill` tools gated by the permission engine, with a management panel (import, toggle, review, delete).
- **Live Token Streaming & Cancellation:** Ollama token streaming into the chat timeline; Stop aborts in-flight requests and frees the model server-side; cloud providers cancellable the same way.
- **Web Research Suite:** Safe `web_search` (keyless DuckDuckGo) and `fetch_page` (capped public page reader) tools wrapped as untrusted external content.
- **Ollama Model Management:** In-app model pulls with live progress and cancellation, deletion, model info (params/quantization/real context length/tool support), loaded-models view with VRAM, hardware-aware fit guidance.
- **OpenAI-Compatible Custom Endpoints:** LM Studio / llama.cpp / vLLM support via custom base URL.
- **Onboarding Ollama Detection:** Connectivity check with re-check and install guidance.
- **Context & Speed Meter:** Status-bar prompt-tokens/context + tokens-per-second calculated from real Ollama eval timings.
- **Responsive & Accessible UI:** Visible `:focus-visible` everywhere, `prefers-reduced-motion` support, responsive settings dialog/status bar/modals, consistent scrollbars and states across all themes.

### Removed
- **Duplicate `delete_file` Tool Schema:** This feature is removed from the tool dispatcher to prevent schema conflicts and enforce the unified deletion pipeline.
- **Unvalidated Terminal Command Execution:** This feature is removed and replaced by the strict three-tier `CommandClassifier` security sandbox.

### Fixed
- **`write_file - Missing path`:** JSON-string and aliased (`parameters`/`input`) tool arguments normalized everywhere; dispatcher accepts `file_path`/`filePath` aliases and returns structured self-correctable errors.
- **`patch_file` Panic:** Invalid line ranges now error cleanly instead of poisoning the workspace mutex; CRLF line endings preserved.
- **XSS & Content Security:** Escape-first markdown rendering, listener-bound copy buttons, escaped search snippets, and real CSP.
- **Git Command Injection:** All git operations use argument-array execution.
- **Light Theme:** Settings dialog no longer renders as a dark box; missing `--bg-glass-translucent` token added to Light/Midnight Blue/High Contrast.
- **Workspace Metadata:** Real cached scan results (file counts, languages) instead of zeros.
- **Chat History Persistence:** Sessions moved to atomic `~/.orbital/chat_sessions.json` with bounded growth to eliminate localStorage quota loss.

---

## [v2.2.2] — 2026-10-22

### Upgraded
- **Kernel-Level Workspace Boundary Confinement:** All agent file inspections, searches, modifications, and deletions are strictly resolved against canonical workspace boundary with Windows verbatim `\\?\` prefix normalization and trailing slash boundaries.
- **Root Directory Wipe Protection:** Explicit kernel-level check blocks the agent from ever targeting or deleting the workspace root (`ensure_not_workspace_root`), preventing catastrophic hallucinated directory wipes.
- **CommandClassifier Three-Tier Security Sandbox:** Prohibits destructive wipes (`rm -rf /`, `rmdir /s /q`), administrative elevation (`runas`, `takeown`, `sudo`, `icacls /grant`), registry alterations (`reg add`, `reg delete`), and encoded PowerShell scripts (`-enc`) before shell execution.
- **Dedicated Directory & Two-Stage Batch File Deletion Tools:** `delete_directory` tool with undo journal logging and `batch_delete_files` tool with stage 1 preview manifest and stage 2 pre-execution revalidation.
- **Category Color-Coded Approval Cards:** Visual color coding for tool actions (Emerald for Writes, Cyan for Reads, Amber for Commands, Red for Deletions, Purple for Modes) with Monaco Diff inspection cards.
- **Self-Healing Diagnostics:** When an agent task encounters an obstacle, rich diagnostics display with an intuitive `▶️ Resume & Retry Blocked Task` button to continue execution without losing state.

### Fixed
- **React JSX Syntax False Positives:** Fixed regex parsing bug where JSX tags (`<div />`) caused 25% execution blocker false syntax failures during validation.
- **Elapsed Time Accuracy:** Fixed timer calculation so execution duration is tracked accurately.

---

## [v2.0.1] — 2026-10-15

### Added
- **Windows NSIS Installer:** Full setup wizard with license agreement, directory picker, scope selector (current user / all users), and uninstaller registration in Windows Settings.
- **Automated Project Memory Extraction:** Agent now auto-detects architecture discussions and upserts them to project memory without requiring explicit user commands.
- **Chat Session Persistence:** Full chat history stored in `localStorage` with session switching dropdown and new-chat creation.
- **VS Code-style Terminal:** Multi-tab integrated terminal with command history navigation (ArrowUp/Down), shell built-ins (`cd`, `cls`), and hotkey toggle (`Ctrl+` `` ` `` / `Ctrl+J`).
- **Memory Deduplication:** `MemoryService.save_memory()` now normalizes and deduplicates by `(category, title)` pair — no more accumulation of duplicate entries.
- **Community Files:** Added `LICENSE`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CHANGELOG.md` to make the project community-ready.

### Fixed
- **Settings Save:** Model and API key settings now persist correctly across sessions; save-and-close button wired to full settings flush.
- **Model Dropdown:** Provider model selector now shows the correct dropdown list for each provider; Ollama models fetched live from the local API.
- **Source Control Panel:** `Ctrl+Shift+G` shortcut now correctly opens/toggles the git panel.
- **Extensions Panel:** `Ctrl+Shift+X` shortcut now correctly opens/toggles the extensions panel.
- **Terminal Launch:** Terminal no longer attempts to create a new PowerShell process window — all output runs inline in the IDE bottom panel.

### Improved
- Agent dock UX: cleaner approval cards, better streaming indicators, provider/model context badges.
- Status bar now reflects active model and provider accurately.
- Theme tokens refined for more consistent spacing in all three themes.

---

## [v1.0.0] — 2026-10-01

### Added
- Initial Orbital X MVP.
- Monaco Editor integration with 50+ language grammars, line numbers, minimap, and dirty indicators.
- Three agent operating modes: Agent Pro, Dev, and User.
- Unified AI provider support: Anthropic Claude, OpenAI, Google Gemini, Ollama (local).
- PolicyEngine for tool-call risk evaluation and approval flow.
- Durable project memory with `.orbital/memory.json`.
- Monaco Diff Editor for file change previews.
- Source control panel showing git status.
- Extensions panel.
- Three visual themes: Orbit Dark, Nebula Light, Midnight Blue.
- Keyboard shortcuts: `Ctrl+S`, `Ctrl+B`, `Ctrl+J`, `Ctrl+Shift+A`, `Ctrl+Shift+G`, `Ctrl+Shift+X`, `Alt+M`.
