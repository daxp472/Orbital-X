// ==========================================================================
// Orbital X — Developer Mode Menu System (developer-menu.js)
// Developer Menu: Menubar 'Developer' button → sleek native-grade dropdown
// F12: Instant DevTools trigger across the application (with in-app fallback)
// ==========================================================================

import { state, persistState } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

let devMenuOpen = false;
let f12ListenerAttached = false;
let devConsoleVisible = false;
let devConsoleOverlay = null;

export function initDeveloperMenu() {
  console.log('[developer-menu] Initializing F12 listener & debug console handlers...');

  // Remove any legacy dev dropdown in DOM so only the native menubar dropdown renders
  document.getElementById('dev-dropdown')?.remove();

  // Setup global F12 shortcut listener
  setupF12Listener();

  // Setup Escape key and outside-click handlers for console
  attachConsoleCloseHandlers();
}

function setupF12Listener() {
  if (f12ListenerAttached) return;
  f12ListenerAttached = true;

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'F12') {
      e.preventDefault();
      await openDevToolsFromDropdown();
    }
  });
}

export async function openDevToolsFromDropdown() {
  console.log('[developer-menu] Opening DevTools (F12)...');
  try {
    await invoke('open_dev_tools');
    showToast('Developer Tools opened', 'success', 2000);
    return;
  } catch (e) {
    console.warn('[developer-menu] Native open_dev_tools failed, falling back to debug console:', e);
  }

  showDebugConsole();
  showToast('Debug Console opened', 'info', 2000);
}

export function showDebugConsole() {
  devConsoleVisible = !devConsoleVisible;

  if (!devConsoleOverlay) {
    devConsoleOverlay = document.createElement('div');
    devConsoleOverlay.id = 'dev-console-overlay';
    devConsoleOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      z-index: 999999;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      color: var(--text-primary, #fff);
    `;

    devConsoleOverlay.innerHTML = `
      <div style="padding: 18px 24px; background: var(--bg-card, #1a1a20); border: 1px solid var(--border-subtle, #333); border-radius: 10px; max-width: 90%; width: 680px; box-shadow: 0 24px 64px rgba(0,0,0,0.7); box-sizing: border-box; display: flex; flex-direction: column; max-height: 85vh;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--accent-cyan, #39c5bb); font-size: 14px;">⚡</span>
            <h2 style="margin: 0; font-size: 14px; font-weight: 700;">Orbital X Debug Console</h2>
          </div>
          <button id="dev-console-close" style="background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted); padding: 4px;">✕</button>
        </div>
        <div id="dev-console-output" style="background: var(--bg-surface, #121216); padding: 12px; border-radius: 6px; border: 1px solid var(--border-subtle, #2a2a32); min-height: 240px; max-height: 420px; overflow-y: auto; font-family: monospace; font-size: 11.5px; line-height: 1.5; color: #bbb;">
          <div style="color: var(--text-muted);">Console ready. Execute JS expressions or inspect app state (e.g. <code>window.state</code>).</div>
        </div>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <input id="dev-console-input" type="text" placeholder="Evaluate JavaScript (e.g. state.workspace)..." style="flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-primary); font-family: monospace; font-size: 12px; outline: none;" />
          <button id="dev-console-exec" class="btn btn-primary btn-sm" style="padding: 8px 16px;">Run</button>
        </div>
      </div>
    `;

    document.body.appendChild(devConsoleOverlay);

    devConsoleOverlay.querySelector('#dev-console-close')?.addEventListener('click', () => {
      devConsoleOverlay.style.display = 'none';
      devConsoleVisible = false;
    });

    const runCmd = () => {
      const inputEl = devConsoleOverlay.querySelector('#dev-console-input');
      const outputEl = devConsoleOverlay.querySelector('#dev-console-output');
      const cmd = inputEl?.value?.trim();
      if (!cmd || !outputEl) return;

      const row = document.createElement('div');
      row.style.cssText = 'margin: 6px 0; padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.03);';

      try {
        window.state = state;
        const result = eval(cmd);
        const resStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
        row.innerHTML = `<span style="color: var(--accent-cyan);">&gt; ${escapeHtml(cmd)}</span><pre style="margin: 4px 0 0; color: #98c379; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(resStr)}</pre>`;
      } catch (err) {
        row.innerHTML = `<span style="color: var(--accent-cyan);">&gt; ${escapeHtml(cmd)}</span><pre style="margin: 4px 0 0; color: #e06c75; white-space: pre-wrap;">${escapeHtml(String(err))}</pre>`;
      }

      outputEl.appendChild(row);
      outputEl.scrollTop = outputEl.scrollHeight;
      inputEl.value = '';
    };

    devConsoleOverlay.querySelector('#dev-console-exec')?.addEventListener('click', runCmd);
    devConsoleOverlay.querySelector('#dev-console-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runCmd();
    });
  }

  devConsoleOverlay.style.display = devConsoleVisible ? 'flex' : 'none';
  if (devConsoleVisible) {
    setTimeout(() => devConsoleOverlay.querySelector('#dev-console-input')?.focus(), 50);
  }
}

function attachConsoleCloseHandlers() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && devConsoleVisible && devConsoleOverlay) {
      devConsoleVisible = false;
      devConsoleOverlay.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (devConsoleVisible && devConsoleOverlay && e.target === devConsoleOverlay) {
      devConsoleVisible = false;
      devConsoleOverlay.style.display = 'none';
    }
  });
}

export function setDeveloperMode(_enabled) {
  // Maintained for backward compatibility with settings
}

export function isDeveloperModeEnabled() {
  return true;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
