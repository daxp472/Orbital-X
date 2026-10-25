// ==========================================================================
// Orbital X — Monaco Editor Integration (monaco.js)
//
// Editor infrastructure:
//  • Dual-pane split editor with independent tab bars, models, and resizer
//  • Advanced tabs: drag & drop reordering, context menu, pinning, preview
//    mode, and persisted sessions (order, pins, split layout)
//  • Inline AI autocomplete (ghost text), folding/multi-cursor/symbol chords
//  • Rich status bar: language picker, line endings, selection, indent, format
// ==========================================================================

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { state, notify } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';
import { getBinding, comboToMonaco } from '../services/keybindings.js';

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

// ---------------------------------------------------------------------------
// Panel architecture: 'left' is the historical single editor (its state lives
// in state.editor for backward compatibility); 'right' exists while split.
// ---------------------------------------------------------------------------

const editors = { left: null, right: null };
export const tabDirtyMap = new Map(); // tabId -> boolean
const editorModels = new Map();       // path -> monaco.editor.ITextModel
let autoSaveTimer = null;

function panelState(panel) {
  if (panel === 'right') {
    return {
      get tabs() { return state.editor.rightTabs; },
      set tabs(v) { state.editor.rightTabs = v; },
      get activeTabId() { return state.editor.rightActiveTabId; },
      set activeTabId(v) { state.editor.rightActiveTabId = v; },
    };
  }
  return {
    get tabs() { return state.editor.tabs; },
    set tabs(v) { state.editor.tabs = v; },
    get activeTabId() { return state.editor.activeTabId; },
    set activeTabId(v) { state.editor.activeTabId = v; },
  };
}

function panelDom(panel) {
  return {
    tabsBar: document.getElementById(panel === 'left' ? 'tabs-bar' : 'tabs-bar-right'),
    breadcrumb: document.getElementById(panel === 'left' ? 'editor-breadcrumb' : 'editor-breadcrumb-right'),
    container: document.getElementById(panel === 'left' ? 'monaco-container' : 'monaco-container-right'),
    emptyState: document.getElementById(panel === 'left' ? 'editor-empty-state' : 'editor-empty-state-right'),
  };
}

export function getActivePanel() {
  return lastFocusedPanel || 'left';
}

/** Tabs of a given panel (used by file-tree preview promotion and panels UI). */
export function getPanelTabs(panel = 'left') {
  return panelState(panel).tabs;
}

/** The Monaco editor instance of the focused pane. */
export function getActiveEditor() {
  return editors[getActivePanel()];
}

/** Closes the active tab of the focused pane (used by Ctrl+W and the palette). */
export function closeActiveTab() {
  const panel = getActivePanel();
  const p = panelState(panel);
  if (p.activeTabId) closeTabInternal(p.activeTabId, panel);
}
let lastFocusedPanel = 'left';

function editorFor(panel) {
  return editors[panel];
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export function detectLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'rs': return 'rust';
    case 'py': return 'python';
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'scss': return 'scss';
    case 'json': return 'json';
    case 'md': case 'markdown': return 'markdown';
    case 'go': return 'go';
    case 'cpp': case 'c': case 'h': return 'cpp';
    case 'toml': return 'ini';
    case 'yaml': case 'yml': return 'yaml';
    case 'sh': case 'ps1': return 'shell';
    case 'sql': return 'sql';
    default: return 'plaintext';
  }
}

// ---------------------------------------------------------------------------
// Editor settings (Part B: minimap, wrap, indent, font) — persisted in
// state.settings.editor and applied to every editor + model.
// ---------------------------------------------------------------------------

const DEFAULT_EDITOR_SETTINGS = {
  minimap: true,
  minimapSide: 'right',
  minimapScale: 1,
  minimapSlider: 'mouseover',
  stickyScroll: true,
  wordWrap: 'on',
  wordWrapColumn: 80,
  tabSize: 2,
  insertSpaces: true,
  detectIndent: true,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
  fontSize: 13,
  fontLigatures: true,
  lineHeight: 22,
  letterSpacing: 0,
};

function editorSettings() {
  state.settings.editor = { ...DEFAULT_EDITOR_SETTINGS, ...(state.settings.editor || {}) };
  return state.settings.editor;
}

export function persistEditorSettings() {
  try {
    localStorage.setItem('orbital_editor_settings', JSON.stringify(state.settings.editor));
  } catch (e) { /* quota — best effort */ }
}

function loadEditorSettings() {
  try {
    const raw = localStorage.getItem('orbital_editor_settings');
    if (raw) state.settings.editor = { ...DEFAULT_EDITOR_SETTINGS, ...JSON.parse(raw) };
    else state.settings.editor = { ...DEFAULT_EDITOR_SETTINGS };
  } catch (e) {
    state.settings.editor = { ...DEFAULT_EDITOR_SETTINGS };
  }
}

export function applyEditorSettings() {
  const s = editorSettings();
  const options = {
    minimap: { enabled: !!s.minimap, side: s.minimapSide, scale: Number(s.minimapScale) || 1, showSlider: s.minimapSlider },
    stickyScroll: { enabled: !!s.stickyScroll },
    wordWrap: s.wordWrap || 'on',
    wordWrapColumn: Number(s.wordWrapColumn) || 80,
    fontFamily: s.fontFamily,
    fontSize: Number(s.fontSize) || 13,
    fontLigatures: !!s.fontLigatures,
    lineHeight: Number(s.lineHeight) || 22,
    letterSpacing: Number(s.letterSpacing) || 0,
  };

  // G5: workspace settings (.orbital/settings.json) override globals for the
  // supported subset — tab size, word wrap, and indent detection.
  const wsEd = state.settings.workspace?.editor;
  if (wsEd) {
    if (Number.isFinite(Number(wsEd.tabSize)) && Number(wsEd.tabSize) > 0) {
      s.tabSize = Number(wsEd.tabSize);
    }
    if (typeof wsEd.wordWrap === 'string' && ['off', 'on', 'wordWrapColumn', 'bounded'].includes(wsEd.wordWrap)) {
      options.wordWrap = wsEd.wordWrap;
    }
    if (typeof wsEd.detectIndent === 'boolean') {
      s.detectIndent = wsEd.detectIndent;
    }
    options.wordWrapColumn = Number(wsEd.wordWrapColumn) || options.wordWrapColumn;
  }

  for (const ed of [editors.left, editors.right]) {
    if (ed) ed.updateOptions(options);
  }
  const modelOpts = { tabSize: Number(s.tabSize) || 2, insertSpaces: !!s.insertSpaces };
  for (const model of editorModels.values()) {
    model.updateOptions(modelOpts);
    if (s.detectIndent) detectModelIndent(model);
  }
  persistEditorSettings();
  updateIndentStatus();
}

/** Sniffs the dominant indentation of a file and applies it to the model. */
function detectModelIndent(model) {
  try {
    const lines = model.getLinesContent().slice(0, 400);
    let spaces = 0, tabs = 0, spaceWidths = {};
    for (const line of lines) {
      const m = line.match(/^([ \t]+)/);
      if (!m) continue;
      if (m[1].includes('\t')) tabs++;
      else { spaces++; const w = m[1].length; spaceWidths[w] = (spaceWidths[w] || 0) + 1; }
    }
    if (spaces === 0 && tabs === 0) return;
    if (tabs > spaces) {
      model.updateOptions({ insertSpaces: false, tabSize: 4 });
    } else {
      const widths = Object.entries(spaceWidths).sort((a, b) => b[1] - a[1]);
      const inferred = widths.length ? parseInt(widths[0][0], 10) : 2;
      model.updateOptions({ insertSpaces: true, tabSize: [2, 4, 8].includes(inferred) ? inferred : 2 });
    }
  } catch (e) { /* detection is best-effort */ }
}

