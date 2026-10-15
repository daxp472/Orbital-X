# Orbital X — Product Requirements Document (PRD)
**Version:** 1.0  
**Status:** Implementation blueprint for Antigravity  
**Product:** Orbital X  
**Platform:** Windows-first desktop IDE  
**Primary stack:** Tauri 2 + Rust + TypeScript-free frontend (HTML/CSS/JavaScript)  
**Document purpose:** Give Antigravity a clear, staged specification for building Orbital X without prematurely generating the entire application in one uncontrolled pass.

---

## 1. Executive Summary

Orbital X is a memory-conscious, AI-powered desktop coding IDE. It combines a conventional code editor with a tool-using coding agent that can inspect a project, understand context, manage project memory, create and edit files, run commands, and validate results.

Orbital X must support two model connection families:

1. **Cloud providers:** Anthropic Claude API, OpenAI API, and Google Gemini API, using user-supplied API keys.
2. **Local models:** Ollama first, with a provider abstraction that can support compatible local inference servers later.

The defining user experience is a choice of three agent operating modes:

- **Agent Pro Mode:** high autonomy within a defined workspace and safety policy.
- **Dev Mode:** routine coding work is streamlined, while commands and consequential actions require approval.
- **User Mode:** each file or command operation requires explicit approval and is reported to the user.

The product must look and behave like a real desktop IDE, not a chat page with a code editor attached. UI polish, clear status indicators, keyboard usability, trustworthy diffs, reliable editor behavior, onboarding, settings import/export, theming, and Windows installation are in scope.

### Product principles

- **Local-first:** keep project data and memory on the user's machine by default.
- **Provider-neutral:** agent tools and UI must not depend on one model vendor.
- **Trustworthy autonomy:** modes change approval policy, not the underlying security boundaries.
- **Visible work:** the user can inspect what the agent is doing, what it changed, and what validation actually ran.
- **Resource-aware:** avoid indexing or loading entire repositories unnecessarily; use bounded caches and background work.
- **Incremental delivery:** ship a reliable vertical slice before expanding provider coverage and advanced features.

---

## 2. Goals and Non-Goals

### 2.1 Goals

1. Deliver a Windows desktop IDE with a professional, familiar developer layout.
2. Open a workspace folder and browse, open, edit, save, and create source files and Markdown documents.
3. Provide syntax highlighting, line numbers, search, tabs, dirty-file indicators, and basic editor keyboard shortcuts.
4. Support Anthropic, OpenAI, Gemini, and Ollama through a shared provider interface.
5. Implement a tool-using agent loop: understand request → gather context → plan → call tools → observe results → validate → report.
6. Implement the three modes with centrally enforced, testable permissions.
7. Show diffs before or after edits according to the selected mode; preserve unsaved user work.
8. Execute workspace commands with timeouts, cancellation, output capture, and policy checks.
9. Validate changes with build, test, lint, and user-defined commands where available.
10. Store settings, conversations, project memory, and activity logs locally by default.
11. Provide first-run onboarding, model setup, theme selection, settings import/export, and a Windows installer.
12. Minimize idle RAM use and avoid expensive background work unless needed.

### 2.2 Non-goals for the first release

- Reimplementing all of VS Code.
- Training or hosting a foundation model.
- Guaranteed correctness of generated code.
- Supporting every language's full LSP/debugger ecosystem in the first milestone.
- Cloud accounts, team collaboration, hosted workspaces, or mandatory account creation.
- Running arbitrary commands with unrestricted administrator privileges.
- A plugin marketplace or multi-agent swarm.
- Full browser automation or remote deployment workflows.
- Silent uploads of source code, telemetry, or project data.

---

## 3. Target Users and Primary Use Cases

### Users

- Students and independent developers who want AI help in a real editor.
- Developers who use local models for privacy or cost control.
- Developers who prefer high-autonomy workflows for trusted projects.
- Developers who need explicit approval for sensitive repositories or unfamiliar tasks.

### Core use cases

1. Open an existing project and ask the agent to explain its structure.
2. Ask the agent to create a small feature across multiple files.
3. Review diffs, accept or reject changes, and undo an agent operation.
4. Ask the agent to run tests or a build, inspect the real output, fix failures, and rerun validation.
5. Switch between cloud models and a local Ollama model without changing the workspace.
6. Select an operating mode based on trust and desired interruption level.
7. Save project-specific instructions and decisions for future sessions.
8. Export settings for backup or transfer them to another installation.
9. Install Orbital X on Windows and complete first-run setup without technical confusion.

---

## 4. Platform and Technology Decisions

### 4.1 Desktop shell

Use **Tauri 2 + Rust**. Do not use Electron. Do not use React or TypeScript in the initial implementation.

### 4.2 Frontend

Use semantic HTML, modern CSS, and modular JavaScript. Use a maintainable component pattern without requiring a frontend framework.

The UI runs in the system WebView provided by Tauri. Check WebView2 availability and installer behavior on supported Windows versions.

### 4.3 Editor

Use **Monaco Editor** if its package/runtime integration is practical within the Tauri WebView and offline packaging requirements. Monaco is a browser-based editor component; it is not a complete IDE by itself. Package its assets locally where feasible rather than requiring a network download at launch.

If Monaco creates unacceptable bundle size or startup cost, evaluate CodeMirror 6 as a fallback. Record the tradeoff and make the decision before implementing editor-dependent features.

