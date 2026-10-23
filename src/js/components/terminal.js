// ==========================================================================
// Orbital X — Integrated Real Interactive Terminal Subsystem (terminal.js)
// Modeled after VS Code, Antigravity, and Cursor integrated terminals.
// Supports real interactive PowerShell shell processes, live output streaming,
// persistent working directories, and multiple independent sessions.
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { state } from '../state/store.js';

let terminalInstances = [];
let activeTerminalId = 1;
let pollTimer = null;

const STORAGE_KEY_CMD_HISTORY = 'orbital_cmd_history';
const MAX_CMD_HISTORY = 50;
let globalCmdHistory = [];
let cmdHistoryIndex = -1;

function loadCommandHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CMD_HISTORY);
    globalCmdHistory = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(globalCmdHistory)) globalCmdHistory = [];
  } catch (e) {
    globalCmdHistory = [];
  }
}

function saveCommandToHistory(command) {
  if (!command || !command.trim()) return;
  const trimmed = command.trim();
  if (globalCmdHistory.length > 0 && globalCmdHistory[globalCmdHistory.length - 1] === trimmed) {
    return;
  }
  globalCmdHistory.push(trimmed);
  if (globalCmdHistory.length > MAX_CMD_HISTORY) {
    globalCmdHistory = globalCmdHistory.slice(-MAX_CMD_HISTORY);
  }
  try {
    localStorage.setItem(STORAGE_KEY_CMD_HISTORY, JSON.stringify(globalCmdHistory));
  } catch (e) {
    console.warn("Could not persist terminal command history:", e);
  }
}

class TerminalSession {
  constructor(id, name = 'powershell') {
    this.id = id;
    this.sessionId = `term_${id}_${Date.now()}`;
    this.name = name;
    this.cwd = state.workspace.rootPath || 'D:\\1work\\YT\\Orbital X';
    this.history = [];
    this.historyIndex = -1;
    this.buffer = '';
    this.isRunning = false;
    this.isBackendConnected = false;
  }

  async startBackendShell() {
    try {
      const res = await invoke('create_interactive_terminal', {
        sessionId: this.sessionId,
        name: this.name,
        cwd: this.cwd,
        shell: 'powershell',
      });
      if (res && res.id) {
        this.sessionId = res.id;
      }
      this.isBackendConnected = true;
      // Initial poll after short delay for prompt
      setTimeout(() => pollActiveTerminalOutput(), 250);
    } catch (e) {
      console.warn(`[Terminal] Interactive shell spawn failed for session ${this.sessionId}:`, e);
      this.isBackendConnected = false;
    }
  }

  async closeBackendShell() {
    if (this.isBackendConnected) {
      try {
        await invoke('close_interactive_terminal', { sessionId: this.sessionId });
      } catch (e) {
        console.warn(`[Terminal] Close session failed:`, e);
      }
      this.isBackendConnected = false;
    }
  }
}

