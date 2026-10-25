# ZCODE PROMPT 3/4 — ORBITAL X: AI Agent Engine & Chat UX
## Branch: `Zcode/agent` — ALL commits go here. NEVER push to main.

---

## MISSION BRIEF

Orbital X's AI agent must be so good that real developers prefer it over Cursor. This prompt makes the AI chat and agent engine Cursor-level quality — agentic, context-aware, with all the UX polish that makes daily use delightful.

Repository: `d:\1work\YT\Orbital X`
Branch: `Zcode/agent` — switch first: `git checkout Zcode/agent`

**READ THESE FILES BEFORE STARTING:**
- `src/js/components/agent.js` — the entire agent loop (large file — read it fully)
- `src-tauri/src/providers.rs` — provider dispatch (Ollama, OpenAI, Anthropic, Gemini)
- `src-tauri/src/tools.rs` — tool schemas available to the agent
- `src-tauri/src/lib.rs` — execute_tool dispatch

---

## PART H: AI Chat UX Overhaul (~3,000 LOC)

### H1. Chat Message Rendering (Full Markdown)
**Files:** `src/js/components/agent.js`, `src/styles/components.css`
- Currently renders markdown via `marked.js` (check if already imported, add if not: `import { marked } from 'https://cdn.jsdelivr.net/npm/marked/src/marked.min.js'`)
- Improve rendering:
  - Code blocks: use Monaco's syntax highlighter (or Prism.js CDN) for inline code highlighting
  - Tables: render as proper HTML tables with alternating row colors
  - Checklists: `- [x]` renders as actual checked checkboxes (non-interactive)
  - Blockquotes: styled with left border, italic text
  - Links: open in system browser via Tauri shell, not in a web tab
  - Images: render inline (src from web URLs only — block file:// for security)
- Each code block has a "Copy Code" button in top-right corner

### H2. Message Actions Bar
Each chat message (user and assistant) has an action bar that appears on hover:
- 📋 Copy — copies the entire message text to clipboard (already exists — keep)
- ✏️ Edit — user messages only: click to make the message editable. On submit, replaces the message and re-runs the agent from that point (removes all messages after the edited one, re-sends)
- 🔄 Regenerate — assistant messages only: removes this assistant message and the previous user message, re-sends to get a new response
- 👍 / 👎 — thumbs up/down feedback (store in localStorage as `orbital_feedback[]`, each entry: { messageId, rating, timestamp })
- 🗣️ Read Aloud — uses browser's Web Speech API (`speechSynthesis.speak(...)`) to read the message text aloud

### H3. Chat Input Enhancements
- Slash commands: when user types `/` at start of message, show a dropdown of available commands:
  - `/plan <task>` — generate an implementation plan
  - `/explain` — explain the currently open file
  - `/fix` — fix errors in the current file
  - `/test` — generate tests for the current file
  - `/refactor` — suggest refactoring for the current file
  - `/commit` — generate a commit message for staged changes
  - `/review` — code review of the current file
  - `/docs` — generate JSDoc/rustdoc documentation
  - `/optimize` — suggest performance optimizations
- Dropdown: shows command name + short description, Arrow up/down to navigate, Enter to select
- `@` mentions: type `@` to mention files/symbols. Show a fuzzy-search picker of workspace files. Selected file's content gets attached to the message context

### H4. Conversation Management
- Multiple chat sessions (already exists — improve):
  - Session rename: click session title to edit inline (already exists — verify it works)
  - Export chat: button to download the current conversation as a Markdown file
  - Import chat: load a previously exported Markdown file to restore a session
  - Session search: search across all sessions' messages (search in session list)
  - Pin sessions: pin important conversations to top of list
  - Archive sessions: hide old sessions without deleting

### H5. Context Attachments (like Cursor's @ system)
- A paperclip 📎 button in the composer
- Opens a picker to attach:
  - Current file — attaches the entire content of the active editor
  - File by path — fuzzy search workspace files, attach selected file's content
  - Code selection — attaches the currently selected text in the editor
  - Terminal output — attaches the last N lines of terminal output
  - Git diff — attaches the current `git diff` output
  - Folder — attaches a compact file tree of a selected directory
- Attached items appear as chips below the composer input
- Remove chips by clicking × on them
- Agent sees all attached content in the user message context

### H6. Agent Mode Indicator & Quick Switch
- The current mode (Agent Pro / Dev / User) is shown in the header — extend:
  - Show a more detailed tooltip on hover explaining what each mode does
  - Mode change confirmation: if switching from Agent Pro to User mode mid-task, ask "Are you sure? The agent will stop."
  - Last mode change timestamp shown in tooltip

---

## PART I: Agent Engine Improvements (~4,000 LOC)

### I1. Better Tool Result Rendering
For each tool call the agent makes, show a rich result card:
- `workspace_info` — show a mini stats card (files, languages)
- `read_file` — show file path + first 3 lines preview (expandable)
- `write_file` / `patch_file` — show a mini diff view (green additions, red deletions, max 10 lines, "Show full diff" expands)
- `run_command` — show: command, exit code (green ✓ or red ✗), stdout/stderr (first 10 lines, expandable), duration
- `search_files` — show: "N matches in M files" with top 3 results shown
- `git_commit` — show: commit hash, message, files changed count
- `get_diagnostics` — show: error count, warning count, first 3 errors with file:line
- All cards collapsed by default (already implemented for tool boxes — extend the rendering to be richer)

### I2. Agent Thinking / Reasoning Display
- When the model returns a `<think>` block or chain-of-thought before the tool call (common with models like qwen3-thinking, deepseek-r1):
  - Parse `<think>...</think>` tags from the response
  - Show it in a collapsible "🧠 Thinking..." section above the tool call, styled differently (darker background, italic text, muted color)
  - Collapsed by default to save space

### I3. Live Token Usage HUD
- While the agent loop is running, show in the status bar:
  - Prompt tokens: N
  - Completion tokens: N  
  - Context used: N/8192 (or the model's actual context limit)
  - Tokens per second: N tok/s (from Ollama eval timings)
  - Cost estimate for cloud providers (OpenAI: $0.000N, Claude: $0.000N based on known pricing)
- After the loop completes, show a summary card at the bottom of the chat:
  "Session: 4 turns | 1,243 tokens | 47 tok/s | Cost: ~$0.003"

### I4. Agent Action Confirmation Cards (improve existing)
- Currently there's an approval card for risky actions — make it better:
  - Show the exact diff before confirming a file write (Monaco diff viewer inline)
  - For `run_command`: show the exact command, warn about potentially destructive patterns
  - For `delete_file`: show the file content that will be deleted
  - "Remember this decision" checkbox: "Always allow writes in this session"
  - Keyboard shortcuts on approval card: Enter = Approve, Escape = Deny

### I5. Multi-Model Agent (Specialist Routing)
- A new setting: "Smart Routing" (on/off)
- When on: route different types of tasks to different models:
  - Code writing tasks → model A (e.g. qwen2.5-coder)
  - Explanation/reasoning tasks → model B (e.g. deepseek-r1)
  - Quick lookups → smallest available model
- Configuration: Settings > Models > Smart Routing section with dropdowns for each role
- The routing decision is made by keyword matching the user's message

### I6. Agent Memory Improvements
- Currently saves project memory as key-value entries — extend:
- **Auto-memory extraction:** After any task that reads or modifies files, automatically extract:
  - What language/framework the project uses
  - Key file locations (e.g. "main entry: src/main.js")
  - Build commands discovered
  - Patterns/conventions noticed
  - Store these silently in the background without interrupting the user
- **Memory panel improvements:**
  - Show memory entries grouped by category with icons
  - Full-text search across all memory entries (client-side)
  - Memory entry importance score (1-5 stars) — the agent prioritizes high-importance entries
  - Memory age shown: "3 days ago"
  - Bulk delete (checkbox + delete selected)

### I7. Agent Checkpoints / Undo History
- Each time the agent writes, patches, or deletes a file: create a checkpoint
- Checkpoints panel: new tab in the agent view "Checkpoints"
- Shows: timestamp, action description, files affected
- "Restore to this checkpoint" button: reverts all file changes since that checkpoint
- Max 20 checkpoints per session, stored in memory (not persisted)

### I8. Planned vs Actual Execution Tracking
- When the agent starts a multi-step task, show a sidebar panel "Plan"
- As the agent executes, check off completed steps in real-time
- Show estimated vs actual steps taken
- Show which tools were used most in this session

### I9. Debug Mode for Agent
- Settings > Agent: "Debug Mode" toggle
- When on: show verbose output in a collapsible section of each turn:
  - Full messages array sent to the model (formatted JSON, collapsed)
  - Raw model response before parsing
  - Tool call parsing: what JSON was extracted
  - Context window size in tokens before and after trimming

---

## PART J: Code Review AI Feature (~2,000 LOC)

### J1. Inline Code Review
- Right-click in the Monaco editor → "Ask AI to Review Selection"
- Or select code and press Ctrl+Shift+R
- Sends selected code to the AI with system prompt: "You are an expert code reviewer. Review this code for: bugs, security issues, performance, style, and suggest improvements. Be concise."
- Shows the review in a popup panel (not in the main chat) — like an inline side-panel
- "Apply Suggestions" button: sends the suggestions back to the agent to implement them

### J2. Explain Code
- Right-click → "Explain This" OR Ctrl+Shift+E on selection
- Sends selected code to AI with prompt: "Explain this code simply and clearly."
- Shows explanation in a small popup near the selection (positioned near the cursor)
- Dismiss on click outside

### J3. Generate Docstring
- Right-click → "Generate Docstring" on a function/method selection
- Sends code to AI, asks for JSDoc/rustdoc/Python docstring format auto-detected from language
- Inserts the generated docstring directly above the function in the editor

---

## COMMIT INSTRUCTIONS

After each Part (H, I, J), commit and push:
```bash
git checkout Zcode/agent
git add -A
git commit -m "feat(agent|chat|ai): [descriptive message]"
git push origin Zcode/agent
```

Complete ALL parts H, I, J before stopping.