### 4.4 Rust backend

Rust owns privileged desktop operations and core services:

- Workspace/file operations.
- Permission and policy enforcement.
- Command execution lifecycle.
- Local persistence.
- Secure credential storage integration.
- Provider orchestration boundary where appropriate.
- Application lifecycle, updater/installer integration, and diagnostics.

Do not expose unrestricted filesystem or process APIs to the WebView. Use narrowly scoped Tauri commands and validate every argument in Rust.

### 4.5 AI integration strategy

Use a **provider adapter layer** with a normalized internal interface. Avoid binding the agent engine directly to a single provider's SDK or tool schema.

- Anthropic adapter: official Messages API, supported tool-use flow, streaming where practical.
- OpenAI adapter: official API/SDK and supported tool/function-calling flow for the selected endpoint.
- Gemini adapter: official Gemini API/SDK and supported function-calling flow.
- Ollama adapter: local HTTP API, model discovery/listing where supported, streaming and tool calling when supported by the chosen model.

Use official API documentation and current supported SDKs at implementation time. Provider capabilities differ. Do not assume identical tool-calling semantics, JSON guarantees, context limits, or streaming behavior.

The normalized adapter should expose capabilities and limitations so the UI can explain when a selected model does not support a requested feature.

### 4.6 Avoid unnecessary runtime duplication

Do not bundle a Node.js server merely because it is familiar. Prefer Rust services for core operations. If a specific ecosystem dependency requires a separate process, justify it, document its lifecycle, and ensure it is not left running when unused.

---

## 5. Information Architecture and Main UI

### 5.1 Primary window layout

Use a polished, resizable, dark-first desktop IDE layout:

1. **Title bar / application menu**
   - Orbital X logo and product name.
   - Workspace name.
   - Window controls.
   - Menu entries: File, Edit, View, Agent, Terminal, Settings, Help.

2. **Activity rail**
   - Explorer.
   - Search.
   - Source Control.
   - Agent / conversations.
   - Settings.

3. **Explorer sidebar**
   - Workspace tree.
   - Expand/collapse folders.
   - File type icons.
   - New file/folder.
   - Refresh.
   - Clear loading, empty, and error states.

4. **Editor region**
   - Tabbed files.
   - Syntax highlighting.
   - Line numbers.
   - Dirty-state marker.
   - Find in file.
   - Save and save-all.
   - Clear empty-workspace state.
   - Unsaved changes confirmation.

5. **Agent panel**
   - Conversation history.
   - Composer with multiline input.
   - Selected provider/model.
   - Selected mode indicator.
   - Plan/task progress.
   - Tool activity timeline.
   - Approval cards.
   - Diff preview and change summary.
   - Cancel/stop action.
   - Validation status.

6. **Bottom panel**
   - Terminal / command output.
   - Problems / validation.
   - Output / agent logs.
   - Resizable height and collapse state.

7. **Status bar**
   - Current workspace.
   - File language and encoding where practical.
   - Cursor position.
   - Model connection state.
   - Agent mode.
   - Running task indicator.
   - RAM/diagnostics display only if it can be measured cheaply and accurately.

### 5.2 UX quality requirements

- No placeholder buttons that look functional but do nothing.
- Every asynchronous operation has loading, success, empty, and failure states.
- Avoid layout jumps while the agent streams output.
- Keep the current editor visible while the agent works.
- Display long paths and errors accessibly without breaking the layout.
- Support resizing of explorer, editor, agent, and terminal panels.
- Provide keyboard shortcuts for common actions and show them in menus/tooltips.
- Support high-DPI displays, minimum practical window size, and Windows scaling.
- Use consistent spacing, typography, iconography, focus states, hover states, and motion.
- Respect reduced-motion preferences where feasible.
- Do not use fake terminal output or fake validation results in the actual product.

---

## 6. Branding and Visual Design

### 6.1 Product identity

Name: **Orbital X**  
Tagline suggestion: **Code. Explore. Validate.**  
Brand concept: a clean orbital ring around a central point, suggesting focused intelligence, connected tools, and iteration.

### 6.2 Logo requirements

Create an original vector logo, not a copied logo from another IDE or AI company.

- Primary mark: simple orbital ring / X motif.
- Must remain legible at 16×16, 32×32, 128×128, and installer-icon sizes.
- Include light and dark variants.
- Export SVG for the UI and appropriate PNG/ICO assets for Windows packaging.
- Do not rely on fine gradients or tiny detail for the recognizable silhouette.
- Include a simple monochrome variant for system/taskbar contexts.

### 6.3 Suggested themes

Provide at least three built-in themes:

1. **Orbit Dark** — default; charcoal background, restrained violet/cyan accent, high-contrast text.
2. **Nebula Light** — neutral light background, clear borders, accessible contrast.
3. **Solarized / Midnight Blue** — deep blue background with warm, readable syntax colors.

Theme rules:

- Centralize color tokens as CSS custom properties.
- Theme changes must update editor colors and application chrome consistently.
- Persist selected theme.
- Ensure readable text, focus indicators, selected rows, diffs, and terminal output.
- Do not encode success/error only through color; use icons and labels too.
- Keep syntax highlighting readable without excessive neon effects.

### 6.4 Import/export and customization

Settings must support:

