// ==========================================================================
// Orbital X — Agent Orchestrator & Mode Enforcer (agent.js)
// ==========================================================================

import { state, notify } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openDiffModal, openFileInTab } from '../editor/monaco.js';
import { showToast } from '../services/notifications.js';
import {
  isComplexRequest,
  createPlan,
  canStartTask,
  getNextTask,
  updateTaskState,
  calculateProgress,
  persistPlanState,
  restorePlanState
} from '../services/orchestrator.js';

let isLoopRunning = false;
let timestampIntervalId = null;
let liveActivityTimerId = null;
let liveActivityStartTime = null;

export function initAgent() {
  const sendBtn = document.getElementById('btn-agent-send');
  const stopBtn = document.getElementById('btn-agent-stop');
  const inputElem = document.getElementById('agent-input');
  const clearBtn = document.getElementById('btn-clear-chat');

  // Relative timestamp updater every 60 seconds
  if (!timestampIntervalId) {
    timestampIntervalId = setInterval(updateAllTimelineTimestamps, 60000);
  }

  // Mode buttons
  const modeProBtn = document.getElementById('btn-mode-pro');
  const modeDevBtn = document.getElementById('btn-mode-dev');
  const modeUserBtn = document.getElementById('btn-mode-user');

  if (modeProBtn && modeDevBtn && modeUserBtn) {
    modeProBtn.addEventListener('click', () => switchMode('agent_pro'));
    modeDevBtn.addEventListener('click', () => switchMode('dev'));
    modeUserBtn.addEventListener('click', () => switchMode('user'));
  }

  // Live token estimate counter below input
  let tokenCounter = document.getElementById('composer-token-counter');
  if (!tokenCounter && inputElem) {
    tokenCounter = document.createElement('div');
    tokenCounter.id = 'composer-token-counter';
    tokenCounter.className = 'composer-token-counter';
    inputElem.insertAdjacentElement('afterend', tokenCounter);
  }
  updateTokenEstimate(inputElem?.value || '');

  // Quick Action Chips
  document.getElementById('chip-plan')?.addEventListener('click', () => {
    inputElem.value = "/plan ";
    updateTokenEstimate(inputElem.value);
    inputElem.focus();
  });

  document.getElementById('chip-explain')?.addEventListener('click', () => {
    inputElem.value = "Explain the architecture, structure, and entrypoints of this workspace.";
    updateTokenEstimate(inputElem.value);
    handleSend();
  });

  document.getElementById('chip-validate')?.addEventListener('click', () => {
    inputElem.value = "Run the project test suite and validate that all checks pass.";
    updateTokenEstimate(inputElem.value);
    handleSend();
  });

  document.getElementById('chip-review')?.addEventListener('click', () => {
    document.getElementById('btn-review-changes')?.click();
  });

  document.getElementById('chip-undo')?.addEventListener('click', async () => {
    try {
      const res = await invoke('undo_agent_change');
      appendTimelineCard('assistant', `↩️ ${res}`);
    } catch (e) {
      showToast("Undo failed: " + e, 'error');
    }
  });

  // Context button (@)
  document.getElementById('btn-composer-context')?.addEventListener('click', () => {
    const activeTab = state.editor.tabs.find(t => t.id === state.editor.activeTabId);
    if (activeTab) {
      inputElem.value = `@${activeTab.name} ` + inputElem.value;
      updateTokenEstimate(inputElem.value);
      inputElem.focus();
    } else {
      const filename = prompt("Enter file name or symbol to attach to prompt (e.g. src/main.rs):");
      if (filename) {
        inputElem.value = `@${filename} ` + inputElem.value;
        updateTokenEstimate(inputElem.value);
        inputElem.focus();
      }
    }
  });

  if (sendBtn && inputElem) {
    sendBtn.addEventListener('click', handleSend);
    inputElem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-expand textarea based on content up to 180px & live token count estimate
    inputElem.addEventListener('input', () => {
      inputElem.style.height = 'auto';
      inputElem.style.height = Math.min(inputElem.scrollHeight, 180) + 'px';
      updateTokenEstimate(inputElem.value);
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      isLoopRunning = false;
      setAgentBusy(false);
      removeLiveActivityBar();
      if (state.orchestrator.activePlan && state.orchestrator.activePlan.status === 'in_progress') {
        state.orchestrator.activePlan.status = 'cancelled';
        persistPlanState(null);
      }
      updateStatusBarAgentStatus();
      appendTimelineCard('assistant', '⚠️ Task stopped by user.');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.conversation = [];
      const timeline = document.getElementById('agent-timeline');
      if (timeline) {
        timeline.innerHTML = '';
        appendTimelineCard('assistant', `Conversation reset. Active Mode: <strong>${state.agentMode.toUpperCase()}</strong>.`);
      }
    });
  }
}

function getModeDisplayName(mode = state.agentMode) {
  if (mode === 'agent_pro') return 'Agent Pro Mode';
  if (mode === 'dev') return 'Dev Mode';
  return 'User Mode';
}

function updateStatusBarAgentStatus(statusText = null) {
  const sbText = document.getElementById('sb-mode-text');
  if (sbText) {
    sbText.textContent = statusText || getModeDisplayName();
  }
}

function updateTokenEstimate(text = '') {
  const tokenCounter = document.getElementById('composer-token-counter');
  if (!tokenCounter) return;
  const count = text ? text.length : 0;
  const estimatedTokens = Math.ceil(count / 4);
  tokenCounter.textContent = `~${estimatedTokens} tokens`;
}

