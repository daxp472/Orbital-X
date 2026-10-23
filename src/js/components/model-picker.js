// ==========================================================================
// Orbital X — Model Picker Dropdown Component (model-picker.js)
// ==========================================================================

import { state, setActiveModel, subscribe } from '../state/store.js';
import { invoke } from '../services/tauri.js';

let dropdownEl = null;

export function initModelPicker() {
  const triggerBtn = document.getElementById('composer-model-selector');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown('composer');
    });
  }

  // Header Current Model Indicator Pill
  setupHeaderModelPill();

  document.addEventListener('click', (e) => {
    const headerPill = document.getElementById('header-model-pill');
    if (dropdownEl && !dropdownEl.contains(e.target) && e.target !== triggerBtn && !headerPill?.contains(e.target)) {
      closeDropdown();
    }
  });

  // Subscribe to store notifications for reactive model updates
  subscribe((property, payload) => {
    if (property === 'modelChanged' || property === 'model') {
      updateHeaderModelDisplay(payload?.model || state.ai.model);
    }
  });
}

function setupHeaderModelPill() {
  const modePill = document.getElementById('header-mode-pill');
  if (!modePill || document.getElementById('header-model-pill')) return;

  const pill = document.createElement('div');
  pill.className = 'model-pill';
  pill.id = 'header-model-pill';
  pill.title = 'Active Model — Click to switch model';
  pill.innerHTML = `
    <span class="model-pill-icon">✨</span>
    <span id="header-model-text">${state.ai.model || 'Select Model'}</span>
  `;

  // Insert right next to mode pill
  modePill.insertAdjacentElement('afterend', pill);

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('header');
  });
}

function updateHeaderModelDisplay(modelName) {
  const textEl = document.getElementById('header-model-text');
  if (textEl) {
    textEl.textContent = modelName || state.ai.model || 'Select Model';
  }
}

export async function toggleDropdown(source = 'composer') {
  if (dropdownEl && dropdownEl.style.display !== 'none') {
    closeDropdown();
  } else {
    await openDropdown(source);
  }
}

export function closeDropdown() {
  if (dropdownEl) {
    dropdownEl.style.display = 'none';
  }
}

export async function openDropdown(source = 'composer') {
  if (!dropdownEl) {
    createDropdownDOM();
  }

  if (source === 'header') {
    dropdownEl.style.top = '40px';
    dropdownEl.style.bottom = 'auto';
    dropdownEl.style.right = '12px';
  } else {
    dropdownEl.style.top = 'auto';
    dropdownEl.style.bottom = '75px';
    dropdownEl.style.right = '12px';
  }

  // Fetch local Ollama models dynamically if available
  renderModelList();

  dropdownEl.style.display = 'flex';
}

function createDropdownDOM() {
  dropdownEl = document.createElement('div');
  dropdownEl.id = 'model-picker-dropdown';
  dropdownEl.style.cssText = `
    position: absolute;
    bottom: 75px;
    right: 12px;
    width: 320px;
    max-height: 420px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: fadeIn 0.15s ease;
  `;

  document.body.appendChild(dropdownEl);
}

async function renderModelList() {
  if (!dropdownEl) return;

  dropdownEl.innerHTML = `
    <div style="padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 12px;">
      <span>Select AI Model & Provider</span>
      <button class="icon-btn" id="btn-close-model-picker" style="font-size: 14px;">✕</button>
    </div>

    <!-- Provider Tabs -->
    <div style="display: flex; background: var(--bg-surface); padding: 4px; gap: 4px; border-bottom: 1px solid var(--border-subtle);">
      <button class="btn btn-sm ${state.ai.provider === 'ollama' ? 'btn-primary' : 'btn-secondary'}" data-p="ollama" style="flex: 1; font-size: 11px;">Ollama</button>
      <button class="btn btn-sm ${state.ai.provider === 'anthropic' ? 'btn-primary' : 'btn-secondary'}" data-p="anthropic" style="flex: 1; font-size: 11px;">Claude</button>
      <button class="btn btn-sm ${state.ai.provider === 'openai' ? 'btn-primary' : 'btn-secondary'}" data-p="openai" style="flex: 1; font-size: 11px;">OpenAI</button>
      <button class="btn btn-sm ${state.ai.provider === 'gemini' ? 'btn-primary' : 'btn-secondary'}" data-p="gemini" style="flex: 1; font-size: 11px;">Gemini</button>
    </div>

    <!-- Models Container -->
    <div id="mp-models-list" style="padding: 10px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 6px;">
      <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 10px;">
        <span class="spinner"></span> Querying models...
      </div>
    </div>
  `;

  dropdownEl.querySelector('#btn-close-model-picker')?.addEventListener('click', closeDropdown);

  dropdownEl.querySelectorAll('[data-p]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const p = tabBtn.dataset.p;
      dropdownEl.querySelectorAll('[data-p]').forEach(b => {
        b.className = b.dataset.p === p ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
      });
      loadProviderModels(p);
    });
  });

  loadProviderModels(state.ai.provider);
}