- Export settings to a versioned JSON file.
- Import settings from a valid Orbital X settings file.
- Preview the import and list what will change.
- Validate schema and version before applying.
- Reject malformed files safely and never execute imported content.
- Allow choosing whether to import appearance, keyboard shortcuts, provider configuration metadata, and agent preferences.
- **Never export raw API keys by default.** If secret export is ever supported, it must be an explicit separate encrypted workflow with clear warnings. Prefer exporting provider names/model preferences without credentials.

---

## 7. Agent Operating Modes

Modes must be implemented in one central Rust permission-policy service. The UI must not be the authority that grants permissions. All tool invocations pass through the same policy checks, regardless of which provider/model requested the action.

### 7.1 Agent Pro Mode

**Purpose:** high-autonomy work inside the selected workspace.

Expected behavior:

- Read relevant workspace files without asking for every read.
- Search project files and gather context automatically within limits.
- Create and edit workspace files automatically.
- Apply patches and maintain an auditable change history.
- Run allowlisted, low-risk project commands automatically.
- Run build/test/lint commands automatically when covered by policy.
- Inspect real command output and test results.
- Retry fixes within configurable limits.
- Summarize changed files, commands, test results, and unresolved issues.
- Display a visible live activity timeline and an always-available Stop button.

Safety constraints that remain active:

- Restrict file writes to the selected workspace unless the user explicitly adds another workspace.
- Never read or disclose secrets intentionally; exclude common credential files and sensitive paths from default indexing.
- Do not send source code to cloud providers without the provider configuration and relevant data-sharing disclosure.
- Never bypass operating-system permissions, security prompts, or Tauri/Rust policy.
- Block destructive or high-impact operations by default: deleting large directory trees, formatting disks, changing system settings, administrator/elevated commands, credential access, publishing, deployment, external uploads, and Git push.
- Git push, release/publish, and deployment require explicit approval by default.
- Allow users to configure safe command patterns, retry limits, network policy, and workspace boundaries.
- Pro mode must not claim responsibility is transferred from the user to the software. Clearly state that users remain responsible for reviewing consequential changes.

### 7.2 Dev Mode

**Purpose:** efficient development with approvals for meaningful execution actions.

Default policy:

- Workspace file reads and context collection: allowed without per-file prompts.
- File creation/edits: agent may propose changes; show a diff and let the user configure automatic application or approval-first behavior.
- Terminal commands: approval required by default, including build/test commands, with an optional setting for previously approved safe commands.
- Git status/diff: read-only inspection may be automatic.
- Git commit: approval required.
- Git push, publish, deployment, destructive Git operations: approval required.
- External network requests initiated by tools: approval required unless specifically configured.
- Every approved operation is recorded in the activity log.
- The agent must report validation results and any skipped checks.

### 7.3 User Mode

**Purpose:** explicit per-operation control.

Default policy:

- Ask before each file read or file-content inspection.
- Ask before each search operation that exposes file contents.
- Ask before creating, editing, renaming, moving, or deleting a file.
- Ask before every command execution.
- Ask before Git operations that change state; ask before external/network operations.
- Each approval request must describe the action, target, reason, and likely effect.
- The user can approve or deny; denial must stop that tool call without retrying it through another path.
- No broad implicit consent. A batch approval is permitted only when the exact batch and scope are displayed and the user explicitly approves that batch.
- Log approvals, denials, results, and failures.
- The agent must not claim an action occurred if it was denied or failed.

### 7.4 Mode switching

- Display the active mode prominently in the title/agent header and approval cards.
- Switching mode applies to future tool calls; it does not retroactively approve pending operations.
- If a task is running, explain whether the switch takes effect immediately or after the current operation. Safest default: apply to the next tool call and re-check policy before each call.
- Pro Mode should require a one-time confirmation explaining its autonomy boundaries.
- Show a persistent indicator when Pro Mode is active.
- Changing modes must never bypass core workspace restrictions or secret protection.

### 7.5 Approval request design

Each request must show:

- Tool/action name.
- Exact file path, command, or destination.
- Why the agent wants to perform it.
- Whether it reads, writes, deletes, executes, or transmits data.
- Risk label: low, medium, or high.
- Buttons: Approve, Deny, and (where appropriate) Inspect details.
- For commands, show the full command and working directory.
- For edits, show the diff before approval when feasible.

---

## 8. Agent Tools and Contracts

Create a typed internal tool registry. Each tool must have a stable name, validated input schema, bounded output, declared risk level, permission category, timeout/cancellation behavior, and tests. Model output is untrusted input; validate all arguments before execution.

### 8.1 Workspace and file tools

- `workspace_info`: report root path and workspace metadata.
- `list_files`: list files under an allowed root with ignore rules.
- `search_files`: filename/content search with result and size limits.
- `read_file`: read a specific allowed file with size and encoding limits.
- `read_file_range`: read a bounded range from a large file.
- `create_file`: create a new file under an allowed workspace root.
- `write_file`: write or replace content after policy checks.
- `apply_patch`: apply a validated patch; detect conflicts and preserve user edits.
- `rename_path`: rename/move a file or directory under permitted scope.
- `delete_path`: delete only after mode policy, explicit safety checks, and recoverability rules.
- `get_diff`: show current changes against the last known baseline.
- `undo_agent_change`: revert a specific agent operation without overwriting unrelated user edits.