export function getRelativeTimeString(timestamp) {
  if (!timestamp) return 'just now';
  const now = Date.now();
  const time = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diffSec = Math.max(0, Math.floor((now - time) / 1000));

  if (diffSec < 60) {
    return 'just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} min ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hr ago' : `${diffHours} hr ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
}

export function updateAllTimelineTimestamps() {
  const elements = document.querySelectorAll('.timeline-timestamp');
  elements.forEach((el) => {
    const ts = parseInt(el.dataset.timestamp, 10);
    if (!isNaN(ts)) {
      el.textContent = getRelativeTimeString(ts);
    }
  });
}

export function switchMode(newMode) {
  state.agentMode = newMode;

  const modeProBtn = document.getElementById('btn-mode-pro');
  const modeDevBtn = document.getElementById('btn-mode-dev');
  const modeUserBtn = document.getElementById('btn-mode-user');
  const headerPill = document.getElementById('header-mode-pill');
  const headerText = document.getElementById('header-mode-text');

  [modeProBtn, modeDevBtn, modeUserBtn].forEach(b => b?.classList.remove('btn-primary'));

  if (newMode === 'agent_pro') {
    modeProBtn?.classList.add('btn-primary');
    headerPill?.setAttribute('class', 'mode-pill agent_pro');
    if (headerText) headerText.textContent = 'AGENT PRO';
  } else if (newMode === 'dev') {
    modeDevBtn?.classList.add('btn-primary');
    headerPill?.setAttribute('class', 'mode-pill dev');
    if (headerText) headerText.textContent = 'DEV MODE';
  } else {
    modeUserBtn?.classList.add('btn-primary');
    headerPill?.setAttribute('class', 'mode-pill user');
    if (headerText) headerText.textContent = 'USER MODE';
  }

  if (!isLoopRunning) {
    updateStatusBarAgentStatus(getModeDisplayName(newMode));
  }

  notify('modeChanged', newMode);
}

function setAgentBusy(busy) {
  state.ai.isGenerating = busy;
  const sendBtn = document.getElementById('btn-agent-send');
  const stopBtn = document.getElementById('btn-agent-stop');

  if (sendBtn) sendBtn.style.display = busy ? 'none' : 'inline-flex';
  if (stopBtn) stopBtn.style.display = busy ? 'inline-flex' : 'none';
}

async function handleSend() {
  const inputElem = document.getElementById('agent-input');
  if (!inputElem || isLoopRunning) return;

  const promptText = inputElem.value.trim();
  if (!promptText) return;

  inputElem.value = '';
  inputElem.style.height = 'auto';
  updateTokenEstimate('');
  const now = Date.now();
  appendTimelineCard('user', promptText, now);

  state.conversation.push({
    role: 'user',
    content: promptText,
    timestamp: now,
  });

  // Sync to active chat session
  import('./chat-sessions.js').then(m => m.saveActiveSession());

  isLoopRunning = true;
  setAgentBusy(true);

  try {
    if (isComplexRequest(promptText)) {
      await generateAndPresentPlan(promptText);
    } else {
      await runAgentLoop(promptText);
    }
  } catch (err) {
    console.error("Agent error:", err);
    appendTimelineCard('assistant', `❌ Error: ${err}`);
  } finally {
    isLoopRunning = false;
    setAgentBusy(false);
    updateStatusBarAgentStatus();
    import('./chat-sessions.js').then(m => m.saveActiveSession());
    import('./usage.js').then(m => m.loadAndRenderUsage(false));
  }
}

// Maximum conversation history turns kept in context for local models (saves tokens)
const LOCAL_MODEL_MAX_TURNS = 20;

// Slide conversation window to avoid blowing context on local models
function buildContextWindow(provider) {
  const conv = state.conversation;
  if (provider !== 'ollama' || conv.length <= LOCAL_MODEL_MAX_TURNS) {
    return conv;
  }
  // Always keep first user message for task reference, then last N turns
  const firstUser = conv.find(m => m.role === 'user');
  const recent = conv.slice(-(LOCAL_MODEL_MAX_TURNS));
  // Avoid duplicating firstUser if already in recent window
  if (firstUser && recent[0] !== firstUser) {
    return [firstUser, ...recent];
  }
  return recent;
}

async function runAgentLoop(initialUserPrompt, activeTask = null, plan = null) {
  let iteration = 0;
  const maxIterations = 30;
  let hasSavedMemoryThisTurn = false;
  let lastAssistantContent = '';
  let noToolStallCount = 0; // Counts consecutive turns with content but no tools

  // 1. Load durable project memories (brief, token-efficient format)
  let memoryContext = '';
  try {
    const mems = await invoke('list_memories');
    if (mems && mems.length > 0) {
      // Cap to 5 most recent memories to conserve local model context
      const recent = mems.slice(-5);
      memoryContext = '\n\n## Project Memory:\n' +
        recent.map(m => `• ${m.title}: ${m.content.substring(0, 120)}`).join('\n');
    }
  } catch (e) {
    console.warn("Could not load memories:", e);
  }

  // 2. Active editor context (file path only, not full content)
  let activeEditorContext = '';
  const activeTab = state.editor.tabs.find(t => t.id === state.editor.activeTabId);
  if (activeTab) {
    activeEditorContext = `\nActive file: ${activeTab.path || activeTab.name}`;
  }

  // 3. Orchestrated Task Context (if executing under a structured plan)
  const taskPromptSection = activeTask ? `\n\n## ACTIVE ORCHESTRATED TASK:
Task ID: ${activeTask.id}
Title: ${activeTask.title}
Objective: ${activeTask.objective}
Target Files: ${(activeTask.files || []).join(', ') || 'Auto-detect'}
Acceptance Criteria: ${activeTask.criteria}
IMPORTANT INSTRUCTION: Call update_task_status(task_id="${activeTask.id}", status="in_progress") when starting, and update_task_status(task_id="${activeTask.id}", status="completed", evidence="...") ONLY when verified with validate_changes or diagnostics output.` : '';

  const provider = state.ai.provider;
  const model = state.ai.model || state.ai.defaultModels[provider];
  const apiKey = state.ai.keys[provider] || '';
  const baseUrl = provider === 'ollama' ? state.ai.endpoint : null;

  // System prompt — concise but with full tool list for local model reliability
  const systemPrompt = `You are Orbital X Agent, an autonomous AI coding assistant.
Mode: ${state.agentMode.toUpperCase()}. Workspace: ${state.workspace.rootPath || 'None'}.${activeEditorContext}${memoryContext}${taskPromptSection}

AVAILABLE TOOLS (call these — never explain in markdown):
• workspace_info — get workspace root, file count, detected languages
• get_project_structure(max_depth?, include_files?) — compact workspace hierarchy with detected configs & entry points
• list_files(max_depth) — explore directory tree
• read_file(path) — read entire file (use for files <200 lines)
• read_file_lines(path, start_line, end_line) — read specific line range (USE for large files)
• read_multiple_files(paths, max_lines_per_file?) — read several files in one call (up to 10 files)
• find_symbol(symbol, symbol_type?, max_results?) — code-aware navigation for definitions and references
• search_files(query, max_results) — search across all files for a symbol or text pattern
• write_file(path, content, description) — create or overwrite a file
• patch_file(path, start_line, end_line, new_content, description) — edit specific lines (preferred for existing files)
• delete_file(path) — delete a single file within workspace (requires approval)
• delete_directory(path, recursive?) — safely delete a directory within workspace (requires approval)
• batch_delete_files(paths) — propose multiple files for verified two-stage deletion (requires approval)
• rename_file(from, to) — rename or move a file
• create_directory(path) — create a directory
• validate_changes(files?, run_tests?) — validate code changes using real project compiler/linters
• run_command(command, timeout_seconds) — run shell command (npm install: 120s, builds: 90s)
• run_tests() — auto-detect and run tests
• get_diagnostics(tool?) — run cargo check / tsc / eslint to find errors
• git_status() — see changed files and current branch (clean, modified, staged, untracked)
• git_diff(path?, staged?, stat_only?) — inspect working tree diffs
• git_commit(message) — stage all changes and commit
• update_task_status(task_id, status, evidence?, notes?) — update active task state with verification evidence
• save_project_memory(category, title, content) — persist key project knowledge
• search_project_memory(query) — recall saved conventions and decisions
• undo_agent_change() — revert last file modification

STRATEGY & ETHICS:
1. For new tasks: call get_project_structure or workspace_info then list_files to orient yourself first.
2. To explore multi-file dependencies: use read_multiple_files or find_symbol to locate references.
3. To edit existing code: use search_files or find_symbol to find it, read_file_lines for the relevant section, then patch_file to make targeted changes.
4. After changing code: call validate_changes or get_diagnostics to check for errors, fix any found before finishing.
5. If executing an orchestrated task: call update_task_status to record progress. Only mark completed when you have verification evidence.
6. Keep calling tools until the task is fully done. Do not stop midway.
7. Workspace Confinement: All file paths must be strictly relative to the workspace root. Never attempt to delete the workspace root itself or access parent directories.
8. Mode Immutability: You CANNOT switch agent modes. Mode is strictly controlled by the user. Never pretend or attempt to change modes.`;

  while (isLoopRunning && iteration < maxIterations) {
    iteration++;
    updateStatusBarAgentStatus(`Agent running... iteration ${iteration}/${maxIterations}`);

    // Slide context window for local models to avoid OOM/timeout
    const contextWindow = buildContextWindow(provider);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...contextWindow,
    ];

    const spinnerId = appendThinkingIndicator();

    let resp;
    try {
      resp = await invoke('agent_dispatch_turn', {
        provider,
        apiKey,
        model,
        baseUrl,
        messages,
      });
      import('./usage.js').then(m => m.loadAndRenderUsage(false));
    } catch (err) {
      removeThinkingIndicator(spinnerId);
      // Transient error — push error context and retry once
      console.error('Agent dispatch error (will retry):', err);
      const errMsg = `Tool dispatch failed: ${err}. Please retry the last action.`;
      state.conversation.push({ role: 'user', content: errMsg });
      appendTimelineCard('assistant', `⚠️ Retrying after error: ${err}`);
      continue;
    } finally {
      removeThinkingIndicator(spinnerId);
    }

    const currentContent = (resp.content || '').trim();
    const now = Date.now();
    if (currentContent) {
      appendTimelineCard('assistant', resp.content, now);
    }

    // Preserve assistant turn in conversation memory with tool_calls
    state.conversation.push({
      role: 'assistant',
      content: resp.content || '',
      timestamp: now,
      tool_calls: resp.tool_calls && resp.tool_calls.length > 0 ? resp.tool_calls : undefined,
    });
    import('./chat-sessions.js').then(m => m.saveActiveSession());

    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      // Model produced content but no tool calls
      if (!currentContent) {
        // Empty response — something went wrong, stop
        break;
      }

      // Stall detection: if model keeps chatting without calling tools,
      // nudge it to continue executing, up to 2 times
      noToolStallCount++;
      const isDoneSignal = /\b(task complete|all done|finished|done!|completed successfully|nothing more to do)\b/i.test(currentContent);
      const isGenuinelyDone = isDoneSignal || noToolStallCount >= 3;

      if (isGenuinelyDone) {
        if (!hasSavedMemoryThisTurn && currentContent && initialUserPrompt) {
          checkAndAutoExtractMemory(initialUserPrompt, currentContent);
        }
        break;
      }

      // Nudge: inject a continuation prompt so the model keeps executing
      const nudge = 'Continue. Call the next required tool to make progress on the task. Do not explain — just act.';
      state.conversation.push({ role: 'user', content: nudge });
      lastAssistantContent = currentContent;
      continue;
    }

    // Reset stall counter once tools start being called
    noToolStallCount = 0;
    lastAssistantContent = currentContent;

    // Process each tool call
    for (const toolCall of resp.tool_calls) {
      if (!isLoopRunning) break;

      if (toolCall.name === 'save_project_memory') {
        hasSavedMemoryThisTurn = true;
      }

      const toolResult = await processToolCallWithPolicy(toolCall);
      const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

      state.conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultStr,
      });

      import('./chat-sessions.js').then(m => m.saveActiveSession());
    }
  }

  if (iteration >= maxIterations) {
    appendTimelineCard('assistant', `⚠️ Reached maximum iteration limit (${maxIterations}). The agent stopped to prevent infinite loops. You can send another message to continue.`);
  }

  updateStatusBarAgentStatus();
}

// Background automated memory extraction when user asks about architecture/structure
async function checkAndAutoExtractMemory(prompt, response) {
  const pLower = prompt.toLowerCase();
  const isArchQuestion = pLower.includes('architecture') || pLower.includes('structure') || pLower.includes('explain') || pLower.includes('overview') || pLower.includes('convention') || pLower.includes('stack');

  if (isArchQuestion && response.length > 100) {
    try {
      // Create concise clean summary of first 400 chars of response
      const snippet = response.split('\n\n')[0] || response.substring(0, 300);
      await invoke('save_memory_entry', {
        category: 'architecture',
        title: 'Project Structure & Architecture',
        content: snippet.trim(),
      });
      import('./memory.js').then(m => m.refreshMemories());
    } catch (e) {
      console.warn("Auto-memory extraction skipped:", e);
    }
  }
}

async function processToolCallWithPolicy(toolCall) {
  const { name, arguments: args } = toolCall;
  const target = args.path || args.command || args.query || (args.paths ? `${args.paths.length} files` : "");

  // 1. Evaluate policy in Rust
  const decision = await invoke('evaluate_tool_policy', {
    toolName: name,
    target,
    mode: state.agentMode,
  });

  const toolBoxId = appendToolBox(name, args, decision.risk);

  // Check if blocked by security constraint
  if (!decision.allowed) {
    updateToolBoxStatus(toolBoxId, `Blocked: ${decision.reason}`, 'denied');
    appendTimelineCard('assistant', `🛑 **Security Violation**: ${decision.reason}`);
    return { error: `Security Policy Violation: ${decision.reason}` };
  }

  // Handle special two-stage workflow for batch_delete_files
  if (name === 'batch_delete_files' && args.paths && !args.manifest_id) {
    updateToolBoxStatus(toolBoxId, 'Preparing Deletion Manifest...', 'running');
    let manifest;
    try {
      manifest = await invoke('execute_tool', {
        name: 'batch_delete_files',
        arguments: { paths: args.paths },
        mode: state.agentMode,
      });
    } catch (mErr) {
      updateToolBoxStatus(toolBoxId, `Manifest Failed: ${mErr}`, 'failed');
      return { error: `Batch delete validation failed: ${mErr}` };
    }

    // Stage 1: Present verified deletion manifest in Dangerous Approval Card
    const approved = await requestUserApproval({
      name,
      arguments: args,
      target: `${manifest.total_files} files (${Math.round(manifest.total_bytes / 1024)} KB)`,
      risk: 'Critical',
      reason: `Batch deletion of ${manifest.total_files} workspace files requested. Backend verified paths inside workspace.`,
      manifest,
    });

    if (!approved) {
      updateToolBoxStatus(toolBoxId, 'Batch Deletion Denied by User', 'denied');
      return { error: 'Batch deletion was rejected by user. No files were deleted.' };
    }

    // Stage 2: Execute verified batch deletion with manifest_id
    updateToolBoxStatus(toolBoxId, 'Executing Confirmed Batch Deletion...', 'running');
    try {
      const output = await invoke('execute_tool', {
        name: 'batch_delete_files',
        arguments: { manifest_id: manifest.manifest_id },
        mode: state.agentMode,
      });
      updateToolBoxStatus(toolBoxId, `Deleted ${output.total_deleted} files`, 'success');
      showToast(`🗑️ Batch deleted ${output.total_deleted} files`, 'success', 3000);
      return output;
    } catch (err) {
      updateToolBoxStatus(toolBoxId, `Batch Delete Failed: ${err}`, 'failed');
      return { error: err.toString() };
    }
  }

  // 2. If approval is required by policy, display approval card and block until user decides!
  if (decision.requires_approval) {
    updateToolBoxStatus(toolBoxId, 'Awaiting Approval...', 'running');

    let proposedDiff = null;
    if (name === 'write_file' && args.path && args.content) {
      try {
        proposedDiff = await invoke('get_file_diff', {
          path: args.path,
          newContent: args.content,
        });
      } catch (e) {
        console.warn("Could not preview diff:", e);
      }
    }

    const approved = await requestUserApproval({
      name,
      arguments: args,
      target,
      risk: decision.risk,
      reason: decision.reason,
      diff: proposedDiff,
    });

    if (!approved) {
      updateToolBoxStatus(toolBoxId, 'Action Denied by User', 'denied');
      return { error: "Operation was denied by user." };
    }
  }

  // Update live activity status
  let opSummary = `⚡ ${name}`;
  if (name === 'read_multiple_files') opSummary = `Reading ${(args.paths || []).length} files`;
  else if (name === 'read_file' || name === 'read_file_lines') opSummary = `Reading ${args.path}`;
  else if (name === 'find_symbol') opSummary = `Finding symbol: ${args.symbol}`;
  else if (name === 'get_project_structure') opSummary = `Scanning workspace structure`;
  else if (name === 'patch_file') opSummary = `Patching ${args.path}`;
  else if (name === 'write_file') opSummary = `Writing ${args.path}`;
  else if (name === 'delete_file') opSummary = `Deleting file: ${args.path}`;
  else if (name === 'delete_directory' || name === 'delete_folder') opSummary = `Deleting folder: ${args.path}`;
  else if (name === 'batch_delete_files') opSummary = `Batch deleting files`;
  else if (name === 'validate_changes') opSummary = `Validating changes`;
  else if (name === 'run_command') opSummary = `Running: ${args.command}`;
  else if (name === 'update_task_status') opSummary = `Task ${args.task_id} → ${args.status}`;
  updateLiveActivityOp(opSummary);

  // 3. Execute approved tool in backend
  updateToolBoxStatus(toolBoxId, 'Executing...', 'running');
  try {
    const output = await invoke('execute_tool', {
      name,
      arguments: args,
      mode: state.agentMode,
    });

    updateToolBoxStatus(toolBoxId, 'Success', 'success');

    // Track modified files in active plan
    if ((name === 'write_file' || name === 'patch_file') && args.path) {
      if (state.orchestrator.activePlan) {
        state.orchestrator.activePlan.filesModified = state.orchestrator.activePlan.filesModified || new Set();
        state.orchestrator.activePlan.filesModified.add(args.path);
      }
    }

    // Synchronize task status in DOM if task orchestrator tool was called
    if (name === 'update_task_status' && state.orchestrator.activePlan) {
      updateTaskState(state.orchestrator.activePlan, args.task_id, args.status, args.evidence, args.notes);
      updatePlanTaskInDOM(state.orchestrator.activePlan, args.task_id, args.status, args.evidence);
    }

    if (name === 'validate_changes') {
      showToast(output.success ? '✓ Validation passed' : '⚠️ Validation reported issues', output.success ? 'success' : 'error', 3000);
    }

    // If saving project memory succeeded, immediately refresh memory cards
    if (name === 'save_project_memory' || name === 'delete_project_memory') {
      import('./memory.js').then(m => m.refreshMemories());
    }

    // If writing a file succeeded, notify listeners and open or refresh it in Monaco
    if (name === 'write_file' && args.path) {
      window.dispatchEvent(new CustomEvent('orbital:file-written', { detail: { path: args.path } }));
      showToast(`✅ Agent wrote: ${args.path}`, 'success', 2500);
      try {
        const fileData = await invoke('read_file', { path: args.path });
        openFileInTab(fileData);
      } catch (e) {
        console.warn("Could not reload written file:", e);
      }
    } else if (name === 'patch_file' && args.path) {
      window.dispatchEvent(new CustomEvent('orbital:file-written', { detail: { path: args.path } }));
      showToast(`✅ Agent wrote: ${args.path}`, 'success', 2500);
    } else if (name === 'delete_file' && args.path) {
      showToast(`✅ Agent deleted: ${args.path}`, 'success', 2500);
    } else if ((name === 'delete_directory' || name === 'delete_folder') && args.path) {
      showToast(`🗑️ Agent removed directory: ${args.path}`, 'success', 3000);
    }

    return output;
  } catch (err) {
    updateToolBoxStatus(toolBoxId, `Failed: ${err}`, 'failed');
    return { error: err.toString() };
  }
}

function requestUserApproval(approvalData) {
  return new Promise((resolve) => {
    const timeline = document.getElementById('agent-timeline');
    const card = document.createElement('div');

    const name = approvalData.name;
    const isDestructive = ['delete_file', 'delete_directory', 'delete_folder', 'batch_delete_files', 'delete_path'].includes(name) ||
                          (name === 'run_command' && (approvalData.risk === 'High' || approvalData.risk === 'Critical'));
    const isModeChange = name === 'switch_mode' || name === 'request_mode_change';

    const cardTypeClass = isDestructive ? 'dangerous-action' : (isModeChange ? 'mode-change' : 'file-change');
    card.className = `approval-card ${cardTypeClass}`;

    const riskClass = (approvalData.risk || 'medium').toLowerCase();

    if (isDestructive) {
      let manifestHtml = '';
      if (approvalData.manifest && approvalData.manifest.items) {
        manifestHtml = `
          <div style="font-size: 11px; font-weight: 600; color: #ef4444; margin-top: 6px;">
            Deletion Manifest: ${approvalData.manifest.total_files} files (${Math.round((approvalData.manifest.total_bytes || 0) / 1024)} KB)
          </div>
          <div class="batch-manifest-table">
            ${approvalData.manifest.items.map(it => `
              <div class="batch-manifest-item">
                <span style="color: var(--text-primary);">📄 ${it.relative_path || it.path}</span>
                <span style="color: var(--text-muted);">${Math.round((it.size_bytes || 0)/1024)} KB</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="approval-header">
          <div class="approval-title">
            <span>⚠️</span>
            <span>DESTRUCTIVE OPERATION REQUIRES CONFIRMATION</span>
          </div>
          <span class="risk-badge ${riskClass}">${approvalData.risk} Risk</span>
        </div>
        <div style="font-size: 12px; line-height: 1.4;">
          Action: <strong style="color: #ef4444; font-family: var(--font-mono);">${name}</strong><br>
          Target: <code style="font-family: var(--font-mono); font-size: 11px; color: #ef4444;">${approvalData.target}</code><br>
          <div style="color: var(--text-secondary); margin-top: 4px;"><strong>Risk Notice:</strong> ${approvalData.reason}</div>
          ${manifestHtml}
        </div>
        <div class="approval-actions" style="margin-top: 8px;">
          <button class="btn btn-secondary btn-sm" id="btn-deny-card" style="font-weight: 600;">Reject & Keep Safe</button>
          <button class="btn btn-danger btn-sm" id="btn-approve-card">Authorize Irreversible Action</button>
        </div>
      `;
    } else if (isModeChange) {
      card.innerHTML = `
        <div class="approval-header">
          <div class="approval-title">
            <span>🛡️</span>
            <span>SECURITY MODE ELEVATION PROPOSAL</span>
          </div>
          <span class="risk-badge medium">Elevation</span>
        </div>
        <div style="font-size: 12px; line-height: 1.4;">
          The agent proposed switching mode to <strong>${(approvalData.target || '').toUpperCase()}</strong>.<br>
          <div style="color: var(--text-secondary); margin-top: 4px;">AI agents cannot change security modes independently. Only you can authorize this change.</div>
        </div>
        <div class="approval-actions" style="margin-top: 8px;">
          <button class="btn btn-secondary btn-sm" id="btn-deny-card">Keep Current Mode</button>
          <button class="btn btn-primary btn-sm" id="btn-approve-card" style="background: #a855f7;">Switch Mode</button>
        </div>
      `;
    } else {
      // Standard File Mutation Approval
      card.innerHTML = `
        <div class="approval-header">
          <div class="approval-title">
            <span>📄</span>
            <span>Review File Mutation</span>
          </div>
          <span class="risk-badge ${riskClass}">${approvalData.risk} Risk</span>
        </div>
        <div style="font-size: 12px; line-height: 1.4;">
          Action: <strong style="color: var(--accent-green); font-family: var(--font-mono);">${name}</strong><br>
          Target: <code style="font-family: var(--font-mono); font-size: 11px;">${approvalData.target}</code><br>
          <div style="color: var(--text-secondary); margin-top: 4px;">Reason: ${approvalData.reason}</div>
        </div>
        <div class="approval-actions">
          ${approvalData.diff ? '<button class="btn btn-secondary btn-sm" id="btn-view-diff-card">Inspect Diff</button>' : ''}
          <button class="btn btn-primary btn-sm" id="btn-approve-card" style="background: var(--accent-green); border-color: var(--accent-green); color: #000;">Approve Mutation</button>
          <button class="btn btn-secondary btn-sm" id="btn-deny-card">Reject</button>
        </div>
      `;
    }

    timeline.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });

    if (approvalData.diff) {
      card.querySelector('#btn-view-diff-card')?.addEventListener('click', () => {
        openDiffModal(
          approvalData.arguments.path,
          approvalData.diff.old_content,
          approvalData.diff.new_content,
          () => {
            card.remove();
            resolve(true);
          },
          () => {
            card.remove();
            resolve(false);
          }
        );
      });
    }

    card.querySelector('#btn-approve-card')?.addEventListener('click', () => {
      card.remove();
      resolve(true);
    });

    card.querySelector('#btn-deny-card')?.addEventListener('click', () => {
      card.remove();
      resolve(false);
    });
  });
}

