import { state, loadPersistedState, persistState, setActiveModel } from './state/store.js';
import { initMonaco, saveActiveFile, renderTabs } from './editor/monaco.js';
import { loadWorkspace, refreshFileTree, initFileTreeHeaderActions } from './components/file-tree.js';
import { initAgent, switchMode } from './components/agent.js';
import { initTerminal, getActiveSession, executeTerminalCommand, renderPanes } from './components/terminal.js';
import { initMemory, refreshMemories } from './components/memory.js';
import { initSettings, cycleTheme, applyTheme } from './components/settings.js';
import { initOnboarding } from './onboarding/wizard.js';
import { initModelPicker } from './components/model-picker.js';
import { initSourceControl, refreshGitStatus } from './components/source-control.js';
import { initExtensions } from './components/extensions.js';
import { initSearchPanel } from './components/search.js';
import { initCommandPalette } from './components/command-palette.js';
import { initSkills, renderSkillsPanel } from './components/skills.js';
import { initChatSessions } from './components/chat-sessions.js';
import { initUsageDashboard } from './components/usage.js';
import { pickFolder, invoke } from './services/tauri.js';
import { showInputDialog, showConfirmDialog } from './services/dialogs.js';
import { showToast, loadActivityHistory, markAllActivityRead, clearActivity, recordActivity, notifyNative, isWindowHidden } from './services/notifications.js';
import { restorePlanState } from './services/orchestrator.js';
import { initUnifiedContextMenu } from './services/context-menu.js';
import { initDebug } from './components/debug.js';

window.showToast = showToast;

// Re-renders an interrupted plan for the current workspace so progress
// survives app restarts (plans are persisted per workspace root).
function tryRestorePlan() {
  try {
    const restored = restorePlanState();
    if (!restored || !restored.tasks || restored.tasks.length === 0) return;
    if (['completed', 'cancelled'].includes(restored.status)) return;
    import('./components/agent.js').then((m) => {
      if (typeof m.renderPlanCard === 'function') {
        m.renderPlanCard(restored);
        appendRestoredPlanNotice(restored);
      }
    });
  } catch (e) {
    console.warn('Plan restore failed:', e);
  }
}