export function initTerminal() {
  loadCommandHistory();

  // Initialize first terminal session
  if (terminalInstances.length === 0) {
    const firstSession = new TerminalSession(1, 'powershell');
    terminalInstances.push(firstSession);
    activeTerminalId = 1;
    firstSession.startBackendShell();
  }

  const inputElem = document.getElementById('terminal-command-input');
  const runBtn = document.getElementById('btn-run-terminal-command');
  const clearBtn = document.getElementById('btn-clear-terminal');
  const collapseBtn = document.getElementById('btn-collapse-panel');
  const newTerminalBtn = document.getElementById('btn-new-terminal');
  const splitTerminalBtn = document.getElementById('btn-split-terminal');
  const sidebarNewBtn = document.getElementById('btn-sidebar-new-terminal');
  const bottomPanel = document.getElementById('bottom-panel');

  // Bottom panel tab switching
  const tabs = document.querySelectorAll('.panel-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      const termContent = document.getElementById('tab-content-terminal');
      const valContent = document.getElementById('tab-content-validation');
      const logContent = document.getElementById('tab-content-logs');

      if (termContent) termContent.style.display = target === 'terminal' ? 'flex' : 'none';
      if (valContent) valContent.style.display = target === 'validation' ? 'block' : 'none';
      if (logContent) logContent.style.display = target === 'logs' ? 'block' : 'none';

      if (target === 'terminal') {
        inputElem?.focus();
        pollActiveTerminalOutput();
      }
    });
  });

  // Enter to execute & ArrowUp/Down for command history & Ctrl+C
  if (inputElem) {
    inputElem.addEventListener('keydown', (e) => {
      const active = getActiveSession();
      if (!active) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        executeTerminalCommand();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (globalCmdHistory.length > 0) {
          if (cmdHistoryIndex === -1) {
            cmdHistoryIndex = globalCmdHistory.length - 1;
          } else if (cmdHistoryIndex > 0) {
            cmdHistoryIndex--;
          }
          inputElem.value = globalCmdHistory[cmdHistoryIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (globalCmdHistory.length > 0 && cmdHistoryIndex !== -1) {
          if (cmdHistoryIndex < globalCmdHistory.length - 1) {
            cmdHistoryIndex++;
            inputElem.value = globalCmdHistory[cmdHistoryIndex] || '';
          } else {
            cmdHistoryIndex = -1;
            inputElem.value = '';
          }
        }
      } else if (e.key === 'c' && e.ctrlKey) {
        // Send SIGINT / Ctrl+C to real backend shell process
        sendInterruptSignal();
        inputElem.value = '';
      } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        const stdoutElem = document.getElementById('terminal-stdout');
        if (stdoutElem) stdoutElem.innerHTML = '';
        if (active) active.buffer = '';
      }
    });
  }

  runBtn?.addEventListener('click', () => executeTerminalCommand());

  if (clearBtn) {
    clearBtn.innerHTML = '🗑️';
    clearBtn.title = 'Clear Output (Ctrl+L)';
    clearBtn.addEventListener('click', () => {
      const stdoutElem = document.getElementById('terminal-stdout');
      if (stdoutElem) stdoutElem.innerHTML = '';
      const active = getActiveSession();
      if (active) active.buffer = '';
    });
  }

  newTerminalBtn?.addEventListener('click', () => createTerminalInstance());
  splitTerminalBtn?.addEventListener('click', () => createTerminalInstance());
  sidebarNewBtn?.addEventListener('click', () => createTerminalInstance());

  collapseBtn?.addEventListener('click', () => {
    bottomPanel?.classList.toggle('collapsed');
  });

  // Focus terminal input when clicking anywhere on stdout area
  document.getElementById('terminal-stdout')?.addEventListener('click', () => {
    inputElem?.focus();
  });

  // Validation Suite triggers
  document.getElementById('btn-run-all-tests')?.addEventListener('click', runValidationTests);

  renderTerminalSessionsList();
  renderActiveBuffer();
  updatePromptDisplay();

  // Start continuous output polling loop
  startOutputPolling();
}

export function getActiveSession() {
  return terminalInstances.find(t => t.id === activeTerminalId) || terminalInstances[0];
}

export async function createTerminalInstance(name = 'powershell') {
  const newId = terminalInstances.length > 0 ? Math.max(...terminalInstances.map(t => t.id)) + 1 : 1;
  const newSession = new TerminalSession(newId, name);
  terminalInstances.push(newSession);
  await newSession.startBackendShell();
  switchTerminalInstance(newId);
  renderTerminalSessionsList();
}

export function switchTerminalInstance(id) {
  activeTerminalId = id;
  renderTerminalSessionsList();
  renderActiveBuffer();
  updatePromptDisplay();
  document.getElementById('terminal-command-input')?.focus();
  pollActiveTerminalOutput();
}

export async function closeTerminalInstance(id, event) {
  if (event) event.stopPropagation();

  const targetSession = terminalInstances.find(t => t.id === id);
  if (targetSession) {
    await targetSession.closeBackendShell();
  }

  if (terminalInstances.length <= 1) {
    // If only one, restart/clear it
    const session = terminalInstances[0];
    session.buffer = '';
    renderActiveBuffer();
    return;
  }

  terminalInstances = terminalInstances.filter(t => t.id !== id);
  if (activeTerminalId === id) {
    activeTerminalId = terminalInstances[0].id;
  }

  renderTerminalSessionsList();
  renderActiveBuffer();
  updatePromptDisplay();
}