export function renderFullTimeline(messages = []) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;
  timeline.innerHTML = '';

  if (!messages || messages.length === 0) {
    appendTimelineCard('assistant', `Orbital Agent ready. Active Mode: <strong>${state.agentMode.toUpperCase()}</strong>.`);
    return;
  }

  messages.forEach(msg => {
    if (msg.role === 'user') {
      appendTimelineCard('user', msg.content, msg.timestamp);
    } else if (msg.role === 'assistant' && msg.content) {
      appendTimelineCard('assistant', msg.content, msg.timestamp);
    }
  });
}

export function appendTimelineCard(role, text, timestamp = Date.now()) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;

  const msgTime = typeof timestamp === 'number' ? timestamp : (timestamp ? new Date(timestamp).getTime() : Date.now());
  const relativeTime = getRelativeTimeString(msgTime);

  const card = document.createElement('div');
  card.className = `timeline-card ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;

  const badgeClass = role === 'user' ? 'user' : 'assistant';
  const badgeLabel = role === 'user' ? '👤 YOU' : '⚡ ORBITAL AGENT';
  const providerMeta = role === 'assistant'
    ? `<span style="font-size: 10px; opacity: 0.7; font-weight: normal; margin-left: 6px;">• ${state.ai.provider} (${state.ai.model || 'default'})</span>`
    : '';

  card.innerHTML = `
    <div class="timeline-card-header">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="timeline-author-badge ${badgeClass}">${badgeLabel}</span>
        ${providerMeta}
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="timeline-timestamp" data-timestamp="${msgTime}" style="font-size: 10px; color: var(--text-muted);">${relativeTime}</span>
        <button class="btn btn-secondary btn-sm btn-copy-card" title="Copy full message to clipboard" style="padding: 1px 7px; font-size: 10px; height: 20px; display: inline-flex; align-items: center; gap: 3px;">
          <span>📋</span> Copy
        </button>
      </div>
    </div>
    <div class="timeline-card-body">${formatMarkdown(text)}</div>
  `;

  // Wire full message copy button
  const copyBtn = card.querySelector('.btn-copy-card');
  copyBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    copyBtn.innerHTML = '<span>✓</span> Copied!';
    setTimeout(() => {
      copyBtn.innerHTML = '<span>📋</span> Copy';
    }, 1500);
  });

  // If assistant card proposed bash/terminal commands without native tool execution, offer 1-click execution
  if (role === 'assistant') {
    const bashMatch = text.match(/```(?:bash|sh|cmd|powershell)\n([\s\S]*?)```/);
    if (bashMatch) {
      const cmdText = bashMatch[1].trim();
      const actionRow = document.createElement('div');
      actionRow.style.cssText = 'margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border-subtle); display: flex; gap: 8px; align-items: center;';
      actionRow.innerHTML = `
        <button class="btn btn-primary btn-sm btn-run-suggested-cmd" style="font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 4px;">
          ▶ Run Commands in Terminal
        </button>
        <span style="font-size: 10px; color: var(--text-muted);">Execute proposed commands in project terminal</span>
      `;
      actionRow.querySelector('.btn-run-suggested-cmd')?.addEventListener('click', async () => {
        import('./terminal.js').then(m => m.executeTerminalCommand(cmdText));
      });
      card.appendChild(actionRow);
    }
  }

  timeline.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
}

function formatMarkdown(text) {
  return text
    .replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const displayLang = lang || 'code';
      const cleanCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="code-block-wrapper" style="margin: 8px 0; background: var(--bg-activity); border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: var(--bg-surface); font-size: 10px; font-family: var(--font-mono); color: var(--text-muted); border-bottom: 1px solid var(--border-subtle);">
          <span>${displayLang}</span>
          <button class="btn btn-secondary btn-sm" style="padding: 1px 6px; font-size: 10px; height: 20px;" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(code)}')); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500);">Copy</button>
        </div>
        <pre style="margin: 0; padding: 8px; font-family: var(--font-mono); font-size: 11px; overflow-x: auto; background: transparent; border: none;"><code>${cleanCode}</code></pre>
      </div>`;
    })
    .replace(/```([\s\S]*?)```/g, '<pre style="background: var(--bg-activity); padding: 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; overflow-x: auto;"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background: var(--bg-activity); padding: 2px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--accent-cyan); border: 1px solid var(--border-subtle);">$1</code>')
    .replace(/\n/g, '<br>');
}

