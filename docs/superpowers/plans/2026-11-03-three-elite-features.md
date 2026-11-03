# Multi-Model Speculative Streaming, Token & VRAM Telemetry, and Time-Travel Agent Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three elite-level IDE features: (1) Multi-Model Speculative Streaming with Settings toggles and auto-detection, (2) Native Zero-Allocation Token Telemetry & VRAM Tracker with live canvas HUD, and (3) The Visual "Time-Travel" Agent Journal with VFS multi-file snapshot rollback.

**Architecture:** 
1. **Speculative Streaming:** Rust backend concurrently dispatches a draft model stream to Monaco ghost text while a secondary verification task validates/patches divergences in the background.
2. **Hardware Telemetry:** Native 1000ms poller using `sysinfo` and GPU memory counters emitting zero-allocation Tauri IPC events to an interactive status-bar HUD with real-time TPS vs VRAM graph.
3. **Time-Travel Journal:** VFS turn-level snapshot store in `workspace.rs` capturing directory state before and after each agent prompt, paired with an interactive timeline slider UI for 1-click multi-file workspace rollback.

**Tech Stack:** Rust (Tauri 2, `sysinfo`, `tokio`, `reqwest`), JavaScript (ES2022, Monaco Editor API, HTML5 Canvas, Tauri IPC).

---

## Global Constraints
- Preserve locked version `2.3.0` across all files.
- Preserve zero-cloud privacy: Ollama local models and native OS calls only.
- All existing tests (`npm test`, `cargo test`) must pass with code 0.
- No existing functionality or menubar shortcuts may be broken.

---

## File Structure Map
- **Modified:**
  - `src-tauri/src/providers.rs`: Add speculative draft-verifier streaming and model detection.
  - `src-tauri/src/workspace.rs`: Add prompt-turn VFS snapshots and atomic directory rollback.
  - `src-tauri/src/lib.rs`: Expose commands for speculative streaming, telemetry polling, and time-travel rollback.
  - `src/js/state/store.js`: Add state for speculative streaming, hardware telemetry, and time travel.
  - `src/js/components/settings.js`: Add Speculative Streaming controls (toggle, auto-set, dropdown, descriptions).
  - `src/js/editor/monaco.js`: Connect speculative streaming to inline ghost text completion.
  - `src/js/components/agent.js`: Hook time-travel turn recording and timeline entry point.
- **New:**
  - `src-tauri/src/telemetry.rs`: Real-time sysinfo + VRAM tracker poller and event emitter.
  - `src/js/components/telemetry-hud.js`: Live status bar widget and canvas TPS vs VRAM graph.
  - `src/js/components/time-travel.js`: Visual git-like timeline scrubber and rollback modal.

---

## Task 1: Multi-Model Speculative Streaming Engine (Rust Backend)

- [ ] **Step 1.1: Add draft-and-verify speculative streaming in `providers.rs`**
  Implement `ProviderService::speculative_stream_code(...)` that:
  - Takes `draft_model`, `verifier_model`, `prompt`, `prefix`, `suffix`, and a Tauri event emitter.
  - Streams initial completions from `draft_model` with event `speculative:draft_chunk`.
  - Runs `verifier_model` in background to validate draft tokens, emitting `speculative:verified` or `speculative:patch` if corrected.
- [ ] **Step 1.2: Add auto-selection of smallest local model**
  Implement helper `ProviderService::find_optimal_draft_model(available_models: &[String]) -> Option<String>` which inspects names containing `1.5b`, `1b`, `0.5b`, or `3b`.
- [ ] **Step 1.3: Expose Tauri IPC commands in `lib.rs`**
  Register `speculative_complete_code` and `auto_detect_draft_model`.
- [ ] **Step 1.4: Unit test in `providers.rs`**
  Verify draft model auto-picker and error fallbacks pass `cargo test`.

---

## Task 2: Speculative Streaming UI & Monaco Ghost Text Integration

- [ ] **Step 2.1: Update `src/js/state/store.js`**
  Add `state.ai.speculative = { enabled: false, autoSet: true, draftModel: '', verifierModel: '' }`.
- [ ] **Step 2.2: Add Speculative Streaming controls in `src/js/components/settings.js`**
  Add:
  - On/Off Switch: `Enable Multi-Model Speculative Streaming`.
  - Auto-Set button: fetches installed Ollama models and selects the fastest draft model.
  - Manual Draft Model dropdown with informative description labels.
