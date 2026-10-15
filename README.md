# Orbital X — AI-Powered Desktop Coding IDE

> **Code. Explore. Validate.**  
> A memory-conscious, autonomous AI coding environment built on Tauri 2 and modern web standards.

---

## 1. Overview

**Orbital X** combines the reliability and responsiveness of a native desktop code editor with a deeply integrated, tool-using AI coding agent. It is designed to work seamlessly with both cloud providers (Anthropic Claude, OpenAI, Google Gemini) and local models (Ollama).

### Core Highlights
- **Native Desktop Shell:** Built with **Tauri 2 + Rust** for minimal idle memory and native Windows speed.
- **Pure Web Standards Frontend:** Semantic HTML5, modern CSS with tailored design tokens, and modular JavaScript (ES Modules). Zero heavy frontend framework bloat.
- **Monaco Code Editor:** Full syntax highlighting for 50+ languages, line numbers, minimap, tabs, dirty indicators, and integrated Monaco Diff Editor for change reviews.
- **Three Central Agent Modes:**
  1. 🟣 **Agent Pro Mode:** High autonomy within workspace boundaries. File reads, searches, and allowlisted edits/tests run automatically.
  2. 🟢 **Dev Mode (Default):** Balanced development. Code inspection and searching are streamlined; file edits show diffs and terminal commands require user approval.
  3. 🟠 **User Mode:** Explicit per-operation confirmation before every read, write, or command.
- **Unified Provider Abstraction:** Seamless switching between Anthropic Claude, OpenAI, Google Gemini, and Ollama (Local).
- **Validation Loop:** Integrated terminal runner, automatic test suite detection (`cargo test`, `npm test`, `pytest`), and error diagnostics.
- **Durable Project Memory:** Persists architecture decisions, setup conventions, and project rules locally in `.orbital/memory.json`.

---

## 2. Operating Modes Explained

| Feature / Action | Agent Pro Mode | Dev Mode (Default) | User Mode |
|---|---|---|---|
| **File Reads & Searches** | Automatic | Automatic | Approval Required |
| **Workspace Map & Symbols** | Automatic | Automatic | Approval Required |
| **File Creation & Edits** | Automatic | **Approval Card (with Diff)** | **Approval Card (with Diff)** |
| **Safe Build / Test Commands** | Automatic | **Approval Card** | **Approval Card** |
| **Arbitrary Commands / Git** | Approval Required | **Approval Card** | **Approval Card** |
| **Destructive / Elevated Actions** | **Strictly Blocked** | **Strictly Blocked** | **Strictly Blocked** |

All tool decisions are evaluated and enforced strictly inside the trusted Rust backend (`PolicyEngine`), ensuring the WebView cannot bypass safety constraints.

---

## 3. Themes & Aesthetics

Orbital X includes three curated visual themes:
1. **Orbit Dark (Default):** Charcoal backgrounds (`#0d1117`), electric cyan (`#39c5bb`) and luminous violet (`#bc8cff`) accents.
2. **Nebula Light:** Clean slate and neutral light backgrounds with high accessible contrast.
3. **Midnight Blue:** Deep cosmic navy (`#080d1a`) with warm amber and electric blue syntax colors.

---

## 4. Prerequisites

To run or build Orbital X on Windows:
- **Operating System:** Windows 10/11 (64-bit) with Microsoft Edge WebView2 (installed by default on Windows 10/11).
- **Rust Toolchain:** Rust 1.90+ with `rustc` and `cargo` installed via [rustup.rs](https://rustup.rs).
- **Node.js:** Node.js 18+ and `npm`.
- **C++ Build Tools:** Visual Studio C++ Build Tools or Windows SDK (required by Tauri).
- *(Optional for Local AI)* **Ollama:** Installed and running locally on `http://localhost:11434`.

---

## 5. Development & Build Commands

### Install Dependencies
```powershell
npm install
```

### Run in Development Mode (Live HMR)
```powershell
# In terminal 1: start frontend dev server
npm run dev

# In terminal 2: launch Tauri desktop window
npx tauri dev
```

### Run Unit Tests
```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

### Build Production Bundle & Windows Installer
```powershell
# 1. Build optimized frontend assets
npm run build

# 2. Package desktop executable and installer
npx tauri build
```
The installer will be generated in `src-tauri/target/release/bundle/msi/` or `nsis/`.

---

## 6. Keyboard Shortcuts

- `Ctrl + O`: Open Workspace Directory
- `Ctrl + S`: Save Active File
- `Ctrl + F`: Quick Find in File
- `Ctrl + Shift + A`: Toggle Agent Dock
- `Ctrl + Shift + E`: Focus File Explorer
- `Ctrl + Shift + F`: Search Across Workspace
- `Ctrl + Shift + M`: Project Memory & Rules
- `Alt + M`: Cycle Operating Mode (Dev ➔ Pro ➔ User)

---

## 7. Security & Privacy Disclosure

- **Local First:** All project files, workspace maps, activity journals, and memories are kept strictly on your local disk.
- **Provider Transparency:** Code context is only transmitted to AI providers that you explicitly configure and select.
- **Credential Protection:** API keys are stored locally, masked in UI forms, and automatically redacted from settings exports and logs.
- **Path Isolation:** Directory traversal (`..`) and symlink escapes outside the open workspace directory are blocked at the Rust kernel boundary.
