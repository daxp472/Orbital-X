// ==========================================================================
// Orbital X — Professional Integrated Terminal (terminal.js)
//
// E1  Multi-tab sessions with inline rename + shell-type color dots
// E2  Profile selector (PowerShell / cmd / Git Bash / WSL / custom) on "+"
// E3  Split terminal (two side-by-side pane groups with resizer)
// E4  Font/appearance settings applied live (family, size, line height,
//     cursor style, blink, scrollback)
// E5  Full ANSI parser: 16 + bright + 256-color fg/bg, bold, italic,
//     underline, strikethrough, reset  →  parseAnsiToHtml(text)
// E6  Copy/Paste context menu + Ctrl+Shift+C/V, Ctrl+A select all
// E7  In-terminal search (Ctrl+F) with highlight + prev/next navigation
// E8  Working-directory breadcrumb parsed from the live prompt
// E9  Ctrl+R searchable history picker
// E10 Link detection: URLs open the browser, file paths open the editor
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { state } from '../state/store.js';
import { showToast } from '../services/notifications.js';

const STORAGE_KEY_CMD_HISTORY = 'orbital_cmd_history';
const MAX_CMD_HISTORY = 50;
let globalCmdHistory = [];
let cmdHistoryIndex = -1;

// --- E2: terminal profiles ------------------------------------------------

const SHELL_PROFILES = [
  { id: 'cmd', label: 'Command Prompt', shell: 'cmd.exe', dot: 'var(--accent-orange)', os: 'windows' },
  { id: 'powershell', label: 'PowerShell', shell: 'powershell.exe', dot: 'var(--accent-blue)', os: 'windows' },
  { id: 'gitbash', label: 'Git Bash', shell: 'C:\\Program Files\\Git\\bin\\bash.exe', dot: 'var(--accent-green)', os: 'windows' },
  { id: 'wsl', label: 'WSL', shell: 'wsl.exe', dot: 'var(--accent-green)', os: 'windows' },
  { id: 'sh', label: 'sh (Unix)', shell: 'sh', dot: 'var(--accent-green)', os: 'unix' },
];

function isWindows() { return navigator.userAgent.includes('Windows'); }

function defaultProfiles() {
  return isWindows()
    ? SHELL_PROFILES.filter(p => p.os === 'windows').map(p => p.id)
    : SHELL_PROFILES.filter(p => p.os === 'unix').map(p => p.id);
}

function loadTerminalSettings() {
  state.settings.terminal = {
    fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    fontSize: 13,
    lineHeight: 1.5,
    cursorStyle: 'block',   // block | underline | bar
    cursorBlink: true,
    scrollback: 1000,
    ...(state.settings.terminal || {}),
  };
  state.terminal = state.terminal || {
    profiles: [],
    splitMode: false,
    defaultShell: isWindows() ? 'cmd' : 'sh',
  };
  if (!Array.isArray(state.terminal.profiles) || state.terminal.profiles.length === 0) {
    state.terminal.profiles = defaultProfiles();
  }
  try {
    const savedCustom = JSON.parse(localStorage.getItem('orbital_terminal_custom_shells') || '[]');
    for (const c of savedCustom) {
      SHELL_PROFILES.push({ id: `custom:${c.label}`, label: c.label, shell: c.path, dot: 'var(--text-muted)', os: 'any' });
    }
    const savedTerm = JSON.parse(localStorage.getItem('orbital_terminal_settings') || 'null');
    if (savedTerm) state.settings.terminal = { ...state.settings.terminal, ...savedTerm };
    const savedMeta = JSON.parse(localStorage.getItem('orbital_terminal_meta') || 'null');
    if (savedMeta) state.terminal = { ...state.terminal, ...savedMeta };
  } catch (e) { /* defaults */ }
}

function persistTerminalMeta() {
  try {
    localStorage.setItem('orbital_terminal_meta', JSON.stringify({
      profiles: state.terminal.profiles,
      splitMode: state.terminal.splitMode,
      defaultShell: state.terminal.defaultShell,
    }));
  } catch (e) { /* quota */ }
}

export function persistTerminalSettings() {
  try {
    localStorage.setItem('orbital_terminal_settings', JSON.stringify(state.settings.terminal));
  } catch (e) { /* quota */ }
}

function shellDot(shell) {
  const p = SHELL_PROFILES.find(x => x.shell === shell || x.id === shell);
  if (p) return p.dot;
  if (/powershell/i.test(shell)) return 'var(--accent-blue)';
  if (/cmd/i.test(shell)) return 'var(--accent-orange)';
  if (/bash|wsl|sh/i.test(shell)) return 'var(--accent-green)';
  return 'var(--text-muted)';
}

// --- command history --------------------------------------------------------

function loadCommandHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CMD_HISTORY);
    globalCmdHistory = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(globalCmdHistory)) globalCmdHistory = [];
  } catch (e) {
    globalCmdHistory = [];
  }
}

function saveCommandToHistory(command) {
  if (!command || !command.trim()) return;
  const trimmed = command.trim();
  if (globalCmdHistory.length > 0 && globalCmdHistory[globalCmdHistory.length - 1] === trimmed) {
    return;
  }
  globalCmdHistory.push(trimmed);
  if (globalCmdHistory.length > MAX_CMD_HISTORY) {
    globalCmdHistory = globalCmdHistory.slice(-MAX_CMD_HISTORY);
  }
  try {
    localStorage.setItem(STORAGE_KEY_CMD_HISTORY, JSON.stringify(globalCmdHistory));
  } catch (e) {
    console.warn('Could not persist terminal command history:', e);
  }
}

// ===========================================================================
// E5: ANSI → HTML parser
// ===========================================================================

const ANSI_16 = {
  30: '#6e7681', 31: 'var(--accent-red)', 32: 'var(--accent-green)', 33: 'var(--accent-orange)',
  34: 'var(--accent-blue)', 35: 'var(--accent-purple)', 36: 'var(--accent-cyan)', 37: 'var(--text-primary)',
  90: 'var(--text-muted)', 91: 'var(--accent-red)', 92: 'var(--accent-green)', 93: 'var(--accent-orange)',
  94: 'var(--accent-blue)', 95: 'var(--accent-purple)', 96: 'var(--accent-cyan)', 97: 'var(--text-primary-bright)',
  // backgrounds (40-47, 100-107) — muted translucent fills
  40: 'rgba(110,118,129,0.25)', 41: 'rgba(255,69,58,0.25)', 42: 'rgba(48,209,88,0.25)', 43: 'rgba(255,159,10,0.25)',
  44: 'rgba(41,151,255,0.25)', 45: 'rgba(188,140,255,0.25)', 46: 'rgba(57,197,187,0.25)', 47: 'rgba(230,237,243,0.2)',
  100: 'rgba(110,118,129,0.35)', 101: 'rgba(255,69,58,0.35)', 102: 'rgba(48,209,88,0.35)', 103: 'rgba(255,159,10,0.35)',
  104: 'rgba(41,151,255,0.35)', 105: 'rgba(188,140,255,0.35)', 106: 'rgba(57,197,187,0.35)', 107: 'rgba(255,255,255,0.3)',
};

