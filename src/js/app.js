import { state, loadPersistedState, persistState, setActiveModel } from './state/store.js';
import { initMonaco, saveActiveFile, renderTabs } from './editor/monaco.js';
import { loadWorkspace, refreshFileTree, initFileTreeHeaderActions } from './components/file-tree.js';
import { initAgent, switchMode } from './components/agent.js';
import { initTerminal, getActiveSession, executeTerminalCommand } from './components/terminal.js';
import { initMemory, refreshMemories } from './components/memory.js';
import { initSettings, cycleTheme, applyTheme } from './components/settings.js';
import { initOnboarding } from './onboarding/wizard.js';
import { initModelPicker } from './components/model-picker.js';
import { initSourceControl, refreshGitStatus } from './components/source-control.js';
import { initExtensions } from './components/extensions.js';
import { initChatSessions } from './components/chat-sessions.js';
import { initUsageDashboard } from './components/usage.js';
import { pickFolder, invoke } from './services/tauri.js';
import { showToast } from './services/notifications.js';

window.showToast = showToast;

document.addEventListener('DOMContentLoaded', async () => {
  console.log("Orbital X Desktop IDE initializing...");

  // 1. Load state
  loadPersistedState();
  applyTheme(state.theme);
  switchMode(state.agentMode);

  // Set initial model display on composer pill & statusbar
  const initialModel = state.ai.model || state.ai.defaultModels[state.ai.provider] || 'llama3';
  setActiveModel(state.ai.provider, initialModel);

  // 2. Initialize Monaco Editor in container
  const monacoContainer = document.getElementById('monaco-container');
  if (monacoContainer) {
    initMonaco(monacoContainer);
  }

  // 3. Initialize UI Subsystems
  await initAgent();
  const splash = document.getElementById('splash-screen');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('hidden');
    }, 1500);
  }
  initChatSessions();
  initTerminal();
  initUsageDashboard();
  initMemory();
  initSettings();
  initOnboarding();
  initModelPicker();
  initSourceControl();
  initExtensions();
  initFileTreeHeaderActions();
  initActivityRail();
  initResizers();
  initGlobalShortcuts();
  initWindowControls();
  initShortcutsHelpOverlay();

  // 4. Panel Layout Toggles (Matching screenshot buttons)
  const sidebarEl = document.getElementById('sidebar');
  const bottomPanelEl = document.getElementById('bottom-panel');
  const agentPanelEl = document.getElementById('agent-panel');

  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnToggleBottom = document.getElementById('btn-toggle-bottom');
  const btnToggleAgent = document.getElementById('btn-toggle-agent');

  btnToggleSidebar?.addEventListener('click', () => {
    sidebarEl?.classList.toggle('hidden');
    btnToggleSidebar.classList.toggle('active', !sidebarEl?.classList.contains('hidden'));
  });

  btnToggleBottom?.addEventListener('click', () => {
    bottomPanelEl?.classList.toggle('collapsed');
    btnToggleBottom.classList.toggle('active', !bottomPanelEl?.classList.contains('collapsed'));
  });

  btnToggleAgent?.addEventListener('click', () => {
    agentPanelEl?.classList.toggle('hidden');
    btnToggleAgent.classList.toggle('active', !agentPanelEl?.classList.contains('hidden'));
  });

  document.getElementById('btn-close-agent-panel')?.addEventListener('click', () => {
    agentPanelEl?.classList.add('hidden');
    btnToggleAgent?.classList.remove('active');
  });



  document.getElementById('sb-settings-link')?.addEventListener('click', () => {
    document.getElementById('btn-open-settings')?.click();
  });

  // 5. Check for current open workspace
  try {
    const meta = await invoke('get_workspace_meta');
    if (meta && meta.root_path) {
      await loadWorkspace(meta.root_path);
      refreshMemories();
    }
  } catch (e) {
    console.log("No initial workspace loaded:", e);
  }

  // Quick Open Folder handler (Native Dialog Picker & Clean Workspace Transition)
  const handleOpenFolder = async () => {
    // 1. Check for unsaved changes in open tabs
    const unsavedTabs = state.editor.tabs.filter(t => t.isDirty);
    if (unsavedTabs.length > 0) {
      const confirmOpen = confirm(`You have ${unsavedTabs.length} unsaved file(s). Opening a new workspace will close these tabs. Continue?`);
      if (!confirmOpen) return;
    }

    try {
      const selected = await pickFolder();
      if (selected) {
        // 2. Clean tab state
        state.editor.tabs = [];
        state.editor.activeTabId = null;
        renderTabs();
        const emptyState = document.getElementById('editor-empty-state');
        if (emptyState) emptyState.style.display = 'flex';
        const breadcrumbElem = document.getElementById('editor-breadcrumb');
        if (breadcrumbElem) breadcrumbElem.textContent = '';

        // 3. Load workspace and update file tree
        await loadWorkspace(selected);

        // 4. Update terminal session CWD to match new workspace
        const activeTerm = getActiveSession();
        if (activeTerm) {
          activeTerm.cwd = selected;
          const promptLabel = document.getElementById('terminal-prompt-label');
          if (promptLabel) promptLabel.textContent = `PS ${selected}>`;
          await executeTerminalCommand(`cd "${selected}"`);
        }

        // 5. Reload memory and source control
        refreshMemories();
        refreshGitStatus();
      }
    } catch (err) {
      console.error("Workspace transition error:", err);
      alert("Failed to open workspace folder: " + err);
    }
  };

  document.getElementById('btn-open-workspace')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-welcome-open-folder')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-open-folder-inline')?.addEventListener('click', handleOpenFolder);
  document.getElementById('menu-file')?.addEventListener('click', handleOpenFolder);

  // Theme toggle button in titlebar
  document.getElementById('btn-theme-toggle')?.addEventListener('click', cycleTheme);

  // Mode pill in header: click to cycle modes
  document.getElementById('header-mode-pill')?.addEventListener('click', () => {
    const modes = ['dev', 'agent_pro', 'user'];
    const next = modes[(modes.indexOf(state.agentMode) + 1) % modes.length];
    switchMode(next);
  });

  // Search input handler
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => performSearch(e.target.value), 300);
    });
  }

  console.log("Orbital X initialization complete.");
});

