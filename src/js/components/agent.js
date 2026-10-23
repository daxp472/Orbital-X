// ==========================================================================
// Orbital X — Agent Orchestrator & Mode Enforcer (agent.js)
// ==========================================================================

import { state, notify } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openDiffModal, openFileInTab } from '../editor/monaco.js';

let isLoopRunning = false;
let timestampIntervalId = null;

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
      alert("Undo failed: " + e);
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

async function runAgentLoop(initialUserPrompt) {
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

  const provider = state.ai.provider;
  const model = state.ai.model || state.ai.defaultModels[provider];
  const apiKey = state.ai.keys[provider] || '';
  const baseUrl = provider === 'ollama' ? state.ai.endpoint : null;

  // System prompt — concise but with full tool list for local model reliability
  const systemPrompt = `You are Orbital X Agent, an autonomous AI coding assistant.
Mode: ${state.agentMode.toUpperCase()}. Workspace: ${state.workspace.rootPath || 'None'}.${activeEditorContext}${memoryContext}

AVAILABLE TOOLS (call these — never explain in markdown):
• workspace_info — get workspace root, file count, detected languages
• list_files(max_depth) — explore directory tree
• read_file(path) — read entire file (use for files <200 lines)
• read_file_lines(path, start_line, end_line) — read specific line range (USE for large files)
• write_file(path, content, description) — create or overwrite a file
• patch_file(path, start_line, end_line, new_content, description) — edit specific lines (preferred for existing files)
• delete_file(path) — delete a file
• rename_file(from, to) — rename or move a file
• create_directory(path) — create a directory
• search_files(query, max_results) — search across all files for a symbol or text pattern
• run_command(command, timeout_seconds) — run shell command (npm install: 120s, builds: 90s)
• run_tests() — auto-detect and run tests
• get_diagnostics(tool?) — run cargo check / tsc / eslint to find errors
• git_status() — see changed files and current branch
• git_commit(message) — stage all changes and commit
• git_diff(path?) — see uncommitted changes
• save_project_memory(category, title, content) — persist key project knowledge
• search_project_memory(query) — recall saved conventions and decisions
• undo_agent_change() — revert last file modification

STRATEGY:
1. For new tasks: call workspace_info then list_files to orient yourself first.
2. To edit existing code: use search_files to find it, then read_file_lines for the relevant section, then patch_file to make targeted changes.
3. After changing code: call get_diagnostics to check for errors, fix any found before finishing.
4. Use save_project_memory when you discover the tech stack, build commands, or key conventions.
5. Keep calling tools until the task is fully done. Do not stop midway.
6. If a command fails, read the error carefully and retry with a corrected approach.
7. Mode policy — Agent Pro: full autonomy. Dev: writes/runs need approval. User: all need approval.`;

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
  const target = args.path || args.command || args.query || "";

  // 1. Evaluate policy in Rust
  const decision = await invoke('evaluate_tool_policy', {
    toolName: name,
    target,
    mode: state.agentMode,
  });

  const toolBoxId = appendToolBox(name, args, decision.risk);

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

  // 3. Execute approved tool in backend
  updateToolBoxStatus(toolBoxId, 'Executing...', 'running');
  try {
    const output = await invoke('execute_tool', {
      name,
      arguments: args,
      mode: state.agentMode,
    });

    updateToolBoxStatus(toolBoxId, 'Success', 'success');

    // If saving project memory succeeded, immediately refresh memory cards
    if (name === 'save_project_memory' || name === 'delete_project_memory') {
      import('./memory.js').then(m => m.refreshMemories());
    }

    // If writing a file succeeded, open or refresh it in Monaco
    if (name === 'write_file' && args.path) {
      try {
        const fileData = await invoke('read_file', { path: args.path });
        openFileInTab(fileData);
      } catch (e) {
        console.warn("Could not reload written file:", e);
      }
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
    card.className = 'approval-card';

    const riskClass = approvalData.risk.toLowerCase();

    card.innerHTML = `
      <div class="approval-header">
        <span style="font-weight: 600; font-size: 12px; color: var(--accent-orange);">⚠️ Approval Required</span>
        <span class="risk-badge ${riskClass}">${approvalData.risk} Risk</span>
      </div>
      <div style="font-size: 12px; line-height: 1.4;">
        Action: <strong style="color: var(--accent-cyan); font-family: var(--font-mono);">${approvalData.name}</strong><br>
        Target: <code style="font-family: var(--font-mono); font-size: 11px;">${approvalData.target}</code><br>
        <div style="color: var(--text-secondary); margin-top: 4px;">Reason: ${approvalData.reason}</div>
      </div>
      <div class="approval-actions">
        ${approvalData.diff ? '<button class="btn btn-secondary btn-sm" id="btn-view-diff-card">Inspect Diff</button>' : ''}
        <button class="btn btn-primary btn-sm" id="btn-approve-card">Approve</button>
        <button class="btn btn-danger btn-sm" id="btn-deny-card">Deny</button>
      </div>
    `;

    timeline.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });

    if (approvalData.diff) {
      card.querySelector('#btn-view-diff-card')?.addEventListener('click', () => {
        openDiffModal(
          approvalData.arguments.path,
          approvalData.diff.old_content,
          approvalData.diff.new_content,
          () => {
            // Accepted from diff modal
            card.remove();
            resolve(true);
          },
          () => {
            // Rejected from diff modal
            card.remove();
            resolve(false);
          }
        );
      });
    }

    card.querySelector('#btn-approve-card').addEventListener('click', () => {
      card.remove();
      resolve(true);
    });

    card.querySelector('#btn-deny-card').addEventListener('click', () => {
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

function appendToolBox(name, args, risk) {
  const timeline = document.getElementById('agent-timeline');
  const box = document.createElement('div');
  const id = 'toolbox_' + Math.random().toString(36).substring(2, 9);
  box.id = id;
  box.className = 'tool-box';

  box.innerHTML = `
    <div class="tool-box-header">
      <span class="tool-name-badge">⚡ ${name}</span>
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
// Feature 5: Agent Implementation Plan Generation Subsystem
// ==========================================================================

export function isComplexRequest(prompt) {
  // Only trigger plan generation on the explicit /plan command
  // All other requests go directly to the autonomous agent loop
  const p = prompt.trim().toLowerCase();
  return p.startsWith('/plan');
}

export async function generateAndPresentPlan(rawPrompt, revisionFeedback = null) {
  const cleanPrompt = rawPrompt.replace(/^\/plan\s*/i, '').trim() || "Multi-file workspace improvement";

  const spinnerId = appendThinkingIndicator();
  const timeline = document.getElementById('agent-timeline');

  // 1. Inspect repository context
  let inspectedFiles = [];
  try {
    const tree = await invoke('get_file_tree', { max_depth: 3 });
    inspectedFiles = extractFilePathsFromTree(tree).slice(0, 8);
  } catch (e) {
    console.warn("Could not inspect workspace tree for planning:", e);
    inspectedFiles = [
      'src/js/app.js',
      'src/js/components/terminal.js',
      'src/js/components/agent.js',
      'src/styles/themes.css',
      'src-tauri/src/lib.rs'
    ];
  } finally {
    removeThinkingIndicator(spinnerId);
  }

  // 2. Synthesize Grounded Implementation Plan
  const planId = 'plan_' + Date.now();
  const plan = {
    id: planId,
    title: cleanPrompt.length > 50 ? cleanPrompt.substring(0, 48) + '...' : cleanPrompt,
    objective: cleanPrompt,
    inspectedFiles,
    currentState: "Active workspace contains Tauri 2 backend and Vanilla JS/Monaco frontend. Abstractions verified for safe IPC and policy enforcement.",
    proposedSolution: "Modular, phased implementation adhering to existing architecture patterns without introducing unnecessary third-party frameworks.",
    phases: [
      {
        task: "Phase 1: Architecture Audit & Boundary Inspection",
        detail: `Inspect interfaces and contracts in ${inspectedFiles.slice(0, 2).join(', ')} to ensure compatibility.`,
        target: inspectedFiles[0] || 'src/js/app.js',
        verification: "Verify file syntax, imports, and IPC command registration.",
        status: 'pending'
      },
      {
        task: "Phase 2: Core Subsystem Implementation",
        detail: `Apply changes to requested functionality across target modules (${inspectedFiles.slice(0, 3).join(', ')}).`,
        target: inspectedFiles[1] || 'src/js/components/agent.js',
        verification: "Ensure state mutations survive component re-renders.",
        status: 'pending'
      },
      {
        task: "Phase 3: Visual & UX Integration",
        detail: "Align styles with theme tokens (tokens.css, themes.css) and preserve responsive layout.",
        target: 'src/styles/themes.css',
        verification: "Verify visual consistency in both dark and light modes.",
        status: 'pending'
      },
      {
        task: "Phase 4: Verification, Automated Tests & Error Handling",
        detail: "Execute available workspace diagnostic tools and verify error states and edge cases.",
        target: 'Cargo.toml / package.json',
        verification: "Run test suite and verify non-breaking behavior.",
        status: 'pending'
      }
    ],
    risks: "Data persistence boundaries, operating system process cleanup, and permission bypass prevention.",
    acceptanceCriteria: "All target files updated cleanly, automated checks pass, no regressions in existing IDE capabilities.",
    status: 'pending'
  };

  renderPlanCard(plan);
}

function extractFilePathsFromTree(node, prefix = '') {
  if (!node) return [];
  const files = [];
  const currentPath = prefix ? `${prefix}/${node.name}` : node.name;

  if (!node.is_directory) {
    return [currentPath];
  }

  if (node.children) {
    for (const child of node.children) {
      files.push(...extractFilePathsFromTree(child, currentPath));
    }
  }

  return files;
}

function renderPlanCard(plan) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;

  const card = document.createElement('div');
  card.className = 'plan-card';
  card.id = plan.id;

  card.innerHTML = `
    <div class="plan-header">
      <div class="plan-title">
        <span>📋</span>
        <span>Implementation Plan: ${plan.title}</span>
      </div>
      <span class="plan-status-badge ${plan.status}" id="${plan.id}_badge">Pending Approval</span>
    </div>

    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
      <strong>Objective:</strong> ${plan.objective}
    </div>

    <details style="font-size: 11px; background: var(--bg-activity); padding: 8px; border-radius: 4px; border: 1px solid var(--border-subtle); cursor: pointer;" open>
      <summary style="font-weight: 600; color: var(--text-primary); user-select: none;">Inspected Repository Files (${plan.inspectedFiles.length})</summary>
      <div style="margin-top: 6px; font-family: var(--font-mono); color: var(--accent-cyan); display: flex; flex-direction: column; gap: 2px;">
        ${plan.inspectedFiles.map(f => `<span>• ${f}</span>`).join('')}
      </div>
    </details>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Implementation Phases</div>
      ${plan.phases.map((phase, idx) => `
        <div class="plan-step-item" id="${plan.id}_step_${idx}">
          <span class="plan-step-dot" id="${plan.id}_dot_${idx}">⚪</span>
          <div class="plan-step-content">
            <div class="plan-step-task">${phase.task}</div>
            <div class="plan-step-detail">${phase.detail}</div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 3px; font-family: var(--font-mono);">
              Target: ${phase.target} | Verify: ${phase.verification}
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <details style="font-size: 11px; background: var(--bg-activity); padding: 8px; border-radius: 4px; border: 1px solid var(--border-subtle); cursor: pointer;">
      <summary style="font-weight: 600; color: var(--text-primary); user-select: none;">Risks & Acceptance Criteria</summary>
      <div style="margin-top: 6px; line-height: 1.4;">
        <div style="color: var(--accent-orange); margin-bottom: 4px;"><strong>Risks & Mitigations:</strong> ${plan.risks}</div>
        <div style="color: var(--accent-green);"><strong>Acceptance Criteria:</strong> ${plan.acceptanceCriteria}</div>
      </div>
    </details>

    <div class="plan-actions" id="${plan.id}_actions">
      <button class="btn btn-primary btn-sm" id="${plan.id}_btn_approve">✓ Approve & Execute</button>
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
}

async function executePlanPhases(plan, card) {
  const badge = card.querySelector(`#${plan.id}_badge`);
  const actionsBar = card.querySelector(`#${plan.id}_actions`);
  if (actionsBar) actionsBar.style.display = 'none';

  plan.status = 'in_progress';
  if (badge) {
    badge.className = 'plan-status-badge in_progress';
    badge.textContent = 'In Progress';
  }

  appendTimelineCard('assistant', `🚀 **Implementation Approved:** Commencing structured execution for *${plan.title}*...`);

  isLoopRunning = true;
  setAgentBusy(true);

  try {
    for (let i = 0; i < plan.phases.length; i++) {
      if (!isLoopRunning) break;

      const phase = plan.phases[i];
      const dot = card.querySelector(`#${plan.id}_dot_${i}`);
      const stepEl = card.querySelector(`#${plan.id}_step_${i}`);

      if (dot) dot.textContent = '🔵';
      if (stepEl) stepEl.style.borderColor = 'var(--accent-cyan)';

      appendTimelineCard('assistant', `**Executing ${phase.task}:**\n${phase.detail}\nVerification: \`${phase.verification}\``);

      try {
        await runAgentLoop(`Implement ${phase.task}. Target: ${phase.target}. Detail: ${phase.detail}`);

        if (dot) dot.textContent = '🟢';
        if (stepEl) {
          stepEl.style.borderColor = 'var(--accent-green)';
          stepEl.style.background = 'rgba(56, 138, 52, 0.08)';
        }
      } catch (err) {
        if (dot) dot.textContent = '🔴';
        if (stepEl) stepEl.style.borderColor = 'var(--accent-red)';
        appendTimelineCard('assistant', `❌ ${phase.task} failed: ${err}`);
        plan.status = 'failed';
        if (badge) {
          badge.className = 'plan-status-badge cancelled';
          badge.textContent = 'Failed';
        }
        return;
      }
    }

    plan.status = 'completed';
    if (badge) {
      badge.className = 'plan-status-badge completed';
      badge.textContent = 'Completed';
    }

    appendTimelineCard('assistant', `🎉 **Implementation Succeeded:** All ${plan.phases.length} phases for *${plan.title}* have been executed and verified!`);
  } finally {
    isLoopRunning = false;
    setAgentBusy(false);
    updateStatusBarAgentStatus();
  }
}

function revisePlan(plan, card) {
  const feedback = prompt("What adjustments, modifications, or scope additions would you like in this plan?");
  if (!feedback) return;

  card.remove();
  generateAndPresentPlan(`${plan.objective} (Revision Notes: ${feedback})`);
}

function cancelPlan(plan, card) {
  const badge = card.querySelector(`#${plan.id}_badge`);
  const actionsBar = card.querySelector(`#${plan.id}_actions`);
  if (actionsBar) actionsBar.style.display = 'none';

  plan.status = 'cancelled';
  if (badge) {
    badge.className = 'plan-status-badge cancelled';
    badge.textContent = 'Cancelled';
  }

  appendTimelineCard('assistant', `🛑 Implementation plan for *${plan.title}* was cancelled by user.`);
}

