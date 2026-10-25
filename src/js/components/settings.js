// ==========================================================================
// Orbital X — Settings & Preferences Manager (settings.js)
// ==========================================================================

import { state, persistState, notify, setActiveModel } from '../state/store.js';
import { invoke, makeEventChannel } from '../services/tauri.js';
import { updateTheme } from '../editor/monaco.js';

export function initSettings() {
  const modal = document.getElementById('modal-settings');
  const openBtn = document.getElementById('btn-open-settings');
  const closeBtn = document.getElementById('btn-close-settings');
  const saveBtn = document.getElementById('btn-save-settings');

  // Menu item trigger
  document.getElementById('menu-settings')?.addEventListener('click', openSettings);

  if (openBtn) openBtn.addEventListener('click', openSettings);
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  if (saveBtn) saveBtn.addEventListener('click', saveAndClose);

  // Antigravity Sidebar Tab switching
  setupShortcutsTab();

  const tabs = [
    { btn: 'stab-general', pane: 'spane-general' },
    { btn: 'stab-models', pane: 'spane-models' },
    { btn: 'stab-appearance', pane: 'spane-appearance' },
    { btn: 'stab-shortcuts', pane: 'spane-shortcuts' },
    { btn: 'stab-agent', pane: 'spane-agent' },
    { btn: 'stab-terminal', pane: 'spane-terminal' },
    { btn: 'stab-importexport', pane: 'spane-importexport' },
  ];

  tabs.forEach(t => {
    document.getElementById(t.btn)?.addEventListener('click', () => {
      tabs.forEach(o => {
        document.getElementById(o.btn)?.classList.remove('active');
        const p = document.getElementById(o.pane);
        if (p) p.style.display = 'none';
      });
      document.getElementById(t.btn)?.classList.add('active');
      const targetPane = document.getElementById(t.pane);
      if (targetPane) targetPane.style.display = 'flex';

      if (t.btn === 'stab-models') {
        import('./usage.js').then(m => m.loadAndRenderUsage(true));
      }
    });
  });

  // Antigravity Security Mode Cards
  const modeCards = [
    { id: 'card-mode-pro', mode: 'agent_pro' },
    { id: 'card-mode-dev', mode: 'dev' },
    { id: 'card-mode-user', mode: 'user' },
  ];

  modeCards.forEach(c => {
    document.getElementById(c.id)?.addEventListener('click', () => {
      selectSecurityCard(c.mode);
      import('./agent.js').then(m => m.switchMode(c.mode));
    });
  });

  // Segmented group for Queued Messages
  document.querySelectorAll('#queued-msg-control .settings-segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#queued-msg-control .settings-segmented-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Test Connection Buttons
  document.getElementById('btn-test-anthropic')?.addEventListener('click', () => testConnection('anthropic'));
  document.getElementById('btn-test-openai')?.addEventListener('click', () => testConnection('openai'));
  document.getElementById('btn-test-gemini')?.addEventListener('click', () => testConnection('gemini'));
  document.getElementById('btn-test-ollama')?.addEventListener('click', () => testConnection('ollama'));

  // Ollama Model Manager (pull/delete/info/running)
  setupOllamaManagerUI();

  // Editor settings UI (appearance + formatting + inline autocomplete)
  setupEditorSettingsUI();

  // Settings overhaul: search, JSON editor, import/export/reset, editable keybindings
  setupSettingsOverhaul();

  // Terminal appearance settings (Part E4)
  setupTerminalSettingsUI();

  // Theme Select inside settings
  populateThemeDropdown();
  document.getElementById('cfg-theme-select')?.addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  // Default mode dropdown inside settings
  document.getElementById('cfg-default-mode')?.addEventListener('change', (e) => {
    selectSecurityCard(e.target.value);
    import('./agent.js').then(m => m.switchMode(e.target.value));
  });

  // Export / Import Settings
  document.getElementById('btn-export-settings')?.addEventListener('click', exportSettings);
  document.getElementById('btn-import-settings')?.addEventListener('click', importSettings);

  // Auto Save Setting Controls
  document.getElementById('cfg-auto-save')?.addEventListener('change', (e) => {
    if (!state.settings) state.settings = {};
    state.settings.autoSave = e.target.checked;
    persistState();
  });
  document.getElementById('cfg-auto-save-delay')?.addEventListener('change', (e) => {
    if (!state.settings) state.settings = {};
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 0) {
      state.settings.autoSaveDelay = val;
      persistState();
    }
  });
}

// ==========================================================================
// Ollama Model Manager — pull with live progress & cancellation, delete with
// confirmation, per-model info from /api/show, running models from /api/ps,
// and honest hardware-fit guidance (estimates clearly labelled).
// ==========================================================================

let activePullId = null;

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Rough memory-per-weight by quantization label — used ONLY for clearly
// labelled fit guidance, never displayed as a hard requirement.
function estimateModelMemoryGb(parameterSize, quantization) {
  const paramsMatch = String(parameterSize || '').match(/^([\d.]+)\s*B/i);
  if (!paramsMatch) return null;
  const paramsB = parseFloat(paramsMatch[1]);
  const q = String(quantization || '').toUpperCase();
  let bitsPerWeight = null;
  if (q.includes('F16') || q.includes('FP16')) bitsPerWeight = 17;
  else if (q.includes('Q8')) bitsPerWeight = 9;
  else if (q.includes('Q6')) bitsPerWeight = 7;
  else if (q.includes('Q5')) bitsPerWeight = 6;
  else if (q.includes('Q4')) bitsPerWeight = 5;
  else if (q.includes('Q3')) bitsPerWeight = 4;
  else if (q.includes('Q2')) bitsPerWeight = 3.5;
  else if (q.startsWith('F') || q.startsWith('BF')) bitsPerWeight = 17;
  return { paramsB, estimateGb: paramsB * bitsPerWeight / 8, bitsPerWeight };
}

let hardwareCache = null;
async function getHardware() {
  if (hardwareCache) return hardwareCache;
  try {
    hardwareCache = await invoke('get_hardware_info');
  } catch (e) {
    hardwareCache = { totalRamBytes: null, gpus: [] };
  }
  return hardwareCache;
}

function renderFitGuidance(info) {
  const est = estimateModelMemoryGb(info.parameter_size, info.quantization);
  if (!est) {
    return `<div style="font-size: 10px; color: var(--text-muted);">Memory fit: parameter size unknown — no estimate shown.</div>`;
  }
  const parts = [`<div style="font-size: 10px; color: var(--text-secondary);">Memory fit (estimated ≈${est.estimateGb.toFixed(1)} GB for ${info.parameter_size}${info.quantization ? ' ' + info.quantization : ''}): `];
  const hwPromise = getHardware();
  // Synchronous fallback frame; resolved asynchronously below
  parts.push(`<span class="fit-verdict" data-est-gb="${est.estimateGb}">checking hardware…</span></div>`);
  hwPromise.then((hw) => {
    const el = document.querySelector('.fit-verdict[data-est-gb]');
    if (!el) return;
    const lines = [];
    if (hw.totalRamBytes) {
      const ramGb = hw.totalRamBytes / (1024 ** 3);
      const ok = ramGb >= est.estimateGb + 2; // headroom for OS + app
      lines.push(`RAM ${ramGb.toFixed(0)} GB ${ok ? '✓' : '✗ (tight)'}`);
    }
    const gpu = (hw.gpus || []).find(g => g.vramBytes);
    if (gpu) {
      const vramGb = gpu.vramBytes / (1024 ** 3);
      lines.push(vramGb >= est.estimateGb
        ? `GPU ${vramGb.toFixed(0)} GB ✓ full offload likely (${gpu.name})`
        : `GPU ${vramGb.toFixed(0)} GB → partial offload/CPU spill likely`);
    } else if ((hw.gpus || []).length > 0) {
      lines.push(`GPU: ${hw.gpus[0].name} (VRAM not reported)`);
    } else {
      lines.push('GPU: not detected — CPU inference expected');
    }
    el.textContent = lines.join(' · ');
  });
  return parts.join('');
}

