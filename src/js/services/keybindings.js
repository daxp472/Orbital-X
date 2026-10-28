// ==========================================================================
// Orbital X — Keybinding Service (keybindings.js)
//
// G4: editable keyboard shortcuts. A registry of default combos per action,
// user overrides persisted to localStorage (orbital_custom_keybindings),
// conflict detection, and helpers to map combos back onto DOM keydown
// events and Monaco KeyMod/KeyCode pairs.
// ==========================================================================

const CUSTOM_KEY = 'orbital_custom_keybindings';

/** id → { title, scope: 'app' | 'editor', combo, group } */
export const DEFAULT_BINDINGS = {
  'app.save':              { title: 'Save File', scope: 'app', combo: 'Ctrl+S', group: 'File' },
  'app.openFolder':        { title: 'Open Workspace Folder', scope: 'app', combo: 'Ctrl+O', group: 'File' },
  'app.closeTab':          { title: 'Close Editor Tab', scope: 'app', combo: 'Ctrl+W', group: 'Editor' },
  'app.splitEditor':       { title: 'Toggle Split Editor', scope: 'app', combo: 'Ctrl+\\', group: 'Editor' },
  'app.commandPalette':    { title: 'Command Palette', scope: 'app', combo: 'Ctrl+Shift+P', group: 'View' },
  'app.toggleTerminal':    { title: 'Toggle Terminal', scope: 'app', combo: 'Ctrl+`', group: 'View' },
  'app.newTerminal':       { title: 'New Terminal', scope: 'app', combo: 'Ctrl+Shift+`', group: 'View' },
  'app.toggleSidebar':     { title: 'Toggle Sidebar', scope: 'app', combo: 'Ctrl+B', group: 'View' },
  'app.toggleAgent':       { title: 'Toggle Agent Panel', scope: 'app', combo: 'Ctrl+Shift+A', group: 'View' },
  'app.focusChat':         { title: 'Focus Agent Chat', scope: 'app', combo: 'Ctrl+L', group: 'Agent' },
  'app.explorer':          { title: 'Show Explorer', scope: 'app', combo: 'Ctrl+Shift+E', group: 'View' },
  'app.search':            { title: 'Show Search Panel', scope: 'app', combo: 'Ctrl+Shift+F', group: 'View' },
  'app.sourceControl':     { title: 'Show Source Control', scope: 'app', combo: 'Ctrl+Shift+G', group: 'Git' },
  'app.extensions':        { title: 'Show Extensions', scope: 'app', combo: 'Ctrl+Shift+X', group: 'View' },
  'app.cycleMode':         { title: 'Cycle Operating Mode', scope: 'app', combo: 'Alt+M', group: 'Agent' },
  'app.settings':          { title: 'Open Settings', scope: 'app', combo: 'Ctrl+,', group: 'Tools' },
  'app.shortcuts':         { title: 'Keyboard Shortcuts Reference', scope: 'app', combo: 'F1', group: 'Tools' },

  'editor.find':           { title: 'Find in File', scope: 'editor', combo: 'Ctrl+F', group: 'Editor' },
  'editor.gotoLine':       { title: 'Go to Line…', scope: 'editor', combo: 'Ctrl+G', group: 'Editor' },
  'editor.gotoDefinition': { title: 'Go to Definition', scope: 'editor', combo: 'F12', group: 'Editor' },
  'editor.selectHighlights': { title: 'Select All Occurrences', scope: 'editor', combo: 'Ctrl+Shift+L', group: 'Editor' },
  'editor.fold':           { title: 'Fold Region', scope: 'editor', combo: 'Ctrl+Shift+[', group: 'Editor' },
  'editor.unfold':         { title: 'Unfold Region', scope: 'editor', combo: 'Ctrl+Shift+]', group: 'Editor' },
  'editor.symbolInFile':   { title: 'Go to Symbol in File', scope: 'editor', combo: 'Ctrl+Shift+O', group: 'Editor' },
  'editor.symbolInWorkspace': { title: 'Go to Symbol in Workspace', scope: 'editor', combo: 'Ctrl+T', group: 'Editor' },
  'editor.wordWrap':       { title: 'Toggle Word Wrap (editor setting)', scope: 'editor', combo: 'Alt+Z', group: 'Editor' },
};