function appendRestoredPlanNotice(plan) {
  const { completedCount, totalCount } = (function calc() {
    const done = (plan.tasks || []).filter(t => t.status === 'completed' || t.status === 'skipped').length;
    return { completedCount: done, totalCount: (plan.tasks || []).length };
  })();
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;
  const notice = document.createElement('div');
  notice.style.cssText = 'font-size: 11px; color: var(--text-muted); padding: 4px 2px; border-left: 2px solid var(--accent-cyan); margin: 6px 0;';
  notice.textContent = `↩️ Restored in-progress plan "${plan.title}" (${completedCount}/${totalCount} tasks done). Use the plan card above to resume execution.`;
  timeline.appendChild(notice);
}

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
  initDebug();
  initExtensions();
  initSkills();
  initSearchPanel();
  initCommandPalette();
  initActivityCenter();
  initProductionHardening();
  initUpdateCheck();
  initResizerPersistence();
  initFileTreeHeaderActions();
  initActivityRail();
  initStatusBarExtras();
  initResizers();
  initGlobalShortcuts();
  initWindowControls();
  initShortcutsHelpOverlay();
  initUnifiedContextMenu();

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

  // 5. Check for current open workspace — if the backend has none, try to
  //    auto-restore the most recent folder so the app opens where the user
  //    left it (Antigravity / VS Code behaviour).
  try {
    const meta = await invoke('get_workspace_meta');
    if (meta && meta.root_path) {
      await enterWorkspace(meta.root_path);
    } else {
      await tryRestoreLastWorkspace();
    }
  } catch (e) {
    console.log("No initial workspace loaded:", e);
    await tryRestoreLastWorkspace();
  }

  // Quick Open Folder handler (Native Dialog Picker & Clean Workspace Transition)
  // Quick Open Folder handler (Native Dialog Picker & Clean Workspace Transition)
  // M1: recent workspaces bookkeeping + M2 trust gate
  async function enterWorkspace(rootPath) {
    if (!rootPath) return;
    if (typeof rootPath === 'object' && rootPath !== null) {
      rootPath = rootPath.path || rootPath.filePath || rootPath;
    }
    if (typeof rootPath !== 'string') return;

    try {
      const meta = await invoke('set_workspace', { path: rootPath });
      if (!meta || !meta.root_path) {
        throw new Error('Workspace initialization returned empty metadata');
      }

      // Update state store
      state.workspace.rootPath = meta.root_path;
      state.workspace.name = meta.name;

      // Update UI headers
      const headerTitle = document.getElementById('header-workspace-name');
      if (headerTitle) headerTitle.textContent = meta.name;
      const sbWorkspace = document.getElementById('sb-workspace-text');
      if (sbWorkspace) sbWorkspace.textContent = meta.name;
      const sbRootName = document.getElementById('sidebar-root-name');
      if (sbRootName) sbRootName.textContent = (meta.name || 'WORKSPACE').toUpperCase();
      document.title = `${meta.name || 'Workspace'} — Orbital X`;

      // Clean open editor tabs from any prior workspace
      state.editor.tabs = [];
      state.editor.activeTabId = null;
      renderTabs();
      const emptyState = document.getElementById('editor-empty-state');
      if (emptyState) emptyState.style.display = 'flex';
      const breadcrumbElem = document.getElementById('editor-breadcrumb');
      if (breadcrumbElem) breadcrumbElem.textContent = '';

      // Remember in recent workspaces
      rememberRecentWorkspace(meta.root_path, meta.name);

      // Trust gate
      const trusted = isWorkspaceTrusted(meta.root_path);
      if (trusted === null) {
        await promptWorkspaceTrust(meta.root_path);
      }
      updateTrustIndicator();

      // Update terminal session CWD to match new workspace
      const activeTerm = getActiveSession();
      if (activeTerm) {
        activeTerm.cwd = meta.root_path;
        for (const pane of ['A', 'B']) {
          const pl = document.getElementById(`terminal-prompt-label-${pane}`);
          if (pl) pl.textContent = `PS ${meta.root_path}>`;
        }
        renderPanes();
        executeTerminalCommand(`cd "${meta.root_path}"`).catch(() => {});
      }

      // Load file tree passing cached meta (avoids duplicate set_workspace IPC)
      await loadWorkspace(meta.root_path, meta);

      // Background refreshes - catch each so failure never breaks workspace transition
      refreshMemories().catch(e => console.warn('Memory refresh failed:', e));
      refreshGitStatus().catch(e => console.warn('Git status refresh failed:', e));
      tryRestorePlan();
      tryRestoreEditorSession();
      import('./components/settings.js').then(m => { if (m.refreshWorkspaceSettings) m.refreshWorkspaceSettings(); }).catch(() => {});
      startWorkspaceIndexing().catch(e => console.warn('Workspace indexing failed:', e));

      // Close welcome modal
      const modal = document.getElementById('modal-welcome');
      if (modal) modal.style.display = 'none';

      return meta;
    } catch (err) {
      console.error('enterWorkspace failed:', err);
      throw err;
    }
  }

  const handleOpenFolder = async () => {
    const unsavedTabs = state.editor.tabs.filter(t => t.isDirty);
    if (unsavedTabs.length > 0) {
      const confirmOpen = await showConfirmDialog('Unsaved Files', `You have ${unsavedTabs.length} unsaved file(s). Opening a new workspace will close these tabs. Continue?`, 'Open Workspace');
      if (!confirmOpen) return;
    }

    try {
      const selected = await pickFolder();
      if (selected) {
        await enterWorkspace(selected);
        showToast(`Opened workspace: ${state.workspace.name || selected}`, 'info', 2500);
      }
    } catch (err) {
      console.error("Open Folder failed:", err);
      showToast(`Could not open folder: ${err}`, 'error', 3500);
    }
  };

  document.getElementById('btn-open-workspace')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-welcome-open-folder')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-open-folder-inline')?.addEventListener('click', handleOpenFolder);
  document.getElementById('menu-file')?.addEventListener('click', handleOpenFolder);
  document.getElementById('sidebar-root-header')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-explorer-open-folder')?.addEventListener('click', handleOpenFolder);

  // Theme toggle button in titlebar
  document.getElementById('btn-theme-toggle')?.addEventListener('click', cycleTheme);

  // Mode pill in header: click to open Apple-style Mode Switcher Dropdown
  const headerModePill = document.getElementById('header-mode-pill');
  const modeDropdown = document.getElementById('mode-switcher-dropdown');
  if (headerModePill && modeDropdown) {
    headerModePill.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = modeDropdown.style.display !== 'none';
      modeDropdown.style.display = isVisible ? 'none' : 'flex';
      modeDropdown.querySelectorAll('.mode-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === state.agentMode);
      });
    });

    modeDropdown.querySelectorAll('.mode-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const chosen = opt.dataset.mode;
        if (chosen) switchMode(chosen);
        modeDropdown.style.display = 'none';
      });
    });

    document.addEventListener('click', (e) => {
      if (!modeDropdown.contains(e.target) && !headerModePill.contains(e.target)) {
        modeDropdown.style.display = 'none';
      }
    });
  }

  console.log("Orbital X initialization complete.");
});

// Rich status bar interactions (Part C): language picker, indent settings,
// format button — plus editor session restore after workspace load.
function initStatusBarExtras() {
  document.getElementById('status-language')?.addEventListener('click', () => {
    import('./editor/monaco.js').then(m => m.openLanguagePicker());
  });
  document.getElementById('sb-format-btn')?.addEventListener('click', () => {
    import('./editor/monaco.js').then(m => m.formatActiveDocument());
  });
  document.getElementById('sb-indent')?.addEventListener('click', () => {
    import('./components/settings.js').then(m => m.openSettings());
  });
}

async function tryRestoreEditorSession() {
  try {
    const m = await import('./editor/monaco.js');
    if (typeof m.restoreEditorSession === 'function') await m.restoreEditorSession();
  } catch (e) {
    console.warn('Editor session restore failed:', e);
  }
}