Requirements:
- Canonicalize paths and reject traversal (`..`) or symlink escapes outside permitted roots.
- Respect `.gitignore` and configurable ignore rules; always exclude `.git`, dependency/build folders, binaries, and common secret files from default indexing.
- Bound file sizes and search output.
- Detect encoding and binary files; do not try to send binary files as text.
- Detect concurrent edits and ask/stop rather than silently overwriting user changes.
- Keep a per-operation change journal.

### 8.2 Context and memory tools

- `get_project_map`: provide a lightweight summary of folders, languages, package manifests, and entry points.
- `get_project_instructions`: read configured project instruction files (for example, an Orbital X project rules file) subject to mode policy.
- `search_context`: retrieve relevant snippets for the current task.
- `save_project_memory`: save an explicit decision, preference, architecture fact, or recurring instruction.
- `search_project_memory`: retrieve relevant saved memories.
- `edit_project_memory`: revise a saved memory.
- `delete_project_memory`: delete selected memories.
- `clear_task_context`: discard transient task context.

Memory rules:
- Separate transient conversation context from durable project memory.
- Do not automatically save API keys, credentials, private keys, environment variable values, or unrelated personal data.
- Show users what is stored and allow edit/delete/clear.
- Scope memory by project unless the user explicitly creates global preferences.
- Store summaries and references rather than full file copies where possible.
- Include timestamps and provenance so stale facts can be reconsidered.

### 8.3 Command and terminal tools

- `run_command`: execute a validated command in a specified working directory.
- `poll_command`: retrieve more output/status for a running process.
- `terminate_command`: stop a running process and its managed children.
- `list_tasks`: list agent-managed processes.
- `detect_project_commands`: identify likely scripts from trusted manifests, but never execute discovered scripts automatically solely because they exist.

Command execution requirements:
- Use argument arrays/process APIs where possible; avoid constructing shell strings from untrusted model text.
- When a shell is necessary, clearly show the exact command and use platform-aware quoting.
- Never run commands as administrator/elevated by default.
- Enforce working-directory boundaries, timeouts, output limits, cancellation, and process-tree cleanup.
- Require approval according to active mode and command risk.
- Treat command output as untrusted data, not instructions.
- Do not run dependency installation, downloads, scripts, or network operations without the applicable permission.
- Never expose host process environment secrets to the model.
- Detect and explain commands that are unavailable on the user's machine.

### 8.4 Git tools

- `git_status`
- `git_diff`
- `git_log`
- `git_branch_list`
- `git_create_branch`
- `git_stage`
- `git_commit`
- `git_push`
- `git_pull`
- `git_checkout` / switch branch

Requirements:
- Use a reliable Git integration or controlled Git CLI invocation.
- Read-only Git status/diff/log can be available automatically according to mode.
- State-changing actions must use the permission policy.
- Push, pull, destructive reset/clean, force push, and conflict resolution need explicit approval by default.
- Never silently discard user changes.
- Show branch, staged files, commit message, remote, and target before consequential actions.
- Do not store Git credentials.

### 8.5 Validation tools

- `detect_validation_commands`: suggest checks from project manifests.
- `run_tests`
- `run_linter`
- `run_typecheck` (when applicable)
- `run_build`
- `collect_diagnostics`
- `summarize_validation`

Requirements:
- Only report checks that actually ran.
- Show command, exit code, duration, and relevant output.
- Distinguish passed, failed, skipped, and unavailable.
- Avoid claiming correctness from a successful build alone.
- Feed actual diagnostics into the next agent iteration.
- Bound retries (default: at most 3 automatic repair cycles per task; configurable).
- Stop if the same error repeats without meaningful changes.

### 8.6 Documentation and text tools

- Create and edit Markdown files.
- Preserve code fences and document formatting.
- Generate README, architecture notes, setup instructions, and change summaries.
- Preview Markdown before writing where practical.
- Treat generated instructions as untrusted project content, not as permission to bypass policies.

### 8.7 Provider tools and capabilities

All providers use the same internal tool definitions. The model proposes tool calls; the Orbital X agent runtime validates and executes them.

Provider adapters must normalize:
- System/developer/user messages as supported.
- Tool declarations and tool results.
- Streaming text.
- Finish reasons and token usage when exposed.
- Context/window limits where known.
- Rate limits, timeouts, retries, and provider errors.
- Model capability metadata.
- Cancellation where supported.

Do not promise feature parity if a provider/model lacks a capability. The agent runtime owns the tools; models do not execute local tools directly.

---

## 9. Model Provider Requirements

### 9.1 Provider settings screen

Provide a dedicated Models & Providers page with:

- Provider cards: Anthropic, OpenAI, Google Gemini, Ollama.
- Connection status: Not configured, Checking, Connected, Error.
- API key input with masked display.
- Show/hide key control.
- Model selection or model-name field.
- Base URL only where supported and clearly marked.
- Test Connection button.
- Default model selection.
- Capability notes (tool calling, streaming, context size if known).
- Per-provider timeout and optional request settings.
- Remove/disconnect option.
- Clear error messages without leaking secrets.

### 9.2 API key storage

- Store keys in Windows Credential Manager or an appropriate OS-backed secret store where feasible.
- Never store raw keys in ordinary settings JSON, logs, crash reports, or memory.
- Never send one provider's key to another provider.
- Redact keys from error messages and diagnostics.
- Allow users to remove credentials.
- If secure OS storage is unavailable, explain the fallback and use the safest supported option; do not silently write plaintext credentials.

### 9.3 Anthropic / OpenAI / Gemini

