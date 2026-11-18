# Orbital X v2.4.3 — Release Highlights

## What's New in Version 2.4.3

Orbital X v2.4.3 introduces a complete UI/UX and frameless desktop architecture overhaul, unified theme token engine with 100% Light/White theme parity, Claude-grade floating notification system, native Windows 11 full-height caption controls, live wall-clock `<think>` reasoning accordion, and zero-flicker Monaco editor streaming with hunk-level diffs.

---

### 1. Frameless Window Architecture & Desktop Titlebar
- **Native OS Window Frame Elimination**: Disabled redundant Windows titlebar rendering via Tauri 2 frameless window configuration (`decorations: false`, `transparent: false`, `shadow: true`), leaving a single, ultra-clean custom Antigravity top titlebar.
- **Full-Height Windows 11 Caption Controls**: Minimize, Maximize, and Close buttons span the full 36px titlebar height (`width: 46px; height: 100%`) flush to the top-right corner, obeying Fitts's law for effortless corner closing.
- **Dynamic Maximize/Restore & Drag Hardening**: Smooth vector icon transitions between Maximize (`□`) and Restore (`❐`), titlebar drag region hardening without button hijacking, double-click to toggle maximize, and automatic synchronization with Windows Snap Assist and `Win + ↑` / `Win + ↓` shortcuts.
- **Right-Side Panel Stabilization**: Enforced a 320px minimum width guardrail on the Agent AI Dock so it never squishes into a hairline vertical strip, maintaining balanced symmetry with the left file explorer.
- **Pristine Tab Bar**: Eliminated stray glyphs and orphan split icons from the welcome state, relocating split editor actions neatly to the right-hand actions bar with native SVG icons.

---

### 2. Unified Theme Token Engine & Light Theme Parity
- **Total Color Tokenization**: Replaced all hardcoded dark hex colors with semantic CSS custom properties (`--bg-app`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-color`).
- **White Theme Polish**: Complete contrast and legibility parity across all modal dialogues, Knowledge & Memory Directory, Command Palette (`Ctrl+P`), Shortcuts Help, and Toast Notifications in Orbit Light, Nebula Light, and Solarized Light themes.

---

### 3. Claude-Grade Notification System
- **Floating Bottom-Right Stack**: Anchored at `bottom: 34px; right: 16px;` with smooth stacking, max 3 concurrent cards, subtle glass surfaces, and colored category accent stripes (info, success, warning, error).
- **Silent Telemetry Routing**: Low-level AST indexing and background 3-second draft saves are recorded quietly to activity history without interrupting the user.

---

### 4. Live Thinking Accordion & Zero-Flicker Streaming
- **Elapsed Wall-Clock Reasoning Timer**: Incremental `<think>` token streaming with a live 100ms timer (`Thinking… 1.8s`) that automatically collapses into a clean summary (`Thought for 4.2s ▾`) upon completion.
- **Incremental Markdown Rendering**: Streaming tokens append cleanly to the DOM without layout shifts, flickering, or jarring end-of-turn full innerHTML replacements.
- **Clustered Recon Steps**: Consecutive read-only recon calls (`list_files`, `view_file_outline`, `get_project_structure`) collapse into a compact, expandible summary row.

---

### 5. Monaco Smart Actions & Inline Hunks
- **Interactive Code Actions**: Every fenced code block in agent messages features 1-click **[Apply to File]** and **[Insert at Cursor]** buttons.
- **Monaco Inline Diff Reviews**: Hunk-level review widgets with instant `[✓ Accept | ✕ Reject]` controls directly in the editor buffer.
- **Composer Polish**: Quick prompt history cycling via `ArrowUp` and `ArrowDown`, stream cancellation with `Escape`, and comprehensive `@git`, `@terminal`, and `@symbol` context mentions.
