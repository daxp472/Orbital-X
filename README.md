# Orbital X — AI-Powered Desktop Coding IDE

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blueviolet.svg?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.90%2B-orange.svg?logo=rust)](https://www.rust-lang.org)
[![Version](https://img.shields.io/badge/Release-v2.0.1-emerald.svg)](https://github.com/daxp472/Orbital-X/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows_x64-0078d4.svg?logo=windows)](https://github.com/daxp472/Orbital-X/releases)

**A high-performance, memory-conscious, autonomous AI coding environment built on Tauri 2 and modern web standards.**  
*Native speed. 100% local model support. Durable workspace memory.*

[Key Features](#key-features) • [Installation](#installation) • [Operating Modes](#operating-modes) • [Local AI with Ollama](#local-ai-with-ollama) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## 🚀 Overview

**Orbital X** combines the reliability and speed of a native desktop code editor with a deeply integrated, tool-using AI coding agent. It is designed from the ground up for developers who demand **complete data privacy**, **offline-first local model support** (via Ollama), and **zero-bloat memory performance**.

Unlike heavy Electron-based editors that consume gigabytes of RAM at idle, Orbital X uses **Tauri 2 + Rust** with Microsoft Edge WebView2, keeping idle memory under **120 MB** while maintaining full compatibility with Monaco Editor and VS Code-grade editing capabilities.

---

## ✨ Key Features

- **⚡ Native Rust Shell:** Powered by Tauri 2. Idle memory footprint of ~100MB vs 1.5GB+ in Electron alternatives.
- **🧠 100% Local AI Support:** First-class support for [Ollama](https://ollama.ai) — run `llama3`, `qwen2.5-coder`, `mistral`, or `deepseek-coder` completely offline on your PC with zero API fees and 100% code privacy.
- **☁️ Cloud Provider Flexibility:** Seamlessly switch between Anthropic Claude (3.5 Sonnet), OpenAI (GPT-4o), Google Gemini (1.5 Pro / Flash), and local Ollama from a single unified model picker.
- **🛡️ Tri-Mode Safety Policy:** Choose between **Agent Pro Mode** (autonomous tool execution), **Dev Mode** (approval cards for writes/commands), and **User Mode** (strict per-action confirmation).
- **💾 Durable Project Memory:** Architecture decisions, entrypoints, and setup rules are automatically extracted and saved locally in `.orbital/memory.json` — your AI remembers your project across restarts.
- **🖥️ Integrated VS Code Terminal:** Full multi-tab terminal with command history (`↑`/`↓`), built-in navigation (`cd`, `cls`), and instant hotkey toggle (`Ctrl+` `` ` `` / `Ctrl+J`).
- **📝 Monaco Code Editor:** Full syntax highlighting for 50+ languages, line numbers, minimap, dirty tab indicators, and integrated side-by-side Monaco Diff Editor for change reviews.
- **💬 Chat Sessions & History:** Persistent multi-session chat manager stored locally in `localStorage` — switch between past conversations or start clean tasks with a single click.
- **🎨 Modern Developer Aesthetics:** Hand-crafted Orbit Dark, Nebula Light, and Midnight Blue themes with silky-smooth micro-animations, accessible contrast, and zero "AI slop" clutter.

---

## 📥 Installation

### Windows Setup Installer (Recommended)

1. Head to the **[Latest Releases](https://github.com/daxp472/Orbital-X/releases/tag/v2.0.1)** page.
2. Download `Orbital X_2.0.1_x64-setup.exe`.
3. Run the installer:
   - Choose **Install for anyone (All Users)** or **Install just for me (Current User - no admin required)**.
   - Accept the license and select your preferred install directory.
   - Shortcuts are automatically created on your Desktop and Start Menu.
4. Launch **Orbital X** from your Start Menu or Desktop.

---

## 🎛️ Operating Modes

Orbital X features a kernel-enforced permission model evaluated inside Rust (`PolicyEngine`):

| Feature / Action | 🟣 Agent Pro Mode | 🟢 Dev Mode (Default) | 🟠 User Mode |
|---|---|---|---|
| **File Reads & Searches** | Automatic | Automatic | Approval Required |
| **Workspace Map & Symbols** | Automatic | Automatic | Approval Required |
| **File Creation & Edits** | Automatic | **Approval Card (with Diff)** | **Approval Card (with Diff)** |
| **Safe Build / Test Commands** | Automatic | **Approval Card** | **Approval Card** |
| **Arbitrary Commands / Git** | Approval Required | **Approval Card** | **Approval Card** |
| **Destructive Actions (`rmdir`, `format`)** | **Strictly Blocked** | **Strictly Blocked** | **Strictly Blocked** |

> **Quick Switch:** Press `Alt + M` or click the mode pill in the top header to cycle between modes at any time.

---

## 🦙 Local AI with Ollama

Orbital X connects directly to your local [Ollama](https://ollama.ai) instance without any cloud proxy:

1. Install and launch Ollama on your machine:
   ```powershell
   # Install your preferred coding model
   ollama run qwen2.5-coder:7b
   # or
   ollama run llama3:latest
   ```
2. Open **Orbital X Settings** (`Ctrl + ,` or the gear icon in the activity rail).
3. Under **Provider**, select `Ollama (Local)`.
4. Ensure the endpoint is set to `http://localhost:11434` (default).
5. Orbital X will auto-populate the dropdown with all models installed locally on your PC!
6. Click **Save and Close**. You are now coding with 100% local, private AI.

---

## ⌨️ Essential Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + O` | Open Workspace Directory |
| `Ctrl + S` | Save Active File |
| `Ctrl + L` | Focus Agent Chat / Reveal AI Dock |
| `Ctrl + \`` / `Ctrl + J` | Toggle Terminal Panel |
| `Ctrl + B` | Toggle Primary Side Bar |
| `Ctrl + Shift + A` | Toggle Agent Dock |
| `Ctrl + Shift + G` | Open Source Control (Git) |
| `Ctrl + Shift + E` | Open File Explorer |
| `Ctrl + Shift + F` | Search Across Workspace |
| `Ctrl + Shift + X` | Open Extensions Catalog |
| `Alt + M` | Cycle Operating Mode (Dev ➔ Pro ➔ User) |

---

## 🛠️ Building from Source

### Prerequisites
- **OS:** Windows 10/11 (64-bit)
- **Rust Toolchain:** Rust 1.90+ (`rustup install stable`)
- **Node.js:** Node.js 18+ and `npm`
- **Visual Studio C++ Build Tools:** Desktop development with C++ workload

### Step-by-Step Build

```powershell
# 1. Clone repository
git clone https://github.com/daxp472/Orbital-X.git
cd Orbital-X

# 2. Install frontend dependencies
npm install

# 3. Launch in development mode
npm run dev:tauri

# 4. Package production NSIS installer
npx tauri build --bundles nsis
```

The compiled setup installer will be placed in:
```
src-tauri/target/release/bundle/nsis/Orbital X_2.0.1_x64-setup.exe
```

---

## 🏛️ Architecture & Documentation

- [Architecture Guide](ARCHITECTURE.md) — Detailed diagrams, IPC command registry, data flows, and subsystem specifications.
- [Contributing Guidelines](CONTRIBUTING.md) — Coding conventions, branching strategy, and pull request procedures.
- [Security Policy](SECURITY.md) — Path traversal isolation, secret sanitization, and vulnerability reporting.
- [Changelog](CHANGELOG.md) — Detailed version-by-version release history.

---

## 📄 License

Orbital X is open-source software licensed under the **[MIT License](LICENSE)**.

---

<div align="center">
Made with ❤️ by the Orbital X Community.
</div>