// ---------------------------------------------------------------------------
// Tab session persistence (order, pins, active, split)
// ---------------------------------------------------------------------------

const TAB_SESSION_KEY = 'orbital_editor_session_v1';
let persistTimer = null;

function scheduleTabPersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistTabSession, 400);
}

function persistTabSession() {
  const pack = (tabs, activeId) => ({
    paths: tabs.map(t => t.path),
    pinned: tabs.filter(t => t.isPinned).map(t => t.path),
    active: (tabs.find(t => t.id === activeId) || {}).path || null,
  });
  try {
    localStorage.setItem(TAB_SESSION_KEY, JSON.stringify({
      left: pack(state.editor.tabs, state.editor.activeTabId),
      right: state.editor.splitMode ? pack(state.editor.rightTabs || [], state.editor.rightActiveTabId) : null,
    }));
  } catch (e) { /* best effort */ }
}

export async function restoreEditorSession() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(TAB_SESSION_KEY) || 'null');
  } catch (e) { saved = null; }
  if (!saved || !saved.left) return;

  const openPanel = async (data, panel) => {
    if (!data || !Array.isArray(data.paths)) return;
    for (const path of data.paths.slice(0, 15)) {
      try {
        const fileData = await invoke('read_file', { path });
        if (fileData && !fileData.is_binary) {
          openFileInTab(fileData, { panel, silent: true });
          if (data.pinned?.includes(path)) {
            const p = panelState(panel);
            const t = p.tabs.find(x => x.path === path);
            if (t) t.isPinned = true;
          }
        }
      } catch (e) { /* file moved on — skip */ }
    }
    if (data.active) {
      const p = panelState(panel);
      const t = p.tabs.find(x => x.path === data.active);
      if (t) switchToTab(t.id, panel);
    }
  };

  await openPanel(saved.left, 'left');
  if (saved.right && saved.right.paths?.length) {
    openSplitRight();
    await openPanel(saved.right, 'right');
  }
  renderTabs('left');
  renderTabs('right');
  persistTabSession();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initMonaco(containerElement) {
  if (editors.left) return editors.left;
  loadEditorSettings();

  monaco.editor.defineTheme('orbital-dark-theme', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7681', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'bc8cff', fontStyle: 'bold' },
      { token: 'string', foreground: '39c5bb' },
      { token: 'number', foreground: 'f0883e' },
      { token: 'type', foreground: '58a6ff' },
      { token: 'function', foreground: '58a6ff' },
    ],
    colors: {
      'editor.background': '#1f1f1f', 'editor.foreground': '#f0f6fc',
      'editorCursor.foreground': '#39c5bb', 'editor.lineHighlightBackground': '#252526',
      'editorLineNumber.foreground': '#6e7681', 'editorLineNumber.activeForeground': '#39c5bb',
      'editor.selectionBackground': '#264f78', 'editor.inactiveSelectionBackground': '#1e3852',
    }
  });

  monaco.editor.defineTheme('orbital-light-theme', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8250df', fontStyle: 'bold' },
      { token: 'string', foreground: '059669' },
      { token: 'number', foreground: 'bc4c00' },
      { token: 'type', foreground: '0066b8' },
      { token: 'function', foreground: '0066b8' },
    ],
    colors: {
      'editor.background': '#ffffff', 'editor.foreground': '#24292f',
      'editorCursor.foreground': '#059669', 'editor.lineHighlightBackground': '#f6f8fa',
      'editorLineNumber.foreground': '#8c959f', 'editorLineNumber.activeForeground': '#059669',
      'editor.selectionBackground': '#b6e3ff', 'editor.inactiveSelectionBackground': '#d0e8ff',
    }
  });

  const activeTheme = document.documentElement.getAttribute('data-theme') || 'orbit-dark';
  const initialMonacoTheme = activeTheme === 'nebula-light' ? 'orbital-light-theme' : 'orbital-dark-theme';
  const s = editorSettings();

  editors.left = monaco.editor.create(containerElement, {
    theme: initialMonacoTheme,
    fontSize: s.fontSize, fontFamily: s.fontFamily, fontLigatures: s.fontLigatures,
    lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
    lineNumbers: 'on', roundedSelection: true, scrollBeyondLastLine: false, readOnly: false,
    automaticLayout: true,
    minimap: { enabled: !!s.minimap, side: s.minimapSide, scale: Number(s.minimapScale) || 1, showSlider: s.minimapSlider },
    stickyScroll: { enabled: !!s.stickyScroll },
    tabSize: s.tabSize, insertSpaces: s.insertSpaces,
    wordWrap: s.wordWrap, wordWrapColumn: s.wordWrapColumn,
    renderLineHighlight: 'all', cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true, bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
  });

  editors.left.onDidFocusEditorText(() => { lastFocusedPanel = 'left'; });
  bindEditorBase(editors.left, 'left');
  bindEditorCommands(editors.left);
  registerInlineCompletions();

  // Live file reload / Watch: agent writes to a file open in the active tab
  window.addEventListener('orbital:file-written', async (e) => {
    const writtenPath = e.detail?.path;
    if (!writtenPath) return;
    const normalize = (p) => (p ? p.replace(/\\/g, '/').toLowerCase() : '');
    for (const panel of ['left', 'right']) {
      const p = panelState(panel);
      const activeTab = p.tabs.find(t => t.id === p.activeTabId);
      if (activeTab && normalize(activeTab.path) === normalize(writtenPath)) {
        try {
          const fileData = await invoke('read_file', { path: writtenPath });
          const ed = editorFor(panel);
          const pos = ed?.getPosition();
          ed?.setValue(fileData.content);
          if (pos && ed) ed.setPosition(pos);
          activeTab.content = fileData.content;
          activeTab.originalContent = fileData.content;
          activeTab.isDirty = false;
          tabDirtyMap.set(activeTab.id, false);
          renderTabs(panel);
        } catch (err) {
          console.warn('Could not reload file on orbital:file-written:', err);
        }
      }
    }
  });

  return editors.left;
}