async function setupOllamaManagerUI() {
  const container = document.getElementById('ollama-manager-container');
  if (!container) return;

  container.innerHTML = `
    <div id="ollama-pull-container" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
      <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Pull New Ollama Model</div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" class="input-text" id="cfg-ollama-pull-name" placeholder="e.g. qwen2.5-coder:7b" style="flex: 1;" />
        <button type="button" class="btn btn-primary btn-sm" id="btn-ollama-pull" style="white-space: nowrap;">Pull Model</button>
        <button type="button" class="btn btn-danger btn-sm" id="btn-ollama-pull-cancel" style="display: none;">Cancel</button>
      </div>
      <div id="ollama-pull-progress-wrap" style="display: none; margin-top: 8px;">
        <div style="height: 8px; background: var(--bg-activity); border-radius: 4px; overflow: hidden;">
          <div id="ollama-pull-progress-bar" style="height: 100%; width: 0%; background: var(--accent-cyan); transition: width 0.3s ease;"></div>
        </div>
        <div id="ollama-pull-status" style="font-size: 11px; margin-top: 4px; min-height: 16px; color: var(--text-muted);"></div>
      </div>
    </div>
    <div id="ollama-models-section" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
      <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Installed Models</div>
      <div id="ollama-models-list" style="display: flex; flex-direction: column; gap: 4px;">
        <div style="font-size: 11px; color: var(--text-muted);">Loading…</div>
      </div>
    </div>
  `;

  const pullBtn = container.querySelector('#btn-ollama-pull');
  const cancelBtn = container.querySelector('#btn-ollama-pull-cancel');
  const pullInput = container.querySelector('#cfg-ollama-pull-name');
  const statusEl = container.querySelector('#ollama-pull-status');
  const progressWrap = container.querySelector('#ollama-pull-progress-wrap');
  const progressBar = container.querySelector('#ollama-pull-progress-bar');

  pullBtn?.addEventListener('click', async () => {
    const modelName = pullInput?.value.trim();
    if (!modelName) {
      if (statusEl) {
        statusEl.textContent = 'Please enter a model name to pull.';
        statusEl.style.color = 'var(--accent-orange)';
        progressWrap.style.display = 'block';
      }
      return;
    }

    const pullId = 'pull_' + Date.now();
    activePullId = pullId;
    pullBtn.disabled = true;
    pullBtn.innerHTML = `<span class="spinner"></span> Pulling…`;
    cancelBtn.style.display = 'inline-flex';
    progressWrap.style.display = 'block';
    progressBar.style.width = '0%';
    if (statusEl) {
      statusEl.innerHTML = `Contacting Ollama registry for <strong>${modelName}</strong>…`;
      statusEl.style.color = 'var(--accent-cyan)';
    }

    const channel = await makeEventChannel();
    if (channel) {
      channel.onmessage = (ev) => {
        if (!ev || ev.type !== 'pull_status') return;
        const pct = Number.isFinite(ev.percent) ? ev.percent : null;
        if (pct !== null) {
          progressBar.style.width = `${Math.min(100, pct)}%`;
          statusEl.innerHTML = `Downloading <strong>${modelName}</strong> — ${pct.toFixed(1)}% (${fmtBytes(ev.completed)} / ${fmtBytes(ev.total)})`;
        } else if (ev.status) {
          statusEl.innerHTML = `${ev.status} — <strong>${modelName}</strong>`;
        }
      };
    }

    try {
      const res = await invoke('ollama_pull_model', {
        name: modelName,
        endpoint: state.ai.endpoint,
        pullId,
        onEvent: channel,
      });
      if (res && res.success) {
        progressBar.style.width = '100%';
        statusEl.innerHTML = `✓ <strong>${modelName}</strong> downloaded and ready.`;
        statusEl.style.color = 'var(--accent-green)';
        const modelInput = document.getElementById('cfg-ollama-model');
        if (modelInput && !modelInput.value) {
          modelInput.value = modelName;
          state.ai.defaultModels.ollama = modelName;
        }
        loadOllamaModelsList();
      } else if (res && res.cancelled) {
        statusEl.innerHTML = `⏹ Pull of <strong>${modelName}</strong> cancelled.`;
        statusEl.style.color = 'var(--accent-orange)';
      } else {
        statusEl.innerHTML = `✗ ${(res && res.error) || 'Pull failed.'}`;
        statusEl.style.color = 'var(--accent-red)';
      }
    } catch (err) {
      statusEl.innerHTML = `✗ Error pulling model: ${err}`;
      statusEl.style.color = 'var(--accent-red)';
    } finally {
      activePullId = null;
      pullBtn.disabled = false;
      pullBtn.innerHTML = 'Pull Model';
      cancelBtn.style.display = 'none';
    }
  });

  cancelBtn?.addEventListener('click', async () => {
    if (!activePullId) return;
    try {
      await invoke('cancel_agent_operation', { opId: activePullId });
    } catch (e) {
      console.warn('Pull cancel failed:', e);
    }
  });

  loadOllamaModelsList();
}

async function loadOllamaModelsList() {
  const listEl = document.getElementById('ollama-models-list');
  if (!listEl) return;

  let models = [];
  let running = new Map();
  try {
    models = await invoke('get_ollama_models', { endpoint: state.ai.endpoint });
  } catch (e) {
    listEl.innerHTML = `<div style="font-size: 11px; color: var(--accent-orange);">Ollama not reachable at ${state.ai.endpoint}.</div>`;
    return;
  }
  try {
    const ps = await invoke('ollama_running_models', { endpoint: state.ai.endpoint });
    for (const m of (ps?.models || [])) {
      running.set(m.name || m.model, m);
    }
  } catch (e) { /* /api/ps unavailable on older Ollama — non-fatal */ }

  if (!models || models.length === 0) {
    listEl.innerHTML = `<div style="font-size: 11px; color: var(--text-muted);">No models installed yet — pull one above.</div>`;
    return;
  }

  listEl.innerHTML = '';
  for (const name of models) {
    const runInfo = running.get(name);
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px; background: var(--bg-activity); border: 1px solid var(--border-subtle); border-radius: 4px; font-size: 11px;';
    const isActive = state.ai.provider === 'ollama' && state.ai.model === name;
    row.innerHTML = `
      <div style="min-width: 0; flex: 1;">
        <strong style="color: ${isActive ? 'var(--accent-cyan)' : 'var(--text-primary)'};">${name}</strong>
        ${isActive ? '<span style="color: var(--accent-cyan); margin-left: 4px;">✓ active</span>' : ''}
        ${runInfo ? `<span title="Loaded in memory" style="color: var(--accent-green); margin-left: 4px;">● loaded${runInfo.size_vram_bytes ? ` (${fmtBytes(runInfo.size_vram_bytes)} VRAM)` : ''}</span>` : ''}
        <div class="model-info-detail" style="display: none; margin-top: 4px;"></div>
      </div>
      <div style="display: flex; gap: 4px; flex-shrink: 0;">
        <button class="btn btn-secondary btn-sm btn-model-info" style="padding: 1px 7px; font-size: 10px;">Info</button>
        <button class="btn btn-secondary btn-sm btn-model-use" style="padding: 1px 7px; font-size: 10px;">Use</button>
        <button class="btn btn-danger btn-sm btn-model-delete" style="padding: 1px 7px; font-size: 10px;">Delete</button>
      </div>
    `;

    row.querySelector('.btn-model-use')?.addEventListener('click', () => {
      setActiveModel('ollama', name);
      const modelInput = document.getElementById('cfg-ollama-model');
      if (modelInput) modelInput.value = name;
      loadOllamaModelsList();
    });

    row.querySelector('.btn-model-info')?.addEventListener('click', async (e) => {
      const detail = row.querySelector('.model-info-detail');
      if (detail.style.display === 'block') { detail.style.display = 'none'; return; }
      detail.style.display = 'block';
      detail.innerHTML = '<span style="color: var(--text-muted);">Querying model details…</span>';
      try {
        const info = await invoke('ollama_model_info', { name, endpoint: state.ai.endpoint });
        const ctx = info.context_length ? Number(info.context_length).toLocaleString() : 'unknown';
        const tools = info.supports_tools === null || info.supports_tools === undefined
          ? '<span style="color: var(--text-muted);">tool calling: unknown</span>'
          : (info.supports_tools
            ? '<span style="color: var(--accent-green);">tool calling ✓</span>'
            : '<span style="color: var(--accent-orange);">tool calling ✗ (JSON fallback only)</span>');
        detail.innerHTML = `
          <div style="font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px;">
            <span>params: ${info.parameter_size || 'unknown'}${info.quantization ? ` · ${info.quantization}` : ''}${info.family ? ` · ${info.family}` : ''}</span>
            <span>context: ${ctx} tokens</span>
            <span>${tools}</span>
          </div>
          ${renderFitGuidance(info)}
        `;
        // Cache real context length for engine auto-capping
        if (info.context_length) {
          state.ai.modelInfo = state.ai.modelInfo || {};
          state.ai.modelInfo[name] = {
            contextLength: info.context_length,
            parameterSize: info.parameter_size || null,
            quantization: info.quantization || null,
            supportsTools: info.supports_tools ?? null,
          };
          try { localStorage.setItem('orbital_model_info', JSON.stringify(state.ai.modelInfo)); } catch (err) { /* quota */ }
        }
      } catch (err) {
        detail.innerHTML = `<span style="color: var(--accent-red); font-size: 10px;">${err}</span>`;
      }
    });

    row.querySelector('.btn-model-delete')?.addEventListener('click', async (e) => {
      const confirmed = confirm(`Delete model "${name}" from Ollama? This frees disk space and cannot be undone (you can re-pull it later).`);
      if (!confirmed) return;
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const res = await invoke('ollama_delete_model', { name, endpoint: state.ai.endpoint });
        if (res && res.success) {
          showToast(`🗑️ Deleted model ${name}`, 'success', 3000);
          loadOllamaModelsList();
        } else {
          alert(`Delete failed: ${(res && res.error) || 'unknown error'}`);
          btn.disabled = false;
          btn.textContent = 'Delete';
        }
      } catch (err) {
        alert(`Delete failed: ${err}`);
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    });

    listEl.appendChild(row);
  }
}