async function loadProviderModels(provider) {
  const container = dropdownEl.querySelector('#mp-models-list');
  if (!container) return;

  if (provider === 'ollama') {
    container.innerHTML = `
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
        Local Ollama Models (${state.ai.endpoint})
      </div>
      <div id="ollama-detected-models" style="display: flex; flex-direction: column; gap: 4px;">
        <div style="font-size: 11px; color: var(--text-muted); padding: 8px;"><span class="spinner"></span> Detecting installed models...</div>
      </div>
      <div style="margin-top: 8px; border-top: 1px solid var(--border-subtle); padding-top: 8px;">
        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Custom / Specific Model:</div>
        <div style="display: flex; gap: 4px;">
          <input type="text" class="input-text" id="custom-ollama-input" placeholder="e.g. llama3:latest" value="${state.ai.model || 'llama3:latest'}" style="flex: 1; font-size: 11px; padding: 4px 8px;" />
          <button class="btn btn-primary btn-sm" id="btn-apply-custom-ollama">Use</button>
        </div>
      </div>
    `;

    const detectedContainer = container.querySelector('#ollama-detected-models');

    // Query Ollama local models via Tauri
    try {
      const models = await invoke('get_ollama_models', { endpoint: state.ai.endpoint });
      detectedContainer.innerHTML = '';

      if (!models || models.length === 0) {
        detectedContainer.innerHTML = `
          <div style="padding: 6px; font-size: 11px; color: var(--accent-orange); background: var(--bg-surface); border-radius: 4px;">
            No models detected in Ollama. Ensure Ollama is running or enter model name below.
          </div>
        `;
      } else {
        models.forEach(modelName => {
          const item = document.createElement('div');
          const isSelected = state.ai.provider === 'ollama' && state.ai.model === modelName;
          item.style.cssText = `
            padding: 6px 10px;
            border-radius: 4px;
            background: ${isSelected ? 'var(--bg-active)' : 'var(--bg-surface)'};
            border: 1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-color)'};
            cursor: pointer;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          `;
          item.innerHTML = `
            <strong>${modelName}</strong>
            ${isSelected ? '<span style="color: var(--accent-cyan); font-size: 11px;">✓ Active</span>' : ''}
          `;
          item.addEventListener('click', () => {
            selectModel('ollama', modelName);
          });
          detectedContainer.appendChild(item);
        });
      }
    } catch (e) {
      detectedContainer.innerHTML = `
        <div style="padding: 6px; font-size: 11px; color: var(--accent-orange); background: var(--bg-surface); border-radius: 4px;">
          Ollama not reached at ${state.ai.endpoint}.<br>Enter your local model name below.
        </div>
      `;
    }

    container.querySelector('#btn-apply-custom-ollama')?.addEventListener('click', () => {
      const customVal = container.querySelector('#custom-ollama-input').value.trim();
      if (customVal) {
        selectModel('ollama', customVal);
      }
    });

  } else if (provider === 'anthropic') {
    const models = [
      { id: 'claude-3-7-sonnet-20250219', desc: 'Hybrid reasoning and coding model' },
      { id: 'claude-3-5-sonnet-20241022', desc: 'Recommended general coding model' },
      { id: 'claude-3-5-haiku-20241022', desc: 'High-speed lightweight model' },
    ];
    renderPredefinedList(container, 'anthropic', models);
  } else if (provider === 'openai') {
    const models = [
      { id: 'gpt-4o', desc: 'Flagship multimodal reasoning' },
      { id: 'gpt-4o-mini', desc: 'Fast, efficient everyday model' },
      { id: 'o3-mini', desc: 'Advanced coding & math reasoning' },
      { id: 'o1', desc: 'Deep reasoning model' },
    ];
    renderPredefinedList(container, 'openai', models);
  } else if (provider === 'gemini') {
    const models = [
      { id: 'gemini-2.0-flash', desc: 'Next-gen multimodal speed' },
      { id: 'gemini-2.5-flash', desc: 'Optimized reasoning & low latency' },
      { id: 'gemini-2.5-pro', desc: 'Deep coding comprehension' },
    ];
    renderPredefinedList(container, 'gemini', models);
  }
}

function renderPredefinedList(container, provider, models) {
  container.innerHTML = `
    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">
      Popular ${provider.toUpperCase()} Models:
    </div>
  `;

  models.forEach(m => {
    const isSelected = state.ai.provider === provider && state.ai.model === m.id;
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 8px 10px;
      border-radius: 6px;
      background: ${isSelected ? 'var(--bg-active)' : 'var(--bg-surface)'};
      border: 1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-color)'};
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
    `;
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <strong style="color: var(--text-primary-bright); font-size: 11px;">${m.id}</strong>
        ${isSelected ? '<span style="color: var(--accent-blue); font-size: 11px;">✓ Active</span>' : ''}
      </div>
      <div style="font-size: 10px; color: var(--text-secondary);">${m.desc}</div>
    `;

    item.addEventListener('click', () => {
      selectModel(provider, m.id);
    });

    container.appendChild(item);
  });
}

function selectModel(provider, modelName) {
  setActiveModel(provider, modelName);
  closeDropdown();
}
