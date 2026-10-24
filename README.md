# Orbital X — Local-AI Desktop Coding IDE

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blueviolet.svg?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.90%2B-orange.svg?logo=rust)](https://www.rust-lang.org)
[![Version](https://img.shields.io/badge/Release-v2.2.3-emerald.svg)](https://github.com/daxp472/Orbital-X/releases/latest)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-0078d4.svg)](https://github.com/daxp472/Orbital-X/releases/latest)
[![Tests](https://img.shields.io/badge/cargo%20test-36%2F36-brightgreen.svg)](.github/workflows/ci.yml)

**A fast, memory-conscious, autonomous AI coding IDE powered by your own local models.**
*Native speed · Streaming responses · 100% private inference · Rust-enforced safety*

[Download](#-installation) • [Features](#-key-features) • [Operating Modes](#-operating-modes) • [Local AI](#-local-ai-with-ollama) • [Extensions & Skills](#-extensions--skills) • [Build from Source](#-building-from-source)

</div>

---

## 🚀 Overview

**Orbital X** pairs a native desktop code editor with a deeply integrated, tool-using AI agent — built for developers who want **complete data privacy**, **offline-first local models** (via [Ollama](https://ollama.com)), and **zero bloat**.

While Electron editors idle at 1.5 GB+ of RAM, Orbital X runs on **Tauri 2 + Rust** with Edge WebView2 — a ~120 MB footprint with full Monaco (VS Code) editing power underneath.

The agent streams tokens as they're generated, manages its own context window against your model's real limits, executes multi-step tasks through a permission-gated tool system, researches documentation on the web when needed, and reports honest, evidence-backed progress the whole way.

---

## ✨ Key Features

### Agent engine
- **⚡ Live streaming + real cancellation** — Ollama responses render token-by-token; Stop aborts the in-flight request and frees the model immediately.
- **🧠 Context intelligence** — configurable context window auto-capped by each model's *real* limit (read from `/api/show`), compacted tool results, pair-preserving history trimming, and a live `tokens/ctx · tok/s` meter.
- **🧭 Model-generated task plans** — complex requests decompose into 2–6 verifiable, dependency-ordered tasks; tasks complete only with validation evidence; interrupted plans restore per workspace.
- **🌐 Web research tools** — `web_search` + `fetch_page` (DuckDuckGo-backed, no keys) with explicit *untrusted content* isolation, so documentation lookups can never hijack the agent.

### Local models first
- **🦙 Full Ollama lifecycle** — pull models with live progress and cancellation, delete with confirmation, inspect params/quantization/context/tool-support, and watch what's loaded in VRAM right now.
- **🖥️ Hardware-aware guidance** — real RAM/GPU detection with clearly-labelled fit estimates (unknown stays unknown — nothing invented).
- **🔌 Custom OpenAI-compatible endpoints** — LM Studio, llama.cpp server, and vLLM connect through the same provider system.
- **☁️ Cloud when you want it** — Claude, OpenAI, and Gemini adapters with your own keys.

### Safety, enforced in Rust
- **🛡️ Tri-mode policy engine** — Agent Pro / Dev / User permission matrix evaluated in the backend, never the WebView.
- **🔒 Strict workspace confinement** — path validation, symlink/junction escape prevention, and revalidated destructive operations.
- **⚔️ Strict command classification** — quote-aware chaining/redirection/subexpression detection; nested shells and inline-code invocations never auto-approve.

### Editor & UX
- **📝 Monaco editing** — 50+ languages, minimap, side-by-side diff review for every agent edit, one-key rollback via the change journal.
- **🖥️ Integrated terminal** — real interactive PowerShell sessions, multi-tab, history, interrupt support.
- **💾 Durable project memory** — architecture decisions and conventions persist per project in `.orbital/memory.json`.
- **💬 Sessions on disk** — chat history survives restarts and localStorage quota limits.
- **🎨 Four themes + polish** — Orbit Dark, Nebula Light, Midnight Blue, High Contrast; visible keyboard focus, reduced-motion support, and responsive layouts throughout.

---

## 🧩 Extensions & Skills

**Extensions** are declarative packs — safe by design, zero code execution:
- **Themes** override design tokens at runtime (bundled: *Solar Flare*, *Arctic Night*).
- **Prompt packs** inject focused agent guidance (*Rust Strict Mode*, *Frontend Craft*, *Test Discipline*).
- **Command packs** surface one-click runnable commands (*Web Dev*, *Rust Dev*, *Git Flow*).

Browse the bundled registry or import packs from folders. VS Code `.vsix` and code-executing extensions are **not supported** — and Orbital X tells you so instead of pretending.

**Skills** are Claude Code-style instruction packs (`SKILL.md` folders). Enabled skills appear in the agent's context as a digest; when a task matches, the agent reads the full skill through the permission-gated `read_skill` tool and follows it. Manage everything in the Skills panel: import, enable/disable, review, delete.

---

## 📥 Installation

Grab the latest from the **[Releases](https://github.com/daxp472/Orbital-X/releases/latest)** page:

| Platform | Asset |
|---|---|
| **Windows 10/11 (x64)** | `Orbital.X_x64-setup.exe` — NSIS installer; per-user (no admin) or all-users |
| **macOS (Apple Silicon)** | `.dmg` |
| **Linux (x64)** | `.AppImage` / `.deb` |

**For local AI, install [Ollama](https://ollama.com)** and pull a coding model:

```powershell
ollama pull qwen2.5-coder:7b
```

The onboarding wizard detects Ollama automatically and guides you through setup on first launch. Then just pick your model in the composer and start coding — everything runs on your machine.

---

## 🎛️ Operating Modes

The permission matrix is evaluated inside Rust (`PolicyEngine`) — the UI can't bypass it:

| Action | 🟣 Agent Pro | 🟢 Dev (Default) | 🟠 User |
|---|---|---|---|
| Reads, searches, skills, web research | Automatic | Automatic | Approval |
| File creation & edits | Automatic | Approval + diff | Approval + diff |
| Safe build/test commands | Automatic | Approval | Approval |
| Arbitrary commands, git commits | Approval | Approval | Approval |
| Destructive deletions | **Blocked / two-stage manifest** | **Blocked / two-stage manifest** | **Blocked / two-stage manifest** |

> Switch anytime with `Alt + M` or the mode pill in the header. *A policy layer is not an OS sandbox — Orbital X enforces tool boundaries, not system-level isolation.*

---

## 🦙 Local AI with Ollama

1. Install [Ollama](https://ollama.com) and pull a model (see above).
2. Open **Settings** (`Ctrl + ,`) → Provider: **Ollama (Local)** — endpoint `http://localhost:11434`.
3. Pull, inspect, and manage models right from the settings panel (progress bars, VRAM usage, real context lengths).
4. Tune the engine: context window, keep-alive, temperature, and max response tokens — all live in **Local Inference Engine** settings.

---

## ⌨️ Essential Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + L` | Focus agent chat |
| `Ctrl + \` ` / `Ctrl + J` | Toggle terminal |
| `Ctrl + Shift + A` | Toggle agent dock |
| `Ctrl + Shift + G` | Source control |
| `Ctrl + Shift + E` / `F` | Explorer / workspace search |
| `Ctrl + Shift + X` | Extensions |
| `Alt + M` | Cycle operating mode |
| `Ctrl + O` / `Ctrl + S` | Open folder / save |
| `F1` / `Ctrl + Shift + P` | Shortcuts help |

---

## 🛠️ Building from Source

**Prerequisites:** Rust 1.90+, Node.js 18+, VS C++ Build Tools (Windows).

```powershell
git clone https://github.com/daxp472/Orbital-X.git
cd Orbital-X
npm install

npm run dev:tauri            # development
npx tauri build --bundles nsis   # production installer
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. CI runs `cargo test` + frontend builds on every push.

---

## 🏛️ Documentation

- [Architecture Guide](ARCHITECTURE.md) — subsystem specs and IPC registry
- [Release Notes](release/notes/) — version-by-version history
- [Contributing](CONTRIBUTING.md) · [Security Policy](SECURITY.md) · [Changelog](CHANGELOG.md)
- [Website](https://daxp472.github.io/Orbital-X/)

---

## 📄 License

Open-source under the **[MIT License](LICENSE)**.

<div align="center">
Made with ❤️ for local-first AI development.
</div>