let custom = {};
try {
  custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') || {};
} catch (e) { custom = {}; }

export function getBinding(id) {
  const def = DEFAULT_BINDINGS[id];
  if (!def) return null;
  return { id, ...def, combo: custom[id] || def.combo, isCustom: !!custom[id] };
}

export function getAllBindings() {
  return Object.keys(DEFAULT_BINDINGS).map(getBinding);
}

export function setBinding(id, combo) {
  if (!DEFAULT_BINDINGS[id]) return false;
  if (!combo) { delete custom[id]; }
  else {
    if (findConflict(id, combo)) return false;
    custom[id] = combo;
  }
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  } catch (e) { /* quota */ }
  return true;
}

export function resetBinding(id) {
  delete custom[id];
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  } catch (e) { /* quota */ }
}

/** Returns the other action id using the same combo, or null. */
export function findConflict(excludeId, combo) {
  if (!combo) return null;
  for (const b of getAllBindings()) {
    if (b.id !== excludeId && b.combo === combo) return b.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM event → canonical combo string
// ---------------------------------------------------------------------------

export function comboFromEvent(e) {
  if (!e.key || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  let key;
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (code === 'Backquote') key = '`';
  else if (code === 'Comma') key = ',';
  else if (code === 'Period') key = '.';
  else if (code === 'Slash') key = '/';
  else if (code === 'Backslash') key = '\\';
  else if (code === 'BracketLeft') key = '[';
  else if (code === 'BracketRight') key = ']';
  else if (code === 'Minus') key = '-';
  else if (code === 'Equal') key = '=';
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

  parts.push(key);
  return parts.join('+');
}

/** Canonical combo string → DOM matcher predicate. */
export function comboMatches(combo, e) {
  return comboFromEvent(e) === combo;
}

// ---------------------------------------------------------------------------
// Combo → Monaco KeyMod/KeyCode (for editor-scoped bindings)
// ---------------------------------------------------------------------------

export function comboToMonaco(monaco, combo) {
  const parts = combo.split('+');
  const keyName = parts[parts.length - 1];
  let mods = 0;
  for (const p of parts.slice(0, -1)) {
    if (p === 'Ctrl') mods |= monaco.KeyMod.CtrlCmd;
    else if (p === 'Shift') mods |= monaco.KeyMod.Shift;
    else if (p === 'Alt') mods |= monaco.KeyMod.Alt;
  }

  const K = monaco.KeyCode;
  const keyMap = {
    'A': K.KeyA, 'B': K.KeyB, 'C': K.KeyC, 'D': K.KeyD, 'E': K.KeyE, 'F': K.KeyF, 'G': K.KeyG,
    'H': K.KeyH, 'I': K.KeyI, 'J': K.KeyJ, 'K': K.KeyK, 'L': K.KeyL, 'M': K.KeyM, 'N': K.KeyN,
    'O': K.KeyO, 'P': K.KeyP, 'Q': K.KeyQ, 'R': K.KeyR, 'S': K.KeyS, 'T': K.KeyT, 'U': K.KeyU,
    'V': K.KeyV, 'W': K.KeyW, 'X': K.KeyX, 'Y': K.KeyY, 'Z': K.KeyZ,
    '0': K.Digit0, '1': K.Digit1, '2': K.Digit2, '3': K.Digit3, '4': K.Digit4,
    '5': K.Digit5, '6': K.Digit6, '7': K.Digit7, '8': K.Digit8, '9': K.Digit9,
    '`': K.Backquote, ',': K.Comma, '.': K.Period, '/': K.Slash, '\\': K.Backslash,
    '[': K.BracketLeft, ']': K.BracketRight, '-': K.Minus, '=': K.Equal,
    'F1': K.F1, 'F2': K.F2, 'F3': K.F3, 'F4': K.F4, 'F5': K.F5, 'F6': K.F6, 'F7': K.F7, 'F8': K.F8,
    'Up': K.ArrowUp, 'Down': K.ArrowDown, 'Left': K.ArrowLeft, 'Right': K.ArrowRight,
  };

  const code = keyMap[keyName];
  if (code === undefined) return null;
  return [mods, code];
}