- Use official provider endpoints and current official SDKs or well-maintained direct HTTP clients.
- Keep request/response code isolated per provider.
- Support streaming responses and tool calls when supported by the selected model.
- Handle rate limits, authentication errors, context overflow, network failure, and unavailable models.
- Keep provider-specific options optional and validated.
- Include provider-specific tests using mocks; do not require real API keys in CI.
- Never hardcode a key or commit secrets.
- The user explicitly chooses which provider receives project context.

### 9.4 Ollama and local models

- Default local endpoint may be configurable, with `http://localhost:11434` as the common Ollama default.
- Test whether the local service is running.
- List available models when the API supports it.
- Let the user enter a model name if listing is unavailable.
- Show clear instructions for installing/running Ollama and pulling a model; do not automatically download large models without consent.
- Detect common connection failures and explain them.
- Support streaming and tool calls when supported by both the runtime and selected model.
- Warn that some local models may not reliably follow tool schemas.
- Local inference must not send prompts to a cloud service unless the user explicitly changes providers.
- Avoid loading model weights inside Orbital X; delegate inference to the local runtime to prevent duplicate RAM usage.

### 9.5 Provider-neutral agent loop

1. Build a request from system rules, user request, relevant context, and available tool schemas.
2. Send it through the chosen provider adapter.
3. Stream text and parse tool requests according to provider semantics.
4. Validate every tool call against schema and permission policy.
5. Ask for approval when required.
6. Execute the tool in the Rust backend.
7. Return bounded tool results to the model.
8. Repeat until the model finishes, the task is cancelled, or a configured limit is reached.
9. Run validation where requested or planned.
10. Produce a truthful final report with changes, checks, and unresolved risks.

---

## 10. Context Management and Project Indexing

Do not read every file into every prompt.

### Requirements

- Build a lightweight workspace map from folder names and common manifests.
- Respect ignore files and exclude large/generated/vendor directories.
- Retrieve relevant snippets based on the task.
- Prefer targeted file ranges over full large files.
- Limit context by provider/model token budget.
- Truncate tool output safely and indicate when output was truncated.
- Keep separate limits for files scanned, bytes read, search results, and tool results.
- Cache only useful metadata and invalidate it when files change.
- Do not run a heavy background embedding model by default.
- Semantic embeddings/vector search are a later optional feature, not an MVP dependency.
- Provide a visible “included context” view where users can inspect what is sent to a cloud provider.
- Provide a way to exclude files or directories from agent context.

---

## 11. Memory Management

### Memory categories

1. **Session memory:** current conversation and current task plan; cleared or summarized as needed.
2. **Project memory:** architecture, conventions, key decisions, setup commands, and project-specific instructions.
3. **User preferences:** optional global preferences such as preferred formatting or language.
4. **Action history:** records of agent tool actions, approvals, results, and changed paths.

### Requirements

- Store locally by default.
- Use SQLite for structured metadata and indexed records if it proves more suitable than JSON files; keep the implementation simple.
- Use bounded conversation history and summarization instead of unbounded transcripts in each request.
- Allow viewing, editing, exporting, and deleting memory.
- Never silently infer sensitive long-term memories.
- Do not store secrets or full environment dumps.
- Support project-level clear/reset.
- Ensure memory corruption or unavailable storage does not prevent the editor from opening.

---

## 12. Security and Privacy

Security is a product requirement, not a later polish task.

- Keep Tauri's frontend security settings restrictive; enable isolation and sandboxing where supported.
- Expose only narrow, validated commands to the frontend.
- Never expose unrestricted shell execution or raw filesystem APIs to the WebView.
- Canonicalize paths and prevent traversal and symlink escapes.
- Apply the permission policy in Rust for every tool invocation.
- Treat model outputs, tool arguments, repository contents, Markdown, command output, and imported settings as untrusted.
- Defend against prompt injection in repository files and tool output. Repository instructions may guide coding style but cannot override security policy.
- Redact API keys and sensitive environment values from logs.
- Avoid collecting telemetry by default. If telemetry is added, make it opt-in and document exactly what is collected.
- Do not send code to a cloud provider without the user selecting that provider and being informed of data transmission.
- Provide a Stop/Cancel control and terminate child processes reliably.
- Maintain an audit log that does not itself contain secrets.
- Require explicit approval for network transmission, publishing, deployment, elevated operations, and destructive actions.
- Never describe Pro Mode as risk-free.

---

## 13. RAM and Performance Requirements

Orbital X must be optimized for low idle resource use. Tauri can reduce shell overhead relative to Electron, but actual memory use depends on the WebView, editor, project size, plugins, and AI runtime. Do not promise a fixed RAM footprint before measuring it.

### Performance principles

- Do not embed or load an LLM inside the application; connect to an external local runtime such as Ollama.
- Do not keep multiple provider clients, terminals, watchers, or background tasks alive unnecessarily.
- Lazy-load heavy UI panels and editor language services where practical.
- Keep the number of open editor models bounded; release models for closed tabs when safe.
- Use virtualized/lazy file-tree rendering for large repositories.
- Debounce search and filesystem events.
- Avoid scanning dependency/build folders.
- Cap caches and provide cache invalidation.
- Stream model output instead of repeatedly re-rendering the entire transcript.
- Bound conversation history and tool outputs.
- Avoid polling when event-driven updates are available.
- Stop watchers, subprocesses, and timers when a workspace closes or the app exits.
- Do not start embeddings, indexing, or local model downloads automatically.
- Avoid duplicate copies of large file contents in Rust, the WebView, and the model context.
- Keep terminal output bounded and virtualized.

