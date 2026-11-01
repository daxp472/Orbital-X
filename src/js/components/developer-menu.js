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
  console.log('[developer-menu] Initializing Developer Menu & F12 listener...');

  // Setup menubar 'Developer' button & dropdown
  setupDevMenuButton();

  // Setup global F12 shortcut listener
  setupF12Listener();

  // Setup Escape key and outside-click handlers for console
  attachConsoleCloseHandlers();
}

function setupDevMenuButton() {
  const devBtn = document.getElementById('menu-developer');
  if (!devBtn) {
    console.warn('[developer-menu] #menu-developer not found in menubar');
    return;
  }

  devBtn.style.cursor = 'pointer';
  devBtn.style.userSelect = 'none';

  devBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDevDropdown();
  });

  createDevDropdown();
}

function createDevDropdown() {
  if (document.getElementById('dev-dropdown')) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'dev-dropdown';
  dropdown.id = 'dev-dropdown';
  dropdown.style.cssText = `
    position: fixed;
    background: var(--bg-surface, #1e1e24);
    border: 1px solid var(--border-subtle, #333);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
    padding: 6px;
    min-width: 220px;
    z-index: 100000;
    display: none;
    flex-direction: column;
    gap: 2px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  dropdown.innerHTML = `
    <div style="padding: 6px 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); margin-bottom: 4px;">
      Developer Tools
    </div>

    <button class="dev-dropdown-btn" id="dev-open-devtools" type="button" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; text-align: left;">
      <span style="display: flex; align-items: center; gap: 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
        Inspect / DevTools
      </span>
      <kbd style="font-size: 10px; opacity: 0.7; padding: 2px 5px; background: rgba(255,255,255,0.08); border-radius: 4px;">F12</kbd>
    </button>

    <button class="dev-dropdown-btn" id="dev-show-console" type="button" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; text-align: left;">
      <span style="display: flex; align-items: center; gap: 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
        Debug Console
      </span>
      <kbd style="font-size: 10px; opacity: 0.7; padding: 2px 5px; background: rgba(255,255,255,0.08); border-radius: 4px;">Console</kbd>
    </button>

    <button class="dev-dropdown-btn" id="dev-reload-win" type="button" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; text-align: left;">
      <span style="display: flex; align-items: center; gap: 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        Reload Window
      </span>
      <kbd style="font-size: 10px; opacity: 0.7; padding: 2px 5px; background: rgba(255,255,255,0.08); border-radius: 4px;">Ctrl+R</kbd>
    </button>

    <div style="border-top: 1px solid var(--border-subtle); margin: 4px 0;"></div>

    <button class="dev-dropdown-btn" id="dev-toggle-agent-debug" type="button" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; text-align: left;">
      <span style="display: flex; align-items: center; gap: 8px;">
        <span id="dev-agent-debug-dot" style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${state.ai?.debugMode ? 'var(--accent-green, #39c5bb)' : 'var(--text-muted, #777)'};"></span>
        Verbose Agent Logs
      </span>
      <span id="dev-agent-debug-status" style="font-size: 10px; color: var(--text-muted);">${state.ai?.debugMode ? 'ON' : 'OFF'}</span>
    </button>

    <button class="dev-dropdown-btn" id="dev-copy-sysinfo" type="button" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; text-align: left;">
      <span style="display: flex; align-items: center; gap: 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        Copy Diagnostic Info
      </span>
    </button>
  `;

  document.body.appendChild(dropdown);

  // Hover styles
  dropdown.querySelectorAll('.dev-dropdown-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))';
      btn.style.color = 'var(--accent-cyan, #39c5bb)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-primary)';
    });
  });

  // Action listeners
  dropdown.querySelector('#dev-open-devtools')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeDevDropdown();
    await openDevToolsFromDropdown();
  });

  dropdown.querySelector('#dev-show-console')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDevDropdown();
    showDebugConsole();
  });

  dropdown.querySelector('#dev-reload-win')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeDevDropdown();
    try {
      await invoke('reload');
    } catch (_) {
      window.location.reload();
    }
  });

  dropdown.querySelector('#dev-toggle-agent-debug')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.ai.debugMode = !state.ai.debugMode;
    persistState();
    const dot = document.getElementById('dev-agent-debug-dot');
    const status = document.getElementById('dev-agent-debug-status');
    if (dot) dot.style.background = state.ai.debugMode ? 'var(--accent-green, #39c5bb)' : 'var(--text-muted, #777)';
    if (status) status.textContent = state.ai.debugMode ? 'ON' : 'OFF';
    showToast(`Agent Debug Mode: ${state.ai.debugMode ? 'Enabled' : 'Disabled'}`, 'info', 2000);
  });

  dropdown.querySelector('#dev-copy-sysinfo')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeDevDropdown();
    const info = [
      `Orbital X Version: 2.2.8`,
      `User Agent: ${navigator.userAgent}`,
      `Workspace: ${state.workspace?.rootPath || 'None'}`,
      `Agent Mode: ${state.agentMode || 'agent_pro'}`,
      `Active Model: ${state.ai?.model || 'default'}`,
      `Screen: ${window.innerWidth}x${window.innerHeight}`,
      `Timestamp: ${new Date().toISOString()}`
    ].join('\n');
    try {
      await navigator.clipboard.writeText(info);
      showToast('Diagnostic info copied to clipboard', 'success', 2500);
    } catch (_) {
      showToast('Could not copy to clipboard', 'error', 2500);
    }
  });

  document.addEventListener('click', outsideClickHandler);
}

function toggleDevDropdown() {
  if (devMenuOpen) {
    closeDevDropdown();
  } else {
    openDevDropdown();
  }
}

function openDevDropdown() {
  const dropdown = document.getElementById('dev-dropdown');
  const btn = document.getElementById('menu-developer');
  if (!dropdown || !btn) return;

  const rect = btn.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.display = 'flex';
  devMenuOpen = true;
}

function closeDevDropdown() {
  const dropdown = document.getElementById('dev-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
    devMenuOpen = false;
  }
}

function outsideClickHandler(e) {
  const dropdown = document.getElementById('dev-dropdown');
  const btn = document.getElementById('menu-developer');
  if (dropdown && btn && devMenuOpen) {
    if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeDevDropdown();
    }
  }
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