// 6x6x6 color cube + greyscale ramp for 256-color mode
function ansi256Color(n) {
  if (n < 16) return null;
  if (n < 232) {
    const c = n - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(c / 36)];
    const g = steps[Math.floor((c % 36) / 6)];
    const b = steps[c % 6];
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

function escapeHtmlText(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converts ANSI escape sequences to HTML with inline styles.
 * Supports: standard + bright 16 colors, 256-color (38;5;N / 48;5;N),
 * bold (1), dim (2), italic (3), underline (4), strikethrough (9),
 * and reset (0 / 39 / 49).
 */
export function parseAnsiToHtml(text) {
  if (!text) return '';
  const segments = [];
  let style = { fg: null, bg: null, bold: false, italic: false, underline: false, strike: false };
  let plain = '';

  const pushSegment = () => {
    if (plain) segments.push({ text: plain, style: { ...style } });
    plain = '';
  };

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    plain += text.slice(last, m.index);
    pushSegment();
    last = m.index + m[0].length;

    const params = m[1] === '' ? ['0'] : m[1].split(';');
    for (let i = 0; i < params.length; i++) {
      const p = parseInt(params[i], 10);
      if (Number.isNaN(p)) continue;
      if (p === 0) style = { fg: null, bg: null, bold: false, italic: false, underline: false, strike: false };
      else if (p === 1) style.bold = true;
      else if (p === 2) style.bold = false; // dim — treated as non-bold
      else if (p === 3) style.italic = true;
      else if (p === 4) style.underline = true;
      else if (p === 9) style.strike = true;
      else if (p === 22) style.bold = false;
      else if (p === 23) style.italic = false;
      else if (p === 24) style.underline = false;
      else if (p === 29) style.strike = false;
      else if (p === 39) style.fg = null;
      else if (p === 49) style.bg = null;
      else if (ANSI_16[p]) {
        if (p < 50 || p >= 90) style.fg = ANSI_16[p]; else style.bg = ANSI_16[p];
      }
      else if (p >= 40 && p <= 47) style.bg = ANSI_16[p];
      else if (p >= 100 && p <= 107) style.bg = ANSI_16[p];
      else if ((p === 38 || p === 48) && params[i + 1] === '5') {
        const n = parseInt(params[i + 2], 10);
        if (Number.isFinite(n)) {
          const col = ansi256Color(n);
          if (col) { if (p === 38) style.fg = col; else style.bg = col; }
          i += 2;
        }
      }
      else if ((p === 38 || p === 48) && params[i + 1] === '2') {
        // truecolor — rasterize to rgb()
        const r = parseInt(params[i + 2], 10), g = parseInt(params[i + 3], 10), b = parseInt(params[i + 4], 10);
        if ([r, g, b].every(Number.isFinite)) {
          const col = `rgb(${r},${g},${b})`;
          if (p === 38) style.fg = col; else style.bg = col;
        }
        i += 4;
      }
    }
  }
  plain += text.slice(last);
  pushSegment();

  return segments
    .map(({ text: seg, style: st }) => {
      const css = [];
      if (st.fg) css.push(`color: ${st.fg}`);
      if (st.bg) css.push(`background-color: ${st.bg}`);
      if (st.bold) css.push('font-weight: 700');
      if (st.italic) css.push('font-style: italic');
      if (st.underline) css.push('text-decoration: underline');
      if (st.strike) css.push('text-decoration: line-through');
      const safe = escapeHtmlText(seg);
      return css.length ? `<span style="${css.join('; ')};">${safe}</span>` : safe;
    })
    .join('');
}

// ===========================================================================
// E10: link detection — URLs and file paths become clickable
// ===========================================================================

const URL_RE = /(https?:\/\/[^\s"'<>]+)/g;
// Windows absolute path (optionally with :line) — tolerate escaped HTML chars
const WIN_PATH_RE = /([A-Za-z]:\\[^\s:<>"]+(?::(\d+))?)/g;

function linkifySafeHtml(safeHtml) {
  // safeHtml is already HTML-escaped. URLs survive escaping untouched.
  return safeHtml
    .replace(URL_RE, (url) =>
      `<a href="#" class="term-link" data-term-link="url" data-url="${url}" title="Open in browser">${url}</a>`)
    .replace(WIN_PATH_RE, (p, path, line) =>
      `<a href="#" class="term-link" data-term-link="file" data-path="${path}" data-line="${line || ''}" title="Open in editor">${path}</a>`);
}

// ===========================================================================
// Sessions
// ===========================================================================

class TerminalSession {
  constructor(id, shell, pane = 'A') {
    this.id = id;
    this.sessionId = `term_${id}_${Date.now()}`;
    this.shell = shell;
    this.pane = pane;               // 'A' | 'B' (split)
    this.name = this.profileName();
    this.cwd = state.workspace.rootPath || '';
    this.history = [];
    this.historyIndex = -1;
    this.buffer = '';
    this.isRunning = false;
    this.isBackendConnected = false;
  }

  profileName() {
    const p = SHELL_PROFILES.find(x => x.shell === this.shell || x.id === this.shell);
    if (p) return p.label;
    if (/powershell/i.test(this.shell)) return 'PowerShell';
    if (/cmd/i.test(this.shell)) return 'cmd';
    if (/bash/i.test(this.shell)) return 'bash';
    if (/wsl/i.test(this.shell)) return 'wsl';
    return this.shell.split(/[\\/]/).pop() || 'shell';
  }

  async startBackendShell() {
    try {
      const res = await invoke('create_interactive_terminal', {
        sessionId: this.sessionId,
        name: this.name,
        cwd: this.cwd || undefined,
        shell: this.shell,
      });
      if (res && res.id) {
        this.sessionId = res.id;
      }
      this.isBackendConnected = true;
      setTimeout(() => pollActiveTerminalOutput(), 250);
    } catch (e) {
      console.warn(`[Terminal] Shell spawn failed for ${this.sessionId}:`, e);
      this.isBackendConnected = false;
      this.buffer += `\r\n⚠ Could not start "${this.shell}": ${e}\r\n`;
      renderPanes();
    }
  }

  async closeBackendShell() {
    if (this.isBackendConnected) {
      try {
        await invoke('close_interactive_terminal', { sessionId: this.sessionId });
      } catch (e) {
        console.warn('[Terminal] Close session failed:', e);
      }
      this.isBackendConnected = false;
    }
  }
}

let terminalInstances = [];
let activeTerminalId = 1;
let pollTimer = null;
let renameTimer = null;

export function initTerminal() {
  loadCommandHistory();
  loadTerminalSettings();

  const clearBtn = document.getElementById('btn-clear-terminal');
  const collapseBtn = document.getElementById('btn-collapse-panel');
  const newTerminalBtn = document.getElementById('btn-new-terminal');
  const splitTerminalBtn = document.getElementById('btn-split-terminal');
  const sidebarNewBtn = document.getElementById('btn-sidebar-new-terminal');
  const bottomPanel = document.getElementById('bottom-panel');

  if (terminalInstances.length === 0) {
    const defaultProfile = SHELL_PROFILES.find(p => p.id === state.terminal.defaultShell) || SHELL_PROFILES[0];
    const first = new TerminalSession(1, defaultProfile.shell, 'A');
    terminalInstances.push(first);
    activeTerminalId = 1;
    first.startBackendShell();
  }

  // Bottom panel tab switching (terminal / validation / logs)
  const tabs = document.querySelectorAll('.panel-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      bottomPanel?.classList.remove('collapsed');
      const target = tab.dataset.tab;
      const termContent = document.getElementById('tab-content-terminal');
      const valContent = document.getElementById('tab-content-validation');
      const logContent = document.getElementById('tab-content-logs');
      if (termContent) termContent.style.display = target === 'terminal' ? 'flex' : 'none';
      if (valContent) valContent.style.display = target === 'validation' ? 'block' : 'none';
      if (logContent) logContent.style.display = target === 'logs' ? 'block' : 'none';
      if (target === 'terminal') {
        focusActiveTerminalInput();
        pollActiveTerminalOutput();
      }
    });
  });

  // Build the terminal DOM into #terminal-mount FIRST before wiring event listeners!
  buildTerminalDom();

  // Per-pane inline prompt wiring — each pane owns its own input + run button
  wireInlinePrompt('A');
  wireInlinePrompt('B');

  newTerminalBtn?.addEventListener('click', (e) => {
    bottomPanel?.classList.remove('collapsed');
    openProfileMenu(e, 'A');
  });
  splitTerminalBtn?.addEventListener('click', toggleTerminalSplit);
  sidebarNewBtn?.addEventListener('click', (e) => {
    bottomPanel?.classList.remove('collapsed');
    openProfileMenu(e, 'A');
  });

  clearBtn?.addEventListener('click', clearActiveTerminal);

  collapseBtn?.addEventListener('click', () => {
    bottomPanel?.classList.toggle('collapsed');
  });

  // N3: terminal log semantics
  const outA = document.getElementById('terminal-stdout-A');
  if (outA) outA.setAttribute('role', 'log');
  const stdoutHost = document.getElementById('terminal-stdout-host') || document.getElementById('terminal-stdout');
  stdoutHost?.addEventListener('click', (e) => {
    const link = e.target.closest('.term-link');
    if (link) {
      e.preventDefault();
      handleTerminalLink(link);
      return;
    }
    focusActiveTerminalInput();
  });

  // E6: right-click context menu on the terminal output
  document.getElementById('tab-content-terminal')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTerminalContextMenu(e.clientX, e.clientY);
  });

  document.getElementById('btn-run-all-tests')?.addEventListener('click', runValidationTests);

  applyTerminalAppearance();
  renderPanes();
  startOutputPolling();
}