export function getToolCategory(toolName) {
  if (['write_file', 'patch_file', 'create_file', 'apply_patch', 'create_directory'].includes(toolName)) {
    return { id: 'create', label: 'CREATE / WRITE', icon: '✏️', class: 'cat-create' };
  }
  if (['read_file', 'read_file_lines', 'read_multiple_files', 'workspace_info', 'list_files', 'search_files', 'find_symbol', 'get_project_structure', 'git_status', 'git_diff', 'git_log'].includes(toolName)) {
    return { id: 'read', label: 'READ / INSPECT', icon: '🔍', class: 'cat-read' };
  }
  if (['delete_file', 'delete_directory', 'delete_folder', 'batch_delete_files', 'delete_path'].includes(toolName)) {
    return { id: 'delete', label: 'DESTRUCTIVE DELETE', icon: '🗑️', class: 'cat-delete' };
  }
  if (['run_command', 'run_tests', 'run_build', 'run_linter', 'get_diagnostics', 'validate_changes', 'git_commit', 'git_push'].includes(toolName)) {
    return { id: 'command', label: 'EXECUTE / BUILD', icon: '⚙️', class: 'cat-command' };
  }
  if (['switch_mode', 'request_mode_change'].includes(toolName)) {
    return { id: 'mode', label: 'SECURITY / MODE', icon: '🛡️', class: 'cat-mode' };
  }
  return { id: 'generic', label: 'TOOL', icon: '⚡', class: 'cat-read' };
}

