# Orbital X — Local-AI Desktop Coding IDE

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blueviolet.svg?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.90%2B-orange.svg?logo=rust)](https://www.rust-lang.org)
[![Version](https://img.shields.io/badge/Release-v2.4.0-emerald.svg)](https://github.com/daxp472/Orbital-X/releases/latest)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-0078d4.svg)](https://github.com/daxp472/Orbital-X/releases/latest)
[![Tests](https://img.shields.io/badge/cargo%20test-84%2F84%20passed-brightgreen.svg)](.github/workflows/ci.yml)

**A high-performance, memory-conscious, autonomous AI coding IDE powered by your own local models.**  
*Native Speed · Streaming Responses · 100% Private Inference · Rust-Enforced Safety*

[Download](#installation) • [Key Features](#key-features) • [Operating Modes](#operating-modes) • [Local AI Setup](#local-ai-with-ollama) • [Extensions & Skills](#extensions--skills) • [Build from Source](#building-from-source)

</div>

---

## Overview

**Orbital X** combines a native desktop code editor with a deeply integrated, tool-using autonomous AI agent — engineered for software engineers who require **complete privacy**, **offline-first local models** (via [Ollama](https://ollama.com)), and **zero bloat**.

While Electron editors idle at 1.5 GB+ of RAM, Orbital X runs on **Tauri 2 + Rust** with Edge WebView2 — maintaining a lean ~120 MB idle footprint with full Monaco editing power underneath.

The agent streams tokens as they are generated, manages its own context window against real model limits, executes multi-step engineering tasks through a permission-gated tool matrix, researches live documentation when needed, and reports deterministic, evidence-backed progress throughout every turn.

---

## Key Features

### High-Speed Inline Code Suggestions
- **Instant Contextual Antithesis** — Zero-latency (0ms) semantic inversion engine. When typing inside an `else` or fallback branch, it inspects the preceding `if` block, inverts semantic meaning (e.g., `can` $\rightarrow$ `cannot`, `valid` $\rightarrow$ `invalid`, `success` $\rightarrow$ `failed`), and instantly completes the full statement.
- **Decoupled Model Inference** — Inline completions run separately from the main agent conversation using dedicated lightweight coder models (e.g., Qwen2.5-Coder 1.5B/3B), preventing disruption of active chat tasks.
- **Deduplication & Alignment** — Surgical prefix/suffix alignment prevents duplicate code tokens, mismatched parentheses, or repetitive condition headers across all programming languages.
- **Persistent VRAM Caching** — Intelligent 30-minute model keep-alive in Ollama VRAM and LRU prefix caching eliminate cold-start latencies.

### Multimodal Vision & Visual Intelligence
- **Screenshot-to-Agent Context** — Drag, paste (Ctrl+V), or attach visual UI screenshots, bug traces, and mockups directly into the composer.
- **Vision Model Guidance** — Intelligent runtime detection alerts you if the active model is text-only (e.g., standard Qwen) and provides 1-click switching to vision-capable local or cloud models (`llama3.2-vision`, `llava`, `gpt-4o`, `claude-3-5-sonnet`).

### Apple HIG Redesigned Composer & Chat Experience
- **Realigned Bottom Action Bar** — Left-aligned attachment controls (Context Clip, Image Upload, `@` File Mention) paired with right-aligned telemetry (Token Counter, Context Ring, and Send Action).
- **Zero-Layout-Shift Action Dock** — Hover-free, non-shifting message action bars for clean interaction.
- **Welcome Hero State** — New sessions start with a clean 4-card action starter dashboard rather than noisy system messages.

### Structured 4-Stage Error Architecture
Standardized enterprise diagnostic reports (OX-100 through OX-500) organized into 4 clear stages:
1. **Stage 1: Local Ollama / Daemon Runtime** — Daemon connectivity, missing models, VRAM fit issues.
2. **Stage 2: AI Model & Provider** — Multimodal capabilities, rate limits, context window overflow.
3. **Stage 3: Orbital X Core Engine** — Internal runtime exceptions, IPC breaks, VFS sync faults.
4. **Stage 4: Workspace & User Operations** — Missing files, permission policies, path confinement.

### Enterprise Architectural Pillars
1. **Workspace Isolation (`IsolationEngine`)** — Real OS-level isolation on Windows via Win32 Job Objects (1.5 GB memory cap, 75% CPU rate limit, 24 active processes cap, and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` cleanup) and process-group/`rlimit` isolation on Unix.
2. **Semantic Code Graph (`SemanticCodeGraph`)** — AST parsing via tree-sitter grammars (Rust, TypeScript, Python) extracting functions, structs, classes, and call edges with single-file incremental indexing.
3. **Deterministic Diagnostics & Healing (`DiagnosticService`)** — Workspace toolchain autodetection (Cargo, TypeScript `tsc`, npm build), compiler diagnostic parsing, and an automated Hallucination Loop Breaker.
4. **Virtual File System Diff Bridge (`VfsEngine`)** — Copy-on-write memory shadow overlay isolating edits before disk writes, pre-mutation snapshot checkpoints with one-click rollback, and crash-safe two-phase commit (2PC) transactions.

---

## Extensions & Skills

**Extensions** are declarative packs designed to be safe by default with zero arbitrary code execution:
- **Themes** — Override design tokens at runtime (*Solar Flare*, *Arctic Night*, *Midnight Blue*).
- **Prompt Packs** — Inject focused agent discipline (*Rust Strict Mode*, *Frontend Craft*, *Test Discipline*).
- **Command Packs** — Surface one-click runnable commands (*Web Dev*, *Rust Dev*, *Git Flow*).

**Skills** are instruction packs (`SKILL.md` folders). Enabled skills appear in the agent's context digest; when a task matches, the agent reads the full skill through the permission-gated `read_skill` tool and follows it deterministically.

---

## Installation

Download the official release from the **[GitHub Releases](https://github.com/daxp472/Orbital-X/releases/latest)** page or the **[Download Center](https://daxp472.github.io/Orbital-X/download.html)**:

| Platform | Package | Description |
|---|---|---|
| **Windows 10/11 (x64)** | `Orbital.X_2.4.0_x64-setup.exe` | Official NSIS Installer (Desktop setup) |
| **Windows Portable (x64)** | `Orbital.X_2.4.0_portable_win64.zip` | Zero-install portable package for USB/external drives |
| **macOS (Apple Silicon)** | `Orbital.X_2.4.0_aarch64.dmg` | Native Apple Silicon DMG |
| **Linux (x64)** | `Orbital.X_2.4.0_amd64.AppImage` / `.deb` | AppImage & Debian package |

### Quick Start with Ollama

```powershell
# Install Ollama and pull your preferred coding model:
ollama pull qwen2.5-coder:7b

# (Optional) For high-speed inline suggestions, pull a lightweight draft model:
ollama pull qwen2.5-coder:1.5b
```

Launch Orbital X. The onboarding wizard detects Ollama automatically, verifies VRAM fit, and configures the workspace.

---

## Operating Modes

Security policies are enforced inside Rust (`PolicyEngine`) — frontend actions cannot bypass them:

| Action | Agent Pro Mode | Dev Mode (Default) | User Mode |
|---|---|---|---|
| Reads, searches, skills, web research | Automatic | Automatic | Approval Required |
| File creation & edits | Automatic (2PC VFS Commit) | Approval + Monaco Diff | Approval + Monaco Diff |
| Safe build / test commands | Automatic (Sandboxed) | Approval (Sandboxed) | Approval (Sandboxed) |
| Arbitrary commands, git commits | Approval Required | Approval Required | Approval Required |
| Destructive deletions | Two-Stage Confirmation | Two-Stage Confirmation | Two-Stage Confirmation |

> Switch modes anytime with `Alt + M` or via the mode switcher pill in the composer header.

---

## Essential Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + L` | Focus agent chat composer |
| `Ctrl + \` / `Ctrl + J` | Toggle integrated terminal |
| `Ctrl + Shift + A` | Toggle agent sidebar dock |
| `Ctrl + Shift + G` | Source control & Git diffs |
| `Ctrl + Shift + E` / `F` | Explorer / global file search |
| `Ctrl + Shift + X` | Extensions & Skills manager |
| `Alt + M` | Cycle operating mode |
| `Ctrl + O` / `Ctrl + S` | Open workspace / Save file |
| `F1` / `Ctrl + Shift + P` | Command Palette & Shortcuts |

---

## Building from Source

**Prerequisites:** Rust 1.90+, Node.js 18+, VS C++ Build Tools (Windows).

```powershell
git clone https://github.com/daxp472/Orbital-X.git
cd Orbital-X
npm install

npm run dev:tauri                  # Development mode
npx tauri build --bundles nsis     # Production Windows NSIS installer
```

The resulting installer is output to `src-tauri/target/release/bundle/nsis/`.

---

## Documentation & Community

- [Architecture Guide](ARCHITECTURE.md) — Subsystem specifications and IPC registry
- [Release Notes](release/notes/) — Version-by-version technical changelogs
- [Contributing](CONTRIBUTING.md) · [Security Policy](SECURITY.md) · [Changelog](CHANGELOG.md)
- [Official Website](https://daxp472.github.io/Orbital-X/)

---

## License

Open-source under the **[MIT License](LICENSE)**.

<div align="center">
Engineered for local-first, private AI software engineering.
</div>
