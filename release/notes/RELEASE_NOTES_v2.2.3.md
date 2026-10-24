# Orbital X v2.2.3 — Extensions, Skills & a Polished IDE

The largest Orbital X release yet: a real extension system, Claude Code-style agent skills, a major accessibility and responsiveness polish pass, and the full engine overhaul (streaming, cancellation, context management, hardened security, web research) — everything since v2.2.2.

---

## 🧩 Extensions — real, working, honest

The placeholder catalog is gone. Orbital X now ships a genuine extension system built on **declarative packs** — powerful, safe, and with zero code execution:

- **🎨 Themes** — `Solar Flare` and `Arctic Night` override CSS design tokens at runtime. Combineable across all four built-in themes, reversible instantly.
- **🧠 Prompt Packs** — `Rust Strict Mode`, `Frontend Craft`, and `Test Discipline` inject focused guidance into the agent's system prompt when enabled. Applies to every turn, on every provider.
- **⚡ Command Packs** — `Web Dev`, `Rust Dev`, and `Git Flow` surface one-click runnable commands inside the panel. Running one executes it in the integrated terminal — exactly as if you typed it.

**The panel:** Installed / Browse tabs, live search, per-type badges, expandable details that state exactly what each pack does and does not affect, import from local folder, per-pack enable/disable toggles, and uninstall with confirmation.

**Honesty first:** the registry is **bundled with the app** (no marketplace claims), and VS Code `.vsix` packages or code-executing extensions are **explicitly not supported** — they are rejected with a clear explanation instead of silently pretending to install. Extensions live in `~/.orbital/extensions/` with validated manifests and persisted enable state.

## 🛠️ Agent Skills (Claude Code-style)

Skills are reusable instruction packs — a folder with a `SKILL.md` (name, description, when-to-use) that the agent **discovers and reads on demand**:

- Enabled skills appear in the agent's context as a short digest.
- When a task matches, the agent calls the new `list_skills` / `read_skill` tools and follows the full guidance — gated by the existing permission engine like every other read (automatic in Agent Pro/Dev, approval in User mode).
- The new **Skills panel** (activity rail) handles browsing, importing from folder, enable/disable, full-text review, and deletion.
- Skills never execute code — they are instructions, enforced by the same security model as the rest of the IDE.

## ✨ Critical UI polish

- **Keyboard focus is now visible everywhere** — consistent `:focus-visible` rings across every button, input, tab, and rail item, in all four themes.
- **`prefers-reduced-motion` respected** — animations and transitions collapse for users who request it.
- **Responsive from big screens down:** the settings dialog collapses to a column layout under 860px, the status bar gracefully sheds low-priority items, modals never exceed the viewport, and touch targets grow on coarse pointers.
- **Light theme fixed:** the settings dialog no longer renders as a dark box (hardcoded rgba replaced with theme variables), and the missing glass-translucent token was added to Light, Midnight Blue, and High Contrast.
- Consistent scrollbars, selection colors, disabled states, and sidebar header rhythm across the app — plus the same accessibility treatment on the companion website.

## 🔒 Security & correctness hardening

- **`write_file — Missing path` fixed at the root:** tool-call arguments that arrive as JSON strings (a real Ollama behavior) or with `parameters`/`input` aliases are now normalized everywhere; the dispatcher accepts unambiguous `file_path`/`filePath` aliases and returns structured errors that let the model self-correct — it never invents paths.
- **Strict risky-command classification** (enforced in Rust): quote-aware detection of chaining, newline smuggling, shell redirection writes, `$(...)`/backtick subexpressions, and nested shells; inline-code invocations (`python -c`, `node -e`) require approval; `cargo check 2>&1` and normal dev workflows stay automatic.
- **Strict workspace confinement:** new-file writes through symlinked/junction parent directories are blocked (deepest-existing-ancestor canonicalization), all scans skip symlinks, and undo revalidates journaled paths against the current workspace root.
- **Git operations run through argument arrays** — no shell interpolation, no injection path.

## 🌐 Web research tools

- `web_search` (DuckDuckGo — no keys, no paid usage) and `fetch_page` (public pages only; loopback/private/LAN hosts refused; 2 MB / 15 s caps; HTML→text extraction).
- Every result carries an explicit **UNTRUSTED EXTERNAL CONTENT** notice, and the system prompt instructs reference-only use — web pages can never override instructions, permissions, or user intent.

## ⚡ Streaming, cancellation & context intelligence

- **Token streaming from Ollama** — responses render progressively in the chat timeline; no more staring at a spinner.
- **Stop actually stops:** cancelling aborts the in-flight request and stops generation server-side, freeing the model immediately (cloud providers are cancellable the same way).
- **Context management:** configurable `num_ctx`/`keep_alive`/temperature/max-tokens; the effective context is auto-capped by each model's real limit (read from `/api/show`, never guessed); tool results are compacted; retry/nudge noise never enters history; trimming never splits tool-call/result pairs.
- **Live telemetry:** status-bar context meter (prompt tokens / ctx) with tokens-per-second from real Ollama eval timings.

## 🦙 Complete local-model experience

- Model pulls with **live progress and cancellation** (no more silently-discarded 5-minute timeouts), deletion with confirmation, model info (params, quantization, real context length, tool-calling capability), and loaded-models visibility with VRAM usage.
- **Hardware-aware guidance:** real RAM (sysinfo) and GPU/VRAM (Windows registry) detection with clearly-labelled memory-fit estimates — missing data is shown as unknown, never invented.
- **Onboarding detects Ollama** with re-check and install guidance.
- **Custom OpenAI-compatible endpoints** (LM Studio, llama.cpp server, vLLM) connect through the existing provider architecture.

## 🧭 Smarter orchestration & honest progress

- Task plans are **generated by your model** from the actual request and repository context (2–6 verifiable, dependency-ordered tasks) — the fixed four-task template survives only as a labelled fallback.
- Tasks complete **only with evidence**; validation failures retry or block — never silently "complete".
- Interrupted plans **restore per workspace** on relaunch; the timeline shows real tool activity with file paths, task counters, and all six task states.

---

## 📦 Installation

| Platform | Asset |
|---|---|
| **Windows 10/11 (x64)** | `Orbital.X_2.2.3_x64-setup.exe` — NSIS installer, per-user (no admin) or all-users |
| **macOS (Apple Silicon)** | `Orbital.X_2.2.3_aarch64.dmg` |
| **Linux (x64)** | `Orbital.X_2.2.3_amd64.AppImage` / `Orbital.X_2.2.3_amd64.deb` |

**Local AI requires [Ollama](https://ollama.com)** — the onboarding wizard detects it and guides installation. Cloud providers (Claude, OpenAI, Gemini) work out of the box with your own keys.

## ✅ Verification

`cargo test` — **36/36 passing** (policy engine, workspace security, tool-argument normalization, extension/skill services, web extraction) · `vite build` — pass · Windows NSIS installer built and verified locally before release.