function initActivityRail() {
  document.getElementById('btn-global-search')?.addEventListener('click', () => {
    document.getElementById('rail-search')?.click();
    setTimeout(() => document.getElementById('search-input')?.focus(), 60);
  });

  const rails = [
    { id: 'rail-explorer', view: 'view-explorer' },
    { id: 'rail-search', view: 'view-search' },
    { id: 'rail-source-control', view: 'view-source-control' },
    { id: 'rail-debug', view: 'view-debug' },
    { id: 'rail-extensions', view: 'view-extensions' },
    { id: 'rail-memory', view: 'view-memory' },
    { id: 'rail-skills', view: 'view-skills' },
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
        if (item.id === 'rail-skills') renderSkillsPanel();
        if (item.id === 'rail-extensions') {
          import('./components/extensions.js').then(m => m.renderPanel());
        }
        if (item.id === 'rail-source-control') refreshGitStatus();
        if (item.id === 'rail-debug') {
          import('./components/debug.js').then(m => m.refreshDebugTargets());
        }
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
      import('./components/terminal.js').then(m => m.focusActiveTerminalInput());
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

  // Agent panel col-resizer — FIX 8: allow up to 50% of window width
  const agentPanel = document.getElementById('agent-panel');
  setupResizer('resizer-agent', (e) => {
    const panel = document.getElementById('agent-panel');
    if (panel) {
      const maxW = Math.max(600, Math.floor(window.innerWidth * 0.5));
      const newWidth = Math.max(260, Math.min(maxW, window.innerWidth - e.clientX));
      panel.style.width = `${newWidth}px`;
      // Live width tooltip on the resizer
      const handle = document.getElementById('resizer-agent');
      if (handle) handle.title = `${Math.round(newWidth)}px — double-click to reset`;
    }
  });

  // FIX 8: double-click on the agent resizer resets to default width
  const agentHandle = document.getElementById('resizer-agent');
  if (agentHandle && !agentHandle.dataset.dblWired) {
    agentHandle.dataset.dblWired = '1';
    agentHandle.title = 'Drag to resize — double-click to reset';
    agentHandle.addEventListener('dblclick', () => {
      const panel = document.getElementById('agent-panel');
      if (panel) {
        panel.style.width = '380px';
        try { localStorage.setItem('orbital_panel_agent_w', '380'); } catch (e) { /* quota */ }
        import('./editor/monaco.js').then(m => m.getActiveEditor()?.layout());
      }
    });
  }

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
  const actions = {
    'app.save': () => saveActiveFile(),
    'app.openFolder': () => document.getElementById('btn-open-workspace')?.click(),
    'app.closeTab': () => import('./editor/monaco.js').then(m => m.closeActiveTab()),
    'app.splitEditor': () => import('./editor/monaco.js').then(m => m.toggleSplitEditor()),
    'app.commandPalette': () => import('./components/command-palette.js').then(m => m.openPalette()),
    'app.toggleTerminal': () => {
      const bottom = document.getElementById('bottom-panel');
      const isCollapsed = bottom?.classList.contains('collapsed');
      if (isCollapsed) {
        bottom?.classList.remove('collapsed');
        document.querySelector('.panel-tab[data-tab="terminal"]')?.click();
        import('./components/terminal.js').then(m => m.focusActiveTerminalInput());
      } else {
        bottom?.classList.add('collapsed');
      }
    },
    'app.newTerminal': () => import('./components/terminal.js').then(m => m.createTerminalInstance()),
    'app.toggleSidebar': () => document.getElementById('btn-toggle-sidebar')?.click(),
    'app.toggleAgent': () => document.getElementById('rail-agent')?.click(),
    'app.focusChat': () => {
      const agentPanel = document.getElementById('agent-panel');
      const btnToggleAgent = document.getElementById('btn-toggle-agent');
      if (agentPanel?.classList.contains('hidden')) {
        agentPanel.classList.remove('hidden');
        btnToggleAgent?.classList.add('active');
      }
      document.getElementById('agent-input')?.focus();
    },
    'app.explorer': () => document.getElementById('rail-explorer')?.click(),
    'app.search': () => document.getElementById('rail-search')?.click(),
    'app.sourceControl': () => document.getElementById('rail-source-control')?.click(),
    'app.extensions': () => document.getElementById('rail-extensions')?.click(),
    'app.cycleMode': () => document.getElementById('header-mode-pill')?.click(),
    'app.settings': () => document.getElementById('btn-open-settings')?.click(),
    'app.shortcuts': () => document.getElementById('menu-help')?.click(),
  };

  const appBindings = getAllBindings().filter(b => b.scope === 'app');

  window.addEventListener('keydown', (e) => {
    const combo = comboFromEvent(e);
    if (!combo) return;
    const hit = appBindings.find(b => b.combo === combo);
    if (!hit) return;
    const fn = actions[hit.id];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
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
    if (e.key === 'Escape') {
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
        m.showToast('Orbital X is up to date (v2.2.5 Latest Release)', 'success');
      });
      setTimeout(() => {
        btnCheckUpdates.textContent = 'Check for Updates';
      }, 2500);
    }, 600);
  });
}