function renderTerminalSessionsList() {
  const container = document.getElementById('terminal-sessions-list');
  if (!container) return;

  container.innerHTML = '';
  terminalInstances.forEach(term => {
    const isActive = term.id === activeTerminalId;
    const itemEl = document.createElement('div');
    itemEl.className = `terminal-session-item ${isActive ? 'active' : ''}`;
    itemEl.innerHTML = `
      <span style="display: flex; align-items: center; gap: 6px;">
        <span style="color: ${isActive ? 'var(--accent-cyan)' : 'var(--text-muted)'}; font-size: 10px; font-weight: bold;">&gt;_</span>
        <span>${term.id}: ${term.name}</span>
      </span>
      <span class="terminal-session-trash" title="Kill Terminal Session">✕</span>
    `;

    itemEl.addEventListener('click', () => switchTerminalInstance(term.id));
    itemEl.querySelector('.terminal-session-trash')?.addEventListener('click', (e) => closeTerminalInstance(term.id, e));

    container.appendChild(itemEl);
  });
}

function updatePromptDisplay() {
  const promptLabel = document.getElementById('terminal-prompt-label');
  const active = getActiveSession();
  if (promptLabel && active) {
    const cwd = active.cwd || (state.workspace.rootPath || 'D:\\1work\\YT\\Orbital X');
    promptLabel.textContent = `PS ${cwd}>`;
  }
}

function renderActiveBuffer() {
  const stdoutElem = document.getElementById('terminal-stdout');
  const active = getActiveSession();
  if (!stdoutElem || !active) return;

  if (!active.buffer) {
    const defaultGreeting = `Orbital X PowerShell Integrated Terminal [Process ID: ${active.sessionId}]\n(c) 2026 Orbital X Desktop IDE. Active workspace shell ready.\n\nType commands directly and press Enter. ArrowUp/Down for history.\n`;
    stdoutElem.innerHTML = ansiToHtml(defaultGreeting);
  } else {
    stdoutElem.innerHTML = ansiToHtml(active.buffer);
  }

  stdoutElem.scrollTop = stdoutElem.scrollHeight;
}

export async function executeTerminalCommand(cmdString) {
  const inputElem = document.getElementById('terminal-command-input');
  const active = getActiveSession();
  if (!active) return;

  const command = (cmdString || (inputElem ? inputElem.value : '')).trim();
  if (!command) return;

  if (inputElem) inputElem.value = '';
  cmdHistoryIndex = -1;
  saveCommandToHistory(command);
  active.historyIndex = -1;
  active.history.push(command);

  // 1. Built-in: clear / cls
  if (command.toLowerCase() === 'cls' || command.toLowerCase() === 'clear') {
    active.buffer = '';
    renderActiveBuffer();
    return;
  }

  // 2. Built-in: exit
  if (command.toLowerCase() === 'exit') {
    closeTerminalInstance(active.id);
    return;
  }

  // Display command entered into terminal buffer
  appendTerminalText(`\nPS ${active.cwd}> ${command}\n`);

  active.isRunning = true;

  try {
    if (!active.isBackendConnected) {
      await active.startBackendShell();
    }

    if (active.isBackendConnected) {
      try {
        await invoke('send_terminal_input', {
          sessionId: active.sessionId,
          input: command + "\r\n",
        });
        setTimeout(() => pollActiveTerminalOutput(), 60);
        setTimeout(() => pollActiveTerminalOutput(), 180);
        setTimeout(() => pollActiveTerminalOutput(), 400);
        setTimeout(() => pollActiveTerminalOutput(), 900);
      } catch (inputErr) {
        console.warn("send_terminal_input failed, attempting session auto-recovery:", inputErr);
        await active.startBackendShell();
        await invoke('send_terminal_input', {
          sessionId: active.sessionId,
          input: command + "\r\n",
        });
        setTimeout(() => pollActiveTerminalOutput(), 150);
      }
    } else {
      // Fallback subprocess runner if interactive shell process isn't active
      const res = await invoke('run_command', {
        command,
        timeout_seconds: 60,
      });

      let output = '';
      if (res.stdout) output += res.stdout;
      if (res.stderr) output += `\n[STDERR]\n${res.stderr}`;

      const statusBadge = res.success
        ? `\n✓ Exited with code ${res.exit_code} (${res.duration_ms}ms)\n`
        : `\n✗ Exited with code ${res.exit_code ?? 'terminated'} (${res.duration_ms}ms)\n`;

      appendTerminalText(`${output}${statusBadge}`);
    }
    logAudit(`Terminal: "${command}"`);
  } catch (err) {
    appendTerminalText(`\nExecution Error: ${err}\n`);
    logAudit(`Terminal error: "${command}" -> ${err}`);
  } finally {
    active.isRunning = false;
    updatePromptDisplay();
    inputElem?.focus();
  }
}

