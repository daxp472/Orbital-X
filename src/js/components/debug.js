// ==========================================================================
// Orbital X — Run and Debug Panel (debug.js)
// Production-grade codebase execution & debugging runner
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';
import { executeTerminalCommand } from './terminal.js';

let debugState = {
  activeFile: null,
  packageJsonScripts: {},
  hasCargoToml: false,
  hasPython: false,
  lastCommand: null,
  isRunning: false,
};

export function initDebug() {
  const railBtn = document.getElementById('rail-debug');
  railBtn?.addEventListener('click', () => {
    refreshDebugTargets();
  });

  // Re-check when workspace or active tab changes
  window.addEventListener('orbital-active-file-changed', (e) => {
    if (e.detail?.path) {
      debugState.activeFile = e.detail.path;
      renderDebugPanel();
    }
  });

  refreshDebugTargets();
}

export async function refreshDebugTargets() {
  const root = state.workspace.rootPath;
  debugState.activeFile = state.editor?.activeFile?.path || null;
  debugState.packageJsonScripts = {};
  debugState.hasCargoToml = false;
  debugState.hasPython = false;

  if (!root) {
    renderDebugPanel();
    return;
  }

  // 1. Detect package.json
  try {
    const pkgPath = root.endsWith('/') || root.endsWith('\\') ? `${root}package.json` : `${root}/package.json`;
    const pkgContent = await invoke('read_file', { path: pkgPath });
    if (pkgContent && pkgContent.content) {
      const parsed = JSON.parse(pkgContent.content);
      if (parsed.scripts && typeof parsed.scripts === 'object') {
        debugState.packageJsonScripts = parsed.scripts;
      }
    }
  } catch (err) {
    // No package.json or invalid JSON
  }

  // 2. Detect Cargo.toml
  try {
    const cargoPath = root.endsWith('/') || root.endsWith('\\') ? `${root}Cargo.toml` : `${root}/Cargo.toml`;
    const cargoContent = await invoke('read_file', { path: cargoPath });
    if (cargoContent && cargoContent.content) {
      debugState.hasCargoToml = true;
    }
  } catch (err) {
    // No Cargo.toml
  }

  renderDebugPanel();
}

function openTerminalAndRun(cmd) {
  debugState.lastCommand = cmd;
  debugState.isRunning = true;

  // Reveal bottom terminal panel if hidden
  const bottomPanel = document.getElementById('bottom-panel');
  if (bottomPanel) {
    bottomPanel.classList.remove('hidden');
    bottomPanel.style.display = 'flex';
  }
  const toggleBtn = document.getElementById('btn-toggle-bottom');
  if (toggleBtn) toggleBtn.classList.add('active');

  // Switch to terminal tab in bottom panel
  const termTab = document.querySelector('.panel-tab[data-tab="terminal"]');
  termTab?.click();

  // Execute in terminal
  executeTerminalCommand(cmd);
  showToast(`Running: ${cmd}`, 'info', 2200);
  renderDebugPanel();
}

