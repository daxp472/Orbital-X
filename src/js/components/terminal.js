// ==========================================================================
// Orbital X — Integrated Terminal Subsystem (terminal.js)
// Real developer terminal modeled after VS Code, Antigravity, and Cursor.
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { state } from '../state/store.js';

let terminalInstances = [];
let activeTerminalId = 1;

class TerminalSession {
  constructor(id, name = 'powershell') {
    this.id = id;
    this.name = name;
    this.cwd = state.workspace.rootPath || 'D:\\1work\\YT\\Orbital X';
    this.history = [];
    this.historyIndex = -1;
    this.buffer = '';
    this.isRunning = false;
  }

  getPromptText() {
    return `PS ${this.cwd}> `;
  }
}

export function initTerminal() {
  // Initialize with at least one active terminal instance
  if (terminalInstances.length === 0) {
    terminalInstances.push(new TerminalSession(1, 'powershell'));
    activeTerminalId = 1;
  }

  const inputElem = document.getElementById('terminal-command-input');
  const runBtn = document.getElementById('btn-run-terminal-command');
  const clearBtn = document.getElementById('btn-clear-terminal');
  const collapseBtn = document.getElementById('btn-collapse-panel');
  const newTerminalBtn = document.getElementById('btn-new-terminal');
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
      }
    });
  });

  // Enter to execute & ArrowUp/Down for command history
  if (inputElem) {
    inputElem.addEventListener('keydown', (e) => {
      const active = getActiveSession();
      if (!active) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        executeTerminalCommand();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active.history.length > 0) {
          if (active.historyIndex === -1) {
            active.historyIndex = active.history.length - 1;
          } else if (active.historyIndex > 0) {
            active.historyIndex--;
          }
          inputElem.value = active.history[active.historyIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active.history.length > 0 && active.historyIndex !== -1) {
          if (active.historyIndex < active.history.length - 1) {
            active.historyIndex++;
            inputElem.value = active.history[active.historyIndex] || '';
          } else {
            active.historyIndex = -1;
            inputElem.value = '';
          }
        }
      } else if (e.key === 'c' && e.ctrlKey) {
        // Ctrl+C cancellation representation
        appendTerminalText(`^C\n`);
        inputElem.value = '';
      }
    });
  }

  runBtn?.addEventListener('click', () => executeTerminalCommand());

  clearBtn?.addEventListener('click', () => {
    const active = getActiveSession();
    if (active) {
      active.buffer = '';
      renderActiveBuffer();
    }
  });

  newTerminalBtn?.addEventListener('click', () => {
    createTerminalInstance();
  });

  collapseBtn?.addEventListener('click', () => {
    bottomPanel?.classList.toggle('collapsed');
  });

  // Focus terminal input when clicking anywhere on stdout area
  document.getElementById('terminal-stdout')?.addEventListener('click', () => {
    inputElem?.focus();
  });

  // Validation Suite triggers
  document.getElementById('btn-run-all-tests')?.addEventListener('click', runValidationTests);

  renderTerminalTabs();
  renderActiveBuffer();
  updatePromptDisplay();
}

export function getActiveSession() {
  return terminalInstances.find(t => t.id === activeTerminalId) || terminalInstances[0];
}

export function createTerminalInstance(name = 'powershell') {
  const newId = terminalInstances.length > 0 ? Math.max(...terminalInstances.map(t => t.id)) + 1 : 1;
  const newSession = new TerminalSession(newId, name);
  terminalInstances.push(newSession);
  switchTerminalInstance(newId);
  renderTerminalTabs();
}

export function switchTerminalInstance(id) {
  activeTerminalId = id;
  renderTerminalTabs();
  renderActiveBuffer();
  updatePromptDisplay();
  document.getElementById('terminal-command-input')?.focus();
}

export function closeTerminalInstance(id, event) {
  if (event) event.stopPropagation();

  if (terminalInstances.length <= 1) {
    // If only one, clear it instead of deleting
    const session = terminalInstances[0];
    session.buffer = '';
    renderActiveBuffer();
    return;
  }

  terminalInstances = terminalInstances.filter(t => t.id !== id);
  if (activeTerminalId === id) {
    activeTerminalId = terminalInstances[0].id;
  }

  renderTerminalTabs();
  renderActiveBuffer();
  updatePromptDisplay();
}

function renderTerminalTabs() {
  const container = document.getElementById('terminal-instance-tabs');
  if (!container) return;

  container.innerHTML = '';
  terminalInstances.forEach(term => {
    const isActive = term.id === activeTerminalId;
    const tabEl = document.createElement('div');
    tabEl.className = `terminal-instance-pill ${isActive ? 'active' : ''}`;
    tabEl.innerHTML = `
      <span>${term.id}: ${term.name}</span>
      <span class="terminal-close-btn" title="Kill Terminal">✕</span>
    `;

    tabEl.addEventListener('click', () => switchTerminalInstance(term.id));
    tabEl.querySelector('.terminal-close-btn')?.addEventListener('click', (e) => closeTerminalInstance(term.id, e));

    container.appendChild(tabEl);
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
    const defaultGreeting = `Orbital X Integrated Terminal [Version 0.1.0]\n(c) 2026 Orbital X Corp. Modern developer shell active.\n\nType commands directly and press Enter. ArrowUp/Down for history.`;
    stdoutElem.textContent = defaultGreeting;
  } else {
    stdoutElem.textContent = active.buffer;
  }

  stdoutElem.scrollTop = stdoutElem.scrollHeight;
}

export async function executeTerminalCommand(cmdString) {
  const stdoutElem = document.getElementById('terminal-stdout');
  const inputElem = document.getElementById('terminal-command-input');
  const active = getActiveSession();
  if (!active) return;

  const command = (cmdString || (inputElem ? inputElem.value : '')).trim();
  if (!command) return;

  if (inputElem) inputElem.value = '';
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

  // 3. Built-in: cd <dir>
  if (command.toLowerCase().startsWith('cd ') || command.toLowerCase() === 'cd') {
    const targetDir = command.substring(3).trim();
    if (targetDir) {
      active.cwd = targetDir;
      updatePromptDisplay();
      appendTerminalText(`\nPS ${active.cwd}>\n`);
    } else {
      appendTerminalText(`\n${active.cwd}\n`);
    }
    return;
  }

  // Append command to buffer
  const promptText = `\nPS ${active.cwd}> ${command}\n`;
  appendTerminalText(promptText);

  // Show inline progress indicator
  active.isRunning = true;

  try {
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
    logAudit(`Terminal: "${command}" -> exit ${res.exit_code}`);
  } catch (err) {
    appendTerminalText(`\nExecution Error: ${err}\n`);
    logAudit(`Terminal error: "${command}" -> ${err}`);
  } finally {
    active.isRunning = false;
    updatePromptDisplay();
    inputElem?.focus();
  }
}

function appendTerminalText(text) {
  const stdoutElem = document.getElementById('terminal-stdout');
  const active = getActiveSession();
  if (active) {
    active.buffer = (active.buffer || '') + text;
  }
  if (stdoutElem) {
    stdoutElem.textContent += text;
    stdoutElem.scrollTop = stdoutElem.scrollHeight;
  }
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
