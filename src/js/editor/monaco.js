// ==========================================================================
// Orbital X — Monaco Editor Integration (monaco.js)
// ==========================================================================

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { state, notify } from '../state/store.js';
import { invoke } from '../services/tauri.js';

// Setup Monaco Workers
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

let editorInstance = null;
let diffEditorInstance = null;
const editorModels = new Map(); // path -> monaco.editor.ITextModel
export const tabDirtyMap = new Map(); // tabId -> boolean (tracks unsaved changes)
let autoSaveTimer = null;

export function detectLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'go':
      return 'go';
    case 'cpp':
    case 'c':
    case 'h':
      return 'cpp';
    case 'toml':
      return 'ini';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'sh':
    case 'ps1':
      return 'shell';
    case 'sql':
      return 'sql';
    default:
      return 'plaintext';
  }
}

export function initMonaco(containerElement) {
  if (editorInstance) return editorInstance;

  // Custom Dark Theme for Orbital X
  monaco.editor.defineTheme('orbital-dark-theme', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7681', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'bc8cff', fontStyle: 'bold' },
      { token: 'string', foreground: '39c5bb' },
      { token: 'number', foreground: 'f0883e' },
      { token: 'type', foreground: '58a6ff' },
      { token: 'function', foreground: '58a6ff' },
    ],
    colors: {
      'editor.background': '#1f1f1f',
      'editor.foreground': '#f0f6fc',
      'editorCursor.foreground': '#39c5bb',
      'editor.lineHighlightBackground': '#252526',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#39c5bb',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#1e3852',
    }
  });

  // Custom Light Theme for Orbital X (Nebula Light)
  monaco.editor.defineTheme('orbital-light-theme', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8250df', fontStyle: 'bold' },
      { token: 'string', foreground: '059669' },
      { token: 'number', foreground: 'bc4c00' },
      { token: 'type', foreground: '0066b8' },
      { token: 'function', foreground: '0066b8' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#24292f',
      'editorCursor.foreground': '#059669',
      'editor.lineHighlightBackground': '#f6f8fa',
      'editorLineNumber.foreground': '#8c959f',
      'editorLineNumber.activeForeground': '#059669',
      'editor.selectionBackground': '#b6e3ff',
      'editor.inactiveSelectionBackground': '#d0e8ff',
    }
  });

  const activeTheme = document.documentElement.getAttribute('data-theme') || 'orbit-dark';
  const initialMonacoTheme = activeTheme === 'nebula-light' ? 'orbital-light-theme' : 'orbital-dark-theme';

  editorInstance = monaco.editor.create(containerElement, {
    theme: initialMonacoTheme,
    fontSize: state.editor.fontSize || 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    fontLigatures: true,
    lineNumbers: 'on',
    lineHeight: 22,
    roundedSelection: true,
    scrollBeyondLastLine: false,
    readOnly: false,
    automaticLayout: true,
    minimap: { enabled: true, maxColumn: 80 },
    tabSize: 2,
    wordWrap: 'on',
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
  });

  // Track cursor position
  editorInstance.onDidChangeCursorPosition((e) => {
    const cursorElem = document.getElementById('status-cursor');
    if (cursorElem) {
      cursorElem.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    }
  });

  // Find in file on Ctrl+F
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
    triggerFindWidget();
  });

  // Save on Ctrl+S
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveActiveFile();
  });

  // Go to Line on Ctrl+G
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
    triggerGotoLine();
  });

  // Go to Definition on F12
  editorInstance.addCommand(monaco.KeyCode.F12, () => {
    triggerGotoDefinition();
  });

  // Select All Occurrences of Find Match on Ctrl+Shift+L
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, () => {
    triggerSelectHighlights();
  });

  // Editor Zoom In: Ctrl+= / Ctrl++
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
    zoomIn();
  });

  // Editor Zoom Out: Ctrl+-
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
    zoomOut();
  });

  // Editor Zoom Reset: Ctrl+0
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => {
    zoomReset();
  });

  // Global window listener for editor shortcuts when editor view is active
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        triggerFindWidget();
      }
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'g') {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        triggerGotoLine();
      }
    } else if (e.key === 'F12') {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        triggerGotoDefinition();
      }
    } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        triggerSelectHighlights();
      }
    } else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        zoomIn();
      }
    } else if (e.ctrlKey && e.key === '-') {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        zoomOut();
      }
    } else if (e.ctrlKey && e.key === '0') {
      if (editorInstance && state.editor.activeTabId) {
        e.preventDefault();
        zoomReset();
      }
    }
  });

  // Live File Reload / Watch: Update active tab when AI agent writes a file
  window.addEventListener('orbital:file-written', async (e) => {
    const writtenPath = e.detail?.path;
    if (!writtenPath || !editorInstance) return;

    const normalize = (p) => (p ? p.replace(/\\/g, '/').toLowerCase() : '');
    const activeTab = state.editor.tabs.find(t => t.id === state.editor.activeTabId);
    if (activeTab && normalize(activeTab.path) === normalize(writtenPath)) {
      try {
        const fileData = await invoke('read_file', { path: writtenPath });
        const newContent = fileData.content;
        const pos = editorInstance.getPosition();
        editorInstance.setValue(newContent);
        if (pos) {
          editorInstance.setPosition(pos);
        }
        activeTab.content = newContent;
        activeTab.originalContent = newContent;
        activeTab.isDirty = false;
        tabDirtyMap.set(activeTab.id, false);
        renderTabs();
      } catch (err) {
        console.warn("Could not reload file on orbital:file-written:", err);
      }
    }
  });

  return editorInstance;
}

