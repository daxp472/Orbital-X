# Changelog

All notable changes to Orbital X are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