// ==========================================================================
// Prompt 4 — K2 activity center, M1 welcome/recents, M2 trust, M4 overview,
// N2 indexing + quick open, N4 resizer persistence, N5 zen, P1-P4
// ==========================================================================

// ---------------------------------------------------------------
// K2 — Activity Center
// ---------------------------------------------------------------

function initActivityCenter() {
  loadActivityHistory();

  const bell = document.getElementById('btn-activity-center');
  const panel = document.getElementById('activity-center');
  const backdrop = document.getElementById('activity-center-backdrop');

  const close = () => {
    panel.style.display = 'none';
    backdrop.style.display = 'none';
  };
  bell?.addEventListener('click', () => {
    const open = panel.style.display === 'flex';
    if (open) { close(); return; }
    panel.style.display = 'flex';
    backdrop.style.display = 'block';
    renderActivityList();
    markAllActivityRead();
  });
  backdrop?.addEventListener('click', close);
  document.getElementById('activity-close')?.addEventListener('click', close);
  document.getElementById('activity-clear')?.addEventListener('click', () => {
    clearActivity();
    renderActivityList();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.style.display === 'flex') close();
  });
}

function renderActivityList() {
  const list = document.getElementById('activity-list');
  if (!list) return;
  const items = (window.__orbitalStateNotifications || []).slice();
  list.innerHTML = '';
  const notifs = (state.notifications || []);
  if (notifs.length === 0) {
    list.innerHTML = '<div class="pack-empty">No notifications yet.<br>Agent activity, saves, and git operations appear here.</div>';
    return;
  }
  const ICONS = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
  for (const n of notifs) {
    const row = document.createElement('div');
    row.className = 'pack-card';
    row.style.cssText = 'padding: 8px 10px; cursor: pointer;';
    const time = new Date(n.timestamp).toLocaleTimeString();
    row.innerHTML = `
      <div class="pack-title-row">
        <span class="pack-name" style="font-weight: 500; font-size: 11px;">${ICONS[n.type] || 'ℹ️'} ${escapeHtml(n.message)}</span>
      </div>
      <div class="pack-meta">${time}${n.meta?.path ? ` · ${escapeHtml(n.meta.path)}` : ''}</div>
    `;
    row.addEventListener('click', async () => {
      const path = n.meta?.path;
      if (path) {
        try {
          const fileData = await invoke('read_file', { path });
          const m = await import('./editor/monaco.js');
          m.openFileInTab(fileData);
          if (n.meta?.line) {
            const ed = m.getActiveEditor();
            if (ed) { ed.revealLineInCenter(n.meta.line); ed.setPosition({ lineNumber: n.meta.line, column: 1 }); }
          }
          document.getElementById('activity-center-backdrop').style.display = 'none';
          document.getElementById('activity-center').style.display = 'none';
        } catch (e) {
          showToast(`Could not open ${path}: ${e}`, 'error', 3000);
        }
      }
    });
    list.appendChild(row);
  }
}

// ---------------------------------------------------------------
// M1 — welcome screen + recent workspaces
// ---------------------------------------------------------------

const RECENT_WS_KEY = 'orbital_recent_workspaces';

function getRecentWorkspaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_WS_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, 5) : [];
  } catch (e) { return []; }
}

function rememberRecentWorkspace(path, name) {
  try {
    let recents = getRecentWorkspaces().filter(r => r.path !== path);
    recents.unshift({ path, name: name || path.split(/[\\/]/).pop(), openedAt: new Date().toISOString() });
    localStorage.setItem(RECENT_WS_KEY, JSON.stringify(recents.slice(0, 5)));
  } catch (e) { /* quota */ }
}

async function tryRestoreLastWorkspace() {
  // Auto-restore the most recent workspace on startup so the app opens
  // where the user left it — exactly like Antigravity / VS Code.
  const recents = getRecentWorkspaces();
  if (recents.length === 0) { openWelcomeScreen(); return; }
  const last = recents[0];
  try {
    await enterWorkspace(last.path);
    showToast(`Restored workspace: ${last.name || last.path}`, 'success', 2500);
  } catch (e) {
    showToast(`Could not restore "${last.name || last.path}": ${e}`, 'error', 3500);
    // Fall back to the welcome screen so the user isn't stuck
    openWelcomeScreen();
  }
}