- [ ] **Step 2.3: Connect to Monaco Editor inline completion in `src/js/editor/monaco.js`**
  Update inline completion provider to invoke `speculative_complete_code` when enabled, rendering instant draft tokens and dynamically replacing them if verifier emits a patch.
- [ ] **Step 2.4: Verify with `npm test`**

---

## Task 3: Zero-Allocation Native Telemetry & VRAM Tracker (Rust Backend)

- [ ] **Step 3.1: Create `src-tauri/src/telemetry.rs`**
  Build `TelemetryManager`:
  - Background tokio task running every 1000ms.
  - Reads total & free system RAM and CPU usage via `sysinfo::System`.
  - Queries active GPU VRAM via Windows registry/DXGI and Ollama `/api/ps` model memory.
  - Calculates real-time tokens-per-second ($TPS$) from the agent session counter.
  - Emits `telemetry:hardware-tick` event to the frontend.
- [ ] **Step 3.2: Expose commands in `lib.rs`**
  Add `get_live_telemetry` and `start_telemetry_stream`.
- [ ] **Step 3.3: Write unit tests for telemetry structs in `telemetry.rs`**
  Verify serialization and safe fallbacks with `cargo test`.

---

## Task 4: Telemetry Status Widget & Canvas HUD (Frontend)

- [ ] **Step 4.1: Create `src/js/components/telemetry-hud.js`**
  Build:
  - Status bar widget showing live TPS, VRAM, and CPU load.
  - Slide-over HUD panel with real-time HTML5 Canvas showing 60-second rolling graph of Tokens/Sec vs. VRAM & Compute heat.
  - Breakdown cards for Ollama VRAM allocation vs OS System RAM.
- [ ] **Step 4.2: Mount Telemetry HUD in `src/js/app.js` and menubar**
  Add live status pill in bottom status bar and Developer dropdown menu (`Telemetry & VRAM HUD`).
- [ ] **Step 4.3: Verify responsiveness across 1080p, tablet, and mobile**

---

## Task 5: The "Time-Travel" Agent Journal (Rust VFS Snapshots)

- [ ] **Step 5.1: Extend `src-tauri/src/workspace.rs` with `AgentPromptTurnSnapshot`**
  - Group file mutations by agent prompt turn into `AgentPromptTurnSnapshot`: `id`, `prompt`, `timestamp`, `files: Vec<FileMutationSnapshot>`, `diff_summary`.
  - Add `record_prompt_turn_start(prompt)` and `record_prompt_turn_end()`.
  - Add `list_prompt_turns() -> Vec<PromptTurnSummary>`.
  - Add `time_travel_rollback_to_turn(turn_id: &str) -> Result<RollbackSummary, String>` to atomically revert the workspace tree to any prior turn.
- [ ] **Step 5.2: Expose commands in `lib.rs`**
  Register `list_agent_turns` and `time_travel_rollback`.
- [ ] **Step 5.3: Unit test atomic rollback in `workspace.rs`**
  Verify multi-file rollback preserves unaffected files and restores modified/deleted files.

---

## Task 6: Visual Time-Travel Timeline Scrubber UI

- [ ] **Step 6.1: Create `src/js/components/time-travel.js`**
  Build:
  - Visual git-like timeline scrubber with interactive slider and clickable turn nodes.
  - Node card showing exact timestamp, user prompt, changed files count, and diff pills (`+line / -line`).
  - Monaco side-by-side diff preview of what will change upon rollback.
  - "Roll Back Workspace to this Minute" confirmation button.
- [ ] **Step 6.2: Integrate into Agent Panel & Menubar**
  - Add "Timeline" tab / button in the agent header.
  - Wire timeline scrubbing to live file-tree and Monaco editor refreshes.
- [ ] **Step 6.3: Verify end-to-end with `npm test` and `cargo test`**

---

## Task 7: Full System Verification & Release Build

- [ ] **Step 7.1: Run full verification suite**
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `npm test`
  - `npm run build`
- [ ] **Step 7.2: Build latest installer**
  - Run `npm run tauri build` to generate `release/Orbital.X_2.3.0_x64-setup.exe`.
- [ ] **Step 7.3: Git commit and sync**
  - Clean commit on `claude/forge` and fast-forward `main`.
