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

  // Tab switching
  const tabs = [
    { btn: 'stab-providers', pane: 'spane-providers' },
    { btn: 'stab-appearance', pane: 'spane-appearance' },
    { btn: 'stab-agent', pane: 'spane-agent' },
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

  // Export / Import Settings
  document.getElementById('btn-export-settings')?.addEventListener('click', exportSettings);
  document.getElementById('btn-import-settings')?.addEventListener('click', importSettings);
}

export function openSettings() {
  const modal = document.getElementById('modal-settings');
  if (!modal) return;

  // Load current values into form inputs
  document.getElementById('cfg-anthropic-key').value = state.ai.keys.anthropic || '';
  document.getElementById('cfg-anthropic-model').value = state.ai.defaultModels.anthropic || '';

  document.getElementById('cfg-openai-key').value = state.ai.keys.openai || '';
  document.getElementById('cfg-openai-model').value = state.ai.defaultModels.openai || '';

  document.getElementById('cfg-gemini-key').value = state.ai.keys.gemini || '';
  document.getElementById('cfg-gemini-model').value = state.ai.defaultModels.gemini || '';

  document.getElementById('cfg-ollama-url').value = state.ai.endpoint || 'http://localhost:11434';
  document.getElementById('cfg-ollama-model').value = state.ai.defaultModels.ollama || 'llama3';

  document.getElementById('cfg-theme-select').value = state.theme;
  document.getElementById('cfg-default-mode').value = state.agentMode;

  modal.style.display = 'flex';
}

export function closeSettings() {
  const modal = document.getElementById('modal-settings');
  if (modal) modal.style.display = 'none';
}

function saveAndClose() {
  state.ai.keys.anthropic = document.getElementById('cfg-anthropic-key').value.trim();
  state.ai.defaultModels.anthropic = document.getElementById('cfg-anthropic-model').value.trim();

  state.ai.keys.openai = document.getElementById('cfg-openai-key').value.trim();
  state.ai.defaultModels.openai = document.getElementById('cfg-openai-model').value.trim();

  state.ai.keys.gemini = document.getElementById('cfg-gemini-key').value.trim();
  state.ai.defaultModels.gemini = document.getElementById('cfg-gemini-model').value.trim();

  state.ai.endpoint = document.getElementById('cfg-ollama-url').value.trim();
  state.ai.defaultModels.ollama = document.getElementById('cfg-ollama-model').value.trim();

  const selectedTheme = document.getElementById('cfg-theme-select').value;
  applyTheme(selectedTheme);

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