function openWelcomeScreen() {
  const modal = document.getElementById('modal-welcome');
  if (!modal) return;
  const recents = getRecentWorkspaces();
  const host = document.getElementById('welcome-recents');
  if (host) {
    host.innerHTML = '';
    if (recents.length === 0) {
      host.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">No recent workspaces yet.</div>';
    }
    for (const r of recents) {
      const row = document.createElement('button');
      row.className = 'btn btn-secondary btn-sm';
      row.style.cssText = 'justify-content: flex-start; text-align: left; display: flex; flex-direction: column; gap: 1px; padding: 6px 10px;';
      row.innerHTML = `<strong style="font-size: 11.5px;">${escapeHtml(r.name || 'workspace')}</strong>
        <span style="font-size: 9.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${escapeHtml(r.path)}</span>`;
      row.addEventListener('click', async () => {
        try {
          await enterWorkspace(r.path);
          showToast(`Opened workspace: ${r.name || r.path}`, 'success', 2200);
        } catch (e) {
          modal.style.display = 'flex';
          showToast(`Could not reopen workspace: ${e}`, 'error', 4000);
        }
      });
      host.appendChild(row);
    }
  }
  modal.style.display = 'flex';

  document.getElementById('welcome-open-folder-btn')?.addEventListener('click', () => {
    document.getElementById('btn-open-workspace')?.click();
  });
  document.getElementById('welcome-new-file-btn')?.addEventListener('click', () => {
    modal.style.display = 'none';
    import('./components/file-tree.js').then(m => { if (m.promptNewFile) m.promptNewFile(null); });
  });
  document.getElementById('welcome-clone-btn')?.addEventListener('click', async () => {
    const url = await showInputDialog('Clone Repository', 'https://github.com/user/repo.git');
    if (!url || !url.trim()) return;
    const dest = await showInputDialog('Destination', 'folder name (created in home dir)', 'cloned-repo');
    if (!dest || !dest.trim()) return;
    modal.style.display = 'none';
    showToast('Cloning repository…', 'info', 2500);
    try {
      const home = await invoke('run_command', { command: 'echo $env:USERPROFILE', timeout_seconds: 10 });
      const homeDir = (home.stdout || '').trim() || '.';
      const res = await invoke('run_git_command', { args: ['clone', url.trim(), `${homeDir}\\${dest.trim()}`] });
      if (res.success === false) throw new Error((res.stderr || 'clone failed').slice(0, 200));
      showToast('Repository cloned — opening…', 'success', 2600);
      await enterWorkspace(`${homeDir}\\${dest.trim()}`);
    } catch (e) {
      showToast(`Clone failed: ${e}`, 'error', 4500);
    }
  });
  document.getElementById('welcome-link-shortcuts')?.addEventListener('click', (e) => { e.preventDefault(); modal.style.display = 'none'; document.getElementById('menu-help')?.click(); });
  document.getElementById('welcome-link-whatsnew')?.addEventListener('click', (e) => { e.preventDefault(); openWhatsNewModal(); });
  document.getElementById('welcome-link-docs')?.addEventListener('click', (e) => {
    e.preventDefault();
    invoke('run_command', { command: 'explorer "https://github.com/daxp472/Orbital-X"', timeout_seconds: 10 }).catch(() => {});
  });
}

// ---------------------------------------------------------------
// M2 — workspace trust
// ---------------------------------------------------------------

const TRUST_KEY = 'orbital_workspace_trust';

function isWorkspaceTrusted(rootPath) {
  // null = unknown (never asked)
  try {
    const map = JSON.parse(localStorage.getItem(TRUST_KEY) || '{}');
    const v = map[rootPath];
    if (v === true) return true;
    if (v === false) return false;
    return null;
  } catch (e) { return null; }
}

async function promptWorkspaceTrust(rootPath) {
  const trust = confirm(
    'Do you trust the authors of this workspace?\n\n' +
    'Trusting allows the agent to execute code and commands in this directory.\n' +
    'Choose OK to Trust Workspace, or Cancel to open in Restricted Mode (User mode, no command execution).'
  );
  try {
    const map = JSON.parse(localStorage.getItem(TRUST_KEY) || '{}');
    map[rootPath] = trust;
    localStorage.setItem(TRUST_KEY, JSON.stringify(map));
  } catch (e) { /* quota */ }
  if (!trust) {
    import('./components/agent.js').then(m => m.switchMode('user'));
    showToast('Opened in Restricted Mode — agent execution disabled', 'warning', 4000);
  } else {
    showToast('Workspace trusted', 'success', 2200);
  }
}

function updateTrustIndicator() {
  const el = document.getElementById('sb-trust-indicator');
  if (!el) return;
  const root = state.workspace.rootPath;
  const trusted = root ? isWorkspaceTrusted(root) : null;
  if (trusted === true) {
    el.textContent = '🔓 Trusted';
    el.title = 'Workspace trusted — the agent can execute commands here';
  } else if (trusted === false) {
    el.textContent = '🔒 Restricted';
    el.title = 'Restricted Mode — agent execution disabled for this workspace';
  } else {
    el.textContent = '';
  }
}

// ---------------------------------------------------------------
// N2 — background workspace index + Ctrl+P quick open
// ---------------------------------------------------------------

let workspaceIndex = [];
let indexingActive = false;

