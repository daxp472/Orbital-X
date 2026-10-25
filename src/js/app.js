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
import { initSearchPanel } from './components/search.js';
import { initCommandPalette } from './components/command-palette.js';
import { initSkills, renderSkillsPanel } from './components/skills.js';
import { initChatSessions } from './components/chat-sessions.js';
import { initUsageDashboard } from './components/usage.js';
import { pickFolder, invoke } from './services/tauri.js';
import { showToast } from './services/notifications.js';
import { restorePlanState } from './services/orchestrator.js';

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
  initExtensions();
  initSkills();
  initSearchPanel();
  initCommandPalette();
  initFileTreeHeaderActions();
  initActivityRail();
  initStatusBarExtras();
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
      tryRestorePlan();
      tryRestoreEditorSession();
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
        tryRestorePlan();
        tryRestoreEditorSession();
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
    // Ctrl + W: Close editor tab
    else if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      import('./editor/monaco.js').then(m => m.closeActiveTab());
    }
    // Ctrl + \: Toggle split editor
    else if (e.ctrlKey && e.key === '\\') {
      e.preventDefault();
      import('./editor/monaco.js').then(m => m.toggleSplitEditor());
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
        m.showToast('Orbital X is up to date (v2.2.3 Latest Release)', 'success');
      });
      setTimeout(() => {
        btnCheckUpdates.textContent = 'Check for Updates';
      }, 2500);
    }, 600);
  });
}