/** Wires the status bar + per-editor model change plumbing. */
function bindEditorBase(ed, panel) {
  ed.onDidChangeCursorPosition((e) => {
    if (getActivePanel() !== panel) return;
    const cursorElem = document.getElementById('status-cursor');
    if (cursorElem) cursorElem.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  ed.onDidChangeCursorSelection((e) => {
    if (getActivePanel() !== panel) return;
    const selElem = document.getElementById('sb-selection');
    if (!selElem) return;
    const sel = e.selection;
    if (sel.isEmpty()) { selElem.textContent = ''; return; }
    const model = ed.getModel();
    const lines = sel.endLineNumber - sel.startLineNumber + 1;
    if (model && lines > 1) {
      selElem.textContent = `${lines} lines selected`;
    } else {
      const chars = model ? model.getValueInRange(sel).length : 0;
      selElem.textContent = `${chars} chars selected`;
    }
  });

  ed.onDidChangeModel(() => {
    if (getActivePanel() === panel) {
      updateLanguageStatus(ed);
      updateIndentStatus();
      updateLineEndingStatus(ed);
      updateBreadcrumbFor(panel);
    }
  });
}

// ---------------------------------------------------------------------------
// Part B2/B4/B10 — folding, multi-cursor, and symbol command bindings
// ---------------------------------------------------------------------------

function chord(k1, k2) { return monaco.KeyMod.Chord(k1, k2); }

const editorCommandDisposables = new WeakMap();

/** Combos from the keybinding service (custom overrides live). */
function bcombo(id) {
  return getBinding(id)?.combo || null;
}

function addBound(ed, disposables, bindingId, run) {
  const combo = bcombo(bindingId);
  if (!combo) return;
  const mapped = comboToMonaco(monaco, combo);
  if (!mapped) return;
  const d = ed.addCommand(mapped[0] | mapped[1], run);
  if (d) disposables.push(d);
}

function bindEditorCommands(ed) {
  let disposables = editorCommandDisposables.get(ed) || [];
  for (const d of disposables) { try { d.dispose(); } catch (e) { /* gone */ } }
  disposables = [];
  editorCommandDisposables.set(ed, disposables);

  const run = (actionId) => () => {
    const a = ed.getAction(actionId);
    if (a) a.run();
  };

  addBound(ed, disposables, 'editor.find', () => triggerFindWidget());
  addBound(ed, disposables, 'app.save', () => saveActiveFile());
  addBound(ed, disposables, 'editor.gotoLine', () => triggerGotoLine());
  addBound(ed, disposables, 'editor.gotoDefinition', () => triggerGotoDefinition());
  addBound(ed, disposables, 'editor.selectHighlights', () => triggerSelectHighlights());
  addBound(ed, disposables, 'app.commandPalette', () => import('../components/command-palette.js').then(m => m.openPalette()));
  addBound(ed, disposables, 'app.splitEditor', () => toggleSplitEditor());

  // Folding chords (Ctrl+K prefixes — kept as fixed chord bindings)
  const C = monaco.KeyMod.CtrlCmd, K = monaco.KeyCode;
  const chord = (k1, k2) => monaco.KeyMod.Chord(k1, k2);
  const addChord = (c1, c2, actionId) => {
    const d = ed.addCommand(chord(C | c1, C | c2), run(actionId));
    if (d) disposables.push(d);
  };
  addBound(ed, disposables, 'editor.fold', run('editor.action.fold'));
  addBound(ed, disposables, 'editor.unfold', run('editor.action.unfold'));
  addChord(K.KeyK, K.Digit0, 'editor.action.foldAll');
  addChord(K.KeyK, K.KeyJ, 'editor.action.unfoldAll');
  for (let lvl = 1; lvl <= 5; lvl++) {
    addChord(K.KeyK, K.Digit0 + lvl, `editor.action.foldLevel${lvl}`);
  }

  // Multi-cursor bindings (explicit, in addition to Monaco defaults)
  const S = monaco.KeyMod.Shift, A = monaco.KeyMod.Alt;
  const addCmd = (mods, code, actionId) => {
    const d = ed.addCommand(mods | code, run(actionId));
    if (d) disposables.push(d);
  };
  addCmd(S | A, K.ArrowUp, 'editor.action.insertCursorAbove');
  addCmd(S | A, K.ArrowDown, 'editor.action.insertCursorBelow');
  addCmd(C | A, K.ArrowUp, 'editor.action.insertCursorAbove');
  addCmd(C | A, K.ArrowDown, 'editor.action.insertCursorBelow');
  addCmd(A | S, K.KeyI, 'editor.action.insertCursorAtEndOfEachLineSelected');

  addBound(ed, disposables, 'editor.symbolInFile', run('editor.action.quickOutline'));
  addBound(ed, disposables, 'editor.symbolInWorkspace', () => openWorkspaceSymbolSearch());

  // Part J — AI code actions (context menu + keybindings)
  const aiActions = [
    { id: 'orbital.reviewSelection', label: 'Ask AI to Review Selection', keyCtx: 'editor' },
    { id: 'orbital.explainSelection', label: 'Explain This (AI)', keyCtx: 'editor' },
    { id: 'orbital.generateDocstring', label: 'Generate Docstring (AI)', keyCtx: 'editor' },
  ];
  const C2 = monaco.KeyMod.CtrlCmd, S2 = monaco.KeyMod.Shift, A2 = monaco.KeyMod.Alt, K2 = monaco.KeyCode;
  ed.addAction({
    id: 'orbital.reviewSelection',
    label: 'Ask AI to Review Selection',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    keybindings: [C2 | S2 | K2.KeyR],
    run: (e) => runAIReview(e),
  });
  ed.addAction({
    id: 'orbital.explainSelection',
    label: 'Explain This (AI)',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    keybindings: [C2 | A2 | K2.KeyE],
    run: (e) => runExplainPopup(e),
  });
  ed.addAction({
    id: 'orbital.generateDocstring',
    label: 'Generate Docstring (AI)',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 2,
    run: (e) => runGenerateDocstring(e),
  });
}

/** Re-applies editor keybindings after the user edits them (G4). */
export function rebindEditorCommands() {
  for (const ed of [editors.left, editors.right]) {
    if (ed) bindEditorCommands(ed);
  }
}

// ---------------------------------------------------------------------------
// B1 — AI inline autocomplete (ghost text)
// ---------------------------------------------------------------------------

let inlineCompletionSeq = 0;
let inlineCompletionsRegistered = false;

function registerInlineCompletions() {
  if (inlineCompletionsRegistered) return;
  inlineCompletionsRegistered = true;

  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position) {
      const cfg = state.settings.inlineComplete || {};
      if (!cfg.enabled) return { items: [] };

      // Only trigger after the user pauses for 600ms, and never on a blank line
      const lineContent = model.getLineContent(position.lineNumber).substring(0, position.column - 1);
      if (!lineContent.trim()) return { items: [] };

      const mySeq = ++inlineCompletionSeq;
      await new Promise(r => setTimeout(r, 600));
      if (mySeq !== inlineCompletionSeq) return { items: [] }; // user kept typing

      const offset = model.getOffsetAt(position);
      const full = model.getValue();
      const prefix = full.slice(Math.max(0, offset - 200), offset);

      const indicator = document.getElementById('sb-complete-indicator');
      if (indicator) indicator.style.display = '';
      try {
        const res = await invoke('complete_code', {
          prefix,
          suffix: full.slice(offset, offset + 60),
          language: model.getLanguageId(),
        });
        if (mySeq !== inlineCompletionSeq) return { items: [] };
        let text = (res && res.completion) || '';
        text = text.trimEnd();
        if (!text || text.length > 400) return { items: [] };
        return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
      } catch (e) {
        return { items: [] };
      } finally {
        if (indicator) indicator.style.display = 'none';
      }
    },
    freeInlineCompletions() { /* no cached state */ },
  });
}

// ---------------------------------------------------------------------------
// Part A — tabs (render, drag & drop, pin, preview, context menu)
// ---------------------------------------------------------------------------

let dragState = null; // { panel, tabId }

function tabOrderComparator(a, b) {
  if (a.isPinned && !b.isPinned) return -1;
  if (!a.isPinned && b.isPinned) return 1;
  return 0; // stable sort keeps manual order within groups
}

