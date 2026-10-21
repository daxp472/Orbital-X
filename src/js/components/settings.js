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
  const tabs = [
    { btn: 'stab-general', pane: 'spane-general' },
    { btn: 'stab-models', pane: 'spane-models' },
    { btn: 'stab-appearance', pane: 'spane-appearance' },
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

  // Theme Select inside settings
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

  document.getElementById('cfg-theme-select').value = state.theme;
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

  const selectedTheme = document.getElementById('cfg-theme-select').value;
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

export function applyTheme(themeName) {
  state.theme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  updateTheme(themeName);
  persistState();
  notify('themeChanged', themeName);
}

export function cycleTheme() {
  const themes = ['orbit-dark', 'nebula-light', 'midnight-blue'];
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