// --- Per-pane inline prompt wiring ------------------------------------------
// The prompt bar now lives inside each pane (so split terminals each get their
// own input). Each pane's input shares the same keydown handlers; the active
// pane is resolved at event time so the focused input always wins.

function wireInlinePrompt(pane) {
  const input = document.getElementById(`terminal-command-input-${pane}`);
  const runBtn = document.getElementById(`btn-run-terminal-command-${pane}`);
  if (!input) return;

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeTerminalCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHistory(-1, input);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHistory(1, input);
    } else if (e.key === 'c' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      copySelection();
    } else if (e.key === 'v' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      pasteToInput(input);
    } else if (e.key === 'a' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      selectAllTerminal();
    } else if (e.key === 'r' && e.ctrlKey) {
      e.preventDefault();
      openHistoryPicker(input);
    } else if (e.key === 'f' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      openTerminalSearch();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      await handleTabCompletion(input);
    } else if (e.key === 'c' && e.ctrlKey && !e.shiftKey) {
      sendInterruptSignal();
      input.value = '';
    } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      clearActiveTerminal();
    }
  });

  runBtn?.addEventListener('click', () => executeTerminalCommand());
}

export function focusActiveTerminalInput() {
  const active = getActiveSession();
  const pane = active ? active.pane : 'A';
  const input = document.getElementById(`terminal-command-input-${pane}`);
  if (input) {
    input.focus();
    return input;
  }
  const fallback = document.getElementById('terminal-command-input-A');
  if (fallback) fallback.focus();
  return fallback;
}

function getActiveTerminalInput() {
  const active = getActiveSession();
  if (!active) return document.getElementById('terminal-command-input-A');
  return document.getElementById(`terminal-command-input-${active.pane}`);
}

// --- DOM construction (panes, tab bars, breadcrumb, search bar) ------------

