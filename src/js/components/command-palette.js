// ==========================================================================
// Orbital X — Command Palette (command-palette.js)
//
// Ctrl+Shift+P / F1: searchable, fuzzy-matched list of every IDE command,
// grouped (Editor / View / Agent / Git / File / Tools), with keybinding
// hints, arrow-key navigation, and most-recently-used ordering.
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

const MRU_KEY = 'orbital_palette_mru';
let mru = [];
try { mru = JSON.parse(localStorage.getItem(MRU_KEY) || '[]'); } catch (e) { mru = []; }

let commands = [];
let filtered = [];
let selectedIndex = 0;
let backdrop = null;

export function initCommandPalette() {
  buildCommandRegistry();
  // Global open/close is owned by the keybinding dispatcher
  // (app.commandPalette). Escape while open is handled here.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop) {
      e.preventDefault();
      closePalette();
    }
  });
}

function buildCommandRegistry() {
  commands = [
    // ----- Editor -----
    { id: 'file.save', group: 'Editor', icon: '💾', title: 'Save File', keybinding: 'Ctrl+S', run: () => withMonaco(m => m.saveActiveFile()) },
    { id: 'file.saveAll', group: 'Editor', icon: '🗂️', title: 'Save All Dirty Tabs', run: saveAllDirtyTabs },
    { id: 'editor.closeTab', group: 'Editor', icon: '✕', title: 'Close Tab', keybinding: 'Ctrl+W', run: () => withMonaco(m => m.closeActiveTab()) },
    { id: 'editor.formatDocument', group: 'Editor', icon: '🖊️', title: 'Format Document', keybinding: 'Shift+Alt+F', run: () => withMonaco(m => m.formatActiveDocument()) },
    { id: 'editor.foldAll', group: 'Editor', icon: '📕', title: 'Fold All', keybinding: 'Ctrl+K Ctrl+0', run: () => runAction('editor.action.foldAll') },
    { id: 'editor.unfoldAll', group: 'Editor', icon: '📖', title: 'Unfold All', keybinding: 'Ctrl+K Ctrl+J', run: () => runAction('editor.action.unfoldAll') },
    { id: 'editor.gotoSymbol', group: 'Editor', icon: '🔖', title: 'Go to Symbol in File', keybinding: 'Ctrl+Shift+O', run: () => runAction('editor.action.quickOutline') },
    { id: 'editor.workspaceSymbol', group: 'Editor', icon: '🔍', title: 'Go to Symbol in Workspace', keybinding: 'Ctrl+T', run: () => withMonaco(m => m.openWorkspaceSymbolSearch()) },
    { id: 'editor.find', group: 'Editor', icon: '🔎', title: 'Find in File', keybinding: 'Ctrl+F', run: () => withMonaco(m => m.triggerFindWidget()) },
    { id: 'editor.gotoLine', group: 'Editor', icon: '↳', title: 'Go to Line…', keybinding: 'Ctrl+G', run: () => withMonaco(m => m.triggerGotoLine()) },
    { id: 'editor.split', group: 'Editor', icon: '⫲', title: 'Toggle Split Editor', keybinding: 'Ctrl+\\', run: () => withMonaco(m => m.toggleSplitEditor()) },
    { id: 'editor.languageMode', group: 'Editor', icon: '🔤', title: 'Change Language Mode', run: () => withMonaco(m => m.openLanguagePicker()) },

    // ----- View -----
    { id: 'view.toggleSidebar', group: 'View', icon: '▮', title: 'Toggle Primary Sidebar', keybinding: 'Ctrl+B', run: () => clickById('btn-toggle-sidebar') },
    { id: 'view.toggleTerminal', group: 'View', icon: '❯_', title: 'Toggle Terminal', keybinding: 'Ctrl+`', run: () => clickById('rail-terminal') },
    { id: 'view.toggleAgent', group: 'View', icon: '🤖', title: 'Toggle Agent Panel', keybinding: 'Ctrl+Shift+A', run: () => clickById('rail-agent') },
    { id: 'view.explorer', group: 'View', icon: '📁', title: 'Show Explorer', keybinding: 'Ctrl+Shift+E', run: () => clickById('rail-explorer') },
    { id: 'view.search', group: 'View', icon: '🔍', title: 'Show Search Panel', keybinding: 'Ctrl+Shift+F', run: () => clickById('rail-search') },
    { id: 'view.sourceControl', group: 'View', icon: '⑂', title: 'Show Source Control', keybinding: 'Ctrl+Shift+G', run: () => clickById('rail-source-control') },
    { id: 'view.extensions', group: 'View', icon: '🧩', title: 'Show Extensions', keybinding: 'Ctrl+Shift+X', run: () => clickById('rail-extensions') },
    { id: 'view.skills', group: 'View', icon: '🛠️', title: 'Show Skills', run: () => clickById('rail-skills') },
    { id: 'view.memories', group: 'View', icon: '💾', title: 'Show Project Memory', run: () => clickById('rail-memory') },
    { id: 'view.toggleMinimap', group: 'View', icon: '🗺️', title: 'Toggle Minimap', run: toggleMinimap },
    { id: 'view.toggleWordWrap', group: 'View', icon: '↩', title: 'Toggle Word Wrap', keybinding: 'Alt+Z', run: toggleWordWrap },
    { id: 'view.zoomIn', group: 'View', icon: '➕', title: 'Editor Font Zoom In', keybinding: 'Ctrl+=', run: () => withMonaco(m => m.zoomIn()) },
    { id: 'view.zoomOut', group: 'View', icon: '➖', title: 'Editor Font Zoom Out', keybinding: 'Ctrl+-', run: () => withMonaco(m => m.zoomOut()) },
    { id: 'view.cycleTheme', group: 'View', icon: '🎨', title: 'Cycle Color Theme', run: () => import('../components/settings.js').then(m => m.cycleTheme()) },

    // ----- Agent -----
    { id: 'agent.focusChat', group: 'Agent', icon: '💬', title: 'Focus Agent Chat', keybinding: 'Ctrl+L', run: () => { clickById('rail-agent'); document.getElementById('agent-input')?.focus(); } },
    { id: 'agent.newChat', group: 'Agent', icon: '✨', title: 'New Agent Chat Session', run: () => clickById('btn-new-chat') },
    { id: 'agent.undoChange', group: 'Agent', icon: '↩️', title: 'Undo Last Agent File Change', run: async () => {
        try {
          const res = await invoke('undo_agent_change');
          showToast(`↩️ ${res}`, 'success', 3000);
        } catch (e) { showToast(`Undo failed: ${e}`, 'error'); }
      } },
    { id: 'agent.cycleMode', group: 'Agent', icon: '🛡️', title: 'Cycle Operating Mode (Pro/Dev/User)', keybinding: 'Alt+M', run: () => clickById('header-mode-pill') },
    { id: 'agent.modelPicker', group: 'Agent', icon: '⭐', title: 'Select AI Model', run: () => clickById('composer-model-selector') },

    // ----- Git -----
    { id: 'git.status', group: 'Git', icon: '⑂', title: 'Show Git Status', run: () => clickById('rail-source-control') },
    { id: 'git.commit', group: 'Git', icon: '✔', title: 'Stage All & Commit…', run: gitCommitFlow },
    { id: 'git.blame', group: 'Git', icon: '👁', title: 'Toggle Git Blame in Editor', run: () => import('../components/source-control.js').then(m => m.toggleGitBlame()) },

    // ----- File -----
    { id: 'file.openFolder', group: 'File', icon: '📂', title: 'Open Workspace Folder…', keybinding: 'Ctrl+O', run: () => clickById('btn-open-workspace') },
    { id: 'file.runTests', group: 'File', icon: '🧪', title: 'Run Project Tests', run: runTests },

    // ----- Tools -----
    { id: 'tools.settings', group: 'Tools', icon: '⚙️', title: 'Open Settings', keybinding: 'Ctrl+,', run: () => clickById('btn-open-settings') },
    { id: 'tools.shortcuts', group: 'Tools', icon: '⌨️', title: 'Keyboard Shortcuts Reference', run: () => clickById('menu-help') },
    { id: 'tools.usage', group: 'Tools', icon: '⚡', title: 'Token Usage Dashboard', run: () => clickById('rail-usage') },
    { id: 'tools.about', group: 'Tools', icon: '🪐', title: 'About Orbital X', run: () => clickById('btn-about-orbital') },
  ];
}