export function renderDebugPanel() {
  const host = document.getElementById('view-debug');
  if (!host) return;

  const activePath = debugState.activeFile || state.editor?.activeFile?.path || '';
  const activeFileName = activePath ? activePath.split('/').pop().split('\\').pop() : 'No active file';
  const activeExt = activeFileName.includes('.') ? activeFileName.split('.').pop().toLowerCase() : '';

  // Determine active file runner command
  let runFileCmd = null;
  let debugFileCmd = null;

  if (activeExt === 'js' || activeExt === 'mjs' || activeExt === 'cjs') {
    runFileCmd = `node "${activeFileName}"`;
    debugFileCmd = `node --inspect-brk "${activeFileName}"`;
  } else if (activeExt === 'ts') {
    runFileCmd = `npx tsx "${activeFileName}"`;
    debugFileCmd = `node --loader ts-node/esm --inspect-brk "${activeFileName}"`;
  } else if (activeExt === 'py') {
    runFileCmd = `python "${activeFileName}"`;
    debugFileCmd = `python -m pdb "${activeFileName}"`;
  } else if (activeExt === 'rs') {
    runFileCmd = `cargo run`;
    debugFileCmd = `cargo test`;
  } else if (activeExt === 'sh') {
    runFileCmd = `bash "${activeFileName}"`;
  } else if (activeExt === 'html') {
    runFileCmd = `npx serve .`;
  }

  const scripts = Object.entries(debugState.packageJsonScripts);

  host.innerHTML = `
    <div class="sidebar-header" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Run and Debug</span>
      <div class="sidebar-actions">
        <button class="icon-btn" id="btn-refresh-debug" title="Refresh runnable targets">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>
      </div>
    </div>

    <div class="sidebar-content" style="padding: 12px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;">
      
      <!-- Primary Runner Card -->
      <div class="debug-card" style="background: var(--bg-surface-elevated, rgba(255,255,255,0.03)); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">
            Active Target
          </div>
          <span class="debug-status-pill ${debugState.isRunning ? 'running' : 'idle'}" style="font-size: 9.5px; padding: 2px 7px; border-radius: 10px; font-weight: 600; background: ${debugState.isRunning ? 'rgba(48,209,88,0.15)' : 'rgba(255,255,255,0.06)'}; color: ${debugState.isRunning ? '#30d158' : 'var(--text-muted)'};">
            ${debugState.isRunning ? '● RUNNING' : '○ IDLE'}
          </span>
        </div>

        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary-bright); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${activePath}">
          📄 ${escapeHtml(activeFileName)}
        </div>

        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
          ${activePath ? `Path: ${escapeHtml(activePath)}` : 'Open a source file to run it directly.'}
        </div>

        <div style="display:flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-run-active-file" ${!runFileCmd ? 'disabled' : ''} style="flex: 1; display:flex; align-items:center; justify-content:center; gap: 6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Run File
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-debug-active-file" ${!debugFileCmd ? 'disabled' : ''} style="flex: 1; display:flex; align-items:center; justify-content:center; gap: 6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line></svg>
            Debug
          </button>
        </div>
      </div>

      <!-- Custom Command Runner -->
      <div class="debug-card" style="background: var(--bg-surface-elevated, rgba(255,255,255,0.03)); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 8px;">
          ⚡ Quick Command Runner
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
          <input type="text" id="debug-custom-cmd" class="input-text" placeholder="npm run dev, npm test, etc." style="flex: 1; font-family: var(--font-mono); font-size: 11px; padding: 4px 8px;" value="${debugState.lastCommand ? escapeHtml(debugState.lastCommand) : ''}" />
          <button class="btn btn-primary btn-sm" id="btn-run-custom-cmd" style="padding: 4px 10px; font-size: 11px;">
            Run
          </button>
        </div>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm debug-chip" data-cmd="npm run dev" style="font-size: 10px; padding: 2px 7px;">npm run dev</button>
          <button class="btn btn-secondary btn-sm debug-chip" data-cmd="npm test" style="font-size: 10px; padding: 2px 7px;">npm test</button>
          <button class="btn btn-secondary btn-sm debug-chip" data-cmd="npm run build" style="font-size: 10px; padding: 2px 7px;">npm run build</button>
          ${debugState.hasCargoToml ? `<button class="btn btn-secondary btn-sm debug-chip" data-cmd="cargo test" style="font-size: 10px; padding: 2px 7px;">cargo test</button>` : ''}
        </div>
      </div>

      <!-- NPM Scripts Section -->
      ${scripts.length > 0 ? `
        <div class="debug-section">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 6px;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">
              📦 NPM Scripts (${scripts.length})
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${scripts.map(([name, cmd]) => `
              <div class="debug-script-row" style="display:flex; align-items:center; justify-content:space-between; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); transition: background 0.12s ease;">
                <div style="min-width: 0; flex: 1;">
                  <div style="font-size: 11.5px; font-weight: 600; color: var(--accent-cyan); font-family: var(--font-mono);">${escapeHtml(name)}</div>
                  <div style="font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(cmd)}">${escapeHtml(cmd)}</div>
                </div>
                <button class="btn btn-secondary btn-sm btn-run-npm-script" data-script="${escapeHtml(name)}" style="padding: 3px 8px; font-size: 10.5px; margin-left: 8px; display:inline-flex; align-items:center; gap: 4px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Run
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Cargo Section -->
      ${debugState.hasCargoToml ? `
        <div class="debug-section">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 6px;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">
              🦀 Cargo Workflows
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <button class="btn btn-secondary btn-sm btn-run-cargo" data-cmd="cargo test" style="display:flex; align-items:center; justify-content:center; gap: 5px;">
              🧪 cargo test
            </button>
            <button class="btn btn-secondary btn-sm btn-run-cargo" data-cmd="cargo run" style="display:flex; align-items:center; justify-content:center; gap: 5px;">
              ▶ cargo run
            </button>
            <button class="btn btn-secondary btn-sm btn-run-cargo" data-cmd="cargo check" style="display:flex; align-items:center; justify-content:center; gap: 5px;">
              🔍 cargo check
            </button>
            <button class="btn btn-secondary btn-sm btn-run-cargo" data-cmd="cargo build" style="display:flex; align-items:center; justify-content:center; gap: 5px;">
              ⚙ cargo build
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Guidance / Help Card -->
      <div style="background: rgba(57, 197, 187, 0.05); border: 1px solid rgba(57, 197, 187, 0.15); border-radius: 8px; padding: 10px; font-size: 11px; line-height: 1.5; color: var(--text-secondary);">
        <strong style="color: var(--accent-cyan);">💡 How Running & Debugging Works:</strong>
        <ul style="margin: 6px 0 0 16px; padding: 0;">
          <li>Commands execute directly inside the integrated terminal sandbox.</li>
          <li>Standard input, interactive debuggers, and watch loops stay live.</li>
          <li>Scripts in your <code style="color:var(--text-primary-bright); font-family:var(--font-mono);">package.json</code> or <code style="color:var(--text-primary-bright); font-family:var(--font-mono);">Cargo.toml</code> auto-appear here.</li>
        </ul>
      </div>

    </div>
  `;

  // Bind Listeners
  host.querySelector('#btn-refresh-debug')?.addEventListener('click', () => {
    refreshDebugTargets();
    showToast('Refreshed runnable targets', 'info', 1500);
  });

  const customInput = host.querySelector('#debug-custom-cmd');
  const runCustom = () => {
    const cmd = customInput?.value?.trim();
    if (cmd) openTerminalAndRun(cmd);
    else showToast('Please enter a command to run', 'warning', 2000);
  };

  host.querySelector('#btn-run-custom-cmd')?.addEventListener('click', runCustom);
  customInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCustom();
    }
  });

  host.querySelectorAll('.debug-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.getAttribute('data-cmd');
      if (cmd) openTerminalAndRun(cmd);
    });
  });

  host.querySelector('#btn-run-active-file')?.addEventListener('click', () => {
    if (runFileCmd) openTerminalAndRun(runFileCmd);
  });

  host.querySelector('#btn-debug-active-file')?.addEventListener('click', () => {
    if (debugFileCmd) openTerminalAndRun(debugFileCmd);
  });

  host.querySelectorAll('.btn-run-npm-script').forEach(btn => {
    btn.addEventListener('click', () => {
      const script = btn.getAttribute('data-script');
      if (script) openTerminalAndRun(`npm run ${script}`);
    });
  });

  host.querySelectorAll('.btn-run-cargo').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (cmd) openTerminalAndRun(cmd);
    });
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