function buildTerminalDom() {
  const mount = document.getElementById('terminal-mount');
  if (!mount) return;

  mount.innerHTML = `
    <div id="terminal-pane-wrap" style="display: flex; flex: 1; min-height: 0; width: 100%;">
      <div class="terminal-pane" id="terminal-pane-A" style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
        <div class="terminal-tabbar-row" id="terminal-tabbar-A"></div>
        <div class="terminal-cwd-breadcrumb" id="terminal-cwd-A"></div>
        <div class="terminal-output-scroll" id="terminal-stdout-A"></div>
        <div class="terminal-prompt-bar terminal-inline-prompt" id="terminal-inline-prompt-A">
          <span id="terminal-prompt-label-A" style="color: var(--accent-cyan); font-family: var(--font-mono); font-size: 12px; font-weight: bold; white-space: nowrap;">PS&gt;</span>
          <input type="text" class="terminal-input terminal-inline-input" id="terminal-command-input-A" aria-label="Terminal command input" placeholder="Type command and press Enter…" />
          <button class="terminal-inline-run" id="btn-run-terminal-command-A" title="Run (Enter)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        </div>
      </div>
      <div class="terminal-split-resizer" id="terminal-split-resizer" style="display: none;"></div>
      <div class="terminal-pane" id="terminal-pane-B" style="display: none; flex: 1; min-width: 0; flex-direction: column;">
        <div class="terminal-tabbar-row" id="terminal-tabbar-B"></div>
        <div class="terminal-cwd-breadcrumb" id="terminal-cwd-B"></div>
        <div class="terminal-output-scroll" id="terminal-stdout-B"></div>
        <div class="terminal-prompt-bar terminal-inline-prompt" id="terminal-inline-prompt-B">
          <span id="terminal-prompt-label-B" style="color: var(--accent-cyan); font-family: var(--font-mono); font-size: 12px; font-weight: bold; white-space: nowrap;">PS&gt;</span>
          <input type="text" class="terminal-input terminal-inline-input" id="terminal-command-input-B" aria-label="Terminal command input" placeholder="Type command and press Enter…" />
          <button class="terminal-inline-run" id="btn-run-terminal-command-B" title="Run (Enter)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div class="terminal-search-bar" id="terminal-search-bar" style="display: none;">
      <input type="text" id="terminal-search-input" placeholder="Find in terminal…" />
      <button class="btn btn-secondary btn-sm" id="terminal-search-prev" title="Previous match">↑</button>
      <span class="btn btn-secondary btn-sm" id="terminal-search-count" style="pointer-events: none;">0/0</span>
      <button class="btn btn-secondary btn-sm" id="terminal-search-next" title="Next match">↓</button>
      <button class="btn btn-secondary btn-sm" id="terminal-search-clear" title="Close search">✕</button>
    </div>
  `;

  wireSplitResizer();
  wireTerminalSearch();
}

