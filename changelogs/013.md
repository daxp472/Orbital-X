# Orbital X v2.3.9 — Release Highlights

## What's New in Version 2.3.9

Orbital X v2.3.9 delivers major upgrades across inline code completions, visual multimodal intelligence, user feedback ergonomics, developer error handling, and transactional code review.

---

### 1. High-Performance Inline Code Suggestions
- **Dedicated Lightweight Completion Model**: Decoupled completion inference from the primary chat model. Configure ultra-fast 1.5B/3B models (e.g. `qwen2.5-coder:1.5b`) independently from your conversational reasoning model.
- **Sub-2-Second Latency**: Tight completion budgets (36 tokens) and targeted context windows (400 chars prefix / 120 chars suffix).
- **Fast LRU In-Memory Cache**: Repeated requests resolve in `<20ms` from memory without invoking the LLM.
- **Immediate Keystroke Cancellation**: Active inference aborts instantly on continued typing.
- **Tab Key Commit**: Native `Tab` keybinding directly in Monaco to accept ghost text suggestions.
- **Live Latency Meter**: Status bar `#sb-complete-indicator` reports actual completion speed in milliseconds.

---

### 2. Activity & Notification Center — Apple HIG Liquid Glass Redesign
- **Apple Human Interface Guidelines Aesthetic**: 28px backdrop blur vibrancy, squircle category badges, and refined translucent card hierarchy.
- **Segmented Control Filter Track**: Apple-style segmented pill selector for `All`, `Build`, `Security`, and `Agent`.
- **Zero Emojis**: Fully replaced emojis with professional vector SVG icons.
- **Preserved Backend Storage**: Retains existing event logging and persistence logic.

---

### 3. Screenshot-to-Agent (Multimodal Visual Intelligence)
- **Direct Clipboard Paste (`Ctrl+V`)**: Paste screenshots directly into the prompt composer.
- **Dedicated Image Attachment & Drag-and-Drop**: Attach `.png`, `.jpg`, and `.webp` images via the composer button or by dragging files into the chat panel.
- **Image Thumbnail Tray**: Visual previews with 1-click removal.
- **Honest Model Validation**: If a text-only model is active, the IDE surfaces an `OX-415` error card guiding the user to a vision-capable model, rather than pretending text models can read images.
- **Universal Multimodal Support**: Full support across Ollama (`llama3.2-vision`, `llava`), OpenAI (`gpt-4o`), Anthropic (`claude-3-5-sonnet`), and Gemini (`gemini-2.0-flash`).
- **In-Chat Gallery**: Attached images render directly in timeline messages with click-to-enlarge full-screen preview.

---

### 4. Dedicated Orbital X Structured Error Framework
- **Standardized Error Representation**: Replaced raw string errors with actionable `OX-Error` cards:
  - `OX-101`: Compiler & Syntax Diagnostic Failures (with 1-click Auto-Fix).
  - `OX-403`: Sandbox Policy Denied (with Safety Mode switcher).
  - `OX-409`: Virtual File System Staging Conflicts.
  - `OX-415`: Multimodal Vision Model Required.
  - `OX-503`: Local Ollama Daemon Offline / Unreachable (with 1-click Connection Test).
  - `OX-500`: General Agent Runtime Error.
- **Actionable Remediation**: Plain-language root causes, interactive quick-fix action buttons, 1-click diagnostic clipboard export, and collapsible technical logs.

---

### 5. Streamlined Feedback Actions
- User-authored messages now only display Copy and Edit actions.
- Thumbs up and thumbs down ratings are restricted strictly to AI assistant responses.

---

### 6. Explorer Drag-and-Drop Tagging & Rich Context Staging
- **File Explorer DND**: Dragging any tree node into the chat panel tags `@path` in the prompt composer.
- **Extended Non-File Context Staging**: Stage diagnostics, package dependencies (`package.json`/`Cargo.toml`), architecture graphs, and working memory to local models with one click.

---

### 7. Transactional VFS In-Editor Review in Monaco
- **Docked In-Editor Review Bar**: Top-mounted review bar displaying filename, line addition count, and line deletion count.
- **Inline Line Highlight Decorations**: Green highlights for added lines and red highlights for removed lines.
- **Per-File & Batch Review Controls**: `[Accept]`, `[Reject]`, `[Accept All]`, and `[Reject All]` controls integrated with the Virtual File System shadow overlay.

