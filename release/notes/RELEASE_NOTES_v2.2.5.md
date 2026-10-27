# Orbital X v2.2.5 — Explorer UI & SVG Icons, Speed & Repetition Fixes

> **Code with Autonomy. Zero Cloud Lock-in. Zero RAM Waste.**  
> High-performance, memory-conscious AI pair-programming desktop IDE built on Tauri 2 and Rust.

---

## 🚀 What's New in v2.2.5

### 🗂️ Clean File Explorer UI & Vector SVG Icon Pack
- **Vector SVG Icons:** Replaced all primitive emoji file and directory icons with a sharp, professional vector SVG icon suite covering 15+ file types (Rust, JavaScript, TypeScript, HTML, CSS, JSON, Markdown, TOML, Git, Locks, Media, Shell, License) and folder open/closed states.
- **Compact 22px Lineup:** Explorer tree rows now align to a compact 22px lineup with subtle indent guide lines and rotating chevron indicators.
- **Removed Header Bloat:** The bulky "Filter files..." input and the persistent "Recent (1)" files accordion have been removed from the file tree root, providing an instant, clean project hierarchy view.

### ⚡ 30–35 Tok/s Inline Suggestion Optimization & 8192-Token Code Generation
- **Capped Inline Suggestions:** Inline autocompletions are capped at 64 tokens (`num_predict: 64`, `max_tokens: 64`, `temperature: 0.15`), achieving low latency (30–35 tokens/sec) for seamless ghost-text suggestions without editor lag.
- **8-Thread Local Ollama Evaluation:** Chat evaluations now default to `num_thread: 8` for >20 tokens/sec local model generation on modern multi-core CPUs.
- **8192-Token Ceiling for Code Generation:** Default code generation token limit expanded from 2048 to 8192 tokens (`num_predict: 8192`), enabling the agent to write full, complex, multi-thousand-line files without abrupt truncation.

### 🌐 @codebase & @workspace Mention Resolution
- **Codebase Digest Injection:** Simply typing `@codebase` or `@workspace` in the AI chat composer (or pressing `Alt+Enter` or clicking the new `🌐 @codebase` chip) compiles an instant structured digest of the repository (file counts, language breakdown, full tree, and dependency manifests) into the prompt.

### ⚙️ Automated Build & Code Verification Tool (`verify_build`)
- **Native Build Test Runner:** Added native Rust command `verify_workspace_build` and agent tool `verify_build` with an interactive composer chip (`⚙️ Verify Build`) to test and compile code (`cargo test`, `npm test`, `npm run build`) before making commits.

### 🖱️ Global Dark Glassmorphic Context Menu
- **Unified Right-Click System:** Intercepts standard right-click actions across the entire IDE (File Tree, Monaco Editor, Integrated Terminal, and AI Chat) to display a sleek, dark glassmorphic context menu with native action routing (Open, Delete, Rename, Copy Path, Clear Terminal, Split Terminal).

### 🔄 AI Chat Infinite Repetition & Looping Fix
- **Loop Prevention:** Resolved root cause in `agent.js` where conversational responses or questions without tool calls triggered repetitive tool re-invocation; added duplicate response suppression and conversational break conditions.
- **Context Popover:** Fixed circle indicator click behavior to display an elevated floating glassmorphic popover directly above the context meter badge instead of opening detached dialogs.
- **Smooth Auto-Scroll:** AI chat timeline auto-scroll behavior restored during active token streaming and user interaction.

---

## 🛠️ Upgrades & Removals Summary

### Upgraded
- **File Explorer UI & Vector SVG Icon Pack:** 15+ vector SVG file types, compact 22px node lineup with indent guide lines.
- **Inline Suggestion Speed & Token Cap:** 64-token cap (`num_predict: 64`), 30–35 tok/s target speed.
- **Local Ollama Inference Speed:** 8-thread (`num_thread: 8`) CPU evaluation for >20 tok/s chat speed.
- **Longer File & Code Generation:** Token generation ceiling expanded to 8192 tokens (`num_predict: 8192`).
- **Codebase Tagging & Context Resolution (`@codebase` / `@workspace`):** Repository structure and dependency digest injection via mention, `Alt+Enter`, or chip.
- **Automated Build & Code Verification Tool (`verify_build`):** Native cargo and npm test runner before commits.
- **Global Dark Glassmorphic Context Menu:** IDE-wide unified context menu with native action routing.

### Removed
- **Filter Files Search Box in File Explorer:** This feature is removed from the explorer tree header to eliminate visual clutter and vertical bloat in favor of instant, direct hierarchy navigation.
- **Persistent Recent Files Accordion:** This feature is removed from the explorer sidebar root to streamline project navigation and adhere to professional IDE standards.
- **Emoji File & Folder Icons:** This feature is removed across all tree components and replaced by crisp, scalable vector SVG icons.

### Fixed
- **AI Chat Infinite Repetition & Looping:** Fixed recursive loop in `agent.js` where conversational responses or questions without tool calls triggered repetitive tool re-invocation; added duplicate response suppression and conversational break conditions.
- **Context Window Usage Popover:** Fixed circle indicator click behavior to display an elevated floating glassmorphic popover directly above the context meter badge instead of opening detached dialogs.
- **AI Chat Timeline Scroll:** Restored smooth, uninterrupted scrolling during active token streaming and user interaction.

---

## 📦 Downloads & Verification

| Platform | Format | Architecture | Filename |
|---|---|---|---|
| **Windows** | `.exe` NSIS Setup | x64 (64-bit) | `Orbital.X_2.2.5_x64-setup.exe` |
| **Windows** | `.exe` Portable | x64 (64-bit) | `orbital-x.exe` |
| **macOS** | `.dmg` Disk Image | Apple Silicon & Intel | `Orbital.X_2.2.5_aarch64.dmg` |
| **Linux** | `.AppImage` | x86_64 / amd64 | `Orbital.X_2.2.5_amd64.AppImage` |
| **Linux** | `.deb` Package | x86_64 / amd64 | `Orbital.X_2.2.5_amd64.deb` |

- **Desktop Runtime:** Tauri v2.2.0 + Rust 1.90
- **Editor Engine:** Monaco Editor 0.52.2