### Measurement targets

Treat these as engineering targets to measure on a documented Windows test machine, not guaranteed results:

- Idle after startup with no workspace: target under 250 MB app-attributed working set where practical.
- Open a small project without an AI request: target under 350 MB app-attributed working set where practical.
- No persistent high CPU usage while idle.
- UI interactions should remain responsive during model streaming and repository scans.
- Cancel should stop agent activity promptly and clean up managed subprocesses.
- Large workspace scanning should be incremental and cancellable.

Document measurement methodology and separate Orbital X memory from Ollama/model runtime memory. Local model inference can use several gigabytes of RAM/VRAM and is not part of the IDE's own footprint.

---

## 14. Onboarding and First-Run Experience

Create a short guided setup with progress, Back/Next, Skip where safe, and a Settings entry to revisit it.

### Step 1: Welcome

- Orbital X logo and short product description.
- Explain that Orbital X can use cloud providers or local models.
- Clearly state that cloud providers receive the context sent to them.
- Buttons: Get Started / Configure Later.

### Step 2: Choose AI setup

Options:
- Connect a cloud provider.
- Connect Ollama/local model.
- Use the editor without AI for now.

Do not block the editor if AI setup is skipped.

### Step 3A: Cloud provider setup

- Select Anthropic, OpenAI, or Gemini.
- Explain where to obtain a provider API key using official provider documentation links.
- Enter key securely.
- Select or enter a model.
- Test connection.
- Show a useful error if authentication, network, or model selection fails.
- Never show the full stored key again after saving.

### Step 3B: Local model setup

- Check whether the local Ollama endpoint responds.
- If not detected, show instructions and an official download link; do not install software silently.
- Explain that the user may need to pull a model using Ollama's documented command.
- List installed models or let the user enter a model name.
- Test connection and perform a small optional test request.
- Explain that local models use system RAM/VRAM and capabilities vary.

### Step 4: Choose default agent mode

Explain the differences in plain language:
- Pro: autonomous inside configured limits.
- Dev: routine work with approval for commands and consequential actions.
- User: explicit approval before every operation.

Default to **Dev Mode** for new users. Pro Mode requires a clear confirmation of its autonomy boundaries.

### Step 5: Choose theme

Preview Orbit Dark, Nebula Light, and Midnight Blue. Let users change it later.

### Step 6: Open a workspace

- Open folder / Open sample project / Start without a project.
- Explain that the agent can access only the selected workspace by default.
- Show a workspace trust notice and excluded sensitive paths.

### Step 7: Interactive mini-tour

Show short tooltips for:
- Explorer and editor.
- AI chat and model selector.
- Agent mode selector.
- Diff review.
- Terminal/validation panel.
- Settings and memory controls.

### Step 8: Ready

Show selected provider/model, active mode, workspace, and a “Try a task” suggestion such as “Explain this project's structure.” Do not make a cloud request until the user submits a task.

---

## 15. Settings and Configuration

Settings sections:

1. Appearance: theme, font size, editor font, density, motion.
2. Editor: tab behavior, word wrap, minimap if supported, autosave options, formatting preferences.
3. AI providers: provider credentials, models, connection test, timeouts.
4. Agent: default mode, tool limits, retries, context limits, approval preferences.
5. Security: workspace restrictions, excluded paths, command policies, network policy.
6. Memory: project/global memory review, export, delete, clear.
7. Terminal: default shell, working directory, output limits, timeout.
8. Git: executable path, default branch behavior, commit approval.
9. Performance: indexing, cache limits, background activity.
10. Import/export: versioned settings file, preview, validation.
11. Diagnostics: app version, platform, logs with secret redaction.

Settings changes must be validated, persisted atomically, and recover safely from malformed configuration.

---

## 16. Windows Packaging, Installer, and Installation Phases

### 16.1 Build and packaging

Use Tauri's supported Windows build and bundling workflow. Verify prerequisites against current official Tauri documentation, including Rust toolchain, target toolchain, and WebView2 requirements. Do not assume every development dependency is present on the user's machine.

Expected release artifacts:
- Windows installer (`.msi` and/or `.exe`, depending on the selected supported bundler).
- Application icon assets.
- Version and release notes.
- Checksums for distributed artifacts where practical.
- Optional portable build only if it can be supported safely.

### 16.2 Installer experience

The installer should:
- Display Orbital X name, logo, version, publisher identity, and license where applicable.
- Explain install location and disk-space requirements.
- Offer a Start Menu shortcut and optional desktop shortcut.
- Install the application and required bundled assets.
- Check or explain WebView2 prerequisites.
- Avoid requesting administrator rights unless the chosen installation scope requires them.
- Provide a clear success screen and launch option.
- Support clean uninstall without deleting user projects or user-created source files.
- Never bundle API keys or user model data.

Code signing should be used for public distribution when feasible. Do not claim the application is signed unless it actually is.

### 16.3 First launch and runtime checks

On first launch:
- Validate configuration and migrate settings if needed.
- Detect missing or invalid local provider configuration.
- Do not fail to open the editor if AI is unavailable.
- Create local application data directories.
- Display a friendly diagnostic for unavailable dependencies.
- Keep logs in an app-specific location and offer a way to open them.

