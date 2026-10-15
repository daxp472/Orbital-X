// ==========================================================================
// Orbital X — Terminal & Validation Panel (terminal.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';

export function initTerminal() {
  const stdoutElem = document.getElementById('terminal-stdout');
  const inputElem = document.getElementById('terminal-command-input');
  const runBtn = document.getElementById('btn-run-terminal-command');
  const clearBtn = document.getElementById('btn-clear-terminal');
  const collapseBtn = document.getElementById('btn-collapse-panel');
  const bottomPanel = document.getElementById('bottom-panel');

  // Tab switching
  const tabs = document.querySelectorAll('.panel-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      document.getElementById('tab-content-terminal').style.display = target === 'terminal' ? 'flex' : 'none';
      document.getElementById('tab-content-validation').style.display = target === 'validation' ? 'block' : 'none';
      document.getElementById('tab-content-logs').style.display = target === 'logs' ? 'block' : 'none';
    });
  });

  if (runBtn && inputElem) {
    runBtn.addEventListener('click', () => executeTerminalCommand());
    inputElem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        executeTerminalCommand();
      }
    });
  }

  if (clearBtn && stdoutElem) {
    clearBtn.addEventListener('click', () => {
      stdoutElem.textContent = 'Terminal cleared.';
    });
  }

  if (collapseBtn && bottomPanel) {
    collapseBtn.addEventListener('click', () => {
      bottomPanel.classList.toggle('collapsed');
    });
  }

  // Validation Suite triggers
  document.getElementById('btn-run-all-tests')?.addEventListener('click', runValidationTests);
}

export async function executeTerminalCommand(cmdString) {
  const stdoutElem = document.getElementById('terminal-stdout');
  const inputElem = document.getElementById('terminal-command-input');

  const command = cmdString || (inputElem ? inputElem.value.trim() : '');
  if (!command) return;

  if (inputElem) inputElem.value = '';

  appendTerminalText(`\n$ ${command}\n[Running process in workspace...]`);

  try {
    const res = await invoke('run_command', {
      command,
      timeout_seconds: 45,
    });

    let output = '';
    if (res.stdout) output += res.stdout;
    if (res.stderr) output += `\n[STDERR]\n${res.stderr}`;

    const statusBadge = res.success
      ? `\n✓ Exited with code ${res.exit_code} (${res.duration_ms}ms)`
      : `\n✗ Exited with code ${res.exit_code ?? 'terminated'} (${res.duration_ms}ms)`;

    appendTerminalText(`${output}${statusBadge}\n`);
    logAudit(`Executed command: "${command}" -> Exit code: ${res.exit_code}`);
  } catch (err) {
    appendTerminalText(`\nExecution Error: ${err}\n`);
    logAudit(`Command failed: "${command}" -> Error: ${err}`);
  }
}

function appendTerminalText(text) {
  const stdoutElem = document.getElementById('terminal-stdout');
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
