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

  // Active theme: 'orbit-dark' | 'nebula-light' | 'midnight-blue'
  theme: 'orbit-dark',

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
    if (savedTheme) state.theme = savedTheme;

    const savedMode = localStorage.getItem('orbital_mode');
    if (savedMode) state.agentMode = savedMode;

    const savedProvider = localStorage.getItem('orbital_provider');
    if (savedProvider) state.ai.provider = savedProvider;

    const savedModel = localStorage.getItem('orbital_model');
    if (savedModel) state.ai.model = savedModel;

    const savedKeys = localStorage.getItem('orbital_keys');
    if (savedKeys) {
      const parsed = JSON.parse(savedKeys);
      state.ai.keys = { ...state.ai.keys, ...parsed };
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
    localStorage.setItem('orbital_keys', JSON.stringify(state.ai.keys));
  } catch (e) {
    console.warn("Could not persist state:", e);
  }
}