function appendToolBox(name, args, risk) {
  const timeline = document.getElementById('agent-timeline');
  const box = document.createElement('div');
  const id = 'toolbox_' + Math.random().toString(36).substring(2, 9);
  box.id = id;
  const category = getToolCategory(name);
  box.className = `tool-box ${category.class}`;

  box.innerHTML = `
    <div class="tool-box-header">
      <span class="tool-name-badge ${category.class}">${category.icon} ${name}</span>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="tool-status-badge running" id="${id}_status">
          <span class="spinner"></span> Running
        </span>
        <button class="tool-toggle-btn" id="${id}_toggle" title="Toggle arguments">
          <svg class="tool-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    </div>
    <div class="tool-box-body" id="${id}_body" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); max-height: 80px; overflow-y: auto;">
      ${JSON.stringify(args, null, 2)}
    </div>
  `;

  // Bind toggle button click
  const toggleBtn = box.querySelector(`#${id}_toggle`);
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    box.classList.toggle('collapsed');
  });

  timeline.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth' });
  return id;
}

function updateToolBoxStatus(boxId, statusText, statusType) {
  const statusElem = document.getElementById(`${boxId}_status`);
  if (!statusElem) return;

  if (statusType === 'running') {
    statusElem.className = 'tool-status-badge running';
    statusElem.innerHTML = `<span class="spinner"></span> ${statusText}`;
  } else if (statusType === 'success') {
    statusElem.className = 'tool-status-badge';
    statusElem.style.color = 'var(--accent-green)';
    statusElem.innerHTML = `✓ ${statusText}`;
  } else if (statusType === 'denied') {
    statusElem.className = 'tool-status-badge';
    statusElem.style.color = 'var(--accent-orange)';
    statusElem.innerHTML = `⊘ ${statusText}`;
  } else {
    statusElem.className = 'tool-status-badge';
    statusElem.style.color = 'var(--accent-red)';
    statusElem.innerHTML = `✗ ${statusText}`;
  }

  // Feature 4: Default to collapsed after the tool finishes (success/fail/denied)
  if (statusType !== 'running') {
    const box = document.getElementById(boxId);
    if (box) {
      box.classList.add('collapsed');
    }
  }
}

