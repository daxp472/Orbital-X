// ==========================================================================
// Orbital X — Settings & Preferences Manager (settings.js)
// ==========================================================================

import { state, persistState, notify } from '../state/store.js';
import { invoke } from '../services/tauri.js';
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

  // Ollama Model Pull UI
  setupOllamaPullUI();

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
}

function setupOllamaPullUI() {
  const ollamaModelInput = document.getElementById('cfg-ollama-model');
  const parentCard = ollamaModelInput?.closest('div[style*="background"]');
  if (!parentCard || document.getElementById('ollama-pull-container')) return;

  const pullContainer = document.createElement('div');
  pullContainer.id = 'ollama-pull-container';
  pullContainer.style.marginTop = '12px';
  pullContainer.style.paddingTop = '10px';
  pullContainer.style.borderTop = '1px solid var(--border-subtle)';
  pullContainer.innerHTML = `
    <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Pull New Ollama Model</div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <input type="text" class="input-text" id="cfg-ollama-pull-name" placeholder="e.g. codellama, mistral, qwen2.5-coder" style="flex: 1;" />
      <button type="button" class="btn btn-primary btn-sm" id="btn-ollama-pull" style="white-space: nowrap;">Pull Model</button>
    </div>
    <div id="ollama-pull-status" style="font-size: 11px; margin-top: 6px; min-height: 16px; color: var(--text-muted);"></div>
  `;

  parentCard.appendChild(pullContainer);

  const pullBtn = pullContainer.querySelector('#btn-ollama-pull');
  const pullInput = pullContainer.querySelector('#cfg-ollama-pull-name');
  const statusEl = pullContainer.querySelector('#ollama-pull-status');

  pullBtn?.addEventListener('click', async () => {
    const modelName = pullInput?.value.trim();
    if (!modelName) {
      if (statusEl) {
        statusEl.textContent = 'Please enter a model name to pull.';
        statusEl.style.color = 'var(--accent-orange)';
      }
      return;
    }

    pullBtn.disabled = true;
    pullBtn.innerHTML = `<span class="spinner"></span> Pulling...`;
    if (statusEl) {
      statusEl.innerHTML = `Pulling <strong>${modelName}</strong> from Ollama library... (this may take a few minutes)`;
      statusEl.style.color = 'var(--accent-cyan)';
    }

    try {
      await invoke('run_command', {
        command: `ollama pull ${modelName}`,
        timeout_seconds: 300,
      });

      if (statusEl) {
        statusEl.innerHTML = `✓ Done! Successfully pulled <strong>${modelName}</strong>.`;
        statusEl.style.color = 'var(--accent-green)';
      }

      if (ollamaModelInput && !ollamaModelInput.value) {
        ollamaModelInput.value = modelName;
        state.ai.defaultModels.ollama = modelName;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = `✗ Error pulling model: ${err}`;
        statusEl.style.color = 'var(--accent-red)';
      }
    } finally {
      pullBtn.disabled = false;
      pullBtn.innerHTML = `Pull Model`;
    }
  });
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
  setupOllamaPullUI();

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

  document.getElementById('cfg-gemini-key').value = state.ai.keys.gemini || '';
  document.getElementById('cfg-gemini-model').value = state.ai.defaultModels.gemini || 'gemini-2.0-flash';

  document.getElementById('cfg-ollama-url').value = state.ai.endpoint || 'http://localhost:11434';
  document.getElementById('cfg-ollama-model').value = state.ai.defaultModels.ollama || 'llama3';

  populateThemeDropdown();
  selectSecurityCard(state.agentMode);

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

  state.ai.keys.gemini = document.getElementById('cfg-gemini-key').value.trim();
  state.ai.defaultModels.gemini = document.getElementById('cfg-gemini-model').value.trim() || 'gemini-2.0-flash';

  state.ai.endpoint = document.getElementById('cfg-ollama-url').value.trim() || 'http://localhost:11434';
  const newOllamaModel = document.getElementById('cfg-ollama-model').value.trim() || 'llama3';
  state.ai.defaultModels.ollama = newOllamaModel;

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