export function renderTabs(panel = 'left') {
  const dom = panelDom(panel);
  if (!dom.tabsBar) return;
  const p = panelState(panel);

  dom.tabsBar.innerHTML = '';

  // Split controls (only in the left tab bar)
  if (panel === 'left') {
    const splitBtn = document.createElement('button');
    splitBtn.className = 'icon-btn tabbar-split-btn';
    splitBtn.title = state.editor.splitMode ? 'Close split editor (Ctrl+\\)' : 'Split editor right (Ctrl+\\)';
    splitBtn.innerHTML = state.editor.splitMode ? '❙❙' : '⫲';
    splitBtn.addEventListener('click', () => toggleSplitEditor());
    dom.tabsBar.appendChild(splitBtn);
  }

  const sorted = [...p.tabs].sort(tabOrderComparator);
  // Sorting a copy visually while the source array keeps chronological order
  // breaks drag-reorder math — instead apply the sort to the real array.
  p.tabs.sort(tabOrderComparator);

  if (p.tabs.length === 0) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size: 11px; color: var(--text-muted); padding: 0 10px; align-self: center;';
    hint.textContent = panel === 'right' ? 'Right pane — open a file here via the file tree or tab context menu' : '';
    if (panel === 'right') dom.tabsBar.appendChild(hint);
    updateEmptyState(panel);
    return;
  }

  for (const tab of p.tabs) {
    const isDirty = tabDirtyMap.has(tab.id) ? tabDirtyMap.get(tab.id) : (tab.isDirty || false);
    const isActive = tab.id === p.activeTabId;
    const tabEl = document.createElement('div');
    tabEl.className = `tab${isActive ? ' active' : ''}${tab.isPreview ? ' preview-tab' : ''}${tab.isPinned ? ' pinned-tab' : ''}`;
    tabEl.title = tab.path;
    tabEl.dataset.tabId = tab.id;
    tabEl.dataset.panel = panel;
    tabEl.draggable = true;

    tabEl.innerHTML = `
      ${tab.isPinned ? '<span class="tab-pin-indicator" title="Pinned">📌</span>' : (isDirty ? '<span class="tab-dirty-dot" title="Unsaved changes">●</span>' : '')}
      <span class="tab-title${tab.isPreview ? ' preview-title' : ''}">${escapeAttr(tab.name)}</span>
      <span class="tab-pin-btn" title="${tab.isPinned ? 'Unpin tab' : 'Pin tab'}">${tab.isPinned ? '⊗' : '📌'}</span>
      ${tab.isPinned ? '' : '<span class="tab-close" title="Close (Ctrl+W)">✕</span>'}
    `;

    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        closeTab(tab.id, panel);
      } else if (e.target.classList.contains('tab-pin-btn')) {
        e.stopPropagation();
        tab.isPinned = !tab.isPinned;
        persistTabSession();
        renderTabs(panel);
      } else {
        // Editing or focusing a preview tab does NOT make it permanent in VS Code;
        // double-click does. Single click just activates.
        switchToTab(tab.id, panel);
      }
    });

    tabEl.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('tab-close') || e.target.classList.contains('tab-pin-btn')) return;
      if (tab.isPreview) {
        tab.isPreview = false;
        renderTabs(panel);
      }
    });

    // A2: context menu
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, panel, tab);
    });

    // A1: drag & drop reordering
    tabEl.addEventListener('dragstart', (e) => {
      dragState = { panel, tabId: tab.id };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tab.id); } catch (err) { /* IE quirk */ }
      tabEl.classList.add('dragging');
    });
    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
      dom.tabsBar.querySelectorAll('.tab').forEach(t => t.classList.remove('drop-before', 'drop-after'));
      dragState = null;
    });
    tabEl.addEventListener('dragover', (e) => {
      if (!dragState || dragState.panel !== panel) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = tabEl.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      dom.tabsBar.querySelectorAll('.tab').forEach(t => t.classList.remove('drop-before', 'drop-after'));
      tabEl.classList.add(before ? 'drop-before' : 'drop-after');
    });
    tabEl.addEventListener('drop', (e) => {
      if (!dragState || dragState.panel !== panel) return;
      e.preventDefault();
      const rect = tabEl.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      moveTabWithinPanel(panel, dragState.tabId, tab, before);
    });

    dom.tabsBar.appendChild(tabEl);
  }

  updateEmptyState(panel);
}

function moveTabWithinPanel(panel, draggedId, targetTab, beforeTarget) {
  const p = panelState(panel);
  const from = p.tabs.findIndex(t => t.id === draggedId);
  if (from === -1) return;
  const [moved] = p.tabs.splice(from, 1);
  let to = p.tabs.findIndex(t => t.id === targetTab.id);
  if (!beforeTarget) to += 1;
  p.tabs.splice(to, 0, moved);
  renderTabs(panel);
  persistTabSession();
}

function updateEmptyState(panel) {
  const dom = panelDom(panel);
  const p = panelState(panel);
  if (dom.emptyState) dom.emptyState.style.display = p.tabs.length === 0 ? 'flex' : 'none';
  if (panel === 'left') {
    const langElem = document.getElementById('status-language');
    const active = p.tabs.find(t => t.id === p.activeTabId);
    if (langElem) langElem.textContent = active ? (active.language || 'plaintext').toUpperCase() : 'PLAIN TEXT';
  }
}

// ---------------------------------------------------------------------------
// Open / switch / close
// ---------------------------------------------------------------------------

export function openFileInTab(fileData, opts = {}) {
  const { path, relative_path, content } = fileData;
  const panel = opts.panel || getActivePanel();
  const p = panelState(panel);
  const dom = panelDom(panel);
  const filename = path.split(/[/\\]/).pop();
  const lang = detectLanguage(filename);

  // Preview mode (A5): at most one preview tab per panel; new previews replace it
  if (opts.preview) {
    const existingPreview = p.tabs.find(t => t.isPreview);
    if (existingPreview && existingPreview.path !== path) {
      closeTabInternal(existingPreview.id, panel, { keepActive: true });
    }
  }

  let tab = p.tabs.find(t => t.path === path);
  if (!tab) {
    tab = {
      id: 'tab_' + Math.random().toString(36).substring(2, 9),
      path,
      relativePath: relative_path || filename,
      name: filename,
      content,
      originalContent: content,
      isDirty: false,
      isPinned: false,
      isPreview: !!opts.preview,
      language: lang,
    };
    p.tabs.push(tab);
    tabDirtyMap.set(tab.id, false);
  } else {
    if (!opts.preview) tab.isPreview = false;
    // Refresh stale content when re-opening
    if (tab.content !== content) {
      tab.content = content;
      tab.originalContent = content;
      const model = editorModels.get(path);
      if (model && model.getValue() !== content) model.setValue(content);
      tab.isDirty = false;
      tabDirtyMap.set(tab.id, false);
    }
  }

  if (!opts.silent || p.activeTabId === null) {
    p.activeTabId = tab.id;
  }

  // Get or create the (shared) Monaco model
  let model = editorModels.get(path);
  if (!model) {
    const uri = monaco.Uri.file(path);
    model = monaco.editor.getModel(uri) || monaco.editor.createModel(content, lang, uri);
    editorModels.set(path, model);

    const s = editorSettings();
    model.updateOptions({ tabSize: s.tabSize, insertSpaces: s.insertSpaces });
    if (s.detectIndent) detectModelIndent(model);

    model.onDidChangeContent(() => {
      const currentVal = model.getValue();
      for (const pnl of ['left', 'right']) {
        const pp = panelState(pnl);
        const currentTab = pp.tabs.find(t => t.path === path);
        if (!currentTab) continue;
        const isDirty = currentVal !== currentTab.originalContent;
        tabDirtyMap.set(currentTab.id, isDirty);
        if (currentTab.isDirty !== isDirty) {
          currentTab.isDirty = isDirty;
          renderTabs(pnl);
        }
        currentTab.content = currentVal;
        // First edit makes a preview tab permanent (A5)
        if (currentTab.isPreview && isDirty) {
          currentTab.isPreview = false;
          renderTabs(pnl);
        }
        if (state.settings?.autoSave && isDirty) {
          scheduleAutoSave(pnl, currentTab);
        }
      }
    });
  }

  const ed = editorFor(panel);
  if (ed) {
    ed.setModel(model);
    ed.layout();
    if (!opts.silent) ed.focus();
  }

  if (dom.emptyState) dom.emptyState.style.display = 'none';
  if (panel === 'left') {
    const langElem = document.getElementById('status-language');
    if (langElem) langElem.textContent = lang.toUpperCase();
    updateLineEndingForContent(content);
  }

  updateBreadcrumbFor(panel);
  renderTabs(panel);
  if (!opts.silent) scheduleTabPersist();
  notify('activeTab', tab);
  return tab;
}