function setupShortcutsTab() {
  const sidebar = document.querySelector('.settings-sidebar');
  const contentPane = document.querySelector('.settings-content-pane');
  if (!sidebar || !contentPane) return;

  const allTabs = [
    { btn: 'stab-general', pane: 'spane-general' },
    { btn: 'stab-models', pane: 'spane-models' },
    { btn: 'stab-appearance', pane: 'spane-appearance' },
    { btn: 'stab-shortcuts', pane: 'spane-shortcuts' },
    { btn: 'stab-agent', pane: 'spane-agent' },
    { btn: 'stab-terminal', pane: 'spane-terminal' },
    { btn: 'stab-importexport', pane: 'spane-importexport' },
  ];

  if (!document.getElementById('stab-shortcuts')) {
    const navItem = document.createElement('div');
    navItem.className = 'settings-nav-item';
    navItem.id = 'stab-shortcuts';
    navItem.setAttribute('data-pane', 'spane-shortcuts');
    navItem.innerHTML = `<span>⌨️</span> Shortcuts`;

    const refNav = document.getElementById('stab-appearance');
    if (refNav && refNav.nextSibling) {
      sidebar.insertBefore(navItem, refNav.nextSibling);
    } else {
      const impNav = document.getElementById('stab-importexport');
      if (impNav) {
        sidebar.insertBefore(navItem, impNav);
      } else {
        sidebar.appendChild(navItem);
      }
    }

    navItem.addEventListener('click', () => {
      allTabs.forEach(o => {
        document.getElementById(o.btn)?.classList.remove('active');
        const p = document.getElementById(o.pane);
        if (p) p.style.display = 'none';
      });
      navItem.classList.add('active');
      const targetPane = document.getElementById('spane-shortcuts');
      if (targetPane) targetPane.style.display = 'flex';
    });
  }

  if (!document.getElementById('spane-shortcuts')) {
    const pane = document.createElement('div');
    pane.id = 'spane-shortcuts';
    pane.className = 'settings-pane';
    pane.style.display = 'none';
    pane.style.flexDirection = 'column';
    pane.innerHTML = `
      <div class="settings-section-title">Keyboard Shortcuts</div>
      <div class="settings-section-desc">Quick reference of all keyboard shortcuts used in Orbital X.</div>
      <div class="settings-shortcuts-wrapper" style="margin-top: 6px;">
        <table class="settings-shortcuts-table">
          <thead>
            <tr>
              <th style="width: 55%; text-align: left;">Action</th>
              <th style="width: 45%; text-align: right;">Shortcut</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Send Message</td>
              <td><kbd>Enter</kbd></td>
            </tr>
            <tr>
              <td>New Line</td>
              <td><kbd>Shift</kbd> + <kbd>Enter</kbd></td>
            </tr>
            <tr>
              <td>Clear Chat</td>
              <td><kbd>Ctrl</kbd> + <kbd>L</kbd></td>
            </tr>
            <tr>
              <td>Open File</td>
              <td><kbd>Ctrl</kbd> + <kbd>P</kbd></td>
            </tr>
            <tr>
              <td>Find</td>
              <td><kbd>Ctrl</kbd> + <kbd>F</kbd></td>
            </tr>
            <tr>
              <td>Go to Line</td>
              <td><kbd>Ctrl</kbd> + <kbd>G</kbd></td>
            </tr>
            <tr>
              <td>Go to Definition</td>
              <td><kbd>F12</kbd></td>
            </tr>
            <tr>
              <td>Select All Occurrences</td>
              <td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd></td>
            </tr>
            <tr>
              <td>Zoom In / Out / Reset</td>
              <td><kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd></td>
            </tr>
            <tr>
              <td>Save</td>
              <td><kbd>Ctrl</kbd> + <kbd>S</kbd></td>
            </tr>
            <tr>
              <td>Toggle Terminal</td>
              <td><kbd>Ctrl</kbd> + <kbd>\`</kbd></td>
            </tr>
            <tr>
              <td>Toggle Primary Sidebar</td>
              <td><kbd>Ctrl</kbd> + <kbd>B</kbd></td>
            </tr>
            <tr>
              <td>Open Folder / Workspace</td>
              <td><kbd>Ctrl</kbd> + <kbd>O</kbd></td>
            </tr>
            <tr>
              <td>Open Settings</td>
              <td><kbd>Ctrl</kbd> + <kbd>,</kbd></td>
            </tr>
            <tr><td>Command Palette</td><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> / <kbd>F1</kbd></td></tr>
            <tr><td>Close Editor Tab</td><td><kbd>Ctrl</kbd> + <kbd>W</kbd></td></tr>
            <tr><td>Toggle Split Editor</td><td><kbd>Ctrl</kbd> + <kbd>\\</kbd></td></tr>
            <tr><td>Fold / Unfold Region</td><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>[</kbd> / <kbd>]</kbd></td></tr>
            <tr><td>Fold All / Unfold All</td><td><kbd>Ctrl</kbd>+<kbd>K</kbd> then <kbd>Ctrl</kbd>+<kbd>0</kbd> / <kbd>J</kbd></td></tr>
            <tr><td>Fold by Level 1–5</td><td><kbd>Ctrl</kbd>+<kbd>K</kbd> then <kbd>Ctrl</kbd>+<kbd>1…5</kbd></td></tr>
            <tr><td>Add Cursor Above / Below</td><td><kbd>Shift</kbd>+<kbd>Alt</kbd> / <kbd>Ctrl</kbd>+<kbd>Alt</kbd> + <kbd>↑/↓</kbd></td></tr>
            <tr><td>Cursor at End of Selected Lines</td><td><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd></td></tr>
            <tr><td>Column Selection</td><td><kbd>Shift</kbd> + <kbd>Alt</kbd> + drag</td></tr>
            <tr><td>Go to Symbol in File</td><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd></td></tr>
            <tr><td>Go to Symbol in Workspace</td><td><kbd>Ctrl</kbd> + <kbd>T</kbd></td></tr>
            <tr><td>Format Document</td><td><kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd></td></tr>
            <tr><td>Toggle Word Wrap</td><td><kbd>Alt</kbd> + <kbd>Z</kbd></td></tr>
          </tbody>
        </table>
      </div>
    `;
    contentPane.appendChild(pane);
  }
}

function selectSecurityCard(mode) {
  document.querySelectorAll('.security-card').forEach(card => card.classList.remove('active'));
  const cardId = mode === 'agent_pro' ? 'card-mode-pro' : (mode === 'user' ? 'card-mode-user' : 'card-mode-dev');
  document.getElementById(cardId)?.classList.add('active');
  const sel = document.getElementById('cfg-default-mode');
  if (sel) sel.value = mode;
}


// ==========================================================================
// Editor settings UI — minimap, sticky scroll, word wrap, indent, fonts
// (B3, B6-B9) and inline AI autocomplete (B1). Values live in
// state.settings.editor / state.settings.inlineComplete and are applied
// through monaco.applyEditorSettings().
// ==========================================================================