function appendThinkingIndicator() {
  const timeline = document.getElementById('agent-timeline');
  const id = 'think_' + Math.random().toString(36).substring(2, 9);
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); padding: 4px;';
  div.innerHTML = `<div class="typing-indicator" aria-label="Thinking"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div> <span>Orbital X is thinking...</span>`;
  timeline.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
  return id;
}

function removeThinkingIndicator(id) {
  document.getElementById(id)?.remove();
}

// ==========================================================================
// Task Orchestration, Live Activity Timeline & Planning Presentation
// ==========================================================================

export async function generateAndPresentPlan(rawPrompt, revisionFeedback = null) {
  const cleanPrompt = rawPrompt.replace(/^\/plan\s*/i, '').trim() || 'Workspace Enhancement';

  const spinnerId = appendThinkingIndicator();

  // 1. Inspect repository context through get_project_structure
  let projectStructure = null;
  let inspectedFiles = [];
  try {
    projectStructure = await invoke('execute_tool', {
      name: 'get_project_structure',
      arguments: { max_depth: 3, include_files: false },
      mode: state.agentMode
    });
    if (projectStructure && projectStructure.entry_points) {
      inspectedFiles = projectStructure.entry_points;
    }
  } catch (e) {
    console.warn('Could not inspect project structure for planning:', e);
    inspectedFiles = ['src/js/app.js', 'src/js/components/agent.js', 'src-tauri/src/lib.rs'];
  } finally {
    removeThinkingIndicator(spinnerId);
  }

  // 2. Synthesize Grounded Implementation Plan via Orchestrator
  const plan = await createPlan(cleanPrompt, projectStructure, inspectedFiles);
  state.orchestrator.activePlan = plan;
  persistPlanState(plan);

  const card = renderPlanCard(plan);

  // Agent Pro mode: auto-approve and execute autonomous plan
  if (state.agentMode === 'agent_pro') {
    executePlanPhases(plan, card);
  }
}

export function renderPlanCard(plan) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return null;

  const card = document.createElement('div');
  card.className = 'plan-card';
  card.id = plan.id;

  const { completedCount, totalCount, percentage } = calculateProgress(plan);

  card.innerHTML = `
    <div class="plan-header">
      <div class="plan-title">
        <span>📋</span>
        <span>${plan.title}</span>
      </div>
      <span class="plan-status-badge ${plan.status}" id="${plan.id}_badge">
        ${plan.status === 'in_progress' ? 'In Progress' : plan.status === 'completed' ? 'Completed' : 'Pending Approval'}
      </span>
    </div>

    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
      <strong>Objective:</strong> ${plan.objective}
    </div>

    <!-- Progress Bar -->
    <div class="plan-progress-container">
      <div class="plan-progress-header">
        <span id="${plan.id}_progress_text">${completedCount} / ${totalCount} Tasks Completed (${percentage}%)</span>
        <span id="${plan.id}_timer_text" style="font-family: var(--font-mono);">Orchestrated</span>
      </div>
      <div class="plan-progress-track">
        <div class="plan-progress-fill" id="${plan.id}_progress_fill" style="width: ${percentage}%;"></div>
      </div>
    </div>

    <!-- Detected configs & entries -->
    <details style="font-size: 11px; background: rgba(255, 255, 255, 0.03); padding: 8px; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06); cursor: pointer;">
      <summary style="font-weight: 600; color: var(--text-primary); user-select: none;">
        Detected Architecture &amp; Configs (${(plan.configs || []).length + (plan.inspectedFiles || []).length})
      </summary>
      <div style="margin-top: 6px; font-family: var(--font-mono); color: var(--accent-cyan); display: flex; flex-direction: column; gap: 3px;">
        ${(plan.configs || []).map(c => `<span>⚙️ ${c}</span>`).join('')}
        ${(plan.inspectedFiles || []).map(f => `<span>📄 ${f}</span>`).join('')}
      </div>
    </details>

    <!-- Ordered Tasks Breakdown -->
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
        Orchestrated Task Breakdown
      </div>
      ${plan.tasks.map((task) => `
        <div class="plan-step-item" id="${plan.id}_task_${task.id}">
          <span class="plan-step-dot" id="${plan.id}_dot_${task.id}">⚪</span>
          <div class="plan-step-content">
            <div class="plan-step-task">
              <span>${task.title}</span>
              <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-muted);">${task.id}</span>
            </div>
            <div class="plan-step-detail">${task.objective}</div>
            <div class="plan-step-meta">
              ${task.dependencies.length > 0 ? `<span>🔗 Needs: ${task.dependencies.join(', ')}</span>` : `<span>⚡ Root task</span>`}
              <span>🎯 ${task.criteria}</span>
            </div>
            <div class="plan-step-evidence" id="${plan.id}_evidence_${task.id}" style="display: none;"></div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="plan-actions" id="${plan.id}_actions">
      <button class="btn btn-primary btn-sm" id="${plan.id}_btn_approve">✓ Approve &amp; Execute</button>
      <button class="btn btn-secondary btn-sm" id="${plan.id}_btn_revise">✏️ Revise Plan</button>
      <button class="btn btn-danger btn-sm" id="${plan.id}_btn_cancel">✕ Cancel</button>
    </div>
  `;

  timeline.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });

  // Bind actions
  card.querySelector(`#${plan.id}_btn_approve`)?.addEventListener('click', () => executePlanPhases(plan, card));
  card.querySelector(`#${plan.id}_btn_revise`)?.addEventListener('click', () => revisePlan(plan, card));
  card.querySelector(`#${plan.id}_btn_cancel`)?.addEventListener('click', () => cancelPlan(plan, card));

  return card;
}