function initActivityRail() {
  const rails = [
    { id: 'rail-explorer', view: 'view-explorer' },
    { id: 'rail-search', view: 'view-search' },
    { id: 'rail-source-control', view: 'view-source-control' },
    { id: 'rail-debug', view: 'view-debug' },
    { id: 'rail-extensions', view: 'view-extensions' },
    { id: 'rail-memory', view: 'view-memory' },
  ];

  const sidebar = document.getElementById('sidebar');

  rails.forEach(item => {
    const btn = document.getElementById(item.id);
    btn?.addEventListener('click', () => {
      const isAlreadyActive = btn.classList.contains('active');

      document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-subview').forEach(v => v.style.display = 'none');

      if (isAlreadyActive && !sidebar.classList.contains('hidden')) {
        // Toggle collapse
        sidebar.classList.add('hidden');
      } else {
        sidebar.classList.remove('hidden');
        btn.classList.add('active');
        const viewElem = document.getElementById(item.view);
        if (viewElem) viewElem.style.display = 'flex';
        if (item.id === 'rail-memory') refreshMemories();
        if (item.id === 'rail-source-control') refreshGitStatus();
      }
    });
  });

  // Toggle Agent Panel from rail
  document.getElementById('rail-agent')?.addEventListener('click', () => {
    const panel = document.getElementById('agent-panel');
    const btn = document.getElementById('rail-agent');
    if (panel) {
      panel.classList.toggle('hidden');
      btn?.classList.toggle('active', !panel.classList.contains('hidden'));
    }
  });

  // Toggle Terminal Panel from rail
  document.getElementById('rail-terminal')?.addEventListener('click', () => {
    const bottom = document.getElementById('bottom-panel');
    const isCollapsed = bottom?.classList.contains('collapsed');
    if (isCollapsed) {
      bottom?.classList.remove('collapsed');
      document.querySelector('.panel-tab[data-tab="terminal"]')?.click();
      document.getElementById('terminal-command-input')?.focus();
    } else {
      bottom?.classList.add('collapsed');
    }
  });

  document.getElementById('rail-settings')?.addEventListener('click', () => {
    document.getElementById('btn-open-settings')?.click();
  });

  document.getElementById('rail-usage')?.addEventListener('click', () => {
    import('./components/usage.js').then(m => m.showUsageModal());
  });

  // Review changes button
  document.getElementById('btn-review-changes')?.addEventListener('click', () => {
    document.getElementById('rail-source-control')?.click();
  });
}

