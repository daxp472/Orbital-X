# Contributing to Orbital X

Thank you for your interest in contributing to **Orbital X**! This document covers everything you need to know to get started as a contributor.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Submitting Changes](#submitting-changes)
- [Commit Message Convention](#commit-message-convention)
- [Branching Strategy](#branching-strategy)
- [Bug Reports & Feature Requests](#bug-reports--feature-requests)
- [Testing](#testing)

---

## Code of Conduct

By participating in this project, you agree to be respectful, inclusive, and constructive in all interactions. We welcome contributors of all backgrounds and experience levels.

---

## How to Contribute

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/Orbital-X.git
   cd Orbital-X
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Create** a feature or fix branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
5. **Make** your changes following the code style guidelines.
6. **Test** your changes (see [Testing](#testing) below).
7. **Submit** a pull request with a clear description of the changes.

---

## Development Setup

### Prerequisites

| Tool | Version | Link |
|------|---------|------|
| Windows OS | 10/11 64-bit | — |
| Rust + Cargo | 1.90+ | [rustup.rs](https://rustup.rs) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Visual Studio C++ Build Tools | 2019+ | [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/) |
| Microsoft Edge WebView2 | Latest | Auto-installed on Windows 11 |
| Ollama (optional for local AI) | Latest | [ollama.ai](https://ollama.ai) |

### Running in Development Mode

```bash
# Start Vite dev server (terminal 1)
npm run dev

# Launch Tauri desktop window (terminal 2)
npx tauri dev
```

> **Note:** If you see `Port 1420 is already in use`, the `scripts/dev-runner.js` handles this gracefully by reusing the active dev server.

### Building for Production

```bash
# Build optimized frontend + package NSIS installer
npx tauri build --bundles nsis
```

The installer appears at:
```
src-tauri/target/release/bundle/nsis/Orbital X_<version>_x64-setup.exe
```

---

## Project Architecture

```
Orbital-X/
├── index.html                    # Main application HTML shell
├── src/
│   ├── js/
│   │   ├── app.js                # Application entry point & shortcut wiring
│   │   ├── state/
│   │   │   └── store.js          # Global state management (localStorage)
│   │   ├── services/
│   │   │   └── tauri.js          # Tauri IPC bridge & native file picker
│   │   ├── components/
│   │   │   ├── agent.js          # AI agent orchestrator & policy enforcement
│   │   │   ├── chat-sessions.js  # Chat history & session persistence
│   │   │   ├── extensions.js     # Extensions catalog UI
│   │   │   ├── file-tree.js      # Workspace file explorer
│   │   │   ├── memory.js         # Project memory sidebar component
│   │   │   ├── model-picker.js   # LLM model selector popover
│   │   │   ├── settings.js       # Settings modal & API key management
│   │   │   ├── source-control.js # Git status & commit view
│   │   │   └── terminal.js       # Integrated terminal engine
│   │   ├── editor/
│   │   │   └── monaco.js         # Monaco editor integration & tabs
│   │   └── onboarding/
│   │       └── wizard.js         # First-launch onboarding flow
│   └── styles/
│       ├── tokens.css            # Design tokens (spacing, radii, etc.)
│       ├── themes.css            # Theme definitions (Orbit Dark, Nebula Light, Midnight Blue)
│       ├── layout.css            # Desktop shell layout (titlebar, sidebar, panels)
│       └── components.css        # UI component styles (buttons, modals, inputs)
├── src-tauri/
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri build configuration
│   └── src/
│       ├── lib.rs                # Tauri command registrations (IPC handlers)
│       ├── main.rs               # Tauri application entry point
│       ├── providers.rs          # AI provider adapters (Claude, OpenAI, Gemini, Ollama)
│       ├── workspace.rs          # File system operations & diff generation
│       ├── memory.rs             # Durable project memory (CRUD + deduplication)
│       ├── terminal.rs           # Shell command execution with safety policy
│       ├── policy.rs             # Permission enforcement (Agent Pro/Dev/User modes)
│       └── tools.rs              # Tool definitions for AI function calling
├── scripts/
│   └── dev-runner.js             # Smart dev server launcher (handles port conflicts)
└── .orbital/
    └── memory.json               # Per-project durable AI memory store
```

### Data Flow: Agent Request

```
User types prompt
       ↓
agent.js: handleSend()
       ↓ 
Load memories + active file context → inject into system prompt
       ↓
invoke('agent_dispatch_turn') → Rust providers.rs → AI Provider API
       ↓
AI returns response + optional tool_calls
       ↓
policy.rs: evaluate_tool_policy() → risk level + requires_approval?
       ↓ (if requires approval)
requestUserApproval() → user clicks Approve/Deny
       ↓
invoke('execute_tool') → workspace.rs / terminal.rs
       ↓
Result appended to conversation + chat-sessions.js saves to localStorage
       ↓
memory.rs: auto-upsert if architecture discovered
```

---

## Submitting Changes

### Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR.
- Include a clear title following the commit convention (see below).
- Write a description explaining **what** changed and **why**.
- Link to any related issues.
- Ensure all unit tests pass: `cargo test --manifest-path src-tauri/Cargo.toml`.

### Code Style

**Frontend (JS):**
- Use ES Modules (`import`/`export`) — no CommonJS.
- No React, TypeScript, or build-time transpiled JSX. Vanilla JS only.
- Prefer `async/await` over raw Promise chains.
- Name component files in `kebab-case.js`.

**Backend (Rust):**
- Follow standard Rust idioms and naming conventions.
- All file system access must go through `WorkspaceService` path validation.
- No `unwrap()` in production paths — use `?` operator or explicit error handling.
- All new Tauri commands must be registered in `lib.rs`.

---

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
[optional footer]
```

**Types:**
| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code restructuring (no behavior change) |
| `style` | UI/CSS changes |
| `docs` | Documentation updates |
| `test` | Adding or updating tests |
| `chore` | Build system, tooling, dependencies |
| `ci` | CI/CD changes |

**Examples:**
```
feat(agent): add automated memory extraction after architecture queries
fix(memory): deduplicate entries with same category and title
style(terminal): add VS Code-style command history navigation
docs: update ARCHITECTURE.md with data flow diagram
```

---

## Branching Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable release branch — always buildable |
| `dev` | Integration branch for in-progress work |
| `feat/<name>` | New feature branches |
| `fix/<name>` | Bug fix branches |
| `release/<ver>` | Release preparation branches |

---

## Bug Reports & Feature Requests

Please use [GitHub Issues](https://github.com/daxp472/Orbital-X/issues) with the appropriate label:

- 🐛 `bug` — Something isn't working correctly.
- ✨ `enhancement` — A new feature or improvement.
- 📚 `documentation` — Documentation improvements.
- 🔒 `security` — Security-related issues (please report privately first via email if critical).
- 🎨 `ui/ux` — Visual or UX improvements.

When filing a bug, please include:
1. Your OS version and build
2. Steps to reproduce
3. Expected behavior
4. Actual behavior
5. Relevant logs from the debug console

---

## Testing

### Rust Backend Tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Current test coverage includes:
- `policy::tests::test_pro_mode_permissions` — Agent Pro mode allows file ops
- `policy::tests::test_dev_mode_permissions` — Dev mode blocks autonomous writes
- `policy::tests::test_user_mode_permissions` — User mode requires all approvals
- `policy::tests::test_destructive_action_blocked` — Safety policy blocks rm/format
- `workspace::tests::test_compute_diff` — Unified diff generation
- `workspace::tests::test_path_security_boundary` — Directory traversal prevention

### Frontend Manual Testing Checklist

Before submitting a PR, verify:
- [ ] Monaco editor loads and syntax-highlights correctly
- [ ] File tabs open, close, and show dirty indicators on edits
- [ ] Agent mode switches (Pro/Dev/User) enforce correct approval behavior
- [ ] Settings modal saves and correctly applies model/API key changes
- [ ] Source control panel shows git status and allows commits
- [ ] Extensions panel renders and toggles
- [ ] Terminal accepts commands, shows output, supports history (ArrowUp/Down)
- [ ] Memory sidebar shows no duplicates
- [ ] New Chat creates a fresh session; history dropdown shows previous chats
- [ ] All keyboard shortcuts work (`Ctrl+S`, `Ctrl+B`, `Ctrl+J`, `Ctrl+Shift+G`, `Ctrl+Shift+X`)

---

Thank you for contributing to Orbital X! 🚀