export function triggerFindWidget() {
  if (!editorInstance) return;
  editorInstance.focus();
  const findAction = editorInstance.getAction('actions.find');
  if (findAction) {
    findAction.run();
  }
}

export function triggerGotoLine() {
  if (!editorInstance) return;
  editorInstance.focus();
  const action = editorInstance.getAction('editor.action.gotoLine');
  if (action) {
    action.run();
  }
}

export function triggerGotoDefinition() {
  if (!editorInstance) return;
  editorInstance.focus();
  const action = editorInstance.getAction('editor.action.revealDefinition');
  if (action) {
    action.run();
  }
}

export function triggerSelectHighlights() {
  if (!editorInstance) return;
  editorInstance.focus();
  const action = editorInstance.getAction('editor.action.selectHighlights');
  if (action) {
    action.run();
  }
}

export function zoomIn() {
  if (!editorInstance) return;
  editorInstance.trigger('keyboard', 'editor.action.fontZoomIn', {});
}

export function zoomOut() {
  if (!editorInstance) return;
  editorInstance.trigger('keyboard', 'editor.action.fontZoomOut', {});
}

export function zoomReset() {
  if (!editorInstance) return;
  editorInstance.trigger('keyboard', 'editor.action.fontZoomReset', {});
}

export function updateTheme(themeName) {
  const chosen = themeName === 'nebula-light' ? 'orbital-light-theme' : 'orbital-dark-theme';
  monaco.editor.setTheme(chosen);
  if (diffEditorInstance) {
    diffEditorInstance.updateOptions({ theme: chosen });
  }
}

export function openFileInTab(fileData) {
  const { path, relative_path, content } = fileData;
  const filename = path.split(/[/\\]/).pop();
  const lang = detectLanguage(filename);

  // Check if tab is already open
  let tab = state.editor.tabs.find(t => t.path === path);
  if (!tab) {
    tab = {
      id: 'tab_' + Math.random().toString(36).substring(2, 9),
      path,
      relativePath: relative_path || filename,
      name: filename,
      content,
      originalContent: content,
      isDirty: false,
      language: lang,
    };
    state.editor.tabs.push(tab);
    tabDirtyMap.set(tab.id, false);
  } else if (!tabDirtyMap.has(tab.id)) {
    tabDirtyMap.set(tab.id, tab.isDirty || false);
  }

  state.editor.activeTabId = tab.id;

  // Get or create Monaco Model
  let model = editorModels.get(path);
  if (!model) {
    const uri = monaco.Uri.file(path);
    model = monaco.editor.getModel(uri) || monaco.editor.createModel(content, lang, uri);
    editorModels.set(path, model);

    // Track dirty state
    model.onDidChangeContent(() => {
      const currentVal = model.getValue();
      const currentTab = state.editor.tabs.find(t => t.path === path);
      if (currentTab) {
        const isDirty = currentVal !== currentTab.originalContent;
        tabDirtyMap.set(currentTab.id, isDirty);
        if (currentTab.isDirty !== isDirty) {
          currentTab.isDirty = isDirty;
          renderTabs();
        }
        currentTab.content = currentVal;

        // Auto-save debounce timer (like VS Code)
        if (state.settings?.autoSave) {
          if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
          }
          const delay = typeof state.settings?.autoSaveDelay === 'number'
            ? state.settings.autoSaveDelay
            : 1000;
          autoSaveTimer = setTimeout(() => {
            saveActiveFile();
          }, delay);
        }
      }
    });
  }

  if (editorInstance) {
    editorInstance.setModel(model);
    editorInstance.focus();
  }

  // Hide empty state screen
  const emptyState = document.getElementById('editor-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  // Update language in status bar
  const langElem = document.getElementById('status-language');
  if (langElem) langElem.textContent = lang.toUpperCase();

  renderTabs();
  notify('activeTab', tab);
}

