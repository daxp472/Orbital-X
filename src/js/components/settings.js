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

export function openSettings() {
  const modal = document.getElementById('modal-settings');
  if (!modal) return;
  setupShortcutsTab();
  setupOllamaManagerUI();

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