function withMonaco(fn) {
  import('../editor/monaco.js').then(fn);
}

function runAction(actionId) {
  withMonaco(m => {
    const ed = m.getActiveEditor?.();
    const action = ed?.getAction(actionId);
    if (action) action.run();
  });
}

function clickById(id) {
  document.getElementById(id)?.click();
}

async function saveAllDirtyTabs() {
  const m = await import('../editor/monaco.js');
  let saved = 0;
  for (const panel of ['left', 'right']) {
    const tabs = m.getPanelTabs(panel);
    for (const t of tabs) {
      if (t.isDirty) {
        await m.saveTab(t, panel);
        saved++;
      }
    }
  }
  showToast(saved > 0 ? `Saved ${saved} file${saved === 1 ? '' : 's'}` : 'No unsaved changes', 'success', 2200);
}

async function toggleMinimap() {
  const { state } = await import('../state/store.js');
  const m = await import('../editor/monaco.js');
  state.settings.editor = state.settings.editor || {};
  state.settings.editor.minimap = !(state.settings.editor.minimap ?? true);
  m.applyEditorSettings();
  showToast(`Minimap ${state.settings.editor.minimap ? 'on' : 'off'}`, 'info', 1600);
}

async function toggleWordWrap() {
  const { state } = await import('../state/store.js');
  const m = await import('../editor/monaco.js');
  state.settings.editor = state.settings.editor || {};
  const current = state.settings.editor.wordWrap || 'on';
  state.settings.editor.wordWrap = current === 'off' ? 'on' : 'off';
  m.applyEditorSettings();
  showToast(`Word wrap ${state.settings.editor.wordWrap === 'on' ? 'on' : 'off'}`, 'info', 1600);
}