async function sendInterruptSignal() {
  const active = getActiveSession();
  if (!active) return;

  appendTerminalText(`^C\n`);

  if (active.isBackendConnected) {
    try {
      await invoke('send_terminal_input', {
        sessionId: active.sessionId,
        input: "\x03", // ASCII ETX / Ctrl+C
      });
      setTimeout(() => pollActiveTerminalOutput(), 100);
    } catch (e) {
      console.warn("Failed to send interrupt signal to shell:", e);
    }
  }
}

function startOutputPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    // Only poll when terminal tab is visible
    const termContent = document.getElementById('tab-content-terminal');
    if (termContent && termContent.style.display !== 'none') {
      pollActiveTerminalOutput();
    }
  }, 200);
}

export async function pollActiveTerminalOutput() {
  const active = getActiveSession();
  if (!active || !active.isBackendConnected) return;

  try {
    const newOutput = await invoke('poll_terminal_output', {
      sessionId: active.sessionId,
    });

    if (newOutput && newOutput.length > 0) {
      appendTerminalText(newOutput);
    }
  } catch (e) {
    // Silently continue polling
  }
}

function appendTerminalText(text) {
  const active = getActiveSession();
  if (active) {
    active.buffer = (active.buffer || '') + text;
    // Cap buffer at 250,000 characters to prevent memory leaks
    if (active.buffer.length > 250000) {
      active.buffer = active.buffer.slice(-150000);
    }
  }

  const stdoutElem = document.getElementById('terminal-stdout');
  if (stdoutElem && active) {
    stdoutElem.innerHTML = ansiToHtml(active.buffer);
    stdoutElem.scrollTop = stdoutElem.scrollHeight;
  }
}

// Convert ANSI escape codes to high-contrast HTML elements
function ansiToHtml(str) {
  if (!str) return '';

  // 1. Escape HTML
  let out = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Map standard 16 ANSI color sequences to CSS colors
  const ansiColors = {
    '30': 'var(--text-muted)',
    '31': 'var(--accent-red)',
    '32': 'var(--accent-green)',
    '33': 'var(--accent-orange)',
    '34': 'var(--accent-blue)',
    '35': 'var(--accent-purple)',
    '36': 'var(--accent-cyan)',
    '37': 'var(--text-primary)',
    '90': 'var(--text-muted)',
    '91': 'var(--accent-red)',
    '92': 'var(--accent-green)',
    '93': 'var(--accent-orange)',
    '94': 'var(--accent-blue)',
    '95': 'var(--accent-purple)',
    '96': 'var(--accent-cyan)',
    '97': 'var(--text-primary-bright)',
  };

  // Convert color codes
  out = out.replace(/\x1b\[(\d+)(;\d+)*m/g, (match, p1) => {
    if (p1 === '0' || p1 === '39') return '</span>';
    if (p1 === '1') return '<span style="font-weight: 700;">';
    if (ansiColors[p1]) {
      return `<span style="color: ${ansiColors[p1]};">`;
    }
    return '';
  });

  return out;
}

export function logAudit(message) {
  const logsContainer = document.getElementById('agent-audit-logs');
  if (logsContainer) {
    const entry = document.createElement('div');
    entry.style.padding = '2px 0';
    entry.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsContainer.appendChild(entry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
}

async function runValidationTests() {
  const card = document.getElementById('validation-report-card');
  if (!card) return;

  card.innerHTML = `<span class="spinner"></span> Running automated test suite in workspace...`;

  try {
    const res = await invoke('execute_tool', {
      name: 'run_tests',
      arguments: {},
      mode: 'agent_pro',
    });

    const isSuccess = res.success;
    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-weight: 600; color: ${isSuccess ? 'var(--accent-green)' : 'var(--accent-red)'};">
          ${isSuccess ? '✓ Tests Passed' : '✗ Tests Failed'}
        </span>
        <span style="font-size: 11px; color: var(--text-muted);">${res.duration_ms}ms</span>
      </div>
      <div style="font-family: var(--font-mono); font-size: 11px; background: var(--bg-activity); padding: 8px; border-radius: 4px; max-height: 140px; overflow-y: auto;">
        ${(res.stdout || res.stderr || 'No output recorded').replace(/\n/g, '<br>')}
      </div>
    `;

    logAudit(`Validation tests completed: ${isSuccess ? 'PASSED' : 'FAILED'}`);
  } catch (e) {
    card.innerHTML = `<div style="color: var(--accent-red);">Validation check error: ${e}</div>`;
  }
}
