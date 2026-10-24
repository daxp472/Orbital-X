# Changelog

All notable changes to Orbital X are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [v2.2.3] — 2026-10-24

### Added
- **Extension System:** Real declarative extension packs (themes, prompt packs, command packs) with a bundled registry, folder import, enable/disable, uninstall, and details views. VS Code `.vsix`/code-executing extensions explicitly unsupported with clear messaging.
- **Agent Skills:** Claude Code-style `SKILL.md` instruction packs — context digest + `list_skills`/`read_skill` tools gated by the permission engine, with a management panel (import, toggle, review, delete).
- **Streaming & Cancellation:** Ollama token streaming into the chat timeline; Stop aborts in-flight requests and frees the model server-side; cloud providers cancellable the same way.
- **Web Research Tools:** `web_search` (DuckDuckGo, keyless) and `fetch_page` (public pages only, private hosts refused, size/time caps) wrapped as untrusted external content.
- **Ollama Model Management:** pulls with live progress and cancellation, deletion, model info (params/quantization/real context length/tool support), loaded-models view with VRAM, hardware-aware fit guidance.
- **OpenAI-Compatible Custom Endpoints:** LM Studio / llama.cpp / vLLM support via custom base URL.
- **Onboarding Ollama Detection:** connectivity check with re-check and install guidance.
- **Context Meter:** status-bar prompt-tokens/context + tokens-per-second from real Ollama eval timings.
- **Responsive & Accessible UI:** visible `:focus-visible` everywhere, `prefers-reduced-motion` support, responsive settings dialog/status bar/modals, consistent scrollbars and states across all themes.

### Changed
- **Task plans are model-generated** from the actual request and repository context (fallback template clearly labelled); completion is evidence-gated; plans restore per workspace on relaunch.
- **Configurable inference:** `num_ctx`, `keep_alive` (default 30m instead of forever), temperature, and max response tokens; effective context auto-capped by each model's real limit from `/api/show`.
- **Context efficiency:** tool-result compaction, ephemeral nudges/retries, pair-preserving token-budget trimming, deduplicated system prompt.
- **Release notes relocated** to `release/notes/`; GitHub release body now carries the full description.

### Fixed
- **`write_file - Missing path`:** JSON-string and aliased (`parameters`/`input`) tool arguments normalized everywhere; dispatcher accepts `file_path`/`filePath` aliases and returns structured self-correctable errors.
- **`patch_file` panic:** invalid line ranges now error cleanly instead of poisoning the workspace mutex; CRLF line endings preserved.
- **XSS:** escape-first markdown rendering, listener-bound copy buttons, escaped search snippets, real CSP.
- **Git command injection:** all git operations use argument-array execution.
- **Light theme:** settings dialog no longer renders as a dark box; missing `--bg-glass-translucent` token added to Light/Midnight Blue/High Contrast.
- **Workspace metadata:** real cached scan results (file counts, languages) instead of zeros.
- **Chat persistence:** sessions moved to `~/.orbital/chat_sessions.json` (atomic writes) with bounded growth — no more silent localStorage quota loss.

### Security
- **Command classifier rewritten:** quote-aware chaining/newline/redirection/subexpression/nested-shell detection; inline-code invocations require approval; expanded prohibited list. Enforcement stays in Rust.
- **Workspace confinement hardened:** symlinked-parent write escapes blocked via ancestor canonicalization; symlink-skipping scans; undo revalidates journaled paths against the current root.
- **Duplicate `delete_file` tool schema** removed.

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