let autoSaveTimers = new Map();
function scheduleAutoSave(panel, tab) {
  clearTimeout(autoSaveTimers.get(tab.id));
  const delay = typeof state.settings?.autoSaveDelay === 'number' ? state.settings.autoSaveDelay : 1000;
  autoSaveTimers.set(tab.id, setTimeout(() => {
    autoSaveTimers.delete(tab.id);
    saveTab(tab, panel);
  }, delay));
}

function updateBreadcrumbFor(panel) {
  const dom = panelDom(panel);
  const p = panelState(panel);
  const tab = p.tabs.find(t => t.id === p.activeTabId);
  if (!dom.breadcrumb) return;
  if (!tab) { dom.breadcrumb.textContent = ''; return; }
  const relativePath = tab.relativePath || tab.name || tab.path || '';
  dom.breadcrumb.textContent = relativePath.replace(/[\\/]/g, ' › ');
}

export function updateBreadcrumb(tab) {
  updateBreadcrumbFor(getActivePanel());
}

export function switchToTab(tabId, panel = 'left') {
  const p = panelState(panel);
  const tab = p.tabs.find(t => t.id === tabId);
  if (!tab) return;

  p.activeTabId = tabId;
  const model = editorModels.get(tab.path);
  const ed = editorFor(panel);
  if (model && ed) {
    ed.setModel(model);
    ed.layout();
    ed.focus();
  }

  const dom = panelDom(panel);
  if (dom.emptyState) dom.emptyState.style.display = 'none';
  const langElem = document.getElementById('status-language');
  if (panel === 'left' && langElem) langElem.textContent = (tab.language || 'plaintext').toUpperCase();
  if (panel === 'left') updateLineEndingForContent(model ? model.getValue() : tab.content);
  updateBreadcrumbFor(panel);
  updateIndentStatus();
  renderTabs(panel);
  scheduleTabPersist();
}

export function closeTab(tabId, panel = 'left') {
  closeTabInternal(tabId, panel);
}

function closeTabInternal(tabId, panel = 'left', opts = {}) {
  const p = panelState(panel);
  const index = p.tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const tab = p.tabs[index];
  if (tab.isDirty && !opts.force) {
    if (!confirm(`Save changes to ${tab.name} before closing?`)) {
      return;
    }
    saveTab(tab, panel);
  }

  p.tabs.splice(index, 1);
  tabDirtyMap.delete(tabId);

  if (p.activeTabId === tabId) {
    if (p.tabs.length > 0) {
      const nextTab = p.tabs[Math.max(0, index - 1)];
      if (opts.keepActive) {
        p.activeTabId = nextTab.id;
        const model = editorModels.get(nextTab.path);
        if (model && editorFor(panel)) editorFor(panel).setModel(model);
      } else {
        switchToTab(nextTab.id, panel);
      }
    } else {
      p.activeTabId = null;
      if (editorFor(panel)) editorFor(panel).setModel(null);
      const dom = panelDom(panel);
      if (dom.emptyState) dom.emptyState.style.display = 'flex';
      const langElem = document.getElementById('status-language');
      if (panel === 'left' && langElem) langElem.textContent = 'PLAIN TEXT';
      updateBreadcrumbFor(panel);
    }
  }
  renderTabs(panel);
  scheduleTabPersist();
}

function closeOthers(panel) {
  const p = panelState(panel);
  const active = p.tabs.find(t => t.id === p.activeTabId);
  if (!active) return;
  for (const t of [...p.tabs]) {
    if (t !== active && !t.isPinned) closeTabInternal(t.id, panel, { keepActive: true });
  }
  renderTabs(panel);
  scheduleTabPersist();
}

function closeToTheRight(panel, fromTab) {
  const p = panelState(panel);
  const idx = p.tabs.findIndex(t => t.id === fromTab.id);
  for (const t of [...p.tabs.slice(idx + 1)]) {
    if (!t.isPinned) closeTabInternal(t.id, panel, { keepActive: true });
  }
  renderTabs(panel);
  scheduleTabPersist();
}

function closeAllTabs(panel) {
  const p = panelState(panel);
  for (const t of [...p.tabs]) {
    if (!t.isPinned) closeTabInternal(t.id, panel, { keepActive: true });
  }
  renderTabs(panel);
  scheduleTabPersist();
}

// ---------------------------------------------------------------------------
// A2 — tab context menu
// ---------------------------------------------------------------------------

function dismissTabContextMenu() {
  document.getElementById('orbital-tab-context-menu')?.remove();
}