function wireSplitResizer() {
  const resizer = document.getElementById('terminal-split-resizer');
  if (!resizer) return;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const wrap = document.getElementById('terminal-pane-wrap');
    const move = (ev) => {
      const rect = wrap.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(25, Math.min(75, pct));
      document.getElementById('terminal-pane-A').style.flex = `0 0 ${clamped}%`;
      document.getElementById('terminal-pane-B').style.flex = `0 0 ${100 - clamped}%`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// --- E3: split --------------------------------------------------------------

export function toggleTerminalSplit() {
  state.terminal.splitMode = !state.terminal.splitMode;
  persistTerminalMeta();
  if (state.terminal.splitMode) {
    const paneB = document.getElementById('terminal-pane-B');
    document.getElementById('terminal-split-resizer').style.display = '';
    if (paneB) paneB.style.display = 'flex';
    if (!terminalInstances.some(t => t.pane === 'B')) {
      const nextId = nextTerminalId();
      const shell = getActiveSession()?.shell || defaultShellPath();
      const s = new TerminalSession(nextId, shell, 'B');
      terminalInstances.push(s);
      s.startBackendShell();
    }
    activeTerminalId = terminalInstances.find(t => t.pane === 'B').id;
  } else {
    document.getElementById('terminal-pane-B').style.display = 'none';
    document.getElementById('terminal-split-resizer').style.display = 'none';
    // Close pane-B sessions (VS Code closes the split's terminals)
    for (const t of terminalInstances.filter(x => x.pane === 'B')) {
      t.closeBackendShell();
    }
    terminalInstances = terminalInstances.filter(x => x.pane !== 'B');
    const firstA = terminalInstances.find(t => t.pane === 'A');
    if (firstA) activeTerminalId = firstA.id;
  }
  renderPanes();
}

function defaultShellPath() {
  const p = SHELL_PROFILES.find(x => x.id === state.terminal.defaultShell) || SHELL_PROFILES[0];
  return p.shell;
}

function nextTerminalId() {
  return terminalInstances.length > 0 ? Math.max(...terminalInstances.map(t => t.id)) + 1 : 1;
}

// --- E2: profile menu ---------------------------------------------------------

function openProfileMenu(e, pane) {
  dismissProfileMenu();
  const menu = document.createElement('div');
  menu.className = 'tree-context-menu';
  menu.id = 'terminal-profile-menu';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 240)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 260)}px`;

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 10px; color: var(--text-muted); padding: 6px 10px 4px;';
  title.textContent = 'New terminal — choose a profile';
  menu.appendChild(title);

  const profiles = SHELL_PROFILES.filter(p =>
    p.os === 'any' || (isWindows() ? p.os === 'windows' : p.os === 'unix') || state.terminal.profiles.includes(p.id));

  for (const p of profiles) {
    const row = document.createElement('div');
    row.className = 'tree-context-item';
    row.innerHTML = `<span class="ctx-icon"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.dot};"></span></span><span class="ctx-label">${p.label}</span>`;
    row.addEventListener('click', () => {
      dismissProfileMenu();
      createTerminalInstance(p.shell, pane);
    });
    menu.appendChild(row);
  }

  const custom = document.createElement('div');
  custom.className = 'tree-context-item';
  custom.innerHTML = `<span class="ctx-icon">⚙️</span><span class="ctx-label">Custom…</span>`;
  custom.addEventListener('click', () => {
    dismissProfileMenu();
    const path = prompt('Path to the shell executable (e.g. C:\\\\bin\\\\nu.exe):');
    if (!path || !path.trim()) return;
    const trimmed = path.trim();
    const label = trimmed.split(/[\\/]/).pop();
    SHELL_PROFILES.push({ id: `custom:${label}`, label, shell: trimmed, dot: 'var(--text-muted)', os: 'any' });
    try {
      const saved = JSON.parse(localStorage.getItem('orbital_terminal_custom_shells') || '[]');
      saved.push({ label, path: trimmed });
      localStorage.setItem('orbital_terminal_custom_shells', JSON.stringify(saved));
    } catch (err) { /* quota */ }
    createTerminalInstance(trimmed, pane);
  });
  menu.appendChild(custom);

  document.body.appendChild(menu);
  setTimeout(() => {
    const onDown = (ev) => {
      if (!menu.contains(ev.target)) { dismissProfileMenu(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}

function dismissProfileMenu() {
  document.getElementById('terminal-profile-menu')?.remove();
}

export function getActiveSession() {
  const active = terminalInstances.find(t => t.id === activeTerminalId);
  return active || terminalInstances.find(t => t.pane === 'A') || terminalInstances[0];
}

export async function createTerminalInstance(shell, pane = 'A') {
  const newSession = new TerminalSession(nextTerminalId(), shell || defaultShellPath(), pane);
  terminalInstances.push(newSession);
  await newSession.startBackendShell();
  activeTerminalId = newSession.id;
  renderPanes();
}

export function switchTerminalInstance(id) {
  activeTerminalId = id;
  renderPanes();
  focusActiveTerminalInput()?.focus();
  pollActiveTerminalOutput();
}

export async function closeTerminalInstance(id, event) {
  if (event) event.stopPropagation();
  const target = terminalInstances.find(t => t.id === id);
  if (target) {
    await target.closeBackendShell();
  }
  const pane = target ? target.pane : 'A';
  const paneSessions = terminalInstances.filter(t => t.pane === pane);
  if (paneSessions.length <= 1) {
    const session = paneSessions[0];
    if (session) {
      session.buffer = '';
      renderPanes();
      return;
    }
  }
  terminalInstances = terminalInstances.filter(t => t.id !== id);
  if (activeTerminalId === id) {
    const next = terminalInstances.find(t => t.pane === pane) || terminalInstances[0];
    activeTerminalId = next ? next.id : 1;
  }
  renderPanes();
}

function clearActiveTerminal() {
  const active = getActiveSession();
  if (active) active.buffer = '';
  renderPanes();
}

// --- rendering ---------------------------------------------------------------

function renderPanes() {
  renderPaneTabs('A');
  renderPaneTabs('B');
  renderBufferFor(activeInPane('A'), 'A');
  renderBufferFor(activeInPane('B'), 'B');
  renderCwdBreadcrumb('A');
  renderCwdBreadcrumb('B');
  updatePromptDisplay();
}

function activeInPane(pane) {
  const active = getActiveSession();
  if (active && active.pane === pane) return active;
  return terminalInstances.find(t => t.pane === pane) || null;
}

function renderPaneTabs(pane) {
  const bar = document.getElementById(`terminal-tabbar-${pane}`);
  if (!bar) return;
  bar.innerHTML = '';
  const sessions = terminalInstances.filter(t => t.pane === pane);
  if (sessions.length === 0 && pane === 'B') return;

  for (const term of sessions) {
    const isActive = term.id === activeTerminalId;
    const item = document.createElement('div');
    item.className = `terminal-tab ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <span class="terminal-shell-dot" style="background:${shellDot(term.shell)};" title="${term.name}"></span>
      <span class="terminal-tab-label">${term.id}: ${term.name}</span>
      <span class="terminal-tab-close" title="Close terminal">✕</span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('terminal-tab-close')) {
        closeTerminalInstance(term.id, e);
      } else {
        switchTerminalInstance(term.id);
      }
    });
    // E1: double-click to rename inline
    item.querySelector('.terminal-tab-label').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const label = e.target;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = term.name;
      input.className = 'terminal-rename-input';
      input.style.cssText = 'width: 90px; font-size: 11px; padding: 0 4px; border: 1px solid var(--border-focus); border-radius: 3px; background: var(--bg-input); color: var(--text-primary);';
      label.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = input.value.trim();
        if (v) term.name = v;
        renderPanes();
      };
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); renderPanes(); }
      });
      input.addEventListener('blur', commit);
      input.addEventListener('click', (ev) => ev.stopPropagation());
    });
    bar.appendChild(item);
  }

  // "+" (profile menu) and "✕" (close active) controls
  const plus = document.createElement('div');
  plus.className = 'terminal-tab terminal-add-btn';
  plus.title = 'New terminal (choose profile)';
  plus.textContent = '+';
  plus.addEventListener('click', (e) => openProfileMenu(e, pane));
  bar.appendChild(plus);

  // E: Share terminal output with the AI chat
  const shareBtn = document.createElement('button');
  shareBtn.className = 'terminal-share-btn terminal-tab';
  shareBtn.title = 'Share terminal output with AI Agent';
  shareBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path>
    </svg>
  `;
  shareBtn.style.marginLeft = 'auto'; shareBtn.style.width = '28px'; shareBtn.style.height = '24px';
  shareBtn.addEventListener('click', async () => {
    const sess = activeInPane(pane);
    if (!sess || !sess.buffer?.trim()) {
      showToast('Terminal buffer is empty', 'info', 2000);
      return;
    }
    const lastLines = sess.buffer.trimEnd().split('\n').slice(-40).join('\n');
    try {
      const agentMod = await import('./agent.js');
      agentMod.addAttachment('terminal');
      showToast('Terminal output attached to chat — send your message', 'success', 2800);
      // Also open the agent panel
      const agentPanel = document.getElementById('agent-panel');
      agentPanel?.classList.remove('hidden');
    } catch (e) {
      showToast(`Share failed: ${e}`, 'error', 2800);
    }
  });
  bar.appendChild(shareBtn);

  const closeBtn = document.createElement('div');
  closeBtn.className = 'terminal-tab terminal-close-btn';
  closeBtn.title = 'Close active terminal';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    const cur = activeInPane(pane);
    if (cur) closeTerminalInstance(cur.id);
  });
  bar.appendChild(closeBtn);
}

function renderBufferFor(session, pane) {
  const el = document.getElementById(`terminal-stdout-${pane}`);
  if (!el) return;
  if (!session) { el.innerHTML = ''; return; }
  const t = state.settings.terminal || {};
  el.style.fontFamily = t.fontFamily;
  el.style.fontSize = `${t.fontSize || 13}px`;
  el.style.lineHeight = `${t.lineHeight || 1.5}`;

  const greeting = !session.buffer
    ? `Orbital X ${session.name} terminal [${session.sessionId}]\nActive workspace shell ready. Right-click for Copy/Paste; Ctrl+R searches history.\n\n`
    : '';
  const raw = session.buffer || greeting;
  el.innerHTML = linkifySafeHtml(parseAnsiToHtml(raw));
  el.scrollTop = el.scrollHeight;
}

// --- E8: working directory breadcrumb ---------------------------------------

const PROMPT_CWD_RE = /(?:PS\s+|^|\n)\s*([A-Za-z]:\\[^\n>]*?|[A-Za-z]:\/[^\n>]*?|\/[^\n>]*?)[>#]\s*$/;

function renderCwdBreadcrumb(pane) {
  const el = document.getElementById(`terminal-cwd-${pane}`);
  if (!el) return;
  const session = activeInPane(pane);
  if (!session) { el.innerHTML = ''; return; }

  // Prefer the last prompt-looking path in the buffer; fall back to tracked cwd
  const lines = (session.buffer || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(PROMPT_CWD_RE);
    if (m && m[1]) {
      session.cwd = m[1].trim();
      break;
    }
  }

  const cwd = session.cwd || state.workspace.rootPath || '';
  if (!cwd) { el.innerHTML = ''; return; }
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  let acc = '';
  el.innerHTML = '';
  parts.forEach((part, idx) => {
    acc = acc ? `${acc}/${part}` : (cwd.startsWith('/') ? `/${part}` : `${part}/`);
    const seg = document.createElement('span');
    seg.className = 'term-cwd-seg';
    seg.textContent = idx === 0 ? part : part;
    const target = idx === parts.length - 1 ? cwd : acc.replace(/\/$/, '');
    seg.title = `Open ${target} in File Explorer`;
    seg.addEventListener('click', () => {
      invoke('run_command', { command: `explorer "${target}"`, timeout_seconds: 10 }).catch(e => console.warn(e));
    });
    el.appendChild(seg);
    if (idx < parts.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'term-cwd-sep';
      sep.textContent = '›';
      el.appendChild(sep);
    }
  });
}

function updatePromptDisplay() {
  for (const pane of ['A', 'B']) {
    const promptLabel = document.getElementById(`terminal-prompt-label-${pane}`);
    if (!promptLabel) continue;
    const active = activeInPane(pane);
    if (!active) { promptLabel.textContent = '>'; continue; }
    const cwd = active.cwd || state.workspace.rootPath || '';
    const short = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).slice(-2).join('\\');
    const isCmd = /cmd\.exe|cmd$/i.test(active.shell || '');
    const isBash = /bash|sh/i.test(active.shell || '');
    if (isCmd) {
      promptLabel.textContent = short ? `${short}>` : 'CMD>';
    } else if (isBash) {
      promptLabel.textContent = short ? `${short}$` : '$';
    } else {
      promptLabel.textContent = short ? `PS ${short}>` : 'PS>';
    }
  }
}

// --- E4: appearance ----------------------------------------------------------

export function applyTerminalAppearance() {
  const t = state.settings.terminal || {};
  for (const pane of ['A', 'B']) {
    const input = document.getElementById(`terminal-command-input-${pane}`);
    if (!input) continue;
    input.style.fontFamily = t.fontFamily;
    input.style.fontSize = `${t.fontSize || 13}px`;
    const caret = t.cursorStyle === 'underline' ? 'underline' : t.cursorStyle === 'bar' ? 'inline' : 'block';
    input.style.caretColor = 'var(--accent-cyan)';
    if (caret === 'block' || caret === 'underline') {
      // Native textareas cannot fully restyle the caret; approximate with cursor color cue
      input.title = `Cursor: ${t.cursorStyle}${t.cursorBlink === false ? ' (no blink)' : ''}`;
    }
  }
  renderPanes();
  persistTerminalSettings();
}

// --- output handling ---------------------------------------------------------

export async function executeTerminalCommand(cmdString) {
  const inputElem = getActiveTerminalInput();
  const active = getActiveSession();
  if (!active) return;

  const command = (cmdString || (inputElem ? inputElem.value : '')).trim();
  if (!command) return;

  if (inputElem) inputElem.value = '';
  cmdHistoryIndex = -1;
  saveCommandToHistory(command);
  active.historyIndex = -1;
  active.history.push(command);

  if (command.toLowerCase() === 'cls' || command.toLowerCase() === 'clear') {
    active.buffer = '';
    renderPanes();
    return;
  }
  if (command.toLowerCase() === 'exit') {
    closeTerminalInstance(active.id);
    return;
  }

  appendTerminalText(`\n${active.cwd || state.workspace.rootPath || ''}> ${command}\n`);
  active.isRunning = true;

  try {
    if (!active.isBackendConnected) {
      await active.startBackendShell();
    }
    if (active.isBackendConnected) {
      await invoke('send_terminal_input', {
        sessionId: active.sessionId,
        input: command + "\r\n",
      });
      [60, 180, 400, 900].forEach(delay => setTimeout(() => pollActiveTerminalOutput(), delay));
    } else {
      const res = await invoke('run_command', { command, timeout_seconds: 60 });
      let output = '';
      if (res.stdout) output += res.stdout;
      if (res.stderr) output += `\n[STDERR]\n${res.stderr}`;
      const statusBadge = res.success
        ? `\n✓ Exited with code ${res.exit_code} (${res.duration_ms}ms)\n`
        : `\n✗ Exited with code ${res.exit_code ?? 'terminated'} (${res.duration_ms}ms)\n`;
      appendTerminalText(`${output}${statusBadge}`);
    }
    logAudit(`Terminal: "${command}"`);
  } catch (err) {
    appendTerminalText(`\nExecution Error: ${err}\n`);
    logAudit(`Terminal error: "${command}" -> ${err}`);
  } finally {
    active.isRunning = false;
    renderPanes();
    inputElem?.focus();
  }
}

function navigateHistory(direction, inputElem) {
  if (globalCmdHistory.length === 0) return;
  if (direction === -1) {
    if (cmdHistoryIndex === -1) cmdHistoryIndex = globalCmdHistory.length - 1;
    else if (cmdHistoryIndex > 0) cmdHistoryIndex--;
  } else {
    if (cmdHistoryIndex === -1) return;
    if (cmdHistoryIndex < globalCmdHistory.length - 1) cmdHistoryIndex++;
    else { cmdHistoryIndex = -1; inputElem.value = ''; return; }
  }
  inputElem.value = globalCmdHistory[cmdHistoryIndex] || '';
}

async function sendInterruptSignal() {
  const active = getActiveSession();
  if (!active) return;
  appendTerminalText(`^C\n`);
  if (active.isBackendConnected) {
    try {
      await invoke('send_terminal_input', { sessionId: active.sessionId, input: "\x03" });
      setTimeout(() => pollActiveTerminalOutput(), 100);
    } catch (e) {
      console.warn('Failed to send interrupt signal:', e);
    }
  }
}

function startOutputPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    const termContent = document.getElementById('tab-content-terminal');
    if (termContent && termContent.style.display !== 'none') {
      pollActiveTerminalOutput();
    }
  }, 200);
}

