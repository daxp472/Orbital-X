// ==========================================================================
// Orbital X — Agent Orchestrator & Mode Enforcer (agent.js)
// ==========================================================================

import { state, notify } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openDiffModal, openFileInTab } from '../editor/monaco.js';

let isLoopRunning = false;

export function initAgent() {
  const sendBtn = document.getElementById('btn-agent-send');
  const stopBtn = document.getElementById('btn-agent-stop');
  const inputElem = document.getElementById('agent-input');
  const clearBtn = document.getElementById('btn-clear-chat');

  // Mode buttons
  const modeProBtn = document.getElementById('btn-mode-pro');
  const modeDevBtn = document.getElementById('btn-mode-dev');
  const modeUserBtn = document.getElementById('btn-mode-user');

  if (modeProBtn && modeDevBtn && modeUserBtn) {
    modeProBtn.addEventListener('click', () => switchMode('agent_pro'));
    modeDevBtn.addEventListener('click', () => switchMode('dev'));
    modeUserBtn.addEventListener('click', () => switchMode('user'));
  }

  // Quick Action Chips
  document.getElementById('chip-explain')?.addEventListener('click', () => {
    inputElem.value = "Explain the architecture, structure, and entrypoints of this workspace.";
    handleSend();
  });

  document.getElementById('chip-validate')?.addEventListener('click', () => {
    inputElem.value = "Run the project test suite and validate that all checks pass.";
    handleSend();
  });

  document.getElementById('chip-undo')?.addEventListener('click', async () => {
    try {
      const res = await invoke('undo_agent_change');
      appendTimelineCard('assistant', `↩️ ${res}`);
    } catch (e) {
      alert("Undo failed: " + e);
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
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      isLoopRunning = false;
      setAgentBusy(false);
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

export function switchMode(newMode) {
  state.agentMode = newMode;

  const modeProBtn = document.getElementById('btn-mode-pro');
  const modeDevBtn = document.getElementById('btn-mode-dev');
  const modeUserBtn = document.getElementById('btn-mode-user');
  const headerPill = document.getElementById('header-mode-pill');
  const headerText = document.getElementById('header-mode-text');
  const sbText = document.getElementById('sb-mode-text');

  [modeProBtn, modeDevBtn, modeUserBtn].forEach(b => b?.classList.remove('btn-primary'));

  if (newMode === 'agent_pro') {
    modeProBtn?.classList.add('btn-primary');
    headerPill?.setAttribute('class', 'mode-pill agent_pro');
    if (headerText) headerText.textContent = 'AGENT PRO';
    if (sbText) sbText.textContent = 'Agent Pro Mode';
  } else if (newMode === 'dev') {
    modeDevBtn?.classList.add('btn-primary');
    headerPill?.setAttribute('class', 'mode-pill dev');
    if (headerText) headerText.textContent = 'DEV MODE';
    if (sbText) sbText.textContent = 'Dev Mode';
  } else {
    modeUserBtn?.classList.add('btn-primary');
    headerPill?.setAttribute('class', 'mode-pill user');
    if (headerText) headerText.textContent = 'USER MODE';
    if (sbText) sbText.textContent = 'User Mode';
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
  appendTimelineCard('user', promptText);

  state.conversation.push({
    role: 'user',
    content: promptText,
  });

  isLoopRunning = true;
  setAgentBusy(true);

  try {
    await runAgentLoop();
  } catch (err) {
    console.error("Agent error:", err);
    appendTimelineCard('assistant', `❌ Error: ${err}`);
  } finally {
    isLoopRunning = false;
    setAgentBusy(false);
  }
}

async function runAgentLoop() {
  let iteration = 0;
  const maxIterations = 6;

  // System instructions including current mode constraints
  const systemPrompt = `You are Orbital X, an autonomous, memory-conscious desktop AI pair programmer.
Current Operating Mode: ${state.agentMode.toUpperCase()}.
Workspace Root: ${state.workspace.rootPath || "No open workspace"}.
Instructions:
1. In Agent Pro Mode, you can inspect, search, edit files, and run tests autonomously.
2. In Dev Mode, inspect/search is automatic, but file changes and commands will be confirmed by the user.
3. In User Mode, every tool execution requires explicit approval.
Always explain your intent clearly and use available tools to perform real tasks.`;

  while (isLoopRunning && iteration < maxIterations) {
    iteration++;

    const provider = state.ai.provider;
    const model = state.ai.model || state.ai.defaultModels[provider];
    const apiKey = state.ai.keys[provider] || '';
    const baseUrl = provider === 'ollama' ? state.ai.endpoint : null;

    // Build payload messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...state.conversation,
    ];

    // Show thinking indicator
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
    } finally {
      removeThinkingIndicator(spinnerId);
    }

    if (resp.content && resp.content.trim()) {
      appendTimelineCard('assistant', resp.content);
      state.conversation.push({
        role: 'assistant',
        content: resp.content,
      });
    }

    // Check if tools were proposed
    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      break; // No further tools, agent is done
    }

    // Process each tool call according to active policy mode
    for (const toolCall of resp.tool_calls) {
      if (!isLoopRunning) break;

      const toolResult = await processToolCallWithPolicy(toolCall);

      state.conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
      });
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

function appendTimelineCard(role, text) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;

  const card = document.createElement('div');
  card.className = `timeline-card ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;

  card.innerHTML = `
    <div class="timeline-card-header">
      <span>${role === 'user' ? 'You' : 'Orbital Agent'}</span>
      <span style="font-size: 10px; color: var(--text-muted);">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="timeline-card-body">${formatMarkdown(text)}</div>
  `;

  timeline.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
}

function formatMarkdown(text) {
  // Simple clean markdown parser for text and code blocks
  return text
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background: var(--bg-activity); padding: 1px 4px; border-radius: 3px; font-family: monospace;">$1</code>')
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
      <span class="tool-status-badge running" id="${id}_status">
        <span class="spinner"></span> Running
      </span>
    </div>
    <div style="font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); max-height: 80px; overflow-y: auto;">
      ${JSON.stringify(args, null, 2)}
    </div>
  `;

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
}

function appendThinkingIndicator() {
  const timeline = document.getElementById('agent-timeline');
  const id = 'think_' + Math.random().toString(36).substring(2, 9);
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); padding: 4px;';
  div.innerHTML = `<span class="spinner"></span> Orbital X is thinking...`;
  timeline.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
  return id;
}

function removeThinkingIndicator(id) {
  document.getElementById(id)?.remove();
}