### 16.4 Developer setup guide

The repository must include `README.md` with:
- Supported OS and prerequisites.
- Rust and Tauri setup.
- Frontend dependency installation.
- Development run command.
- Build/package command.
- Test and lint commands.
- Provider setup instructions.
- Ollama setup instructions.
- Troubleshooting for WebView2, Rust targets, native build tools, provider errors, and permissions.
- How to create a release build.

Do not invent commands. Verify commands against the actual generated project and current framework versions.

---

## 17. Suggested Repository Structure

Adapt to actual Tauri conventions, but keep a clear separation between frontend, Rust backend, agent policy, providers, and tests.

```text
orbital-x/
  README.md
  PRD.md
  package.json
  package-lock.json or chosen lockfile
  index.html
  src/
    styles/
      tokens.css
      themes.css
      layout.css
      components.css
    js/
      app.js
      state/
      components/
      views/
      services/
      editor/
      onboarding/
      settings/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    capabilities/
    icons/
    src/
      main.rs
      commands/
      workspace/
      filesystem/
      terminal/
      git/
      agent/
        orchestrator.rs
        policy.rs
        tools.rs
        context.rs
        memory.rs
        validation.rs
      providers/
        mod.rs
        anthropic.rs
        openai.rs
        gemini.rs
        ollama.rs
      storage/
      security/
      diagnostics/
  tests/
    fixtures/
    policy/
    providers/
    workspace/
    agent/
  docs/
    architecture.md
    security.md
    user-guide.md
    troubleshooting.md
```

Do not create empty files just to match this tree. Build modules as their dependencies become real. Keep provider credentials, tool execution, and policy enforcement in trusted backend code.

---

## 18. Implementation Plan and Milestones

Antigravity must work incrementally. It must inspect the current repository before changing files, avoid replacing working code blindly, and run the available checks after each milestone.

### Milestone 0 — Repository and environment audit

- Inspect the existing repository, installed toolchains, Tauri version, and project state.
- Confirm the intended frontend uses HTML/CSS/JavaScript, not React or TypeScript.
- Write `docs/implementation-plan.md`.
- Record assumptions, build risks, dependency decisions, and acceptance criteria.
- Do not implement features until the architecture and build path are understood.

**Exit criteria:** the project builds a minimal Tauri window or a specific blocker is documented.

### Milestone 1 — Desktop shell and visual foundation

- Create branded window and app icon.
- Implement IDE layout, resizable panels, explorer, editor area, agent panel, bottom panel, status bar.
- Add three themes and persistent theme selection.
- Add empty/loading/error states.
- Verify keyboard navigation and scaling.

**Exit criteria:** the app launches and feels like a coherent desktop IDE, even before AI is connected.

### Milestone 2 — Workspace and code editor

- Open a folder.
- Browse files and directories.
- Open text files, edit, create, save, and close tabs.
- Add syntax highlighting and basic find.
- Handle unsaved changes and external file modifications.
- Apply path and size restrictions.

**Exit criteria:** users can perform basic coding and Markdown editing without the agent.

### Milestone 3 — Provider framework

- Define normalized provider interface and capability metadata.
- Implement one provider end-to-end first.
- Add provider settings, secure key storage, connection tests, streaming, errors.
- Add remaining cloud adapters and Ollama incrementally.
- Add mocked provider tests.

**Exit criteria:** users can select a configured model and exchange a basic prompt with truthful connection/error state.

### Milestone 4 — Agent read/context loop

- Implement tool registry and schemas.
- Add workspace map, bounded search, file reading, context display.
- Add streaming agent response and activity timeline.
- Implement tool-call validation and cancellation.

**Exit criteria:** the agent can inspect a sample repository and accurately explain relevant files.

### Milestone 5 — Editing and diff review

- Add create/write/patch tools.
- Show diffs.
- Detect concurrent edits and conflicts.
- Add accept/reject and undo for agent changes.
- Enforce mode policy in Rust.

**Exit criteria:** the agent can safely make a small multi-file change with an auditable record.

### Milestone 6 — Terminal, Git, and validation

- Implement controlled command execution.
- Capture output, exit code, duration, timeout, cancellation.
- Add test/build/lint suggestions and results.
- Add Git read operations first, then approved state-changing actions.
- Implement bounded repair loop.

**Exit criteria:** a sample task can edit code, run a real check, and report the actual result.

### Milestone 7 — Modes and memory

- Implement Pro, Dev, and User policy profiles.
- Test policy at every tool boundary.
- Add session and project memory.
- Add memory viewer, edit/delete, and reset.
- Add action history.

**Exit criteria:** the same agent task demonstrably follows different permission behavior in all three modes.

### Milestone 8 — Onboarding, settings, and import/export

- Add first-run wizard and mini-tour.
- Add provider and model setup.
- Add theme preview and settings import/export.
- Validate imported settings and protect credentials.

**Exit criteria:** a new user can reach a usable editor without reading the developer README.

### Milestone 9 — Hardening and installer

- Add unit/integration tests.
- Check Tauri security configuration and capabilities.
- Measure idle and small-workspace RAM use.
- Test process cleanup, cancellation, provider failure, and workspace boundaries.
- Build Windows installer.
- Verify install, launch, upgrade behavior if implemented, and uninstall.
- Complete user guide and troubleshooting docs.