export async function pollActiveTerminalOutput() {
  // Poll every live pane's active session so split panes both stream
  for (const pane of ['A', 'B']) {
    const session = activeInPane(pane);
    if (!session || !session.isBackendConnected) continue;
    try {
      const newOutput = await invoke('poll_terminal_output', { sessionId: session.sessionId });
      if (newOutput && newOutput.length > 0) {
        session.buffer += newOutput;
        capBuffer(session);
        const el = document.getElementById(`terminal-stdout-${pane}`);
        if (el) {
          el.innerHTML = linkifySafeHtml(parseAnsiToHtml(session.buffer));
          el.scrollTop = el.scrollHeight;
        }
        renderCwdBreadcrumb(pane);
      }
    } catch (e) { /* session may have died */ }
  }
}

function capBuffer(session) {
  const scrollback = (state.settings.terminal?.scrollback) || 1000;
  // Assume ~120 chars/line average; keep the newest window
  const maxChars = Math.max(20000, scrollback * 120);
  if (session.buffer.length > maxChars) {
    session.buffer = session.buffer.slice(-Math.floor(maxChars * 0.75));
  }
}

function appendTerminalText(text) {
  const active = getActiveSession();
  if (active) {
    active.buffer += text;
    capBuffer(active);
  }
  renderPanes();
}