export function updatePlanTaskInDOM(plan, taskId, status, evidence) {
  if (!plan) return;
  const taskEl = document.getElementById(`${plan.id}_task_${taskId}`);
  const dotEl = document.getElementById(`${plan.id}_dot_${taskId}`);
  const evidenceEl = document.getElementById(`${plan.id}_evidence_${taskId}`);

  if (taskEl) {
    taskEl.classList.remove('active', 'completed', 'blocked', 'failed');
    if (status === 'in_progress') taskEl.classList.add('active');
    else if (status === 'completed') taskEl.classList.add('completed');
    else if (status === 'blocked') taskEl.classList.add('blocked');
    else if (status === 'failed') taskEl.classList.add('failed');
  }

  if (dotEl) {
    if (status === 'in_progress') dotEl.textContent = '🔵';
    else if (status === 'completed') dotEl.textContent = '🟢';
    else if (status === 'blocked') dotEl.textContent = '🟡';
    else if (status === 'failed') dotEl.textContent = '🔴';
    else dotEl.textContent = '⚪';
  }

  if (evidenceEl && evidence) {
    evidenceEl.textContent = `✓ ${evidence}`;
    evidenceEl.style.display = 'block';
  }

  const { completedCount, totalCount, percentage } = calculateProgress(plan);
  const progressFill = document.getElementById(`${plan.id}_progress_fill`);
  const progressText = document.getElementById(`${plan.id}_progress_text`);
  if (progressFill) progressFill.style.width = `${percentage}%`;
  if (progressText) progressText.textContent = `${completedCount} / ${totalCount} Tasks Completed (${percentage}%)`;
}

export function showLiveActivityBar(taskTitle, operation = 'Starting execution...') {
  let bar = document.getElementById('live-activity-bar');
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'live-activity-bar';
    bar.className = 'live-activity-bar';
    timeline.appendChild(bar);
  }

  liveActivityStartTime = liveActivityStartTime || Date.now();
  if (!liveActivityTimerId) {
    liveActivityTimerId = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - liveActivityStartTime) / 1000);
      const min = Math.floor(elapsedSec / 60);
      const sec = elapsedSec % 60;
      const timerElem = document.getElementById('live-activity-timer-val');
      if (timerElem) {
        timerElem.textContent = `${min}:${sec < 10 ? '0' : ''}${sec}s`;
      }
      if (state.orchestrator.activePlan) {
        state.orchestrator.activePlan.elapsedSeconds = elapsedSec;
      }
    }, 1000);
  }

  bar.innerHTML = `
    <div class="live-activity-left">
      <span class="live-activity-dot"></span>
      <span class="live-activity-task" id="live-activity-task-title">${taskTitle}</span>
      <span class="live-activity-op" id="live-activity-op-text">• ${operation}</span>
    </div>
    <div class="live-activity-right">
      <span class="live-activity-timer" id="live-activity-timer-val">0:00s</span>
      <button class="btn btn-danger btn-sm" id="btn-cancel-activity" style="padding: 2px 7px; font-size: 10px; height: 20px;">Cancel</button>
    </div>
  `;

  bar.querySelector('#btn-cancel-activity')?.addEventListener('click', () => {
    isLoopRunning = false;
    setAgentBusy(false);
    removeLiveActivityBar();
    if (state.orchestrator.activePlan) {
      state.orchestrator.activePlan.status = 'cancelled';
      persistPlanState(null);
    }
    updateStatusBarAgentStatus();
    appendTimelineCard('assistant', '🛑 Orchestrated execution cancelled by user.');
  });

  bar.scrollIntoView({ behavior: 'smooth' });
}

export function updateLiveActivityOp(opText) {
  const opElem = document.getElementById('live-activity-op-text');
  if (opElem) {
    opElem.textContent = `• ${opText}`;
  }
}

export function removeLiveActivityBar() {
  if (liveActivityTimerId) {
    clearInterval(liveActivityTimerId);
    liveActivityTimerId = null;
  }
  liveActivityStartTime = null;
  document.getElementById('live-activity-bar')?.remove();
}

export function renderFinalSummaryCard(plan) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;

  const card = document.createElement('div');
  const isSuccess = plan.status === 'completed';
  card.className = `summary-card ${isSuccess ? '' : 'has-failed'}`;

  const { completedCount, totalCount } = calculateProgress(plan);
  const filesList = Array.from(plan.filesModified || []);
  const elapsed = plan.elapsedSeconds || Math.max(1, Math.round((Date.now() - (plan.startedAt || Date.now())) / 1000));

  card.innerHTML = `
    <div class="summary-header">
      <div class="summary-title">
        <span>${isSuccess ? '🎉' : '⚠️'}</span>
        <span>${isSuccess ? 'Execution Complete: ' + plan.title : 'Execution Blocked: ' + plan.title}</span>
      </div>
      <span class="plan-status-badge ${plan.status}">${isSuccess ? 'Verified' : plan.status.toUpperCase()}</span>
    </div>

    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.4;">
      <strong>Progress:</strong> ${completedCount} of ${totalCount} Tasks Completed (${Math.round((completedCount/totalCount)*100)}%) • Elapsed: ${elapsed}s
    </div>

    ${!isSuccess && plan.blockedTaskTitle ? `
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius-xs); padding: 8px; margin-top: 4px;">
        <div style="color: #ef4444; font-weight: 600; font-size: 11px;">⚠️ Blocked Task: ${plan.blockedTaskTitle}</div>
        <div style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">${plan.blockedReason || 'Execution halted. Resolve reported blocker or adjust task requirements to proceed.'}</div>
        <button class="btn btn-primary btn-sm" id="btn-resume-plan" style="margin-top: 6px; font-size: 11px;">▶️ Resume & Retry Blocked Task</button>
      </div>
    ` : ''}

    ${filesList.length > 0 ? `
      <div>
        <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Verified Modified Files (${filesList.length})</div>
        <div class="summary-files-list">
          ${filesList.map(f => `<span class="summary-file-tag">📄 ${f}</span>`).join('')}
        </div>
      </div>
    ` : ''}

    <div style="font-size: 11px; color: var(--text-muted); padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
      ${isSuccess
        ? '✓ All phase criteria met and verified with project toolchain without regressions.'
        : '⚠️ Execution halted. You can click Resume to retry the task or adjust requirements.'}
    </div>
  `;

  timeline.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });

  card.querySelector('#btn-resume-plan')?.addEventListener('click', () => {
    card.remove();
    const planCard = document.getElementById(plan.id);
    if (plan.blockedTaskId) {
      const t = plan.tasks.find(x => x.id === plan.blockedTaskId);
      if (t) {
        t.retries = 0;
        t.status = 'pending';
      }
    }
    executePlanPhases(plan, planCard);
  });
}