**Exit criteria:** installer works on a clean supported Windows test machine and core workflows pass.

---

## 19. Acceptance Criteria

The MVP is acceptable only when the following are demonstrably true:

### Desktop and editor
- [ ] App launches without an AI provider configured.
- [ ] User can open a workspace and edit/save a source file and Markdown file.
- [ ] Tabs, dirty markers, search, and unsaved-change warnings work.
- [ ] Three themes work consistently, including editor syntax colors.
- [ ] The UI handles loading, empty, and error states.

### Providers
- [ ] Anthropic, OpenAI, Gemini, and Ollama each have a provider adapter or a clearly documented staged implementation status.
- [ ] API keys are not present in plaintext settings exports or logs.
- [ ] Provider connection failures are explained without crashing the IDE.
- [ ] Unsupported tool features are surfaced clearly.

### Agent
- [ ] Agent can read relevant project context, propose edits, and report actual tool outcomes.
- [ ] Changes are reviewable and can be undone without erasing unrelated user edits.
- [ ] Terminal commands are bounded, cancellable, and policy-checked.
- [ ] Validation results distinguish passed, failed, skipped, and unavailable.
- [ ] Automatic retry count is bounded.

### Modes
- [ ] Pro Mode minimizes routine prompts but remains within explicit safety boundaries.
- [ ] Dev Mode requests approval for commands and consequential operations by default.
- [ ] User Mode asks before every requested file or command operation.
- [ ] All modes use the same backend-enforced policy engine.
- [ ] Denied actions cannot be retried through a different tool path without a new approval.
- [ ] Active mode and pending approvals are always visible.

### Memory, settings, and packaging
- [ ] Project memory is inspectable and deletable.
- [ ] Settings export/import is versioned and validated.
- [ ] Theme and provider preferences persist.
- [ ] Installer works on a clean supported Windows environment.
- [ ] App opens when Ollama or a cloud provider is unavailable.
- [ ] Performance tests measure app memory separately from local model memory.

---

## 20. Test Plan

### Unit tests
- Permission-policy decision table for every tool × mode × risk class.
- Path canonicalization and workspace boundary checks.
- Settings import validation and schema migration.
- Secret redaction.
- Provider response/tool-call normalization.
- Patch conflict handling and undo logic.

### Integration tests
- Open/read/edit/save a fixture project.
- Model requests a read tool and receives the actual file content.
- Model requests a file change and produces a correct diff.
- Model requests a command and policy behaves according to the selected mode.
- Test failure is returned to the agent and retry limits are enforced.
- Provider disconnect, invalid key, timeout, rate limit, and context overflow are handled.
- Cancel terminates active tasks and managed child processes.

### Manual UX tests
- Keyboard-only navigation.
- Long filenames and deeply nested projects.
- High-DPI display and resizing.
- Large terminal output.
- Slow model streaming.
- Theme changes while editor is open.
- First-run setup with no provider, cloud provider, and Ollama.
- Installer and uninstall on a clean machine.

---

## 21. Antigravity Working Instructions

Antigravity must follow these rules throughout implementation:

1. **Read before writing.** Inspect existing files and current repository state before editing.
2. **No giant one-shot rewrite.** Implement one milestone at a time.
3. **No fake functionality.** Do not present mock data, simulated commands, or hardcoded “tests passed” results as real functionality.
4. **No unverified commands.** Confirm scripts and framework commands from the actual project and current official documentation.
5. **No hidden permission bypass.** Every agent tool call passes through the Rust policy layer.
6. **No unrestricted shell exposure.** The frontend cannot invoke arbitrary OS commands directly.
7. **No secret leakage.** Redact keys and sensitive environment data in logs and model context.
8. **No false success claims.** State exactly which build, tests, or checks were executed and their results.
9. **Protect user changes.** Detect concurrent edits and avoid destructive overwrites.
10. **Keep the application usable at every milestone.** After each milestone, run available tests and the app.
11. **Document decisions.** Update architecture and setup docs when meaningful decisions change.
12. **Prefer small dependencies.** Add a dependency only when it materially improves functionality and its cost is understood.
13. **Measure memory.** Profile idle and representative workloads rather than claiming Tauri is automatically low-memory.
14. **Preserve stack decisions.** Use Tauri + Rust and HTML/CSS/JavaScript. Do not introduce Electron, React, or TypeScript unless the product owner explicitly changes this requirement.
15. **Verify provider integrations.** Use current official API documentation; never assume Anthropic, OpenAI, Gemini, and Ollama have identical APIs.
16. **Keep the user in control.** Provide Stop, review, undo, and clear mode indicators.
17. **Report milestone completion** with changed files, commands run, test results, known gaps, and the next recommended step.

---

## 22. Definition of Done

Orbital X MVP is done when a new Windows user can install and launch it, open a real project, choose a local or cloud model, select Pro/Dev/User mode, ask the agent to make a small change, inspect or approve the operation according to mode, run a real validation command, see the actual output, and review a truthful final summary.

The UI must feel like a real IDE, settings and memory must be manageable, the installer must work, credentials must be protected, and the agent must not bypass its own permission rules.

**Priority order:** reliable desktop/editor foundation → one complete agent workflow → permission modes → provider breadth → memory and validation polish → installer and performance hardening.

Do not sacrifice core usability or safety to claim every planned feature is finished. If time is constrained, clearly label incomplete features and keep the application stable.