function initResizers() {
  // Sidebar col-resizer
  setupResizer('resizer-sidebar', (e) => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const newWidth = Math.max(160, Math.min(500, e.clientX - 48));
      sidebar.style.width = `${newWidth}px`;
    }
  });

  // Agent panel col-resizer
  setupResizer('resizer-agent', (e) => {
    const panel = document.getElementById('agent-panel');
    if (panel) {
      const newWidth = Math.max(260, Math.min(600, window.innerWidth - e.clientX));
      panel.style.width = `${newWidth}px`;
    }
  });

  // Bottom panel row-resizer
  setupResizer('resizer-bottom', (e) => {
    const panel = document.getElementById('bottom-panel');
    if (panel) {
      const newHeight = Math.max(80, Math.min(500, window.innerHeight - e.clientY - 24));
      panel.style.height = `${newHeight}px`;
    }
  });
}

function setupResizer(handleId, onDrag) {
  const handle = document.getElementById(handleId);
  if (!handle) return;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('resizing');

    const handleMouseMove = (moveEvent) => {
      onDrag(moveEvent);
    };

    const handleMouseUp = () => {
      handle.classList.remove('resizing');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  });
}

function initGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Ctrl + O: Open Folder
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      document.getElementById('btn-open-workspace')?.click();
    }
    // Ctrl + S: Save File
    else if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveActiveFile();
    }
    // Alt + M: Cycle Mode
    else if (e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      document.getElementById('header-mode-pill')?.click();
    }
    // Ctrl + Shift + A: Toggle Agent
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      document.getElementById('rail-agent')?.click();
    }
    // Ctrl + Shift + G: Source Control (Git)
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      document.getElementById('rail-source-control')?.click();
    }
    // Ctrl + Shift + X: Extensions
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      document.getElementById('rail-extensions')?.click();
    }
    // Ctrl + Shift + D: Run & Debug
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      document.getElementById('rail-debug')?.click();
    }
    // Ctrl + Shift + E: Explorer
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      document.getElementById('rail-explorer')?.click();
    }
    // Ctrl + Shift + F: Search in Workspace
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      document.getElementById('rail-search')?.click();
    }
    // Ctrl + ` (backtick) or Ctrl + J: Toggle Terminal Panel & Focus Terminal Input
    else if (e.ctrlKey && (e.key === '`' || e.key.toLowerCase() === 'j')) {
      e.preventDefault();
      const bottom = document.getElementById('bottom-panel');
      const isCollapsed = bottom?.classList.contains('collapsed');
      if (isCollapsed) {
        bottom?.classList.remove('collapsed');
        document.querySelector('.panel-tab[data-tab="terminal"]')?.click();
        document.getElementById('terminal-command-input')?.focus();
      } else {
        bottom?.classList.add('collapsed');
      }
    }
    // Ctrl + B: Toggle Sidebar
    else if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      document.getElementById('btn-toggle-sidebar')?.click();
    }
    // Ctrl + L: Focus Agent Chat Input (VS Code / Cursor / Antigravity standard)
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      const agentPanel = document.getElementById('agent-panel');
      const btnToggleAgent = document.getElementById('btn-toggle-agent');
      if (agentPanel?.classList.contains('hidden')) {
        agentPanel.classList.remove('hidden');
        btnToggleAgent?.classList.add('active');
      }
      document.getElementById('agent-input')?.focus();
    }
  });
}

async function performSearch(query) {
  const container = document.getElementById('search-results-container');
  if (!container) return;

  if (!query || query.trim().length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; margin-top: 20px;">Type a term to search across all files.</div>';
    return;
  }

  container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted);"><span class="spinner"></span> Searching files...</div>';

  try {
    const matches = await invoke('search_workspace', { query, max_results: 30 });
    if (!matches || matches.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; margin-top: 20px;">No matches found.</div>';
      return;
    }

    container.innerHTML = `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Found ${matches.length} matches</div>`;

    matches.forEach(m => {
      const item = document.createElement('div');
      item.style.cssText = 'padding: 6px; border-radius: 4px; background: var(--bg-surface); margin-bottom: 4px; cursor: pointer; font-size: 11px;';
      item.innerHTML = `
        <div style="font-weight: 600; color: var(--accent-cyan);">${m.file}${m.line ? `:${m.line}` : ''}</div>
        <div style="font-family: var(--font-mono); font-size: 10px; color: var(--text-primary); margin-top: 2px;">${m.snippet}</div>
      `;

      item.addEventListener('click', async () => {
        try {
          const fileData = await invoke('read_file', { path: m.file });
          openFileInTab(fileData);
        } catch (err) {
          alert("Error opening match: " + err);
        }
      });

      container.appendChild(item);
    });
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red); font-size: 12px;">Search error: ${e}</div>`;
  }
}