async function gitCommitFlow() {
  const message = prompt('Commit message (stages all changes first):');
  if (!message || !message.trim()) return;
  try {
    const out = await invoke('git_stage_and_commit', { message: message.trim() });
    showToast('Committed successfully', 'success', 3000);
    console.log(out);
    import('../components/source-control.js').then(m => m.refreshGitStatus?.());
  } catch (e) {
    showToast(`Commit failed: ${e}`, 'error', 4000);
  }
}

async function runTests() {
  showToast('Running project test suite…', 'info', 2000);
  try {
    const res = await invoke('execute_tool', {
      name: 'run_tests',
      arguments: {},
      mode: (await import('../state/store.js')).state.agentMode,
    });
    showToast(res?.success ? '✓ Tests passed' : '✗ Tests failed — see terminal', res?.success ? 'success' : 'error', 3500);
  } catch (e) {
    showToast(`Tests failed: ${e}`, 'error', 4000);
  }
}

// ---------------------------------------------------------------------------
// Palette UI
// ---------------------------------------------------------------------------

export function togglePalette() {
  if (backdrop) closePalette();
  else openPalette();
}

export function closePalette() {
  backdrop?.remove();
  backdrop = null;
}

export function openPalette() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.className = 'command-palette-backdrop';
  backdrop.innerHTML = `
    <div class="command-palette" role="dialog" aria-label="Command palette">
      <input type="text" id="command-palette-input" placeholder="Type a command…" autocomplete="off" spellcheck="false" />
      <div class="command-palette-list" id="command-palette-list"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#command-palette-input');
  const list = backdrop.querySelector('#command-palette-list');

  input.addEventListener('input', () => {
    filterCommands(input.value);
    renderList(list);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); renderList(list); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); renderList(list); }
    else if (e.key === 'Enter') { e.preventDefault(); executeSelected(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closePalette();
  });

  filterCommands('');
  renderList(list);
  input.focus();
}

/** Subsequence fuzzy match with contiguous bonus; returns score or -1. */
function fuzzyScore(text, query) {
  text = text.toLowerCase();
  query = query.toLowerCase();
  if (!query) return 0;
  let ti = 0, score = 0, streak = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return -1;
    streak = found === ti ? streak + 2 : 0;
    score += 1 + streak + (found === 0 || /[\s./_-]/.test(text[found - 1] || '') ? 3 : 0);
    ti = found + 1;
  }
  return score;
}

function filterCommands(query) {
  if (!query.trim()) {
    // Empty query: MRU order first, then registry order
    filtered = [...commands].sort((a, b) => {
      const ai = mru.indexOf(a.id), bi = mru.indexOf(b.id);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return 0;
    });
  } else {
    filtered = commands
      .map(c => ({ c, score: fuzzyScore(`${c.title} ${c.group}`, query.trim()) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.c);
  }
  selectedIndex = 0;
}

function moveSelection(delta) {
  if (filtered.length === 0) return;
  selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
  const el = document.getElementById(`cp-item-${selectedIndex}`);
  el?.scrollIntoView({ block: 'nearest' });
}

function executeSelected() {
  const cmd = filtered[selectedIndex];
  if (!cmd) return;
  // Update MRU
  mru = [cmd.id, ...mru.filter(id => id !== cmd.id)].slice(0, 8);
  try { localStorage.setItem(MRU_KEY, JSON.stringify(mru)); } catch (e) { /* quota */ }
  closePalette();
  try {
    cmd.run();
  } catch (e) {
    showToast(`Command failed: ${e}`, 'error');
  }
}

function renderList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="command-palette-empty">No matching commands.</div>';
    return;
  }
  filtered.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = `command-palette-item${i === selectedIndex ? ' selected' : ''}`;
    item.id = `cp-item-${i}`;
    item.innerHTML = `
      <span class="cp-icon">${cmd.icon}</span>
      <span class="cp-title">${escapeHtml(cmd.title)}</span>
      ${cmd.keybinding ? `<span class="cp-keybinding">${escapeHtml(cmd.keybinding)}</span>` : ''}
      <span class="cp-group">${escapeHtml(cmd.group)}</span>
    `;
    item.addEventListener('click', () => { selectedIndex = i; executeSelected(); });
    item.addEventListener('mousemove', () => {
      if (selectedIndex !== i) { selectedIndex = i; listEl.querySelectorAll('.command-palette-item').forEach(el => el.classList.remove('selected')); item.classList.add('selected'); }
    });
    listEl.appendChild(item);
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