function showTabContextMenu(x, y, panel, tab) {
  dismissTabContextMenu();
  const menu = document.createElement('div');
  menu.className = 'tree-context-menu tab-context-menu';
  menu.id = 'orbital-tab-context-menu';
  menu.addEventListener('contextmenu', (e) => e.preventDefault());

  const p = panelState(panel);
  const idx = p.tabs.findIndex(t => t.id === tab.id);
  const othersCount = p.tabs.filter(t => t.id !== tab.id && !t.isPinned).length;
  const rightCount = p.tabs.slice(idx + 1).filter(t => !t.isPinned).length;

  const items = [
    { label: 'Close Tab', icon: '✕', hint: 'Ctrl+W', enabled: true, action: () => closeTabInternal(tab.id, panel) },
    { label: 'Close Other Tabs', icon: '🗙', enabled: othersCount > 0, action: () => { if (p.activeTabId !== tab.id) switchToTab(tab.id, panel); closeOthers(panel); } },
    { label: 'Close Tabs to the Right', icon: '❯', enabled: rightCount > 0, action: () => closeToTheRight(panel, tab) },
    { label: 'Close All Tabs', icon: '🗂️', enabled: p.tabs.some(t => !t.isPinned), action: () => closeAllTabs(panel) },
    { type: 'separator' },
    { label: tab.isPinned ? 'Unpin Tab' : 'Pin Tab', icon: '📌', action: () => { tab.isPinned = !tab.isPinned; persistTabSession(); renderTabs(panel); } },
    { label: 'Copy File Path', icon: '📋', action: () => navigator.clipboard.writeText(tab.path) },
    { label: 'Copy Relative Path', icon: '🔗', action: () => navigator.clipboard.writeText(tab.relativePath || tab.name) },
    { label: 'Reveal in File Explorer', icon: '📂', action: async () => {
      try {
        await invoke('run_command', { command: `explorer /select,"${tab.path}"`, timeout_seconds: 10 });
      } catch (e) { console.warn('Reveal failed:', e); }
      // Also highlight in the sidebar tree
      import('../components/file-tree.js').then(m => {
        if (typeof m.revealPathInTree === 'function') m.revealPathInTree(tab.path);
      });
    } },
    { label: 'Move to ' + (panel === 'left' ? 'Right' : 'Left') + ' Pane', icon: '⫲', enabled: state.editor.splitMode, action: () => moveTabToPanel(tab, panel, panel === 'left' ? 'right' : 'left') },
    { type: 'separator' },
    { label: 'Toggle Git Blame', icon: '👁', action: () => import('../components/source-control.js').then(m => m.toggleGitBlame()) },
  ];

  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'tree-context-separator';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'tree-context-item' + (item.enabled === false ? ' disabled' : '');
    row.innerHTML = `<span class="ctx-icon">${item.icon}</span><span class="ctx-label">${item.label}</span>${item.hint ? `<span class="ctx-hint">${item.hint}</span>` : ''}`;
    if (item.enabled !== false) {
      row.addEventListener('click', () => { dismissTabContextMenu(); item.action(); });
    }
    menu.appendChild(row);
  }

  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - menuRect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menuRect.height - 8)}px`;

  setTimeout(() => {
    const onDown = (e) => {
      if (!menu.contains(e.target)) { dismissTabContextMenu(); document.removeEventListener('mousedown', onDown); }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { dismissTabContextMenu(); document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
  }, 0);
}

// ---------------------------------------------------------------------------
// A3 — split editor
// ---------------------------------------------------------------------------

export function openSplitRight() {
  if (state.editor.splitMode) return;
  state.editor.splitMode = true;

  const leftTabsBar = document.getElementById('tabs-bar');
  const leftViewport = document.querySelector('.editor-viewport');
  const region = document.querySelector('.editor-region');
  if (!leftTabsBar || !leftViewport || !region) return;

  // Wrap existing left pane, add resizer + right pane
  const leftPane = document.createElement('div');
  leftPane.className = 'editor-pane';
  leftPane.id = 'editor-pane-left';
  region.insertBefore(leftPane, leftTabsBar);
  leftPane.appendChild(leftTabsBar);
  leftPane.appendChild(leftViewport);

  const resizer = document.createElement('div');
  resizer.className = 'resizer-y editor-split-resizer';
  resizer.id = 'editor-split-resizer';
  region.insertBefore(resizer, leftPane.nextSibling);

  const rightPane = document.createElement('div');
  rightPane.className = 'editor-pane';
  rightPane.id = 'editor-pane-right';
  rightPane.innerHTML = `
    <div class="editor-tabs-bar" id="tabs-bar-right"></div>
    <div class="editor-viewport" style="position: relative;">
      <div id="editor-breadcrumb-right" class="editor-breadcrumb"></div>
      <div id="monaco-container-right"></div>
      <div class="empty-state" id="editor-empty-state-right" style="display: flex;">
        <div class="empty-title" style="font-size: 15px;">Right pane</div>
        <div class="empty-desc" style="font-size: 11px; color: var(--text-muted);">Open a file here from the file tree, or move a tab from the left pane.</div>
      </div>
    </div>
  `;
  region.insertBefore(rightPane, resizer.nextSibling);

  const s = editorSettings();
  editors.right = monaco.editor.create(document.getElementById('monaco-container-right'), {
    theme: editors.left?.getOption(monaco.editor.EditorOption.theme) || 'orbital-dark-theme',
    automaticLayout: true,
    fontSize: s.fontSize, fontFamily: s.fontFamily, fontLigatures: s.fontLigatures,
    lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
    minimap: { enabled: !!s.minimap, side: s.minimapSide, scale: Number(s.minimapScale) || 1, showSlider: s.minimapSlider },
    stickyScroll: { enabled: !!s.stickyScroll },
    tabSize: s.tabSize, insertSpaces: s.insertSpaces,
    wordWrap: s.wordWrap, wordWrapColumn: s.wordWrapColumn,
  });
  editors.right.onDidFocusEditorText(() => { lastFocusedPanel = 'right'; });
  bindEditorBase(editors.right, 'right');
  bindEditorCommands(editors.right);

  wireSplitResizer(resizer, leftPane, rightPane);
  renderTabs('left');
  renderTabs('right');
  scheduleTabPersist();
}

export function closeSplitEditor() {
  if (!state.editor.splitMode) return;
  state.editor.splitMode = false;

  // Merge right-pane tabs into the left pane (non-duplicates)
  for (const rt of [...(state.editor.rightTabs || [])]) {
    if (!state.editor.tabs.some(t => t.path === rt.path)) {
      const tab = { ...rt, id: 'tab_' + Math.random().toString(36).substring(2, 9) };
      state.editor.tabs.push(tab);
      tabDirtyMap.set(tab.id, tabDirtyMap.get(rt.id) || false);
    }
  }
  state.editor.rightTabs = [];
  state.editor.rightActiveTabId = null;

  editors.right?.dispose();
  editors.right = null;

  document.getElementById('editor-pane-right')?.remove();
  document.getElementById('editor-split-resizer')?.remove();

  const leftPane = document.getElementById('editor-pane-left');
  const region = document.querySelector('.editor-region');
  if (leftPane && region) {
    const leftTabsBar = document.getElementById('tabs-bar');
    const leftViewport = leftPane.querySelector('.editor-viewport');
    region.insertBefore(leftTabsBar, leftPane);
    region.insertBefore(leftViewport, leftPane.nextSibling);
    leftPane.remove();
  }

  renderTabs('left');
  editors.left?.layout();
  scheduleTabPersist();
}

// ---------------------------------------------------------------------------
// Part J — AI code actions (review / explain / docstring)
// ---------------------------------------------------------------------------

async function askAI(systemPrompt, userPrompt) {
  const { state } = await import('../state/store.js');
  if (state.ai.isGenerating) {
    const { showToast } = await import('../services/notifications.js');
    showToast('The agent is busy — try again when it finishes', 'info', 2600);
    return null;
  }
  const { dispatchAgentTurn } = await import('../components/agent.js');
  const resp = await dispatchAgentTurn([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], {});
  return resp?.content || null;
}

async function getSelectionOrNothing(ed) {
  const model = ed.getModel();
  const sel = ed.getSelection();
  if (!model || sel.isEmpty()) return null;
  return model.getValueInRange(sel);
}

function ensureReviewPanel() {
  let panel = document.getElementById('ai-review-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ai-review-panel';
    panel.className = 'ai-side-panel';
    panel.innerHTML = `
      <div class="ai-side-header">
        <strong>🧐 AI Code Review</strong>
        <button class="btn btn-secondary btn-sm" id="ai-review-close">✕</button>
      </div>
      <div class="ai-side-body" id="ai-review-body"></div>
      <div class="ai-side-footer">
        <button class="btn btn-primary btn-sm" id="ai-review-apply" style="width: 100%;">Apply Suggestions in Agent Chat</button>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#ai-review-close').addEventListener('click', () => { panel.style.display = 'none'; });
  }
  return panel;
}

async function runAIReview(ed) {
  const code = await getSelectionOrNothing(ed);
  if (!code) {
    const { showToast } = await import('../services/notifications.js');
    showToast('Select some code first', 'info', 2200);
    return;
  }
  const model = ed.getModel();
  const panel = ensureReviewPanel();
  const body = panel.querySelector('#ai-review-body');
  panel.style.display = 'flex';
  body.innerHTML = '<div class="pack-empty">Reviewing selection…</div>';
  panel.querySelector('#ai-review-apply').style.display = 'none';

  const review = await askAI(
    'You are an expert code reviewer. Review this code for: bugs, security issues, performance, style, and suggest improvements. Be concise. Use short sections with concrete line references.',
    `Language: ${model?.getLanguageId() || 'unknown'}\n\n\`\`\`\n${code}\n\`\`\`\n\nProvide the review now.`
  );

  if (review === null) { body.innerHTML = '<div class="pack-empty">Review cancelled (agent busy).</div>'; return; }
  const { formatMarkdown } = await import('../components/agent.js');
  body.innerHTML = formatMarkdown(review || '(no review returned)');
  panel.querySelector('#ai-review-apply').style.display = '';
  panel.querySelector('#ai-review-apply').onclick = () => {
    panel.style.display = 'none';
    const agentPanel = document.getElementById('agent-panel');
    agentPanel?.classList.remove('hidden');
    const input = document.getElementById('agent-input');
    if (input) {
      input.value = `Implement these code review suggestions on the selected code:\n\n${review.slice(0, 2500)}`;
      input.focus();
    }
  };
}