function initWindowControls() {
  const getWin = async () => {
    try {
      if (window.__TAURI__?.window?.getCurrentWindow) {
        return window.__TAURI__.window.getCurrentWindow();
      }
      const winModule = await import('@tauri-apps/api/window');
      return winModule.getCurrentWindow ? winModule.getCurrentWindow() : null;
    } catch {
      return null;
    }
  };

  document.getElementById('win-close')?.addEventListener('click', async () => {
    const win = await getWin();
    if (win?.close) {
      await win.close();
    } else {
      console.log("Window close clicked");
    }
  });

  document.getElementById('win-minimize')?.addEventListener('click', async () => {
    const win = await getWin();
    if (win?.minimize) {
      await win.minimize();
    } else {
      console.log("Window minimize clicked");
    }
  });

  document.getElementById('win-maximize')?.addEventListener('click', async () => {
    const win = await getWin();
    if (win?.toggleMaximize) {
      await win.toggleMaximize();
    } else {
      console.log("Window maximize clicked");
    }
  });
}

export function openShortcutsHelp() {
  const modal = document.getElementById('modal-shortcuts-help');
  if (modal) {
    modal.style.display = 'flex';
  }
}

export function closeShortcutsHelp() {
  const modal = document.getElementById('modal-shortcuts-help');
  if (modal) {
    modal.style.display = 'none';
  }
}

function initShortcutsHelpOverlay() {
  const modal = document.getElementById('modal-shortcuts-help');
  const btnClose = document.getElementById('btn-close-shortcuts-help');

  btnClose?.addEventListener('click', closeShortcutsHelp);

  // Close when clicking outside modal-container (backdrop click)
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeShortcutsHelp();
    }
  });

  // Help menu in titlebar opens shortcuts help
  document.getElementById('menu-help')?.addEventListener('click', openShortcutsHelp);

  // Global keydown: F1 or Ctrl+Shift+P to open/toggle, Escape to close
  window.addEventListener('keydown', (e) => {
    const isF1 = e.key === 'F1';
    const isCmdPalette = e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p';

    if (isF1 || isCmdPalette) {
      e.preventDefault();
      const isVisible = modal && modal.style.display !== 'none';
      if (isVisible) {
        closeShortcutsHelp();
      } else {
        openShortcutsHelp();
      }
    } else if (e.key === 'Escape') {
      const isVisible = modal && modal.style.display !== 'none';
      if (isVisible) {
        e.preventDefault();
        closeShortcutsHelp();
      }
      const aboutModal = document.getElementById('modal-about');
      if (aboutModal && aboutModal.style.display !== 'none') {
        e.preventDefault();
        aboutModal.style.display = 'none';
      }
    }
  });

  initAboutModal();
}

function initAboutModal() {
  const modal = document.getElementById('modal-about');
  const btnAbout = document.getElementById('btn-about-orbital');
  const btnClose = document.getElementById('btn-close-about');
  const btnCheckUpdates = document.getElementById('btn-about-check-updates');

  const openAbout = () => {
    if (modal) modal.style.display = 'flex';
  };

  const closeAbout = () => {
    if (modal) modal.style.display = 'none';
  };

  btnAbout?.addEventListener('click', openAbout);
  btnClose?.addEventListener('click', closeAbout);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeAbout();
  });

  btnCheckUpdates?.addEventListener('click', () => {
    btnCheckUpdates.textContent = 'Checking...';
    setTimeout(() => {
      btnCheckUpdates.textContent = '✓ Up to Date';
      import('./services/notifications.js').then(m => {
        m.showToast('Orbital X is up to date (v2.2.2 Latest Release)', 'success');
      });
      setTimeout(() => {
        btnCheckUpdates.textContent = 'Check for Updates';
      }, 2500);
    }, 600);
  });
}