// --- E6: copy / paste / select all --------------------------------------------

function selectAllTerminal() {
  const active = getActiveSession();
  if (!active) return;
  const pane = active.pane;
  const el = document.getElementById(`terminal-stdout-${pane}`);
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function copySelection() {
  const sel = window.getSelection();
  if (sel && sel.toString()) {
    navigator.clipboard.writeText(sel.toString());
    showToast('Copied to clipboard', 'success', 1500);
  }
}

async function pasteToInput(inputElem) {
  try {
    const text = await navigator.clipboard.readText();
    if (inputElem && text) {
      inputElem.value += text;
      inputElem.focus();
    }
  } catch (e) {
    showToast('Clipboard read denied by the browser', 'error', 2500);
  }
}

function showTerminalContextMenu(x, y) {
  document.getElementById('terminal-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'tree-context-menu';
  menu.id = 'terminal-ctx-menu';
  const items = [
    { label: 'Copy', hint: 'Ctrl+Shift+C', action: copySelection },
    { label: 'Paste', hint: 'Ctrl+Shift+V', action: () => pasteToInput(focusActiveTerminalInput()) },
    { label: 'Select All', hint: 'Ctrl+A', action: selectAllTerminal },
    { type: 'separator' },
    { label: 'Clear Terminal', hint: 'Ctrl+L', action: clearActiveTerminal },
    { label: 'Find in Terminal', hint: 'Ctrl+F', action: openTerminalSearch },
    { label: 'Search History', hint: 'Ctrl+R', action: () => openHistoryPicker(focusActiveTerminalInput()) },
  ];
  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'tree-context-separator';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'tree-context-item';
    row.innerHTML = `<span class="ctx-icon"></span><span class="ctx-label">${item.label}</span>${item.hint ? `<span class="ctx-hint">${item.hint}</span>` : ''}`;
    row.addEventListener('click', () => {
      document.getElementById('terminal-ctx-menu')?.remove();
      item.action();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  setTimeout(() => {
    const onDown = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}

// --- E7: terminal search -------------------------------------------------------

let termSearchMatches = [];
let termSearchIndex = -1;
let termSearchTerm = '';

function wireTerminalSearch() {
  const bar = document.getElementById('terminal-search-bar');
  const input = document.getElementById('terminal-search-input');
  const prev = document.getElementById('terminal-search-prev');
  const next = document.getElementById('terminal-search-next');
  const clear = document.getElementById('terminal-search-clear');
  input?.addEventListener('input', () => runTerminalSearch(input.value));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); advanceTerminalSearch(1); }
    if (e.key === 'Escape') { e.preventDefault(); closeTerminalSearch(); }
  });
  prev?.addEventListener('click', () => advanceTerminalSearch(-1));
  next?.addEventListener('click', () => advanceTerminalSearch(1));
  clear?.addEventListener('click', closeTerminalSearch);
  bar?.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTerminalSearch(); });
}