async function startWorkspaceIndexing() {
  if (indexingActive) return;
  indexingActive = true;
  const indicator = ensureIndexIndicator();
  try {
    const tree = await invoke('get_file_tree', { maxDepth: 8 });
    workspaceIndex = [];
    (function walk(node, dir) {
      const full = dir ? `${dir}/${node.name}` : node.name;
      if (node.is_directory) {
        (node.children || []).forEach(c => walk(c, full));
      } else {
        workspaceIndex.push({ path: node.relative_path || full, name: node.name, size: node.size_bytes || 0 });
      }
    })(tree, '');
    // enrich sizes are best-effort (tree already carries size_bytes)
    indicator.textContent = `${workspaceIndex.length.toLocaleString()} files indexed`;
    setTimeout(() => indicator.remove(), 1800);
    // N3 quick-open binding + rebind on writes
  } catch (e) {
    console.warn('Indexing failed:', e);
    indicator.remove();
  } finally {
    indexingActive = false;
  }
}

function ensureIndexIndicator() {
  let el = document.getElementById('sb-index-indicator');
  if (!el) {
    el = document.createElement('div');
    el.className = 'status-item';
    el.id = 'sb-index-indicator';
    el.title = 'Workspace index — powers Ctrl+P quick open';
    const anchor = document.getElementById('sb-ctx-meter');
    anchor?.parentElement?.insertBefore(el, anchor);
  }
  el.innerHTML = '<span class="spinner"></span> Indexing…';
  return el;
}

window.addEventListener('orbital:file-written', () => {
  // Cheap re-index debounce
  clearTimeout(window.__orbital_reindex_timer);
  window.__orbital_reindex_timer = setTimeout(() => startWorkspaceIndexing(), 4000);
});

function initQuickOpen() {
  const modal = document.getElementById('modal-quick-open');
  const input = document.getElementById('quick-open-input');
  const list = document.getElementById('quick-open-list');
  if (!modal || !input) return;

  const open = () => {
    if (!state.workspace.rootPath) { showToast('Open a workspace first', 'info', 2200); return; }
    modal.style.display = 'flex';
    input.value = '';
    renderQuickOpen('');
    setTimeout(() => input.focus(), 30);
  };
  const close = () => { modal.style.display = 'none'; };

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
      // Ctrl+P = quick open (Ctrl+Shift+P stays palette)
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && modal.style.display === 'flex') {
      close();
    }
  });
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.command-palette-item');
    const current = list.querySelector('.command-palette-item.selected');
    let idx = [...items].indexOf(current);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.classList.add('selected'); current?.classList.remove('selected'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(idx - 1, 0)]?.classList.add('selected'); current?.classList.remove('selected'); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = list.querySelector('.command-palette-item.selected') || items[0];
      chosen?.click();
    }
  });

  input.addEventListener('input', () => renderQuickOpen(input.value));

  function renderQuickOpen(query) {
    if (!list) return;
    const q = query.trim().toLowerCase();
    // subsequence fuzzy score
    const score = (text) => {
      const t = text.toLowerCase();
      if (!q) return 0;
      let ti = 0, sc = 0, streak = 0;
      for (const ch of q) {
        const f = t.indexOf(ch, ti);
        if (f === -1) return -1;
        streak = f === ti ? streak + 2 : 0;
        sc += 1 + streak + (f === 0 ? 3 : 0);
        ti = f + 1;
      }
      return sc;
    };
    const results = workspaceIndex
      .map(f => ({ f, s: score(f.path) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40);
    list.innerHTML = '';
    if (results.length === 0) {
      list.innerHTML = `<div class="command-palette-empty">${workspaceIndex.length === 0 ? 'Indexing… try again in a moment' : 'No matching files.'}</div>`;
      return;
    }
    for (const { f } of results) {
      const item = document.createElement('div');
      item.className = 'command-palette-item';
      item.innerHTML = `
        <span class="cp-icon">📄</span>
        <span class="cp-title" style="font-family: var(--font-mono); font-size: 11px;">${escapeHtml(f.name)}</span>
        <span class="cp-group">${escapeHtml(f.path)}</span>`;
      item.addEventListener('click', async () => {
        close();
        try {
          const fileData = await invoke('read_file', { path: f.path });
          const m = await import('./editor/monaco.js');
          m.openFileInTab(fileData);
        } catch (err) {
          showToast(`Could not open ${f.path}: ${err}`, 'error', 3000);
        }
      });
      list.appendChild(item);
    }
  }
}
initQuickOpen();

// ---------------------------------------------------------------
// N4 — persist panel sizes
// ---------------------------------------------------------------

function initResizerPersistence() {
  const SIDEBAR_KEY = 'orbital_panel_sidebar_w';
  const BOTTOM_KEY = 'orbital_panel_bottom_h';
  const AGENT_KEY = 'orbital_panel_agent_w';

  // restore
  const sidebar = document.getElementById('sidebar');
  const savedSidebar = localStorage.getItem(SIDEBAR_KEY);
  if (savedSidebar && sidebar) sidebar.style.width = `${savedSidebar}px`;
  const bottom = document.getElementById('bottom-panel');
  const savedBottom = localStorage.getItem(BOTTOM_KEY);
  if (savedBottom && bottom) {
    const parsedH = parseInt(savedBottom, 10);
    bottom.style.height = (!isNaN(parsedH) && parsedH >= 140 ? parsedH : 240) + 'px';
  }
  const agent = document.getElementById('agent-panel');
  const savedAgent = localStorage.getItem(AGENT_KEY);
  if (savedAgent && agent) agent.style.width = `${savedAgent}px`;

  // observe drags: the existing setupResizer handlers update inline styles —
  // hook mouseup on the handles to persist.
  const persistOn = (handleId, key, readPx) => {
    const handle = document.getElementById(handleId);
    if (!handle || handle.dataset.persistWired) return;
    handle.dataset.persistWired = '1';
    handle.addEventListener('mouseup', () => {
      const px = readPx();
      if (px) { try { localStorage.setItem(key, String(Math.round(px))); } catch (e) { /* quota */ } }
    });
    // also persist on window mouseup since drags capture globally
    window.addEventListener('mouseup', () => {
      if (handle.classList.contains('resizing')) {
        const px = readPx();
        if (px) { try { localStorage.setItem(key, String(Math.round(px))); } catch (e) { /* quota */ } }
      }
    });
  };
  persistOn('resizer-sidebar', SIDEBAR_KEY, () => document.getElementById('sidebar')?.offsetWidth);
  persistOn('resizer-bottom', BOTTOM_KEY, () => {
    const b = document.getElementById('bottom-panel');
    if (!b || b.classList.contains('collapsed')) return null;
    const h = b.offsetHeight;
    return h >= 140 ? h : null;
  });
  persistOn('resizer-agent', AGENT_KEY, () => document.getElementById('agent-panel')?.offsetWidth);
}

// ---------------------------------------------------------------
// N5 — Zen mode (Ctrl+K Z)
// ---------------------------------------------------------------

let zenMode = false;

function toggleZenMode() {
  zenMode = !zenMode;
  document.body.classList.toggle('zen-mode', zenMode);
  const hint = document.getElementById('zen-exit-hint');
  if (zenMode) {
    if (!hint) {
      const h = document.createElement('div');
      h.id = 'zen-exit-hint';
      h.textContent = 'Zen Mode — press Escape twice to exit';
      h.style.cssText = 'position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); font-size: 10.5px; color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: 3px 12px; z-index: 5000; opacity: 0.85;';
      document.body.appendChild(h);
      setTimeout(() => { h.style.transition = 'opacity 1s'; h.style.opacity = '0.35'; }, 3000);
    }
    import('./editor/monaco.js').then(m => { const ed = m.getActiveEditor(); ed?.layout(); ed?.focus(); });
    showToast('Zen Mode on — Escape twice to exit', 'info', 2600);
  } else {
    document.getElementById('zen-exit-hint')?.remove();
    import('./editor/monaco.js').then(m => m.getActiveEditor()?.layout());
  }
}

let lastEscape = 0;
window.addEventListener('keydown', (e) => {
  // Ctrl+K Z chord
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    window.__zenK = true;
    setTimeout(() => { window.__zenK = false; }, 1200);
    return;
  }
  if (window.__zenK && e.key.toLowerCase() === 'z' && !e.ctrlKey) {
    e.preventDefault();
    window.__zenK = false;
    toggleZenMode();
    return;
  }
  if (zenMode && e.key === 'Escape') {
    const now = Date.now();
    if (now - lastEscape < 600) {
      toggleZenMode();
    }
    lastEscape = now;
  }
});

