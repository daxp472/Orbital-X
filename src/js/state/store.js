// ==========================================================================
// Orbital X — Central State Store (store.js)
// ==========================================================================

export const state = {
  // Workspace info
  workspace: {
    rootPath: null,
    name: "No Workspace Open",
    files: null,
  },

  // Editor tabs
  editor: {
    tabs: [], // { id, path, relativePath, name, content, originalContent, isDirty, language }
    activeTabId: null,
    fontSize: 13,
  },

  // Operating Mode: 'agent_pro' | 'dev' | 'user'
  agentMode: 'dev',

  // Active theme: 'theme-dark' | 'theme-light' | 'theme-hc'
  theme: 'theme-dark',

  // Selected Provider & Models
  ai: {
    provider: 'ollama', // 'ollama' | 'anthropic' | 'openai' | 'gemini'
    model: 'llama3',
    endpoint: 'http://localhost:11434',
    keys: {
      anthropic: '',
      openai: '',
      gemini: '',
    },
    defaultModels: {
      ollama: 'llama3',
      anthropic: 'claude-3-5-sonnet-20241022',
      openai: 'gpt-4o',
      gemini: 'gemini-2.0-flash',
    },
    isGenerating: false,
    activeSubprocess: null,
  },

  // Conversation history for agent
  conversation: [],

  // Active pending approval card
  pendingApproval: null, // { toolCallId, name, arguments, risk, reason, diff }

  // Project memories
  memories: [],

  // Bottom panel state
  bottomPanel: {
    activeTab: 'terminal',
    isCollapsed: false,
  },

  // User configurable settings
  settings: {
    autoSave: true,
    autoSaveDelay: 1000,
  },

  // Active Orchestration Plan & Task Execution
  orchestrator: {
    activePlan: null,
    activeTask: null,
    isExecuting: false,
    elapsedSeconds: 0,
  },
};

// Listeners for reactive updates
const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(property, payload) {
  for (const listener of listeners) {
    try {
      listener(property, payload, state);
    } catch (e) {
      console.error("State listener error:", e);
    }
  }
}

// Load persisted preferences from localStorage
export function loadPersistedState() {
  try {
    const savedTheme = localStorage.getItem('orbital_theme');
    if (savedTheme) {
      if (savedTheme === 'orbit-dark' || savedTheme === 'dark') state.theme = 'theme-dark';
      else if (savedTheme === 'nebula-light' || savedTheme === 'light') state.theme = 'theme-light';
      else if (savedTheme === 'high-contrast' || savedTheme === 'hc') state.theme = 'theme-hc';
      else state.theme = savedTheme;
    }

    const savedMode = localStorage.getItem('orbital_mode');
    if (savedMode) state.agentMode = savedMode;

    const savedProvider = localStorage.getItem('orbital_provider');
    if (savedProvider) state.ai.provider = savedProvider;

    const savedModel = localStorage.getItem('orbital_model');
    if (savedModel) state.ai.model = savedModel;

    const savedEndpoint = localStorage.getItem('orbital_endpoint');
    if (savedEndpoint) state.ai.endpoint = savedEndpoint;

    const savedDefaultModels = localStorage.getItem('orbital_default_models');
    if (savedDefaultModels) {
      const parsed = JSON.parse(savedDefaultModels);
      state.ai.defaultModels = { ...state.ai.defaultModels, ...parsed };
    }

    const savedKeys = localStorage.getItem('orbital_keys');
    if (savedKeys) {
      const parsed = JSON.parse(savedKeys);
      state.ai.keys = { ...state.ai.keys, ...parsed };
    }

    const savedAutoSave = localStorage.getItem('orbital_autosave');
    if (savedAutoSave !== null) {
      state.settings.autoSave = savedAutoSave === 'true';
    }
    const savedAutoSaveDelay = localStorage.getItem('orbital_autosave_delay');
    if (savedAutoSaveDelay !== null) {
      const parsedDelay = parseInt(savedAutoSaveDelay, 10);
      if (!isNaN(parsedDelay) && parsedDelay > 0) {
        state.settings.autoSaveDelay = parsedDelay;
      }
    }
  } catch (e) {
    console.warn("Could not load persisted state:", e);
  }
}

export function persistState() {
  try {
    localStorage.setItem('orbital_theme', state.theme);
    localStorage.setItem('orbital_mode', state.agentMode);
    localStorage.setItem('orbital_provider', state.ai.provider);
    localStorage.setItem('orbital_model', state.ai.model);
    localStorage.setItem('orbital_endpoint', state.ai.endpoint);
    localStorage.setItem('orbital_default_models', JSON.stringify(state.ai.defaultModels));
    localStorage.setItem('orbital_keys', JSON.stringify(state.ai.keys));
    localStorage.setItem('orbital_autosave', state.settings.autoSave ? 'true' : 'false');
    localStorage.setItem('orbital_autosave_delay', (state.settings.autoSaveDelay || 1000).toString());
  } catch (e) {
    console.warn("Could not persist state:", e);
  }
}

export function setActiveModel(provider, model) {
  state.ai.provider = provider;
  state.ai.model = model;
  if (state.ai.defaultModels[provider]) {
    state.ai.defaultModels[provider] = model;
  }
  persistState();

  // Update Composer pill and Statusbar
  const composerModelName = document.getElementById('composer-model-name');
  if (composerModelName) {
    const displayName = provider === 'ollama' ? `Ollama (${model})` :
      provider === 'anthropic' ? `Claude (${model})` :
      provider === 'openai' ? `OpenAI (${model})` : `Gemini (${model})`;
    composerModelName.textContent = displayName;
  }

  const sbModelText = document.getElementById('sb-model-text');
  if (sbModelText) {
    const displayName = provider === 'ollama' ? `Ollama (${model})` :
      provider === 'anthropic' ? `Claude (${model})` :
      provider === 'openai' ? `OpenAI (${model})` : `Gemini (${model})`;
    sbModelText.textContent = displayName;
  }

  notify('modelChanged', { provider, model });
}