export function openTerminalSearch() {
  const bar = document.getElementById('terminal-search-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  const input = document.getElementById('terminal-search-input');
  input?.focus();
  input?.select();
}

function closeTerminalSearch() {
  const bar = document.getElementById('terminal-search-bar');
  if (bar) bar.style.display = 'none';
  termSearchMatches = [];
  termSearchIndex = -1;
  termSearchTerm = '';
  // Re-render buffer without highlights
  const active = getActiveSession();
  if (active) {
    const el = document.getElementById(`terminal-stdout-${active.pane}`);
    if (el) el.innerHTML = linkifySafeHtml(parseAnsiToHtml(active.buffer));
  }
  focusActiveTerminalInput()?.focus();
}

function runTerminalSearch(term) {
  termSearchTerm = term;
  termSearchMatches = [];
  termSearchIndex = -1;
  const active = getActiveSession();
  const countEl = document.getElementById('terminal-search-count');
  if (!active || !term) {
    if (countEl) countEl.textContent = '0/0';
    return;
  }
  const el = document.getElementById(`terminal-stdout-${active.pane}`);
  if (!el) return;

  // Highlight matches by re-rendering the buffer with <mark> wrappers.
  // Escape first, then mark literal occurrences of the escaped term.
  const safe = parseAnsiToHtml(active.buffer);
  const escTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escTermHtml = escapeHtmlText(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let count = 0;
  const marked = safe.replace(new RegExp(escTermHtml, 'gi'), (m) => {
    count++;
    return `<mark class="term-search-mark" data-match-idx="${count - 1}">${m}</mark>`;
  });
  termSearchMatches = new Array(count).fill(0).map((_, i) => i);
  el.innerHTML = marked;
  if (countEl) countEl.textContent = count > 0 ? `1/${count}` : '0/0';
  if (count > 0) {
    termSearchIndex = 0;
    scrollToMatch(0, el);
  }
}

function advanceTerminalSearch(dir) {
  if (termSearchMatches.length === 0) return;
  termSearchIndex = (termSearchIndex + dir + termSearchMatches.length) % termSearchMatches.length;
  const countEl = document.getElementById('terminal-search-count');
  if (countEl) countEl.textContent = `${termSearchIndex + 1}/${termSearchMatches.length}`;
  const active = getActiveSession();
  const el = active ? document.getElementById(`terminal-stdout-${active.pane}`) : null;
  if (el) scrollToMatch(termSearchIndex, el);
}

function scrollToMatch(idx, el) {
  const mark = el.querySelector(`mark.term-search-mark[data-match-idx="${idx}"]`);
  if (mark) {
    el.querySelectorAll('mark.term-search-mark.current').forEach(m => m.classList.remove('current'));
    mark.classList.add('current');
    mark.scrollIntoView({ block: 'center' });
  }
}

// --- E9: history picker ---------------------------------------------------------

function openHistoryPicker(inputElem) {
  document.getElementById('terminal-history-popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'command-palette';
  pop.id = 'terminal-history-popover';
  pop.style.cssText = 'position: fixed; bottom: 220px; left: 50%; transform: translateX(-50%); width: 520px; z-index: 2800;';
  pop.innerHTML = `
    <input type="text" id="term-history-filter" placeholder="Reverse search — filter command history…" />
    <div class="command-palette-list" id="term-history-list" style="max-height: 300px;"></div>
  `;
  document.body.appendChild(pop);

  const filterEl = pop.querySelector('#term-history-filter');
  const listEl = pop.querySelector('#term-history-list');
  const history = [...globalCmdHistory].reverse();

  const renderList = (q = '') => {
    const filtered = q ? history.filter(h => h.toLowerCase().includes(q.toLowerCase())) : history;
    listEl.innerHTML = '';
    filtered.slice(0, 50).forEach((cmd, i) => {
      const item = document.createElement('div');
      item.className = 'command-palette-item';
      item.innerHTML = `<span class="cp-icon">❯</span><span class="cp-title" style="font-family: var(--font-mono); font-size: 11px;">${escapeHtmlText(cmd)}</span>`;
      item.addEventListener('click', () => {
        if (inputElem) { inputElem.value = cmd; inputElem.focus(); }
        pop.remove();
      });
      listEl.appendChild(item);
    });
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="command-palette-empty">No matching history.</div>';
    }
  };
  renderList();
  filterEl.addEventListener('input', () => renderList(filterEl.value));
  filterEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pop.remove();
  });
  filterEl.focus();
  setTimeout(() => {
    const onDown = (e) => {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}

// --- E10: link handling ---------------------------------------------------------

async function handleTerminalLink(link) {
  const type = link.dataset.termLink;
  if (type === 'url') {
    const url = link.dataset.url;
    if (!/^https?:\/\//i.test(url)) return;
    invoke('run_command', { command: `explorer "${url}"`, timeout_seconds: 10 })
      .catch(e => showToast(`Could not open URL: ${e}`, 'error'));
    return;
  }
  if (type === 'file') {
    const path = link.dataset.path;
    const line = parseInt(link.dataset.line, 10);
    try {
      const fileData = await invoke('read_file', { path });
      if (fileData.is_binary) {
        showToast('Binary file — opening its folder instead', 'info', 2200);
        const dir = path.replace(/[\\/][^\\/]+$/, '');
        invoke('run_command', { command: `explorer "${dir}"`, timeout_seconds: 10 }).catch(() => {});
        return;
      }
      const m = await import('../editor/monaco.js');
      m.openFileInTab(fileData);
      const ed = m.getActiveEditor();
      if (ed && Number.isFinite(line)) {
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: 1 });
        ed.focus();
      }
    } catch (e) {
      showToast(`Could not open ${path}: ${e}`, 'error', 3000);
    }
  }
}

// --- misc ------------------------------------------------------------------------

export function logAudit(message) {
  const logsContainer = document.getElementById('agent-audit-logs');
  if (logsContainer) {
    const entry = document.createElement('div');
    entry.style.padding = '2px 0';
    entry.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsContainer.appendChild(entry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
}

async function runValidationTests() {
  const card = document.getElementById('validation-report-card');
  if (!card) return;
  card.innerHTML = `<span class="spinner"></span> Running automated test suite in workspace...`;
  try {
    const res = await invoke('execute_tool', {
      name: 'run_tests',
      arguments: {},
      mode: 'agent_pro',
    });
    const isSuccess = res.success;
    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-weight: 600; color: ${isSuccess ? 'var(--accent-green)' : 'var(--accent-red)'};">
          ${isSuccess ? '✓ Tests Passed' : '✗ Tests Failed'}
        </span>
        <span style="font-size: 11px; color: var(--text-muted);">${res.duration_ms}ms</span>
      </div>
      <div style="font-family: var(--font-mono); font-size: 11px; background: var(--bg-activity); padding: 8px; border-radius: 4px; max-height: 140px; overflow-y: auto;">
        ${escapeHtmlText(res.stdout || res.stderr || 'No output recorded').replace(/\n/g, '<br>')}
      </div>
    `;
    logAudit(`Validation tests completed: ${isSuccess ? 'PASSED' : 'FAILED'}`);
  } catch (e) {
    card.innerHTML = `<div style="color: var(--accent-red);">Validation check error: ${e}</div>`;
  }
}

// ==========================================================================
// Tab completion — completes file/folder paths like a real terminal
// ==========================================================================

async function handleTabCompletion(inputElem) {
  const value = inputElem.value;
  const caret = inputElem.selectionStart ?? value.length;

  // Get the current token (last word before cursor)
  const before = value.slice(0, caret);
  const tokenMatch = before.match(/([^\s]*)$/);
  const token = tokenMatch ? tokenMatch[1] : '';
  if (!token) return;

  // Split into directory part and filename prefix
  const lastSlash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  const dirPart = lastSlash >= 0 ? token.slice(0, lastSlash + 1) : '';
  const filePrefix = lastSlash >= 0 ? token.slice(lastSlash + 1) : token;

  // Determine the search directory
  const session = getActiveSession();
  const baseCwd = session?.cwd || state.workspace.rootPath || '.';

  // Ask the backend for matching files
  try {
    const searchDir = dirPart ? `${baseCwd}/${dirPart}`.replace(/\/+/g, '/').replace(/\\\\/g, '/') : baseCwd;
    const results = await invoke('search_workspace', {
      query: filePrefix,
      maxResults: 20,
    });

    // Filter results that are in the current directory level (not nested)
    const matches = (results || []).filter(r => {
      const rel = r.file || '';
      // Must be in the same directory (no additional slashes after the dir part)
      const afterDir = dirPart ? rel.slice(rel.indexOf(dirPart) + dirPart.length) : rel;
      return rel.includes(dirPart) && !afterDir.includes('/');
    });

    if (matches.length === 0) return;

    if (matches.length === 1) {
      // Single match — complete it
      const match = matches[0];
      const fileName = (match.file || '').split('/').pop().split('\\').pop();
      const completed = before.slice(0, before.length - token.length) + dirPart + fileName;
      inputElem.value = completed + value.slice(caret);
      inputElem.setSelectionRange(completed.length, completed.length);
    } else {
      // Multiple matches — show a brief list in the terminal buffer
      const session2 = getActiveSession();
      if (session2) {
        const names = matches.slice(0, 10).map(m => (m.file || '').split('/').pop()).join('  ');
        session2.buffer += `\n${names}\n`;
        if (matches.length > 10) session2.buffer += `  …and ${matches.length - 10} more\n`;
        renderPanes();
      }

      // Complete to common prefix
      const names = matches.map(m => (m.file || '').split('/').pop().split('\\').pop()).sort();
      let common = names[0] || '';
      for (const name of names) {
        while (!name.startsWith(common)) {
          common = common.slice(0, -1);
        }
      }
      if (common.length > filePrefix.length) {
        const completed = before.slice(0, before.length - token.length) + dirPart + common;
        inputElem.value = completed + value.slice(caret);
        inputElem.setSelectionRange(completed.length, completed.length);
      }
    }
  } catch (e) {
    // Silent — Tab completion is best-effort
  }
}
