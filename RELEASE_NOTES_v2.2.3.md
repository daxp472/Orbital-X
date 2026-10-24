# Orbital X v2.2.3 — Release Notes

## Highlights

### Extensions that actually work
A real extension system replaces the old placeholder catalog. Orbital X extensions are **declarative packs** — no code execution, no marketplace theater:

- **Themes** (`Solar Flare`, `Arctic Night`) — runtime CSS-variable overrides, combineable, theme-aware.
- **Prompt packs** (`Rust Strict Mode`, `Frontend Craft`, `Test Discipline`) — guidance appended to the agent's system prompt when enabled.
- **Command packs** (`Web Dev`, `Rust Dev`, `Git Flow`) — one-click runnable commands surfaced in the panel.

Browse the bundled registry, import packs from local folders, enable/disable per pack, and uninstall cleanly. VS Code `.vsix` packages and code-executing extensions are explicitly **not supported** and are rejected with a clear message — never silently faked.

### Agent Skills (Claude Code-style)
Skills are reusable instruction packs (a folder with a `SKILL.md`). Enabled skills appear in the agent's context as a short digest; when a task matches, the agent calls the new `list_skills` / `read_skill` tools to follow the full guidance — gated by the existing permission system like every other read. Manage them in the new Skills panel: browse, import from folder, enable/disable, review the full text, delete.

### Critical UI polish
- Keyboard focus is now **visible and consistent** across every interactive element (`:focus-visible` rings).
- `prefers-reduced-motion` is respected — animations collapse for users who ask for it.
- The app is responsive: settings collapse to a column layout, the status bar sheds low-priority items, and modals never exceed the viewport.
- Fixed the settings dialog rendering a dark box inside the light theme; added the missing glass-translucent variables to Light, Midnight Blue, and High Contrast themes.
- Consistent scrollbars, selection colors, disabled states, and touch targets across all four themes.

### Engine & security foundation (carried from the v2.2.3 development line)
- `write_file — Missing path` fixed at the root (string/aliased tool arguments normalized everywhere).
- Strict risky-command classification: quote-aware chaining/newline/redirection/subexpression detection; nested shells never auto-approved.
- Strict workspace confinement: symlinked-parent escapes blocked, symlink-skipping scans, undo revalidation.
- Web research tools (`web_search`, `fetch_page`) with untrusted-content wrapping and private-network refusal.
- Streaming + cancellation, token-budget context management with pair-preserving trimming, model-aware `num_ctx` caps, tok/s meter.
- Model-generated task plans, honest timeline/outline with per-workspace restore.

## Verification
`cargo test`: 36/36 pass · `vite build`: pass · NSIS installer built and attached to this release.

## Installation
Windows: download `Orbital.X_2.2.3_x64-setup.exe` (NSIS installer, per-user or all-users). macOS: `.dmg` (aarch64 / x64 where provided). Linux: `.AppImage` / `.deb`.

**Local AI requires [Ollama](https://ollama.com)** — the onboarding wizard detects it and guides installation.