// ---------------------------------------------------------------
// P1 — error boundary + crash log, P2 perf monitor
// ---------------------------------------------------------------

function initProductionHardening() {
  // P4: shortcut conflict scan
  import('./services/keybindings.js').then(({ getAllBindings }) => {
    const seen = new Map();
    for (const b of getAllBindings()) {
      if (seen.has(b.combo)) {
        console.warn(`[keybindings] conflict: "${b.combo}" bound to both "${seen.get(b.combo)}" and "${b.id}"`);
      } else {
        seen.set(b.combo, b.id);
      }
    }
  });

  // P1: global error capture
  const reportError = (message, source) => {
    const detail = `${message}${source ? ` (${source})` : ''}`;
    showToast('Something went wrong — click to log details', 'error', 8000, [
      { label: 'Log', onClick: async () => {
          try {
            const prev = localStorage.getItem('orbital_crash_buffer') || '';
            const entry = `[${new Date().toISOString()}] ${detail}\n${prev}`.slice(0, 40000);
            localStorage.setItem('orbital_crash_buffer', entry);
            const root = state.workspace.rootPath;
            if (root) {
              await invoke('save_file', { path: '.orbital/crash.log', content: entry, description: 'Crash log' });
              showToast('Crash details written to .orbital/crash.log', 'success', 3000);
            } else {
              showToast('Open a workspace to persist crash.log — details kept in memory', 'info', 3200);
            }
          } catch (e) {
            showToast(`Could not write crash log: ${e}`, 'error', 3000);
          }
        }, primary: true },
      { label: 'Dismiss', onClick: () => {} },
    ]);
  };

  window.onerror = (message, source, lineno, colno) => {
    reportError(message, `${source}:${lineno}:${colno}`);
  };
  window.onunhandledrejection = (event) => {
    reportError(`Unhandled promise rejection: ${event.reason}`, '');
  };

  // P2: performance monitor
  const perfToggle = document.createElement('div');
  perfToggle.id = 'perf-monitor';
  perfToggle.style.cssText = 'display: none; position: fixed; left: 60px; bottom: 34px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 6px 10px; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); z-index: 2600; pointer-events: none; min-width: 190px;';
  document.body.appendChild(perfToggle);

  let frames = 0, fps = 0;
  const countFrame = () => { frames++; requestAnimationFrame(countFrame); };
  requestAnimationFrame(countFrame);
  setInterval(() => { fps = frames; frames = 0; }, 1000);

  let perfOn = localStorage.getItem('orbital_perf_monitor') === 'true';
  ipcCount = window.__ipcCount = 0;

  const renderPerf = () => {
    if (!perfOn) return;
    const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB heap` : 'heap n/a';
    perfToggle.innerHTML = `FPS ${fps} · ${mem}<br>IPC calls: ${window.__ipcCount || 0}`;
  };
  setInterval(renderPerf, 500);

  // Toggle lives in Settings > Developer-ish: expose via command palette command
  window.__togglePerfMonitor = () => {
    perfOn = !perfOn;
    localStorage.setItem('orbital_perf_monitor', perfOn ? 'true' : 'false');
    perfToggle.style.display = perfOn ? 'block' : 'none';
    showToast(`Performance monitor ${perfOn ? 'on' : 'off'}`, 'info', 1800);
  };
  if (perfOn) perfToggle.style.display = 'block';

  // Agent completion → native notification when minimized (K3)
  document.addEventListener('visibilitychange', () => {
    window.__wasHidden = document.hidden;
  });
  window.addEventListener('orbital:agent-run-finished', (e) => {
    if (isWindowHidden()) {
      notifyNative('Orbital X', `✅ Agent task completed (${e.detail?.steps || 0} steps)`);
    }
  });
}

let ipcCount = 0;

// P3 — update check
function initUpdateCheck() {
  const DISMISS_KEY = 'orbital_update_dismissed_at';
  try {
    const dismissed = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (Date.now() - dismissed < 7 * 24 * 3600 * 1000) return;
  } catch (e) { /* check anyway */ }

  invoke('check_latest_release').then((res) => {
    const latest = (res?.tag || '').replace(/^v/, '');
    const current = '2.2.3';
    if (!latest) return;
    const isNewer = latest.split('.').map(Number).some((n, i) => n > (current.split('.').map(Number)[i] || 0)) &&
      latest !== current;
    if (!isNewer) return;

    const banner = document.createElement('div');
    banner.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; z-index: 5200; background: color-mix(in srgb, var(--accent-cyan) 18%, var(--bg-card)); border-bottom: 1px solid var(--accent-cyan); color: var(--text-primary); font-size: 12px; padding: 7px 16px; display: flex; align-items: center; gap: 12px;';
    banner.innerHTML = `
      <span>✨ Orbital X v${escapeHtml(latest)} is available!</span>
      <button class="btn btn-primary btn-sm" id="update-download">Download</button>
      <button class="btn btn-secondary btn-sm" id="update-dismiss">Dismiss</button>
    `;
    document.body.appendChild(banner);
    banner.querySelector('#update-download').addEventListener('click', () => {
      invoke('run_command', { command: `explorer "${res.url || 'https://github.com/daxp472/Orbital-X/releases/latest'}"`, timeout_seconds: 10 }).catch(() => {});
    });
    banner.querySelector('#update-dismiss').addEventListener('click', () => {
      banner.remove();
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* quota */ }
    });
  }).catch(() => { /* offline — silent */ });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------
// O3 — What's New modal
// ---------------------------------------------------------------

function openWhatsNewModal() {
  document.getElementById('modal-whats-new')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-whats-new';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="width: 560px; max-width: 94vw; max-height: 80vh; overflow-y: auto; padding: 20px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
        <img src="/logo.png" style="width: 34px; height: 34px; border-radius: 50%;" alt="logo" />
        <strong style="font-size: 15px;">What's New in Orbital X</strong>
        <button class="icon-btn" id="whatsnew-close" style="margin-left: auto;">✕</button>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.7; display: flex; flex-direction: column; gap: 10px;">
        <div><strong style="color: var(--text-primary);">v2.2.3</strong> — Streaming agent + real cancellation, Extensions (theme/prompt/command packs), Skills, split editor with pin/preview tabs, inline AI completions, command palette, pro Git panel (staging, branches, graph, blame, stash), pro terminal (profiles, ANSI, search), strict command & workspace security, web research tools, context meter, and full keyboard access.</div>
        <div style="color: var(--text-muted); font-size: 11px;">Full notes live in <code>release/notes/</code> in the repository and on the GitHub release page.</div>
      </div>
      <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
        <button class="btn btn-primary btn-sm" id="whatsnew-got">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => {
    modal.remove();
    try { localStorage.setItem('orbital_seen_version', '2.2.3'); } catch (e) { /* quota */ }
  };
  modal.querySelector('#whatsnew-close').addEventListener('click', close);
  modal.querySelector('#whatsnew-got').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}