function setupEditorSettingsUI() {
  const appearancePane = document.getElementById('spane-appearance');
  if (appearancePane && !document.getElementById('cfg-minimap-side')) {
    const block = document.createElement('div');
    block.style.cssText = 'margin-top: 18px; display: flex; flex-direction: column; gap: 12px;';
    block.innerHTML = `
      <div style="font-size: 13px; font-weight: 600;">Editor Appearance</div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Minimap Side</label>
        <select class="select-input" id="cfg-minimap-side">
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Minimap Scale (1–3)</label>
        <input type="number" class="input-text" id="cfg-minimap-scale" min="1" max="3" step="0.5" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Minimap Slider</label>
        <select class="select-input" id="cfg-minimap-slider">
          <option value="always">Always</option>
          <option value="mouseover">On mouse over</option>
        </select>
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Sticky Scroll</span>
          <span class="settings-setting-caption">Pin the current scope opening lines at the top of the editor.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-sticky-scroll"><span class="settings-toggle-slider"></span></label></div>
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Minimap</span>
          <span class="settings-setting-caption">Overview minimap on the editor edge.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-editor-minimap-v2"><span class="settings-toggle-slider"></span></label></div>
      </div>
    `;
    appearancePane.appendChild(block);
    block.querySelector('#cfg-minimap-side').addEventListener('change', applyFromUI);
    block.querySelector('#cfg-minimap-scale').addEventListener('change', applyFromUI);
    block.querySelector('#cfg-minimap-slider').addEventListener('change', applyFromUI);
    block.querySelector('#cfg-sticky-scroll').addEventListener('change', applyFromUI);
    block.querySelector('#cfg-editor-minimap-v2').addEventListener('change', applyFromUI);
  }

  if (appearancePane && !document.getElementById('cfg-word-wrap')) {
    const fmt = document.createElement('div');
    fmt.style.cssText = 'margin-top: 18px; display: flex; flex-direction: column; gap: 12px;';
    fmt.innerHTML = `
      <div style="font-size: 13px; font-weight: 600;">Editor Formatting, Indent & Font</div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Word Wrap</label>
        <select class="select-input" id="cfg-word-wrap">
          <option value="off">Off</option>
          <option value="on">On (viewport)</option>
          <option value="wordWrapColumn">At column</option>
          <option value="bounded">Bounded</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Word Wrap Column</label>
        <input type="number" class="input-text" id="cfg-word-wrap-column" min="20" max="500" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Tab Size</label>
        <input type="number" class="input-text" id="cfg-tab-size" min="1" max="16" />
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Use Spaces for Indent</span>
          <span class="settings-setting-caption">Insert spaces instead of tab characters.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-insert-spaces"><span class="settings-toggle-slider"></span></label></div>
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Detect Indentation from Files</span>
          <span class="settings-setting-caption">Sniff each file's dominant indentation on open.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-detect-indent"><span class="settings-toggle-slider"></span></label></div>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Font Family</label>
        <input type="text" class="input-text" id="cfg-font-family" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Font Size (px)</label>
        <input type="number" class="input-text" id="cfg-font-size-v2" min="9" max="30" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Line Height</label>
        <input type="number" class="input-text" id="cfg-line-height" min="14" max="40" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Letter Spacing (px)</label>
        <input type="number" class="input-text" id="cfg-letter-spacing" min="-1" max="4" step="0.5" />
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Font Ligatures</span>
          <span class="settings-setting-caption">Join glyphs like => and != when the font supports it.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-font-ligatures"><span class="settings-toggle-slider"></span></label></div>
      </div>
    `;
    appearancePane.appendChild(fmt);
    fmt.querySelectorAll('input, select').forEach(el => el.addEventListener('change', applyFromUI));
  }

  const modelsPane = document.getElementById('spane-models');
  if (modelsPane && !document.getElementById('cfg-inline-complete')) {
    const ic = document.createElement('div');
    ic.style.cssText = 'background: var(--bg-surface); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); margin-top: 12px;';
    ic.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong>Inline AI Autocomplete</strong>
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Ghost text completions</span>
          <span class="settings-setting-caption">Complete code at the cursor with your AI provider after a short pause. Tab accepts, Escape dismisses.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-inline-complete"><span class="settings-toggle-slider"></span></label></div>
      </div>
      <div class="form-group" style="margin-top: 8px; margin-bottom: 0;">
        <label class="form-label">Completion Provider</label>
        <select class="select-input" id="cfg-inline-provider">
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI / compatible endpoint</option>
        </select>
      </div>
    `;
    modelsPane.appendChild(ic);
    ic.querySelector('#cfg-inline-complete').addEventListener('change', applyFromUI);
    ic.querySelector('#cfg-inline-provider').addEventListener('change', applyFromUI);
  }

  loadEditorSettingsIntoUI();
}

function loadEditorSettingsIntoUI() {
  import('../editor/monaco.js').then((mon) => {
    mon.applyEditorSettings(); // normalizes defaults into state.settings.editor
    const s = state.settings.editor || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    const check = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    set('cfg-minimap-side', s.minimapSide);
    set('cfg-minimap-scale', s.minimapScale);
    set('cfg-minimap-slider', s.minimapSlider);
    check('cfg-sticky-scroll', s.stickyScroll);
    check('cfg-editor-minimap-v2', s.minimap);
    set('cfg-word-wrap', s.wordWrap);
    set('cfg-word-wrap-column', s.wordWrapColumn);
    set('cfg-tab-size', s.tabSize);
    check('cfg-insert-spaces', s.insertSpaces);
    check('cfg-detect-indent', s.detectIndent);
    set('cfg-font-family', s.fontFamily);
    set('cfg-font-size-v2', s.fontSize);
    set('cfg-line-height', s.lineHeight);
    set('cfg-letter-spacing', s.letterSpacing);
    check('cfg-font-ligatures', s.fontLigatures);

    const ic = state.settings.inlineComplete || {};
    check('cfg-inline-complete', ic.enabled);
    set('cfg-inline-provider', ic.provider);
  });
}

function applyFromUI() {
  import('../editor/monaco.js').then((mon) => {
    const s = state.settings.editor || (state.settings.editor = {});
    const val = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      return el.type === 'checkbox' ? el.checked : el.value;
    };
    const num = (id, fallback) => {
      const v = parseFloat(val(id));
      return Number.isFinite(v) ? v : fallback;
    };

    s.minimap = val('cfg-editor-minimap-v2', s.minimap);
    s.minimapSide = val('cfg-minimap-side', s.minimapSide);
    s.minimapScale = num('cfg-minimap-scale', s.minimapScale);
    s.minimapSlider = val('cfg-minimap-slider', s.minimapSlider);
    s.stickyScroll = val('cfg-sticky-scroll', s.stickyScroll);
    s.wordWrap = val('cfg-word-wrap', s.wordWrap);
    s.wordWrapColumn = num('cfg-word-wrap-column', s.wordWrapColumn);
    s.tabSize = num('cfg-tab-size', s.tabSize);
    s.insertSpaces = val('cfg-insert-spaces', s.insertSpaces);
    s.detectIndent = val('cfg-detect-indent', s.detectIndent);
    s.fontFamily = val('cfg-font-family', s.fontFamily);
    s.fontSize = num('cfg-font-size-v2', s.fontSize);
    s.lineHeight = num('cfg-line-height', s.lineHeight);
    s.letterSpacing = num('cfg-letter-spacing', s.letterSpacing);
    s.fontLigatures = val('cfg-font-ligatures', s.fontLigatures);

    state.settings.inlineComplete = state.settings.inlineComplete || { enabled: false, provider: 'ollama' };
    state.settings.inlineComplete.enabled = val('cfg-inline-complete', state.settings.inlineComplete.enabled);
    state.settings.inlineComplete.provider = val('cfg-inline-provider', state.settings.inlineComplete.provider);
    try {
      localStorage.setItem('orbital_inline_complete', JSON.stringify(state.settings.inlineComplete));
    } catch (e) { /* quota */ }

    mon.applyEditorSettings();
  });
}

export function openSettings() {
  const modal = document.getElementById('modal-settings');
  if (!modal) return;
  setupShortcutsTab();
  setupOllamaManagerUI();
  setupEditorSettingsUI();

  // Workspace label
  const wsName = document.getElementById('settings-active-workspace-name');
  const wsPath = document.getElementById('settings-active-workspace-path');
  if (wsName) wsName.textContent = state.workspace?.name || 'Orbital X';
  if (wsPath) wsPath.textContent = state.workspace?.rootPath || 'Default Workspace';

  // Load current values into form inputs
  document.getElementById('cfg-anthropic-key').value = state.ai.keys.anthropic || '';
  document.getElementById('cfg-anthropic-model').value = state.ai.defaultModels.anthropic || 'claude-3-7-sonnet-20250219';

  document.getElementById('cfg-openai-key').value = state.ai.keys.openai || '';
  document.getElementById('cfg-openai-model').value = state.ai.defaultModels.openai || 'gpt-4o';
  document.getElementById('cfg-openai-baseurl').value = state.ai.openaiBaseUrl || '';

  document.getElementById('cfg-gemini-key').value = state.ai.keys.gemini || '';
  document.getElementById('cfg-gemini-model').value = state.ai.defaultModels.gemini || 'gemini-2.0-flash';

  document.getElementById('cfg-ollama-url').value = state.ai.endpoint || 'http://localhost:11434';
  document.getElementById('cfg-ollama-model').value = state.ai.defaultModels.ollama || 'llama3';

  // Local inference engine settings
  const s = state.ai.settings || {};
  const numCtxInput = document.getElementById('cfg-num-ctx');
  if (numCtxInput) numCtxInput.value = s.numCtx || 8192;
  // Model-aware hint: show the cached real limit for the default local model
  const numCtxHint = document.getElementById('numctx-hint');
  if (numCtxHint) {
    const defModel = state.ai.defaultModels.ollama;
    const info = (state.ai.modelInfo || {})[defModel];
    if (info && Number.isFinite(info.contextLength) && info.contextLength > 0) {
      numCtxHint.textContent = `Model "${defModel}" reports a real context limit of ${Number(info.contextLength).toLocaleString()} tokens — requests are capped to min(setting, model limit). Larger context uses more memory and can be slower per token; only raise it for tasks that need it.`;
    } else {
      numCtxHint.textContent = 'The effective context is automatically capped by each model\'s real limit once known (open a model\'s Info above, or select it in the model picker, to read it from Ollama).';
    }
  }
  const keepAliveSel = document.getElementById('cfg-keep-alive');
  if (keepAliveSel) keepAliveSel.value = s.keepAlive || '30m';
  const tempInput = document.getElementById('cfg-temperature');
  if (tempInput) tempInput.value = Number.isFinite(parseFloat(s.temperature)) ? s.temperature : 0.7;
  const numPredictInput = document.getElementById('cfg-num-predict');
  if (numPredictInput) numPredictInput.value = s.numPredict || 2048;
  const maxIterInput = document.getElementById('cfg-max-iterations');
  if (maxIterInput) maxIterInput.value = s.maxIterations || 30;

  populateThemeDropdown();
  selectSecurityCard(state.agentMode);

  // Auto Save values
  const autoSaveToggle = document.getElementById('cfg-auto-save');
  if (autoSaveToggle) {
    autoSaveToggle.checked = state.settings?.autoSave ?? true;
  }
  const autoSaveDelayInput = document.getElementById('cfg-auto-save-delay');
  if (autoSaveDelayInput) {
    autoSaveDelayInput.value = state.settings?.autoSaveDelay ?? 1000;
  }

  // Load live token usage directly
  import('./usage.js').then(m => m.loadAndRenderUsage(true));

  modal.style.display = 'flex';
}

export function closeSettings() {
  const modal = document.getElementById('modal-settings');
  if (modal) modal.style.display = 'none';
}

function saveAndClose() {
  state.ai.keys.anthropic = document.getElementById('cfg-anthropic-key').value.trim();
  state.ai.defaultModels.anthropic = document.getElementById('cfg-anthropic-model').value.trim() || 'claude-3-7-sonnet-20250219';

  state.ai.keys.openai = document.getElementById('cfg-openai-key').value.trim();
  state.ai.defaultModels.openai = document.getElementById('cfg-openai-model').value.trim() || 'gpt-4o';
  state.ai.openaiBaseUrl = document.getElementById('cfg-openai-baseurl').value.trim();

  state.ai.keys.gemini = document.getElementById('cfg-gemini-key').value.trim();
  state.ai.defaultModels.gemini = document.getElementById('cfg-gemini-model').value.trim() || 'gemini-2.0-flash';

  state.ai.endpoint = document.getElementById('cfg-ollama-url').value.trim() || 'http://localhost:11434';
  const newOllamaModel = document.getElementById('cfg-ollama-model').value.trim() || 'llama3';
  state.ai.defaultModels.ollama = newOllamaModel;

  // Local inference engine settings
  if (!state.ai.settings) state.ai.settings = {};
  const numCtxVal = parseInt(document.getElementById('cfg-num-ctx')?.value, 10);
  if (Number.isFinite(numCtxVal) && numCtxVal >= 1024) state.ai.settings.numCtx = numCtxVal;
  const keepAliveVal = document.getElementById('cfg-keep-alive')?.value;
  if (keepAliveVal) state.ai.settings.keepAlive = keepAliveVal;
  const tempVal = parseFloat(document.getElementById('cfg-temperature')?.value);
  if (Number.isFinite(tempVal) && tempVal >= 0 && tempVal <= 2) state.ai.settings.temperature = tempVal;
  const numPredictVal = parseInt(document.getElementById('cfg-num-predict')?.value, 10);
  if (Number.isFinite(numPredictVal) && numPredictVal >= 128) state.ai.settings.numPredict = numPredictVal;
  const maxIterVal = parseInt(document.getElementById('cfg-max-iterations')?.value, 10);
  if (Number.isFinite(maxIterVal) && maxIterVal >= 1 && maxIterVal <= 100) state.ai.settings.maxIterations = maxIterVal;

  const mode = document.getElementById('cfg-default-mode')?.value || state.agentMode;
  import('./agent.js').then(m => m.switchMode(mode));

  // If current active provider is ollama (or whichever), update active model
  const activeModel = state.ai.provider === 'ollama' ? newOllamaModel :
    state.ai.provider === 'anthropic' ? state.ai.defaultModels.anthropic :
    state.ai.provider === 'openai' ? state.ai.defaultModels.openai :
    state.ai.defaultModels.gemini;

  import('../state/store.js').then(({ setActiveModel }) => {
    setActiveModel(state.ai.provider, activeModel);
  });

  const selectedTheme = document.getElementById('cfg-theme-select')?.value || state.theme;
  applyTheme(selectedTheme);

  // Editor font size
  const fontInput = document.getElementById('cfg-font-size');
  if (fontInput) {
    const fs = parseInt(fontInput.value, 10);
    if (!isNaN(fs) && fs >= 10 && fs <= 24) {
      state.editor.fontSize = fs;
      import('../editor/monaco.js').then(m => m.updateFontSize(fs));
    }
  }

  // Workspace Trust notice
  const trustChecked = document.getElementById('cfg-trust-workspace')?.checked;
  if (trustChecked) {
    localStorage.setItem('orbital_workspace_trusted', 'true');
  }

  // Auto Save settings
  if (!state.settings) state.settings = {};
  const autoSaveToggle = document.getElementById('cfg-auto-save');
  if (autoSaveToggle) {
    state.settings.autoSave = autoSaveToggle.checked;
  }
  const autoSaveDelayInput = document.getElementById('cfg-auto-save-delay');
  if (autoSaveDelayInput) {
    const val = parseInt(autoSaveDelayInput.value, 10);
    if (!isNaN(val) && val >= 0) {
      state.settings.autoSaveDelay = val;
    }
  }

  persistState();
  closeSettings();
}

function populateThemeDropdown() {
  const sel = document.getElementById('cfg-theme-select');
  if (!sel) return;
  sel.innerHTML = `
    <option value="theme-dark">Dark (Default)</option>
    <option value="theme-light">Light</option>
    <option value="theme-hc">High Contrast</option>
  `;
  const current = (state.theme === 'nebula-light' || state.theme === 'theme-light' || state.theme === 'light') ? 'theme-light' :
    (state.theme === 'theme-hc' || state.theme === 'hc' || state.theme === 'high-contrast') ? 'theme-hc' : 'theme-dark';
  sel.value = current;
}

export function applyTheme(themeName) {
  let norm = 'theme-dark';
  if (themeName === 'theme-light' || themeName === 'nebula-light' || themeName === 'light') {
    norm = 'theme-light';
  } else if (themeName === 'theme-hc' || themeName === 'hc' || themeName === 'high-contrast') {
    norm = 'theme-hc';
  } else {
    norm = 'theme-dark';
  }

  state.theme = norm;

  // Toggle class on document.body (theme-dark / theme-light / theme-hc)
  document.body.classList.remove('theme-dark', 'theme-light', 'theme-hc');
  document.body.classList.add(norm);

  // Set data-theme on documentElement for styling compatibility
  const legacyDataTheme = norm === 'theme-light' ? 'nebula-light' : (norm === 'theme-hc' ? 'theme-hc' : 'orbit-dark');
  document.documentElement.setAttribute('data-theme', legacyDataTheme);

  // Persist to localStorage
  localStorage.setItem('orbital_theme', norm);

  updateTheme(legacyDataTheme);
  persistState();
  notify('themeChanged', norm);
}

export function cycleTheme() {
  const themes = ['theme-dark', 'theme-light', 'theme-hc'];
  const currentIndex = themes.indexOf(state.theme);
  const nextTheme = themes[(currentIndex + 1) % themes.length];
  applyTheme(nextTheme);
}

async function testConnection(provider) {
  let key = '';
  let model = '';
  let baseUrl = null;

  if (provider === 'anthropic') {
    key = document.getElementById('cfg-anthropic-key').value.trim();
    model = document.getElementById('cfg-anthropic-model').value.trim();
  } else if (provider === 'openai') {
    key = document.getElementById('cfg-openai-key').value.trim();
    model = document.getElementById('cfg-openai-model').value.trim();
    // Custom OpenAI-compatible local servers (LM Studio, llama.cpp, vLLM…)
    const customUrl = document.getElementById('cfg-openai-baseurl')?.value.trim();
    baseUrl = customUrl ? customUrl : null;
  } else if (provider === 'gemini') {
    key = document.getElementById('cfg-gemini-key').value.trim();
    model = document.getElementById('cfg-gemini-model').value.trim();
  } else if (provider === 'ollama') {
    baseUrl = document.getElementById('cfg-ollama-url').value.trim();
    model = document.getElementById('cfg-ollama-model').value.trim();
  }

  const btnId = `btn-test-${provider}`;
  const btn = document.getElementById(btnId);
  if (btn) btn.innerHTML = `<span class="spinner"></span> Testing...`;

  try {
    const res = await invoke('test_provider_connection', {
      provider,
      apiKey: key,
      model,
      baseUrl,
    });

    if (btn) {
      if (res.success) {
        btn.innerHTML = `✓ Connected`;
        btn.style.color = 'var(--accent-green)';
      } else {
        btn.innerHTML = `✗ Failed`;
        btn.style.color = 'var(--accent-red)';
      }
      setTimeout(() => {
        btn.innerHTML = 'Test Connection';
        btn.style.color = '';
      }, 3500);
    }

    alert(res.message);
  } catch (err) {
    if (btn) {
      btn.innerHTML = 'Test Connection';
    }
    alert("Connection test error: " + err);
  }
}

function exportSettings() {
  // PRD Requirement: Never export raw API keys by default!
  const config = {
    version: "1.0",
    theme: state.theme,
    agentMode: state.agentMode,
    defaultModels: state.ai.defaultModels,
    endpoint: state.ai.endpoint,
    editorFontSize: state.editor.fontSize,
  };

  const jsonStr = JSON.stringify(config, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orbital-x-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.theme) applyTheme(imported.theme);
        if (imported.agentMode) state.agentMode = imported.agentMode;
        if (imported.defaultModels) state.ai.defaultModels = { ...state.ai.defaultModels, ...imported.defaultModels };
        if (imported.endpoint) state.ai.endpoint = imported.endpoint;

        persistState();
        alert("Settings successfully imported!");
        closeSettings();
      } catch (err) {
        alert("Malformed settings file: " + err);
      }
    };
    reader.readAsText(file);
  };

  input.click();
}


// ==========================================================================
// Settings overhaul (Part G)
// ==========================================================================

import { getAllBindings, setBinding, resetBinding, findConflict, comboFromEvent } from '../services/keybindings.js';

function markSettingsModified() {
  try {
    localStorage.setItem('orbital_settings_modified_at', new Date().toISOString());
  } catch (e) { /* quota */ }
  const statusEl = document.getElementById('settings-save-status');
  if (statusEl) statusEl.textContent = `Last modified: ${new Date().toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// G2 — settings search across every pane
// ---------------------------------------------------------------------------

function setupSettingsSearch() {
  const content = document.querySelector('.settings-content-pane');
  if (!content || document.getElementById('settings-search-input')) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding: 0 0 10px 0; position: sticky; top: 0; background: inherit; z-index: 5;';
  wrap.innerHTML = `
    <input type="text" id="settings-search-input" class="input-text" placeholder="Search settings… (labels, descriptions)" style="width: 100%; font-size: 12px;" />
    <div id="settings-search-count" style="font-size: 10px; color: var(--text-muted); margin-top: 3px; display: none;"></div>
  `;
  content.insertBefore(wrap, content.firstChild);

  const input = wrap.querySelector('#settings-search-input');
  input.addEventListener('input', () => filterSettings(input.value.trim()));
}

function highlightText(el, term) {
  // Wraps case-insensitive matches of term inside el's direct text with <mark>
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  const lower = term.toLowerCase();
  for (const node of nodes) {
    const text = node.nodeValue;
    const idx = text.toLowerCase().indexOf(lower);
    if (idx === -1) continue;
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.style.cssText = 'background: color-mix(in srgb, var(--accent-cyan) 35%, transparent); color: inherit; border-radius: 2px;';
    mark.textContent = text.slice(idx, idx + term.length);
    frag.appendChild(mark);
    frag.appendChild(document.createTextNode(text.slice(idx + term.length)));
    node.replaceWith(frag);
  }
}

function clearHighlights(root) {
  root.querySelectorAll('mark').forEach(m => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  root.normalize();
}

function filterSettings(term) {
  const panes = [...document.querySelectorAll('.settings-pane')];
  const countEl = document.getElementById('settings-search-count');
  clearHighlights(document.querySelector('.settings-content-pane') || document.body);

  if (!term) {
    countEl.style.display = 'none';
    // Restore normal single-tab view: show only the active tab's pane
    const activeBtn = document.querySelector('.settings-nav-item.active');
    const activePane = activeBtn ? document.getElementById(activeBtn.dataset.pane || activeBtn.getAttribute('data-pane')) : null;
    panes.forEach(p => { p.style.display = (p === activePane) ? 'flex' : 'none'; });
    return;
  }

  const lower = term.toLowerCase();
  let matches = 0;
  panes.forEach(pane => {
    let paneHasMatch = false;
    const rows = pane.querySelectorAll('.settings-setting-row, .form-group, .settings-section-title, .settings-section-desc');
    rows.forEach(row => {
      const label = row.querySelector('.settings-setting-label, .form-label, .settings-section-title');
      const desc = row.querySelector('.settings-setting-caption, .settings-section-desc');
      const labelTxt = (label?.textContent || (row.classList.contains('settings-section-title') ? row.textContent : '')).toLowerCase();
      const descTxt = (desc?.textContent || '').toLowerCase();
      const hit = labelTxt.includes(lower) || descTxt.includes(lower);
      if (row.classList.contains('settings-section-title') || row.classList.contains('settings-section-desc')) {
        row.style.display = ''; // keep headers visible in matched panes
        return;
      }
      if (hit) {
        paneHasMatch = true;
        matches++;
        row.style.display = '';
        highlightText(row, term);
      } else {
        row.style.display = 'none';
      }
    });
    pane.style.display = paneHasMatch ? 'flex' : 'none';
  });

  countEl.style.display = '';
  countEl.textContent = `${matches} setting${matches === 1 ? '' : 's'} match “${term}”`;
}

// ---------------------------------------------------------------------------
// G1 — settings.json editor + G3 — export/import/reset
// ---------------------------------------------------------------------------

function collectAllSettings() {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    theme: state.theme,
    agentMode: state.agentMode,
    autoSave: state.settings.autoSave,
    autoSaveDelay: state.settings.autoSaveDelay,
    editor: state.settings.editor || {},
    terminal: state.settings.terminal || {},
    inlineComplete: state.settings.inlineComplete || { enabled: false, provider: 'ollama' },
    defaultModels: state.ai.defaultModels,
    endpoint: state.ai.endpoint,
    openaiBaseUrl: state.ai.openaiBaseUrl || '',
    // API keys are intentionally EXCLUDED from exports (security)
  };
}

async function applyImportedSettings(obj) {
  if (typeof obj.theme === 'string') applyTheme(obj.theme);
  if (typeof obj.agentMode === 'string' && ['agent_pro', 'dev', 'user'].includes(obj.agentMode)) {
    import('./agent.js').then(m => m.switchMode(obj.agentMode));
  }
  if (typeof obj.autoSave === 'boolean') state.settings.autoSave = obj.autoSave;
  if (Number.isFinite(obj.autoSaveDelay)) state.settings.autoSaveDelay = obj.autoSaveDelay;
  if (obj.editor && typeof obj.editor === 'object') state.settings.editor = { ...(state.settings.editor || {}), ...obj.editor };
  if (obj.terminal && typeof obj.terminal === 'object') state.settings.terminal = { ...(state.settings.terminal || {}), ...obj.terminal };
  if (obj.inlineComplete && typeof obj.inlineComplete === 'object') state.settings.inlineComplete = { ...(state.settings.inlineComplete || {}), ...obj.inlineComplete };
  if (obj.defaultModels && typeof obj.defaultModels === 'object') state.ai.defaultModels = { ...state.ai.defaultModels, ...obj.defaultModels };
  if (typeof obj.endpoint === 'string') state.ai.endpoint = obj.endpoint;
  if (typeof obj.openaiBaseUrl === 'string') state.ai.openaiBaseUrl = obj.openaiBaseUrl;

  persistState();
  markSettingsModified();
  const mon = await import('../editor/monaco.js');
  mon.applyEditorSettings();
  const term = await import('./terminal.js');
  if (typeof term.applyTerminalAppearance === 'function') term.applyTerminalAppearance();
}

async function openSettingsJsonEditor() {
  document.getElementById('modal-settings-json')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-settings-json';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="width: 760px; max-width: 94vw; height: 78vh; display: flex; flex-direction: column; padding: 12px; gap: 8px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <strong style="font-size: 13px;">settings.json</strong>
        <span style="font-size: 11px; color: var(--text-muted);">Direct JSON editing — every setting, validated on save. API keys are never included.</span>
        <span id="settings-json-error" style="font-size: 11px; color: var(--accent-red); margin-left: auto;"></span>
      </div>
      <div id="settings-json-editor-host" style="flex: 1; min-height: 0; border: 1px solid var(--border-color); border-radius: var(--radius-sm);"></div>
      <div style="display:flex; gap:8px; justify-content: flex-end;">
        <button class="btn btn-secondary btn-sm" id="settings-json-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="settings-json-save">Save & Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const monacoMod = await import('monaco-editor');
  const current = collectAllSettings();
  delete current.exportedAt;
  const ed = monacoMod.editor.create(document.getElementById('settings-json-editor-host'), {
    value: JSON.stringify(current, null, 2),
    language: 'json',
    theme: 'orbital-dark-theme',
    automaticLayout: true,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    minimap: { enabled: false },
    tabSize: 2,
  });

  modal.querySelector('#settings-json-cancel').addEventListener('click', () => {
    ed.dispose();
    modal.remove();
  });
  modal.querySelector('#settings-json-save').addEventListener('click', async () => {
    const errEl = modal.querySelector('#settings-json-error');
    errEl.textContent = '';
    try {
      const parsed = JSON.parse(ed.getValue());
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Root must be a JSON object');
      }
      await applyImportedSettings(parsed);
      ed.dispose();
      modal.remove();
      showToast('settings.json applied', 'success', 2500);
      openSettings(); // refresh form fields
    } catch (e) {
      errEl.textContent = `Invalid: ${e.message}`;
    }
  });
}

function resetAllSettingsToDefaults() {
  if (!confirm('Reset ALL settings to defaults?\n\nThis clears themes, models, editor/terminal preferences, custom keybindings, and toggles (API keys are kept). The app reloads afterwards.')) return;
  const keysToClear = [
    'orbital_theme', 'orbital_mode', 'orbital_provider', 'orbital_model', 'orbital_endpoint',
    'orbital_openai_base_url', 'orbital_default_models', 'orbital_ai_settings', 'orbital_autosave',
    'orbital_autosave_delay', 'orbital_editor_settings', 'orbital_terminal_settings',
    'orbital_terminal_meta', 'orbital_terminal_custom_shells', 'orbital_inline_complete',
    'orbital_custom_keybindings', 'orbital_palette_mru',
  ];
  for (const k of keysToClear) localStorage.removeItem(k);
  location.reload();
}

function enhanceImportExport() {
  const exportBtn = document.getElementById('btn-export-settings');
  const importBtn = document.getElementById('btn-import-settings');

  if (exportBtn && !exportBtn.dataset.overhauled) {
    // Clone-replace to drop the legacy export listener (avoid double downloads)
    exportBtn.replaceWith(exportBtn.cloneNode(true));
    const exportBtnFresh = document.getElementById('btn-export-settings');
    exportBtnFresh.dataset.overhauled = '1';
    exportBtnFresh.addEventListener('click', () => {
      const config = collectAllSettings();
      const jsonStr = JSON.stringify(config, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orbital-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      markSettingsModified();
      showToast('Settings exported (API keys excluded)', 'success', 2500);
    });
  }

  if (importBtn && !importBtn.dataset.overhauled) {
    importBtn.dataset.overhauled = '1';
    // Replace the legacy handler's file input with a validated one
    importBtn.replaceWith(importBtn.cloneNode(true));
    const fresh = document.getElementById('btn-import-settings');
    fresh.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const hasKnown = ['theme', 'agentMode', 'editor', 'terminal', 'defaultModels', 'endpoint', 'inlineComplete', 'autoSave']
            .some(k => k in parsed);
          if (!hasKnown) throw new Error('no recognized Orbital X settings keys found');
          if (!confirm(`Import settings from "${file.name}"? Current matching settings will be overwritten (API keys are never imported).`)) return;
          await applyImportedSettings(parsed);
          showToast('Settings imported & applied', 'success', 2800);
          markSettingsModified();
          closeSettings();
        } catch (err) {
          alert(`Import failed — invalid settings file: ${err.message}`);
        }
      };
      input.click();
    });
  }

  // Bottom bar: settings.json + Reset + last-modified timestamp
  const saveBtn = document.getElementById('btn-save-settings');
  const bottomBar = saveBtn?.parentElement;
  if (bottomBar && !document.getElementById('btn-open-settings-json')) {
    const jsonBtn = document.createElement('button');
    jsonBtn.className = 'btn btn-secondary btn-sm';
    jsonBtn.id = 'btn-open-settings-json';
    jsonBtn.textContent = 'settings.json';
    jsonBtn.title = 'Edit all settings as JSON';
    jsonBtn.addEventListener('click', openSettingsJsonEditor);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-danger btn-sm';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', resetAllSettingsToDefaults);
    const spacer = document.createElement('span');
    spacer.style.cssText = 'display:flex; gap:6px; align-items:center;';
    spacer.append(jsonBtn, resetBtn);
    bottomBar.insertBefore(spacer, saveBtn);
  }
  markSettingsModified(); // shows the stored timestamp
}