async function runExplainPopup(ed) {
  const code = await getSelectionOrNothing(ed);
  if (!code) return;
  document.getElementById('ai-explain-popover')?.remove();

  const pop = document.createElement('div');
  pop.id = 'ai-explain-popover';
  pop.className = 'ai-popover';
  pop.innerHTML = '<div class="pack-empty">Explaining…</div>';
  document.body.appendChild(pop);

  // Position near the end of the selection
  const pos = ed.getScrolledVisiblePosition(ed.getSelection().getEndPosition());
  const edRect = ed.getDomNode().getBoundingClientRect();
  const x = Math.min(edRect.left + (pos?.left || 100) , window.innerWidth - 380);
  const y = Math.min(edRect.top + (pos?.top || 100) + 18, window.innerHeight - 240);
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${Math.max(8, y)}px`;

  const explanation = await askAI(
    'Explain code simply and clearly. 3-6 short sentences max. No preamble.',
    `\`\`\`\n${code.slice(0, 3000)}\n\`\`\``
  );
  if (explanation === null) { pop.remove(); return; }
  const { formatMarkdown } = await import('../components/agent.js');
  pop.innerHTML = `<div class="ai-popover-title">💡 Explanation</div><div class="ai-popover-body">${formatMarkdown(explanation || '')}</div>`;

  const onDown = (e) => {
    if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', onDown); }
  };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

const DOCSTRING_FORMATS = {
  typescript: (d) => `/**\n${d.split('\n').map(l => ` * ${l}`).join('\n')}\n */`,
  javascript: (d) => `/**\n${d.split('\n').map(l => ` * ${l}`).join('\n')}\n */`,
  rust: (d) => `/// ${d.split('\n').join('\n/// ')}`,
  python: (d) => `"""${d.split('\n').join('\n')}"""`,
};

async function runGenerateDocstring(ed) {
  const code = await getSelectionOrNothing(ed);
  if (!code) {
    const { showToast } = await import('../services/notifications.js');
    showToast('Select the function to document', 'info', 2200);
    return;
  }
  const lang = ed.getModel()?.getLanguageId() || 'javascript';
  const format = DOCSTRING_FORMATS[lang] || DOCSTRING_FORMATS.javascript;
  const { showToast } = await import('../services/notifications.js');
  showToast('Generating docstring…', 'info', 1800);

  const doc = await askAI(
    `You write documentation comments. Output ONLY the documentation comment text for the given function — no code, no fences, no prose. Format: ${lang === 'rust' ? 'rustdoc (/// lines)' : lang === 'python' ? 'Python docstring body' : 'JSDoc body without the /** */ wrappers'}. Include params, return value, and one-line purpose.`,
    `\`\`\`${lang}\n${code.slice(0, 2500)}\n\`\`\``
  );
  if (!doc) { showToast('Docstring generation failed', 'error', 2600); return; }

  const wrapped = format(doc.replace(/^```[a-z]*\n?|```$/g, '').trim());
  const sel = ed.getSelection();
  const model = ed.getModel();
  if (!model) return;
  ed.executeEdits('orbital-docstring', [{
    range: new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, 1),
    text: wrapped + '\n',
    forceMoveMarkers: false,
  }]);
  showToast('Docstring inserted above the selection', 'success', 2200);
}

/** Closes the focused pane's active tab (used by Ctrl+W and the palette). */
export function toggleSplitEditor() {
  if (state.editor.splitMode) closeSplitEditor();
  else openSplitRight();
}

function moveTabToPanel(tab, fromPanel, toPanel) {
  if (!state.editor.splitMode) return;
  const from = panelState(fromPanel);
  const to = panelState(toPanel);
  if (to.tabs.some(t => t.path === tab.path)) {
    // Already open in target — just activate there
    switchToTab(to.tabs.find(t => t.path === tab.path).id, toPanel);
  } else {
    to.tabs.push(tab);
    tabDirtyMap.set(tab.id, tabDirtyMap.get(tab.id) || false);
    switchToTab(tab.id, toPanel);
  }
  from.tabs = from.tabs.filter(t => t.id !== tab.id);
  if (from.activeTabId === tab.id) {
    from.activeTabId = from.tabs[0]?.id || null;
    if (from.tabs[0]) switchToTab(from.tabs[0].id, fromPanel);
  }
  renderTabs(fromPanel);
  renderTabs(toPanel);
  scheduleTabPersist();
}