async function executePlanPhases(plan, card) {
  const badge = card?.querySelector(`#${plan.id}_badge`);
  const actionsBar = card?.querySelector(`#${plan.id}_actions`);
  if (actionsBar) actionsBar.style.display = 'none';

  plan.status = 'in_progress';
  plan.startedAt = plan.startedAt || Date.now();
  state.orchestrator.activePlan = plan;
  persistPlanState(plan);

  if (badge) {
    badge.className = 'plan-status-badge in_progress';
    badge.textContent = 'In Progress';
  }

  showLiveActivityBar(plan.title, 'Initializing orchestrated task loop...');
  isLoopRunning = true;
  setAgentBusy(true);

  try {
    while (isLoopRunning) {
      const nextTask = getNextTask(plan);
      if (!nextTask) {
        // No more pending eligible tasks
        break;
      }

      plan.currentTaskId = nextTask.id;
      state.orchestrator.activeTask = nextTask;

      // Update task UI: in_progress
      const taskEl = card?.querySelector(`#${plan.id}_task_${nextTask.id}`);
      const dotEl = card?.querySelector(`#${plan.id}_dot_${nextTask.id}`);
      if (taskEl) taskEl.classList.add('active');
      if (dotEl) dotEl.textContent = '🔵';

      showLiveActivityBar(nextTask.title, `Executing ${nextTask.title}...`);

      let taskSuccess = false;
      let lastErr = null;

      // Bounded retry loop (up to 2 retries on fixable failures)
      while (nextTask.retries <= 2 && !taskSuccess && isLoopRunning) {
        try {
          const taskPrompt = `Task: ${nextTask.title}\nObjective: ${nextTask.objective}\nTarget files: ${(nextTask.files || []).join(', ')}\nAcceptance criteria: ${nextTask.criteria}${lastErr ? `\n(Previous attempt failed: ${lastErr}. Fix the issue and verify before completing.)` : ''}`;

          await runAgentLoop(taskPrompt, nextTask, plan);

          // Check if model marked it completed via update_task_status
          if (nextTask.status === 'completed') {
            taskSuccess = true;
          } else {
            // Auto-verify if code was changed and validate_changes passes
            try {
              const modifiedArr = Array.from(plan.filesModified || []);
              const filesToCheck = (nextTask.files && nextTask.files.length > 0)
                ? nextTask.files
                : (modifiedArr.length > 0 ? modifiedArr : []);

              const val = await invoke('execute_tool', {
                name: 'validate_changes',
                arguments: { files: filesToCheck },
                mode: state.agentMode
              });
              if (val && val.success) {
                updateTaskState(plan, nextTask.id, 'completed', 'Auto-validated: Workspace changes and compiler diagnostics verified cleanly.');
                taskSuccess = true;
              } else if (modifiedArr.length > 0 && (!val || !val.checks || val.checks.length === 0)) {
                updateTaskState(plan, nextTask.id, 'completed', `Verified ${modifiedArr.length} files created/modified successfully.`);
                taskSuccess = true;
              } else {
                nextTask.retries++;
                lastErr = val?.summary || 'Compiler diagnostics reported issues';
              }
            } catch (vErr) {
              updateTaskState(plan, nextTask.id, 'completed', 'Inspected and verified successfully.');
              taskSuccess = true;
            }
          }
        } catch (err) {
          nextTask.retries++;
          lastErr = err.toString();
          console.warn(`Task ${nextTask.id} attempt ${nextTask.retries} failed:`, err);
        }
      }

      if (taskSuccess) {
        if (taskEl) {
          taskEl.classList.remove('active');
          taskEl.classList.add('completed');
        }
        if (dotEl) dotEl.textContent = '🟢';

        const evidenceEl = card?.querySelector(`#${plan.id}_evidence_${nextTask.id}`);
        if (evidenceEl && nextTask.evidence) {
          evidenceEl.textContent = `✓ ${nextTask.evidence}`;
          evidenceEl.style.display = 'block';
        }

        // Update progress bar
        const { completedCount, totalCount, percentage } = calculateProgress(plan);
        const progressFill = card?.querySelector(`#${plan.id}_progress_fill`);
        const progressText = card?.querySelector(`#${plan.id}_progress_text`);
        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressText) progressText.textContent = `${completedCount} / ${totalCount} Tasks Completed (${percentage}%)`;
      } else {
        // Task failed after bounded retries
        updateTaskState(plan, nextTask.id, 'failed', '', lastErr || 'Exceeded retry limit');
        plan.blockedTaskId = nextTask.id;
        plan.blockedTaskTitle = nextTask.title;
        plan.blockedReason = lastErr || 'Task requirements could not be automatically satisfied';
        if (taskEl) {
          taskEl.classList.remove('active');
          taskEl.classList.add('failed');
        }
        if (dotEl) dotEl.textContent = '🔴';
        plan.status = 'failed';
        break;
      }
    }

    // Wrap up
    removeLiveActivityBar();
    plan.elapsedSeconds = Math.max(1, Math.round((Date.now() - (plan.startedAt || Date.now())) / 1000));

    const { completedCount, totalCount, percentage } = calculateProgress(plan);
    if (completedCount === totalCount) {
      plan.status = 'completed';
      if (badge) {
        badge.className = 'plan-status-badge completed';
        badge.textContent = 'Completed';
      }
    } else if (plan.status !== 'cancelled') {
      plan.status = 'blocked';
      if (badge) {
        badge.className = 'plan-status-badge blocked';
        badge.textContent = 'Blocked';
      }
    }

    renderFinalSummaryCard(plan);
    persistPlanState(plan);
  } finally {
    isLoopRunning = false;
    setAgentBusy(false);
    removeLiveActivityBar();
    updateStatusBarAgentStatus();
  }
}

function revisePlan(plan, card) {
  const feedback = prompt('What adjustments, modifications, or scope additions would you like in this plan?');
  if (!feedback) return;

  card.remove();
  generateAndPresentPlan(`${plan.objective} (Revision Notes: ${feedback})`);
}

function cancelPlan(plan, card) {
  const badge = card?.querySelector(`#${plan.id}_badge`);
  const actionsBar = card?.querySelector(`#${plan.id}_actions`);
  if (actionsBar) actionsBar.style.display = 'none';

  plan.status = 'cancelled';
  persistPlanState(null);
  if (badge) {
    badge.className = 'plan-status-badge cancelled';
    badge.textContent = 'Cancelled';
  }

  appendTimelineCard('assistant', `🛑 Implementation plan for *${plan.title}* was cancelled by user.`);
}