export function closeTab(tabId) {
  const index = state.editor.tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const tab = state.editor.tabs[index];

  if (tab.isDirty) {
    if (!confirm(`Save changes to ${tab.name} before closing?`)) {
      return;
    }
  }

  state.editor.tabs.splice(index, 1);
  tabDirtyMap.delete(tabId);

  if (state.editor.activeTabId === tabId) {
    if (state.editor.tabs.length > 0) {
      const nextTab = state.editor.tabs[Math.max(0, index - 1)];
      switchToTab(nextTab.id);
    } else {
      state.editor.activeTabId = null;
      if (editorInstance) editorInstance.setModel(null);
      const emptyState = document.getElementById('editor-empty-state');
      if (emptyState) emptyState.style.display = 'flex';
      const langElem = document.getElementById('status-language');
      if (langElem) langElem.textContent = 'Plain Text';
    }
  }

  renderTabs();
}

export function switchToTab(tabId) {
  const tab = state.editor.tabs.find(t => t.id === tabId);
  if (!tab) return;

  state.editor.activeTabId = tabId;
  const model = editorModels.get(tab.path);
  if (model && editorInstance) {
    editorInstance.setModel(model);
    editorInstance.focus();
  }

  const langElem = document.getElementById('status-language');
  if (langElem) langElem.textContent = tab.language.toUpperCase();

  renderTabs();
}

export async function saveActiveFile() {
  const activeTab = state.editor.tabs.find(t => t.id === state.editor.activeTabId);
  if (!activeTab || !editorInstance) return;

  const currentContent = editorInstance.getValue();

  try {
    const diff = await invoke('save_file', {
      path: activeTab.path,
      content: currentContent,
      description: "User manual save",
    });

    activeTab.originalContent = currentContent;
    activeTab.content = currentContent;
    activeTab.isDirty = false;
    tabDirtyMap.set(activeTab.id, false);
    renderTabs();

    console.log("File saved successfully:", activeTab.path, diff);
  } catch (e) {
    alert("Error saving file: " + e);
  }
}

export function renderTabs() {
  const container = document.getElementById('tabs-bar');
  if (!container) return;

  container.innerHTML = '';

  state.editor.tabs.forEach(tab => {
    const isDirty = tabDirtyMap.has(tab.id) ? tabDirtyMap.get(tab.id) : (tab.isDirty || false);
    const tabEl = document.createElement('div');
    tabEl.className = `tab ${tab.id === state.editor.activeTabId ? 'active' : ''}`;
    tabEl.title = tab.path;

    tabEl.innerHTML = `
      ${isDirty ? '<span class="tab-dirty-dot" title="Unsaved changes">●</span>' : ''}
      <span>${tab.name}</span>
      <span class="tab-close" data-close-id="${tab.id}">✕</span>
    `;

    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        closeTab(tab.id);
      } else {
        switchToTab(tab.id);
      }
    });

    container.appendChild(tabEl);
  });
}

// Diff Editor Review
export function openDiffModal(filePath, oldContent, newContent, onAccept, onReject) {
  const modal = document.getElementById('modal-diff-review');
  const container = document.getElementById('diff-editor-container');
  const titleElem = document.getElementById('diff-modal-title');
  const statsElem = document.getElementById('diff-stats-text');

  if (!modal || !container) return;

  const filename = filePath.split(/[/\\]/).pop();
  titleElem.textContent = `Review Proposed Changes: ${filename}`;

  modal.style.display = 'flex';

  if (!diffEditorInstance) {
    diffEditorInstance = monaco.editor.createDiffEditor(container, {
      theme: 'orbital-dark-theme',
      automaticLayout: true,
      readOnly: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
    });
  }

  const lang = detectLanguage(filename);
  const originalModel = monaco.editor.createModel(oldContent, lang);
  const modifiedModel = monaco.editor.createModel(newContent, lang);

  diffEditorInstance.setModel({
    original: originalModel,
    modified: modifiedModel,
  });

  const acceptBtn = document.getElementById('btn-accept-diff');
  const rejectBtn = document.getElementById('btn-reject-diff');
  const closeBtn = document.getElementById('btn-close-diff-modal');

  const cleanup = () => {
    modal.style.display = 'none';
    acceptBtn.onclick = null;
    rejectBtn.onclick = null;
    closeBtn.onclick = null;
    originalModel.dispose();
    modifiedModel.dispose();
  };

  acceptBtn.onclick = () => {
    cleanup();
    if (onAccept) onAccept();
  };

  rejectBtn.onclick = () => {
    cleanup();
    if (onReject) onReject();
  };

  closeBtn.onclick = () => {
    cleanup();
    if (onReject) onReject();
  };
}