function wireSplitResizer(resizer, leftPane, rightPane) {
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const region = document.querySelector('.editor-region');
    const onMouseMove = (ev) => {
      const rect = region.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(20, Math.min(80, pct));
      leftPane.style.width = `${clamped}%`;
      rightPane.style.width = `${100 - clamped}%`;
      editors.left?.layout();
      editors.right?.layout();
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export async function saveActiveFile() {
  const panel = getActivePanel();
  const p = panelState(panel);
  const activeTab = p.tabs.find(t => t.id === p.activeTabId);
  if (!activeTab) return;
  await saveTab(activeTab, panel);
}

export async function saveTab(tab, panel = 'left') {
  const ed = editorFor(panel);
  if (!ed || !tab) return;
  const currentContent = ed.getValue();

  try {
    const diff = await invoke('save_file', {
      path: tab.path,
      content: currentContent,
      description: 'User manual save',
    });

    tab.originalContent = currentContent;
    tab.content = currentContent;
    tab.isDirty = false;
    tabDirtyMap.set(tab.id, false);
    renderTabs(panel);
    console.log('File saved successfully:', tab.path, diff);
  } catch (e) {
    alert('Error saving file: ' + e);
  }
}

// ---------------------------------------------------------------------------
// Part C — status bar (language picker, line ending, indent, selection, format)
// ---------------------------------------------------------------------------

function updateLanguageStatus(ed) {
  const langElem = document.getElementById('status-language');
  if (!langElem) return;
  const model = ed.getModel();
  langElem.textContent = model ? model.getLanguageId().toUpperCase() : 'PLAIN TEXT';
}

function updateIndentStatus() {
  const el = document.getElementById('sb-indent');
  if (!el) return;
  const ed = editorFor(getActivePanel());
  const model = ed?.getModel();
  if (!model) { el.textContent = 'Spaces: 2'; return; }
  const opts = model.getOptions();
  el.textContent = opts.insertSpaces ? `Spaces: ${opts.tabSize}` : `Tab Size: ${opts.tabSize}`;
}

function updateLineEndingStatus(ed) {
  const model = ed.getModel();
  if (!model) return;
  updateLineEndingForContent(model.getValue());
}

function updateLineEndingForContent(content) {
  const el = document.getElementById('sb-line-ending');
  if (!el) return;
  el.textContent = content.includes('\r\n') ? 'CRLF' : 'LF';
}

export function formatActiveDocument() {
  const ed = editorFor(getActivePanel());
  if (!ed) return;
  const action = ed.getAction('editor.action.formatDocument');
  if (action) {
    action.run().then(
      () => showToast('Document formatted', 'success', 1800),
      (err) => showToast(`No formatter available for this language (${err?.message || err})`, 'error', 3000)
    );
  }
}

export function openLanguagePicker() {
  let modal = document.getElementById('modal-language-picker');
  if (modal) { modal.style.display = 'flex'; return; }

  modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-language-picker';
  modal.style.display = 'flex';
  modal.style.alignItems = 'flex-start';
  modal.style.paddingTop = '80px';
  modal.innerHTML = `
    <div class="modal-container" style="width: 380px; max-height: 60vh; display: flex; flex-direction: column; padding: 12px;">
      <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">Select Language Mode</div>
      <input type="text" class="input-text" id="lang-picker-filter" placeholder="Filter languages…" style="margin-bottom: 8px;" autofocus />
      <div id="lang-picker-list" style="overflow-y: auto; display: flex; flex-direction: column; gap: 2px;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector('#lang-picker-list');
  const filterEl = modal.querySelector('#lang-picker-filter');

  const renderList = (query = '') => {
    const langs = monaco.languages.getLanguages();
    const q = query.toLowerCase();
    const filtered = q
      ? langs.filter(l => l.id.toLowerCase().includes(q) || (l.aliases || []).some(a => a.toLowerCase().includes(q)))
      : langs;
    listEl.innerHTML = '';
    for (const lang of filtered) {
      const item = document.createElement('div');
      item.className = 'chat-history-item';
      item.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 6px; font-size: 12px;';
      item.textContent = (lang.aliases && lang.aliases[0]) || lang.id;
      item.title = lang.id;
      item.addEventListener('click', () => {
        const ed = editorFor(getActivePanel());
        const model = ed?.getModel();
        if (model) {
          monaco.editor.setModelLanguage(model, lang.id);
          const p = panelState(getActivePanel());
          const tab = p.tabs.find(t => t.id === p.activeTabId);
          if (tab) tab.language = lang.id;
          updateLanguageStatus(ed);
        }
        modal.style.display = 'none';
      });
      listEl.appendChild(item);
    }
    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No languages match.</div>';
    }
  };

  filterEl.addEventListener('input', () => renderList(filterEl.value));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  window.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      modal.style.display = 'none';
      window.removeEventListener('keydown', onEsc);
    }
  });
  renderList();
  filterEl.focus();
}

// ---------------------------------------------------------------------------
// B10 — workspace symbol search (Ctrl+T)
// ---------------------------------------------------------------------------

export async function openWorkspaceSymbolSearch() {
  let modal = document.getElementById('modal-symbol-search');
  if (modal) { modal.style.display = 'flex'; return; }

  modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-symbol-search';
  modal.style.display = 'flex';
  modal.style.alignItems = 'flex-start';
  modal.style.paddingTop = '80px';
  modal.innerHTML = `
    <div class="modal-container" style="width: 480px; max-height: 60vh; display: flex; flex-direction: column; padding: 12px;">
      <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">Go to Symbol in Workspace</div>
      <input type="text" class="input-text" id="symbol-search-input" placeholder="Type a symbol name…" style="margin-bottom: 8px;" autofocus />
      <div id="symbol-search-results" style="overflow-y: auto; display: flex; flex-direction: column; gap: 2px;">
        <div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Type to search symbols across the workspace.</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const inputEl = modal.querySelector('#symbol-search-input');
  const resultsEl = modal.querySelector('#symbol-search-results');

  let debounce;
  inputEl.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = inputEl.value.trim();
    if (!q) {
      resultsEl.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Type to search symbols across the workspace.</div>';
      return;
    }
    debounce = setTimeout(async () => {
      resultsEl.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Searching…</div>';
      try {
        const res = await invoke('execute_tool', {
          name: 'find_symbol',
          arguments: { symbol: q, symbol_type: 'all', max_results: 30 },
          mode: state.agentMode,
        });
        if (!res || res.length === 0) {
          resultsEl.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">No symbols found.</div>';
          return;
        }
        resultsEl.innerHTML = '';
        for (const sym of res) {
          const item = document.createElement('div');
          item.className = 'chat-history-item';
          item.style.cssText = 'padding: 5px 10px; cursor: pointer; border-radius: 6px; font-size: 11px; display: flex; justify-content: space-between; gap: 8px;';
          item.innerHTML = `
            <span style="font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeAttr(String(sym.snippet || sym.symbol || '').slice(0, 80))}</span>
            <span style="color: var(--text-muted); flex-shrink: 0;">${escapeAttr(sym.file)}:${sym.line}</span>`;
          item.addEventListener('click', async () => {
            modal.style.display = 'none';
            try {
              const fileData = await invoke('read_file', { path: sym.file });
              const tab = openFileInTab(fileData);
              const ed = editorFor(getActivePanel());
              if (ed) {
                ed.revealLineInCenter(sym.line);
                ed.setPosition({ lineNumber: sym.line, column: 1 });
                ed.focus();
              }
            } catch (e) {
              showToast(`Could not open ${sym.file}: ${e}`, 'error');
            }
          });
          resultsEl.appendChild(item);
        }
      } catch (e) {
        resultsEl.innerHTML = `<div style="color: var(--accent-red); font-size: 12px; padding: 8px;">${escapeAttr(String(e))}</div>`;
      }
    }, 250);
  });

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  inputEl.focus();
}

// ---------------------------------------------------------------------------
// Zoom, find, goto — preserved commands
// ---------------------------------------------------------------------------

export function triggerFindWidget() {
  const ed = editorFor(getActivePanel());
  if (!ed) return;
  ed.focus();
  ed.getAction('actions.find')?.run();
}
export function triggerGotoLine() {
  const ed = editorFor(getActivePanel());
  if (!ed) return;
  ed.focus();
  ed.getAction('editor.action.gotoLine')?.run();
}
export function triggerGotoDefinition() {
  const ed = editorFor(getActivePanel());
  if (!ed) return;
  ed.focus();
  ed.getAction('editor.action.revealDefinition')?.run();
}
export function triggerSelectHighlights() {
  const ed = editorFor(getActivePanel());
  if (!ed) return;
  ed.focus();
  ed.getAction('editor.action.selectHighlights')?.run();
}
export function zoomIn() {
  editorFor(getActivePanel())?.trigger('keyboard', 'editor.action.fontZoomIn', {});
}
export function zoomOut() {
  editorFor(getActivePanel())?.trigger('keyboard', 'editor.action.fontZoomOut', {});
}
export function zoomReset() {
  editorFor(getActivePanel())?.trigger('keyboard', 'editor.action.fontZoomReset', {});
}

export function updateFontSize(size) {
  const s = editorSettings();
  s.fontSize = size;
  applyEditorSettings();
}

export function updateTheme(themeName) {
  const chosen = themeName === 'nebula-light' ? 'orbital-light-theme' : 'orbital-dark-theme';
  monaco.editor.setTheme(chosen);
  if (editors.right) editors.right.updateOptions({ theme: chosen });
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Diff editor (unchanged behavior)
// ---------------------------------------------------------------------------

let diffEditorInstance = null;

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

  acceptBtn.onclick = () => { cleanup(); if (onAccept) onAccept(); };
  rejectBtn.onclick = () => { cleanup(); if (onReject) onReject(); };
  closeBtn.onclick = () => { cleanup(); if (onReject) onReject(); };
}