// ---------------------------------------------------------------------------
// G4 — editable keybindings table
// ---------------------------------------------------------------------------

function buildEditableShortcutsTable() {
  const host = document.getElementById('spane-shortcuts');
  if (!host) return;
  const wrapper = host.querySelector('.settings-shortcuts-wrapper') || host;
  wrapper.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'settings-shortcuts-table';
  table.style.cssText = 'width: 100%; font-size: 11px; border-collapse: collapse;';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="text-align:left; padding: 4px 6px;">Action</th>
        <th style="text-align:left; padding: 4px 6px;">Shortcut</th>
        <th style="text-align:right; padding: 4px 6px;">Scope</th>
      </tr>
    </thead>
    <tbody id="keybindings-tbody"></tbody>
  `;
  wrapper.appendChild(table);

  renderKeybindingRows();

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size: 10px; color: var(--text-muted); margin-top: 8px;';
  hint.textContent = 'Click Edit, then press the key combination. Conflicts are rejected. Editor-scoped bindings rebind immediately; app bindings apply on the next keypress.';
  wrapper.appendChild(hint);
}

function renderKeybindingRows() {
  const tbody = document.getElementById('keybindings-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const b of getAllBindings()) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-top: 1px solid var(--border-subtle);';
    tr.innerHTML = `
      <td style="padding: 4px 6px;">
        ${b.title}${b.isCustom ? ' <span style="color: var(--accent-cyan); font-size: 9px;">custom</span>' : ''}
      </td>
      <td style="padding: 4px 6px;" class="kb-combo-cell">
        <kbd class="kb-combo">${escapeHtml(b.combo)}</kbd>
      </td>
      <td style="padding: 4px 6px; text-align: right; white-space: nowrap;">
        <span style="color: var(--text-muted); font-size: 10px;">${b.scope === 'editor' ? 'Editor' : 'App'}</span>
        <button class="btn btn-secondary btn-sm kb-edit" style="padding: 1px 7px; font-size: 10px;">Edit</button>
        ${b.isCustom ? '<button class="btn btn-secondary btn-sm kb-reset" style="padding: 1px 7px; font-size: 10px;">Reset</button>' : ''}
      </td>
    `;
    tr.querySelector('.kb-edit')?.addEventListener('click', () => startRecording(tr, b.id));
    tr.querySelector('.kb-reset')?.addEventListener('click', async () => {
      resetBinding(b.id);
      await import('../editor/monaco.js').then(m => m.rebindEditorCommands());
      renderKeybindingRows();
      showToast(`Reset “${b.title}” to ${b.combo}`, 'success', 2000);
    });
    tbody.appendChild(tr);
  }
}

function startRecording(tr, bindingId) {
  const cell = tr.querySelector('.kb-combo-cell');
  const original = cell.innerHTML;
  cell.innerHTML = `<span class="kb-recording">Press keys… (Esc to cancel)</span>`;
  tr.querySelectorAll('button').forEach(b => (b.disabled = true));

  const onKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      cleanup();
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return; // still pressing modifiers

    const conflict = findConflict(bindingId, combo);
    if (conflict) {
      cell.innerHTML = `<span class="kb-recording" style="color: var(--accent-red);">“${combo}” conflicts with “${conflict}” — try again (Esc to cancel)</span>`;
      return;
    }
    const ok = setBinding(bindingId, combo);
    if (ok) {
      await import('../editor/monaco.js').then(m => m.rebindEditorCommands());
      renderKeybindingRows();
      showToast(`Shortcut set: ${combo}`, 'success', 1800);
    }
    cleanup();
  };

  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    renderKeybindingRows(); // restores buttons + combo display
  }
  window.addEventListener('keydown', onKey, true);
}

// ---------------------------------------------------------------------------
// G5 — workspace settings
// ---------------------------------------------------------------------------

async function refreshWorkspaceSettings() {
  try {
    const res = await invoke('read_file', { path: '.orbital/settings.json' });
    let parsed = {};
    try { parsed = JSON.parse(res.content || '{}'); } catch (e) { parsed = {}; }
    state.settings.workspace = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    state.settings.workspace = {};
  }
  const mon = await import('../editor/monaco.js');
  mon.applyEditorSettings();
  updateWorkspaceBadge();
}

function updateWorkspaceBadge() {
  const badgeEl = document.getElementById('workspace-overrides-badge');
  if (!badgeEl) return;
  const wsEd = state.settings.workspace?.editor || {};
  const keys = ['tabSize', 'wordWrap', 'wordWrapColumn', 'detectIndent'].filter(k => wsEd[k] !== undefined);
  if (keys.length > 0) {
    badgeEl.style.display = '';
    badgeEl.textContent = `Workspace overrides active: ${keys.join(', ')} (from .orbital/settings.json)`;
  } else {
    badgeEl.style.display = 'none';
  }
}

async function openWorkspaceSettingsFile() {
  try {
    let fileData;
    try {
      fileData = await invoke('read_file', { path: '.orbital/settings.json' });
    } catch (e) {
      // Create with a template on first open
      const template = JSON.stringify({
        $schema: 'Workspace overrides. Values here win over global settings for this workspace.',
        editor: { tabSize: 2, wordWrap: 'on', detectIndent: true },
      }, null, 2);
      await invoke('save_file', { path: '.orbital/settings.json', content: template, description: 'Workspace settings created' });
      fileData = await invoke('read_file', { path: '.orbital/settings.json' });
    }
    const mon = await import('../editor/monaco.js');
    mon.openFileInTab(fileData);
    showToast('Editing .orbital/settings.json — reload applies overrides', 'info', 3200);
  } catch (e) {
    showToast(`Could not open workspace settings: ${e}`, 'error', 3500);
  }
}

function setupWorkspaceSettingsSection() {
  const appearancePane = document.getElementById('spane-appearance');
  if (!appearancePane || document.getElementById('workspace-overrides-badge')) return;

  const block = document.createElement('div');
  block.style.cssText = 'margin-top: 18px; border-top: 1px solid var(--border-subtle); padding-top: 12px;';
  block.innerHTML = `
    <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">Workspace Settings</div>
    <div id="workspace-overrides-badge" class="settings-section-desc" style="display: none; color: var(--accent-cyan);"></div>
    <div class="settings-section-desc">
      Settings in <code>.orbital/settings.json</code> (workspace root) override globals for tab size, word wrap, and indent detection — per project.
    </div>
    <button class="btn btn-secondary btn-sm" id="btn-open-workspace-settings" style="margin-top: 8px;">Open workspace settings.json</button>
  `;
  appearancePane.appendChild(block);
  block.querySelector('#btn-open-workspace-settings').addEventListener('click', openWorkspaceSettingsFile);
}

// ---------------------------------------------------------------------------
// E4 — terminal appearance settings pane
// ---------------------------------------------------------------------------

function setupTerminalSettingsUI() {
  const pane = document.getElementById('spane-terminal');
  if (!pane || document.getElementById('cfg-term-font-family')) return;

  const block = document.createElement('div');
  block.style.cssText = 'margin-top: 14px; display: flex; flex-direction: column; gap: 12px;';
  block.innerHTML = `
    <div style="font-size: 13px; font-weight: 600;">Terminal Appearance</div>
    <div class="form-group" style="margin-bottom: 0;">
      <label class="form-label">Font Family</label>
      <input type="text" class="input-text" id="cfg-term-font-family" />
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Font Size (px)</label>
        <input type="number" class="input-text" id="cfg-term-font-size" min="9" max="22" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Line Height</label>
        <input type="number" class="input-text" id="cfg-term-line-height" min="1.1" max="2.2" step="0.05" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Scrollback (lines)</label>
        <input type="number" class="input-text" id="cfg-term-scrollback" min="100" max="10000" step="100" />
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Cursor Style</label>
        <select class="select-input" id="cfg-term-cursor-style">
          <option value="block">Block</option>
          <option value="underline">Underline</option>
          <option value="bar">Bar</option>
        </select>
      </div>
      <div class="settings-setting-row">
        <div class="settings-setting-info">
          <span class="settings-setting-label">Cursor Blink</span>
          <span class="settings-setting-caption">Pulse the text cursor.</span>
        </div>
        <div><label class="settings-toggle-switch"><input type="checkbox" id="cfg-term-cursor-blink"><span class="settings-toggle-slider"></span></label></div>
      </div>
    </div>
  `;
  pane.appendChild(block);

  const loadIntoUI = () => {
    const t = state.settings.terminal || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    set('cfg-term-font-family', t.fontFamily);
    set('cfg-term-font-size', t.fontSize);
    set('cfg-term-line-height', t.lineHeight);
    set('cfg-term-scrollback', t.scrollback);
    set('cfg-term-cursor-style', t.cursorStyle);
    const blink = document.getElementById('cfg-term-cursor-blink');
    if (blink) blink.checked = t.cursorBlink !== false;
  };
  loadIntoUI();

  const apply = () => {
    const t = state.settings.terminal || (state.settings.terminal = {});
    const val = (id) => document.getElementById(id)?.value;
    const num = (id, fb) => { const v = parseFloat(val(id)); return Number.isFinite(v) ? v : fb; };
    t.fontFamily = val('cfg-term-font-family') || t.fontFamily;
    t.fontSize = num('cfg-term-font-size', 13);
    t.lineHeight = num('cfg-term-line-height', 1.5);
    t.scrollback = num('cfg-term-scrollback', 1000);
    t.cursorStyle = val('cfg-term-cursor-style') || 'block';
    t.cursorBlink = document.getElementById('cfg-term-cursor-blink')?.checked !== false;
    import('./terminal.js').then(m => { if (m.applyTerminalAppearance) m.applyTerminalAppearance(); });
    markSettingsModified();
  };
  block.querySelectorAll('input, select').forEach(el => el.addEventListener('change', apply));

  // Wire the default shell dropdown from the existing stub
  const shellSel = document.getElementById('cfg-shell-type');
  if (shellSel && !shellSel.dataset.wired) {
    shellSel.dataset.wired = '1';
    const map = { powershell: 'powershell', cmd: 'cmd', bash: 'gitbash' };
    const rev = { powershell: 'powershell', cmd: 'cmd', gitbash: 'bash', wsl: 'bash', sh: 'bash' };
    shellSel.value = map[state.terminal?.defaultShell] || 'powershell';
    shellSel.addEventListener('change', async () => {
      state.terminal = state.terminal || {};
      state.terminal.defaultShell = map[shellSel.value] || 'powershell';
      const term = await import('./terminal.js');
      if (term.persistTerminalSettings) term.persistTerminalSettings();
    });
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setupSettingsOverhaul() {
  setupSettingsSearch();
  enhanceImportExport();
  setupWorkspaceSettingsSection();
  refreshWorkspaceSettings();
  // The shortcuts pane becomes an editable keybinding table (G4)
  buildEditableShortcutsTable();
}
