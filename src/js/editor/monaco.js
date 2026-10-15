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
      'editor.background': '#0d1117',
      'editor.foreground': '#f0f6fc',
      'editorCursor.foreground': '#39c5bb',
      'editor.lineHighlightBackground': '#161b22',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#39c5bb',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#1e3852',
    }
  });

  editorInstance = monaco.editor.create(containerElement, {
    theme: 'orbital-dark-theme',
    fontSize: state.editor.fontSize || 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    lineNumbers: 'on',
    roundedSelection: true,
    scrollBeyondLastLine: false,
    readOnly: false,
    automaticLayout: true,
    minimap: { enabled: true, maxColumn: 80 },
    tabSize: 2,
    wordWrap: 'on',
    renderLineHighlight: 'all',
  });

  // Track cursor position
  editorInstance.onDidChangeCursorPosition((e) => {
    const cursorElem = document.getElementById('status-cursor');
    if (cursorElem) {
      cursorElem.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    }
  });

  // Save on Ctrl+S
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveActiveFile();
  });

  return editorInstance;
}

export function updateTheme(themeName) {
  if (!editorInstance) return;
  if (themeName === 'nebula-light') {
    monaco.editor.setTheme('vs');
  } else {
    monaco.editor.setTheme('orbital-dark-theme');
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
        if (currentTab.isDirty !== isDirty) {
          currentTab.isDirty = isDirty;
          renderTabs();
        }
        currentTab.content = currentVal;
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
    const tabEl = document.createElement('div');
    tabEl.className = `tab ${tab.id === state.editor.activeTabId ? 'active' : ''}`;
    tabEl.title = tab.path;

    tabEl.innerHTML = `
      <span>${tab.name}</span>
      ${tab.isDirty ? '<span class="tab-dirty-dot" title="Unsaved changes"></span>' : ''}
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
