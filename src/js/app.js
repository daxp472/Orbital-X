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
import { showToast, loadActivityHistory, markAllActivityRead, markActivityRead, dismissActivity, clearActivity, recordActivity, notifyNative, isWindowHidden, getFilteredActivities, getNotificationPersona, setNotificationPersona, updateUnreadBadge } from './services/notifications.js';
import { restorePlanState } from './services/orchestrator.js';
import { initUnifiedContextMenu } from './services/context-menu.js';
import { initDebug } from './components/debug.js';
import { initDeveloperMenu } from './components/developer-menu.js';
import { initMenubar } from './components/menubar.js';
import { initTelemetryHUD } from './components/telemetry-hud.js';
import { initReviewChangesBar } from './services/changed-files.js';
import { initTimeTravel } from './components/time-travel.js';
import { checkForUpdatesManually, checkOnStartupOrWorkspace, CURRENT_VERSION } from './components/updater.js';
import { getAllBindings, comboFromEvent } from './services/keybindings.js';

window.showToast = showToast;
let ipcCount = 0;

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

// Quick Open Folder handler (Native Dialog Picker & Clean Workspace Transition)
// M1: recent workspaces bookkeeping + M2 trust gate
export async function enterWorkspace(rootPath) {
  if (!rootPath) return;
  if (Array.isArray(rootPath)) {
    rootPath = rootPath[0];
  }
  if (typeof rootPath === 'object' && rootPath !== null) {
    rootPath = rootPath.path || rootPath.filePath || rootPath.fsPath || rootPath;
  }
  if (typeof rootPath !== 'string') return;
  rootPath = rootPath.trim();
  if (!rootPath) return;

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

    // Trust gate: explicitly opened workspaces are trusted without blocking alerts
    rememberWorkspaceTrust(meta.root_path, true);
    updateTrustIndicator();
    updateSandboxStatusIndicator();
    updateGraphStatusIndicator();
    updateDiagnosticsStatusIndicator();
    updateVfsStatusIndicator();

    // Update terminal sessions to automatically match the active workspace directory
    import('./components/terminal.js').then(m => m.onWorkspaceOpened(meta.root_path)).catch(console.warn);

    // Check for updates on workspace open (throttled per session)
    checkOnStartupOrWorkspace().catch(() => {});

    // Load file tree passing cached meta (avoids duplicate set_workspace IPC)
    await loadWorkspace(meta.root_path, meta);

    // Ensure Explorer view in sidebar is activated and visible
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.remove('hidden');
      document.getElementById('btn-toggle-sidebar')?.classList.add('active');
    }
    const railExplorer = document.getElementById('rail-explorer');
    if (railExplorer) {
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-subview').forEach(v => v.style.display = 'none');
      railExplorer.classList.add('active');
      const viewExplorer = document.getElementById('view-explorer');
      if (viewExplorer) viewExplorer.style.display = 'flex';
    }

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

export const handleOpenFolder = async () => {
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

document.addEventListener('DOMContentLoaded', async () => {
  console.log("Orbital X Desktop IDE initializing...");

  // 1. Load state
  loadPersistedState();
  applyTheme(state.theme);
  const savedAccent = localStorage.getItem('orbital_accent_color');
  if (savedAccent) {
    document.documentElement.style.setProperty('--accent-cyan', savedAccent);
    document.documentElement.style.setProperty('--accent-primary', savedAccent);
    document.documentElement.style.setProperty('--accent-focus', savedAccent);
  }
  if (localStorage.getItem('orbital_ui_density') === 'compact') {
    document.body.classList.add('density-compact');
  }
  if (localStorage.getItem('orbital_glass_blur') === 'none') {
    document.documentElement.style.setProperty('--glass-blur-sm', 'none');
    document.documentElement.style.setProperty('--glass-blur-md', 'none');
    document.documentElement.style.setProperty('--glass-blur-lg', 'none');
  }
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
  try {
    initGlobalShortcuts();
  } catch (err) {
    console.error("initGlobalShortcuts error:", err);
  }
  initWindowControls();
  initShortcutsHelpOverlay();
  initUnifiedContextMenu();
  initDeveloperMenu();
  initMenubar();

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

  // 5. Workspace Folder & Dialog Triggers (Bound immediately before any async restoration)
  document.getElementById('btn-open-workspace')?.addEventListener('click', handleOpenFolder);
  document.getElementById('welcome-open-folder-btn')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-welcome-open-folder')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-open-folder-inline')?.addEventListener('click', handleOpenFolder);
  document.getElementById('sidebar-root-header')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-explorer-open-folder')?.addEventListener('click', handleOpenFolder);
  document.getElementById('btn-open-in-explorer')?.addEventListener('click', () => {
    invoke('open_in_explorer', {}).catch(e => console.warn(e));
  });

  // Theme toggle button in titlebar
  document.getElementById('btn-theme-toggle')?.addEventListener('click', cycleTheme);

  // Mode pill in header & status bar: click to open Apple-style Mode Switcher Dropdown
  const headerModePill = document.getElementById('header-mode-pill');
  const modeDropdown = document.getElementById('mode-switcher-dropdown');
  const statusModePill = document.getElementById('status-mode');
  if (headerModePill && modeDropdown) {
    const toggleModeDropdown = (e) => {
      e.stopPropagation();
      const isVisible = modeDropdown.style.display !== 'none';
      modeDropdown.style.display = isVisible ? 'none' : 'flex';
      modeDropdown.querySelectorAll('.mode-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === state.agentMode);
      });
    };

    headerModePill.addEventListener('click', toggleModeDropdown);

    if (statusModePill) {
      statusModePill.style.cursor = 'pointer';
      statusModePill.title = 'Click to choose Agent Operating Mode';
      statusModePill.addEventListener('click', toggleModeDropdown);
    }

    modeDropdown.querySelectorAll('.mode-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const chosen = opt.dataset.mode;
        if (chosen) switchMode(chosen);
        modeDropdown.style.display = 'none';
      });
    });

    document.addEventListener('click', (e) => {
      if (!modeDropdown.contains(e.target) && !headerModePill.contains(e.target) && (!statusModePill || !statusModePill.contains(e.target))) {
        modeDropdown.style.display = 'none';
      }
    });
  }

  // 6. Check for current open workspace — if the backend has none, try to
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

  // Report Issue in status bar
  document.getElementById('sb-report-issue')?.addEventListener('click', async () => {
    const issueUrl = 'https://daxp472.github.io/Orbital-X/report-issue.html';
    try {
      await invoke('open_url', { url: issueUrl });
    } catch (e) {
      window.open(issueUrl, '_blank');
    }
  });

  // Pillar 1: Sandbox Status Indicator in status bar
  updateSandboxStatusIndicator();
  document.getElementById('sb-sandbox-indicator')?.addEventListener('click', async () => {
    try {
      const { getSandboxStatus } = await import('./services/tauri.js');
      const st = await getSandboxStatus();
      showToast(
        `Workspace Sandbox: ${st.platform}\nMemory Cap: ${st.max_memory_mb} MB · CPU Cap: ${st.max_cpu_percent}%\nProcess Limit: ${st.max_active_processes}`,
        st.is_active ? 'info' : 'warning',
        4000
      );
    } catch (_) {
      showToast('Workspace Sandbox Active', 'info', 2000);
    }
  });

  // Pillar 2: Semantic Graph Status Indicator in status bar
  updateGraphStatusIndicator();
  document.getElementById('sb-graph-indicator')?.addEventListener('click', async () => {
    let sym = '';
    try {
      const monacoMod = await import('./editor/monaco.js');
      const activeEd = monacoMod.getActiveEditor?.();
      if (activeEd) {
        const model = activeEd.getModel();
        const pos = activeEd.getPosition();
        const sel = activeEd.getSelection();
        if (sel && !sel.isEmpty()) {
          sym = model.getValueInRange(sel).trim();
        } else if (pos) {
          const w = model.getWordAtPosition(pos);
          if (w) sym = w.word;
        }
      }
    } catch (_) {}
    showCallersImpactModal(sym);
  });

  // Pillar 3: Diagnostics Status Indicator in status bar
  updateDiagnosticsStatusIndicator();
  document.getElementById('sb-diag-indicator')?.addEventListener('click', async () => {
    const text = document.getElementById('sb-diag-text');
    const dot = document.getElementById('sb-diag-dot');
    if (text) text.textContent = 'Build: Checking…';
    if (dot) dot.style.backgroundColor = 'var(--accent-orange)';

    try {
      const { runDiagnosticsCheck, evaluateDiagnosticsHealing } = await import('./services/tauri.js');
      const [diags, healing] = await Promise.all([
        runDiagnosticsCheck(30),
        evaluateDiagnosticsHealing(30),
      ]);

      if (diags.length === 0) {
        updateDiagnosticsStatusIndicator(0);
        showToast('Compiler Diagnostics: Clean build! No errors found.', 'success', 3000);
      } else {
        updateDiagnosticsStatusIndicator(diags.length);
        const first = diags[0];
        const loopWarning = healing?.loop_detected ? '\n⚠️ RECURSIVE LOOP DETECTED!' : '';
        showToast(
          `Compiler Diagnostics: ${diags.length} error(s) found.${loopWarning}\n${first.file_path}:${first.line}: ${first.message}`,
          healing?.loop_detected ? 'error' : 'warning',
          6000
        );
      }
    } catch (e) {
      updateDiagnosticsStatusIndicator();
      showToast(`Diagnostic check failed: ${e}`, 'error', 3000);
    }
  });

  // Pillar 4: Virtual File System (VFS) Diff Bridge & Checkpoints Indicator in status bar
  updateVfsStatusIndicator();

  // Unified Architectural Pillars Health Pill click handler
  document.getElementById('sb-pillars-pill')?.addEventListener('click', async () => {
    try {
      const { getSandboxStatus, getGraphStats, getDiagnosticsStatus, getVfsStatus } = await import('./services/tauri.js');
      const [sandbox, graph, diag, vfs] = await Promise.allSettled([
        getSandboxStatus(),
        getGraphStats(),
        getDiagnosticsStatus(),
        getVfsStatus()
      ]);
      const sbMsg = sandbox.status === 'fulfilled' && sandbox.value?.is_active ? `Sandbox: ${sandbox.value.platform} (Active)` : 'Sandbox: Standby';
      const grMsg = graph.status === 'fulfilled' && graph.value ? `AST Graph: ${graph.value.total_files} files · ${graph.value.total_symbols} symbols` : 'AST Graph: Ready';
      const dgMsg = diag.status === 'fulfilled' && diag.value ? `Diagnostics: ${diag.value.toolchain} (${diag.value.last_error_count || 0} err)` : 'Diagnostics: OK';
      const vfMsg = vfs.status === 'fulfilled' && vfs.value ? `VFS: ${vfs.value.dirty_count || 0} staged · ${vfs.value.checkpoint_count || 0} checkpoints` : 'VFS: Clean';

      showToast(`Operational Pillars Health:\n• ${sbMsg}\n• ${grMsg}\n• ${dgMsg}\n• ${vfMsg}`, 'info', 4500);
    } catch (_) {
      showToast('Enterprise Core Pillars: 4/4 Operational', 'info', 2500);
    }
  });
  document.getElementById('sb-vfs-indicator')?.addEventListener('click', async () => {
    try {
      const { getVfsStatus, getVfsPendingDiffs } = await import('./services/tauri.js');
      const [status, diffs] = await Promise.all([
        getVfsStatus(),
        getVfsPendingDiffs(),
      ]);

      if (!diffs || diffs.length === 0) {
        showToast(`VFS Status: Clean\n0 staged shadow edits. ${status?.checkpoint_count || 0} checkpoint(s) available.`, 'info', 3000);
        return;
      }

      const { previewVfsDiff } = await import('./editor/monaco.js');
      if (diffs.length === 1) {
        previewVfsDiff(diffs[0]);
      } else {
        showVfsDiffsModal(diffs, status);
      }
    } catch (e) {
      showToast(`VFS inspection failed: ${e}`, 'error', 3000);
    }
  });
}

export async function updateSandboxStatusIndicator() {
  const el = document.getElementById('sb-sandbox-indicator');
  const dot = document.getElementById('sb-sandbox-dot');
  const text = document.getElementById('sb-sandbox-text');
  if (!el || !text) return;

  try {
    const { getSandboxStatus } = await import('./services/tauri.js');
    const status = await getSandboxStatus();
    if (status && status.is_active) {
      if (dot) dot.style.backgroundColor = 'var(--accent-green)';
      const shortPlatform = status.platform.includes('Job') ? 'Job Object' : 'Process Group';
      text.textContent = `Sandbox: Active [${shortPlatform}]`;
      el.title = `Enterprise Workspace Isolation: Active\nPlatform: ${status.platform}\nMemory Limit: ${status.max_memory_mb} MB\nCPU Limit: ${status.max_cpu_percent}%\nMax Processes: ${status.max_active_processes}\nStaged Files: ${status.active_staging_files}`;
    } else {
      if (dot) dot.style.backgroundColor = 'var(--accent-orange)';
      text.textContent = 'Sandbox: Host';
      el.title = 'Workspace Isolation: Running directly on Host OS (unisolated)';
    }
  } catch (e) {
    if (dot) dot.style.backgroundColor = 'var(--text-muted)';
    text.textContent = 'Sandbox: Standby';
  }
  updatePillarsUnifiedPill();
}

export async function updateGraphStatusIndicator() {
  const el = document.getElementById('sb-graph-indicator');
  const dot = document.getElementById('sb-graph-dot');
  const text = document.getElementById('sb-graph-text');
  if (!el || !text) return;

  try {
    const { getGraphStats } = await import('./services/tauri.js');
    const stats = await getGraphStats();
    if (stats) {
      if (stats.is_indexing) {
        if (dot) dot.style.backgroundColor = 'var(--accent-orange)';
        text.textContent = 'AST: Indexing…';
        el.title = `Native Semantic Graph: Indexing Workspace...\nClick to Find Callers / Impact Graph`;
      } else {
        if (dot) dot.style.backgroundColor = 'var(--accent-cyan)';
        text.textContent = `AST: ${stats.total_files} files · ${stats.total_symbols} symbols`;
        el.title = `Native Semantic Code Graph: Active\nFiles: ${stats.total_files}\nAST Symbols: ${stats.total_symbols}\nCall Edges: ${stats.total_edges}\nClick to Find Callers / Impact Graph`;
      }
    }
  } catch (e) {
    if (dot) dot.style.backgroundColor = 'var(--text-muted)';
    text.textContent = 'AST: Standby';
  }
  updatePillarsUnifiedPill();
}

export async function updateDiagnosticsStatusIndicator(errorsCount = null) {
  const el = document.getElementById('sb-diag-indicator');
  const dot = document.getElementById('sb-diag-dot');
  const text = document.getElementById('sb-diag-text');
  if (!el || !text) return;

  try {
    const { getDiagnosticsStatus } = await import('./services/tauri.js');
    const status = await getDiagnosticsStatus();
    const count = errorsCount !== null ? errorsCount : (status?.last_error_count || 0);

    if (status && status.is_available) {
      if (status.is_loop_detected) {
        if (dot) dot.style.backgroundColor = 'var(--accent-red)';
        text.textContent = 'Build: Loop Alert';
        el.title = `Compiler Diagnostics: RECURSIVE LOOP DETECTED (${status.consecutive_failures} fails)\nToolchain: ${status.toolchain}\nClick to Run Check or Reset Loop`;
      } else if (count > 0) {
        if (dot) dot.style.backgroundColor = 'var(--accent-red)';
        text.textContent = `Build: ${count} error${count > 1 ? 's' : ''}`;
        el.title = `Compiler Diagnostics: ${count} Errors Found\nToolchain: ${status.toolchain}\nClick to Run Check`;
      } else {
        if (dot) dot.style.backgroundColor = 'var(--accent-green)';
        text.textContent = `Build: OK (${status.toolchain})`;
        el.title = `Compiler Diagnostics: Clean Build\nToolchain: ${status.toolchain}\nClick to Re-run Check`;
      }
    } else {
      if (dot) dot.style.backgroundColor = 'var(--text-muted)';
      text.textContent = 'Build: Ready';
      el.title = 'Compiler Diagnostics: Ready (generic/auto-detect)';
    }
  } catch (e) {
    if (dot) dot.style.backgroundColor = 'var(--text-muted)';
    text.textContent = 'Build: Ready';
  }
  updatePillarsUnifiedPill();
}

export async function updateVfsStatusIndicator() {
  const el = document.getElementById('sb-vfs-indicator');
  const dot = document.getElementById('sb-vfs-dot');
  const text = document.getElementById('sb-vfs-text');
  if (!el || !text) return;

  try {
    const { getVfsStatus } = await import('./services/tauri.js');
    const status = await getVfsStatus();
    const dirtyCount = status?.dirty_count || 0;
    const checkpointCount = status?.checkpoint_count || 0;

    if (dirtyCount > 0) {
      if (dot) dot.style.backgroundColor = 'var(--accent-orange)';
      text.textContent = `VFS: ${dirtyCount} pending`;
      el.title = `Virtual File System: ${dirtyCount} Uncommitted Shadow Edit${dirtyCount > 1 ? 's' : ''}\nCheckpoints: ${checkpointCount}\nDirty Files: ${(status.dirty_files || []).join(', ')}\nClick to Review Diffs, Commit, or Rollback`;
    } else {
      if (dot) dot.style.backgroundColor = 'var(--text-muted)';
      text.textContent = `VFS: 0 staged`;
      el.title = `Virtual File System: Clean (0 staged edits)\nCheckpoints Available: ${checkpointCount}\nClick to Review VFS Status`;
    }
  } catch (e) {
    if (dot) dot.style.backgroundColor = 'var(--text-muted)';
    text.textContent = 'VFS: Standby';
  }
  updatePillarsUnifiedPill();
}

export function updatePillarsUnifiedPill() {
  const pill = document.getElementById('sb-pillars-pill');
  const dot = document.getElementById('sb-pillars-dot');
  const text = document.getElementById('sb-pillars-text');
  if (!pill || !text) return;

  const sandboxText = document.getElementById('sb-sandbox-text')?.textContent || 'Active';
  const graphText = document.getElementById('sb-graph-text')?.textContent || 'Ready';
  const diagText = document.getElementById('sb-diag-text')?.textContent || 'OK';
  const vfsText = document.getElementById('sb-vfs-text')?.textContent || 'Clean';

  const isDegraded = diagText.includes('error') || diagText.includes('Loop');
  const isPending = vfsText.includes('pending') || graphText.includes('Indexing');

  if (isDegraded) {
    if (dot) dot.style.backgroundColor = 'var(--accent-red)';
    text.textContent = 'Pillars: Alert';
  } else if (isPending) {
    if (dot) dot.style.backgroundColor = 'var(--accent-orange)';
    text.textContent = 'Pillars: Syncing';
  } else {
    if (dot) dot.style.backgroundColor = 'var(--accent-green)';
    text.textContent = 'Pillars: OK';
  }

  pill.title = `Enterprise Core Pillars Health:\n• Sandbox: ${sandboxText}\n• Semantic Graph: ${graphText}\n• Diagnostics: ${diagText}\n• VFS Bridge: ${vfsText}\nClick for Pillar Diagnostics`;
}

export async function showVfsDiffsModal(diffs, status) {
  const existing = document.getElementById('vfs-review-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'vfs-review-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.backgroundColor = 'rgba(0,0,0,0.65)';
  modal.style.backdropFilter = 'blur(4px)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';

  const card = document.createElement('div');
  card.style.background = 'var(--bg-secondary, #1e1e1e)';
  card.style.border = '1px solid var(--border-color, #333)';
  card.style.borderRadius = '8px';
  card.style.width = '560px';
  card.style.maxWidth = '90vw';
  card.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow = 'hidden';

  card.innerHTML = `
    <div style="padding: 14px 16px; border-bottom: 1px solid var(--border-color, #333); display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-weight: 600; font-size: 14px;">Virtual File System (VFS) Staged Diffs</span>
        <span style="background: var(--accent-orange, #e59500); color: #000; font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 10px;">${diffs.length} Pending</span>
      </div>
      <button id="vfs-modal-close" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px;">&times;</button>
    </div>
    <div style="padding: 12px 16px; max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
      ${diffs.map((d, i) => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--bg-tertiary, #252526); border-radius: 4px;">
          <div>
            <div style="font-size: 13px; font-weight: 500; font-family: monospace;">${d.path}</div>
            <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; margin-top: 2px;">
              <span style="color: var(--accent-green, #4ec9b0);">+${d.additions}</span>
              <span style="color: var(--accent-red, #f44747);">-${d.deletions}</span>
              <span>${d.status}</span>
            </div>
          </div>
          <button class="vfs-preview-btn" data-index="${i}" style="padding: 4px 10px; font-size: 12px; background: var(--accent-blue, #0e639c); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Review Diff</button>
        </div>
      `).join('')}
    </div>
    <div style="padding: 12px 16px; border-top: 1px solid var(--border-color, #333); display: flex; justify-content: space-between; align-items: center; background: var(--bg-primary, #181818);">
      <button id="vfs-rollback-all-btn" style="padding: 6px 14px; font-size: 12px; background: transparent; color: var(--accent-red, #f44747); border: 1px solid var(--accent-red, #f44747); border-radius: 4px; cursor: pointer;">Discard All Changes</button>
      <div style="display: flex; gap: 8px;">
        <button id="vfs-cancel-btn" style="padding: 6px 14px; font-size: 12px; background: var(--bg-secondary, #2d2d2d); color: var(--text-normal); border: 1px solid var(--border-color, #444); border-radius: 4px; cursor: pointer;">Close</button>
        <button id="vfs-commit-all-btn" style="padding: 6px 14px; font-size: 12px; background: var(--accent-green, #388a34); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Commit All to Disk</button>
      </div>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#vfs-modal-close').onclick = close;
  modal.querySelector('#vfs-cancel-btn').onclick = close;

  modal.querySelectorAll('.vfs-preview-btn').forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.index, 10);
      close();
      const { previewVfsDiff } = await import('./editor/monaco.js');
      previewVfsDiff(diffs[idx]);
    };
  });

  modal.querySelector('#vfs-rollback-all-btn').onclick = async () => {
    if (!confirm('Are you sure you want to discard all pending Virtual File System changes?')) return;
    const { rollbackVfsAll } = await import('./services/tauri.js');
    await rollbackVfsAll();
    close();
    updateVfsStatusIndicator();
    showToast('All VFS shadow modifications discarded.', 'info', 3000);
  };

  modal.querySelector('#vfs-commit-all-btn').onclick = async () => {
    const { commitVfsAll } = await import('./services/tauri.js');
    const summary = await commitVfsAll();
    close();
    updateVfsStatusIndicator();
    showToast(`Committed ${summary?.committed_count || diffs.length} files to disk via atomic 2PC transaction.`, 'success', 3000);
  };
}

export async function showCallersImpactModal(initialSymbol = '') {
  let symbol = initialSymbol;
  if (!symbol) {
    symbol = window.prompt('Enter function, method, struct, or class name to inspect:');
  }
  if (!symbol || !symbol.trim()) return;
  symbol = symbol.trim();

  try {
    const { getGraphFocusedContext, getGraphCallers } = await import('./services/tauri.js');
    const [ctx, callers] = await Promise.all([
      getGraphFocusedContext(symbol),
      getGraphCallers(symbol),
    ]);

    const directCallers = ctx?.callers || callers || [];
    if (!ctx && directCallers.length === 0) {
      showToast(`No callers or AST definitions found for "${symbol}" in the active workspace.`, 'info', 3000);
      return;
    }

    const callerSummary = directCallers.length > 0
      ? directCallers.slice(0, 5).map(c => `${c.name} (${c.file_path}:${c.line || '?'})`).join(', ')
      : 'None (entry point)';

    const calleeSummary = (ctx?.callees && ctx.callees.length > 0)
      ? ctx.callees.slice(0, 5).map(c => `${c.name} (${c.file_path}:${c.line || '?'})`).join(', ')
      : 'None';

    showToast(
      `AST Impact [${ctx?.target_symbol || symbol}]:\nCallers: ${callerSummary}\nCallees: ${calleeSummary}`,
      'info',
      6000
    );
  } catch (e) {
    showToast(`Failed to query semantic graph: ${e}`, 'error', 3000);
  }
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

  // Review changes toolbar & diff inspector
  initReviewChangesBar();
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
    'app.openFolder': () => handleOpenFolder(),
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

  let appBindings = [];
  try {
    appBindings = (typeof getAllBindings === 'function' ? getAllBindings() : []).filter(b => b.scope === 'app');
  } catch (err) {
    console.error('Failed to load keybindings in initGlobalShortcuts:', err);
  }

  window.addEventListener('keydown', (e) => {
    // Guaranteed Ctrl+O handler anywhere in the app
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O' || e.code === 'KeyO')) {
      e.preventDefault();
      handleOpenFolder();
      return;
    }
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
    try {
      await invoke('window_close');
    } catch {
      const win = await getWin();
      if (win?.close) {
        await win.close();
      } else {
        window.close();
      }
    }
  });

  document.getElementById('win-minimize')?.addEventListener('click', async () => {
    try {
      await invoke('window_minimize');
    } catch {
      const win = await getWin();
      if (win?.minimize) {
        await win.minimize();
      }
    }
  });

  document.getElementById('win-maximize')?.addEventListener('click', async () => {
    try {
      await invoke('window_toggle_maximize');
    } catch {
      const win = await getWin();
      if (win?.toggleMaximize) {
        await win.toggleMaximize();
      }
    }
  });

  // Global F11 key shortcut for full-screen toggle
  window.addEventListener('keydown', async (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      try {
        await invoke('window_toggle_fullscreen');
      } catch (err) {
        console.warn('Fullscreen toggle error:', err);
      }
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
  const shortcutsModal = document.getElementById('modal-shortcuts-help');
  const helpModal = document.getElementById('modal-help');

  // Close shortcuts modal
  shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) {
      shortcutsModal.style.display = 'none';
    }
  });

  // Close help modal
  helpModal?.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.style.display = 'none';
    }
  });

  // Help menu in titlebar opens Help modal with Report Issue and Shortcuts

  // Keyboard shortcuts button in Help modal
  document.getElementById('btn-help-shortcuts')?.addEventListener('click', () => {
    if (helpModal) helpModal.style.display = 'none';
    if (shortcutsModal) shortcutsModal.style.display = 'flex';
  });

  // Report Issue button in Help modal
  document.getElementById('btn-help-report-issue')?.addEventListener('click', async () => {
    const issueUrl = 'https://daxp472.github.io/Orbital-X/report-issue.html';
    try {
      await invoke('open_url', { url: issueUrl });
    } catch (e) {
      window.open(issueUrl, '_blank');
    }
  });

  // Global keydown: F1 or Ctrl+Shift+P to open Help, Escape to close
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openHelpModal();
      return;
    }
    if (e.key === 'Escape') {
      const shortcutsVisible = shortcutsModal && shortcutsModal.style.display !== 'none';
      if (shortcutsVisible) {
        e.preventDefault();
        shortcutsModal.style.display = 'none';
        return;
      }
      const helpVisible = helpModal && helpModal.style.display !== 'none';
      if (helpVisible) {
        e.preventDefault();
        helpModal.style.display = 'none';
        return;
      }
      const aboutModal = document.getElementById('modal-about');
      if (aboutModal && aboutModal.style.display !== 'none') {
        e.preventDefault();
        aboutModal.style.display = 'none';
      }
      closeShortcutsHelp();
    }
  });

  initAboutModal();

  // Close shortcuts modal via X button
  document.getElementById('btn-close-shortcuts-help')?.addEventListener('click', () => {
    if (shortcutsModal) shortcutsModal.style.display = 'none';
  });

  // Close help modal via X button
  document.getElementById('btn-close-help')?.addEventListener('click', () => {
    if (helpModal) helpModal.style.display = 'none';
  });

  // Check for Updates button in Settings > Terminal
  document.getElementById('btn-check-updates-settings')?.addEventListener('click', checkForUpdatesManually);
}

function openHelpModal() {
  const modal = document.getElementById('modal-help');
  if (modal) modal.style.display = 'flex';
}

function initAboutModal() {
  const modal = document.getElementById('modal-about');
  const btnAbout = document.getElementById('btn-about-orbital');
  const btnClose = document.getElementById('btn-close-about');
  const btnCheckUpdates = document.getElementById('btn-about-check-updates');
  const btnReportIssue = document.getElementById('btn-about-report-issue');

  const openAbout = async () => {
    try {
      const { resolveCurrentVersion } = await import('./components/updater.js');
      const v = await resolveCurrentVersion();
      const badge = modal?.querySelector('.about-version-badge');
      if (badge) badge.textContent = `Version ${v} • Desktop Release`;
      if (btnAbout) btnAbout.title = `Orbital X — v${v} (Click for About)`;
    } catch (_) {}
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

  btnCheckUpdates?.addEventListener('click', () => checkForUpdatesManually(true));

  btnReportIssue?.addEventListener('click', async () => {
    const issueUrl = 'https://daxp472.github.io/Orbital-X/report-issue.html';
    try {
      await invoke('open_url', { url: issueUrl });
    } catch (e) {
      window.open(issueUrl, '_blank');
    }
  });
}

// Show offline fallback modal for Report Issue
function showReportIssueOfflineModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-report-issue-offline';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="max-width: 460px; padding: 24px; text-align: center;">
      <div style="display: flex; align-items: center; gap: 12px; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 20px;">🌐</span>
        <h2 style="margin: 0; font-size: 16px;">Report Issue (Offline Mode)</h2>
        <button class="icon-btn" id="report-issue-close" style="margin-left: auto;">✕</button>
      </div>
      <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.6;">
        Could not open the Report Issue page. You appear to be offline.
      </div>
      <div style="font-size: 13px; color: var(--text-secondary); text-align: left; margin-bottom: 16px;">
        <strong>To report an issue:</strong>
        <ol style="font-size: 13px; margin: 8px 0 0 0; padding-left: 20px; text-align: left;">
          <li>Open your browser manually</li>
          <li>Go to: <a href="https://daxp472.github.io/Orbital-X/report-issue.html" target="_blank" rel="noopener" style="color: var(--accent-cyan); word-break: break-all;">https://daxp472.github.io/Orbital-X/report-issue.html</a></li>
          <li>Fill out the issue form and submit</li>
        </ol>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="btn btn-primary btn-sm" id="report-issue-copy-url">Copy URL</button>
        <button class="btn btn-secondary btn-sm" id="report-issue-close-modal">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#report-issue-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#report-issue-close-modal')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#report-issue-copy-url')?.addEventListener('click', () => {
    navigator.clipboard.writeText('https://daxp472.github.io/Orbital-X/report-issue.html');
    showToast('URL copied to clipboard', 'success', 2000);
    modal.remove();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ==========================================================================
// Prompt 4 — K2 activity center, M1 welcome/recents, M2 trust, M4 overview,
// N2 indexing + quick open, N4 resizer persistence, N5 zen, P1-P4
// ==========================================================================

// ---------------------------------------------------------------
// K2 — Professional Notification Center
// ---------------------------------------------------------------

let currentActivityFilter = 'all';

const NOTIF_CATEGORY_ICONS = {
  task: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
  milestone: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>',
  file: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
  error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
  system: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
};

function formatNotifTime(isoString) {
  if (!isoString) return '';
  const now = Date.now();
  const past = new Date(isoString).getTime();
  const diffSec = Math.floor((now - past) / 1000);
  if (diffSec < 30) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function initActivityCenter() {
  loadActivityHistory();

  const bell = document.getElementById('btn-activity-center');
  const panel = document.getElementById('activity-center');
  const backdrop = document.getElementById('activity-center-backdrop');
  const personaSelect = document.getElementById('activity-persona-select');

  if (personaSelect) {
    personaSelect.value = getNotificationPersona();
    personaSelect.addEventListener('change', (e) => {
      setNotificationPersona(e.target.value);
      renderActivityList(currentActivityFilter);
      showToast(`Notification feed density set: ${personaSelect.options[personaSelect.selectedIndex]?.text.split('(')[0].trim()}`, 'info', 2000);
    });
  }

  // Modern tabs
  const tabs = document.querySelectorAll('.notif-tabs .notif-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      currentActivityFilter = tab.dataset.filter || 'all';
      renderActivityList(currentActivityFilter);
    });
  });

  const close = () => {
    panel.style.display = 'none';
    backdrop.style.display = 'none';
  };

  bell?.addEventListener('click', () => {
    const open = panel.style.display === 'flex';
    if (open) { close(); return; }
    panel.style.display = 'flex';
    backdrop.style.display = 'block';
    if (personaSelect) personaSelect.value = getNotificationPersona();
    renderActivityList(currentActivityFilter);
  });

  backdrop?.addEventListener('click', close);
  document.getElementById('activity-close')?.addEventListener('click', close);

  document.getElementById('activity-mark-read')?.addEventListener('click', () => {
    markAllActivityRead();
    renderActivityList(currentActivityFilter);
    showToast('All notifications marked as read', 'info', 1800);
  });

  document.getElementById('activity-clear')?.addEventListener('click', () => {
    clearActivity();
    renderActivityList(currentActivityFilter);
    showToast('Notifications cleared', 'info', 1800);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.style.display === 'flex') close();
  });
}

function renderActivityList(filterType = 'all') {
  const list = document.getElementById('activity-list');
  if (!list) return;

  const notifs = getFilteredActivities(filterType);
  list.innerHTML = '';

  const persona = getNotificationPersona();
  const summaryText = document.getElementById('notif-summary-text');
  if (summaryText) {
    const personaLabel = persona === 'milestones'
      ? 'Curated feed (low noise)'
      : (persona === 'balanced' ? 'Balanced developer feed' : 'Complete developer log');
    summaryText.textContent = `${personaLabel} • ${notifs.length} item${notifs.length === 1 ? '' : 's'}`;
  }

  // Update tab counts
  updateUnreadBadge();

  if (notifs.length === 0) {
    list.innerHTML = `
      <div class="notif-empty-state">
        <svg class="notif-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <div class="notif-empty-title">No notifications</div>
        <div class="notif-empty-desc">You are all caught up. Task progress, milestone summaries, and file updates will appear here.</div>
      </div>
    `;
    return;
  }

  for (const n of notifs) {
    const card = document.createElement('div');
    card.className = `notif-card${!n.read ? ' unread' : ''}`;
    card.dataset.id = n.id;
    card.dataset.category = n.category || 'system';

    const category = n.category || (n.type === 'error' ? 'error' : 'system');
    const categoryIcon = NOTIF_CATEGORY_ICONS[category] || NOTIF_CATEGORY_ICONS.system;
    const timeFormatted = formatNotifTime(n.timestamp);

    const countBadge = n.count && n.count > 1
      ? `<span class="notif-repeat-badge">×${n.count}</span>`
      : '';

    const hasPath = !!n.meta?.path;
    const pathBase = hasPath ? escapeHtml(n.meta.path.split(/[/\\]/).pop()) : '';

    card.innerHTML = `
      <div class="notif-card-header">
        <div class="notif-card-tag-group">
          <span class="notif-card-icon">${categoryIcon}</span>
          <span class="notif-card-tag notif-tag-${category}">${escapeHtml(category)}</span>
          ${countBadge}
        </div>
        <div class="notif-card-meta-right">
          <span class="notif-card-time" title="${new Date(n.timestamp).toLocaleString()}">${timeFormatted}</span>
          <button class="notif-card-dismiss" data-id="${n.id}" title="Dismiss" aria-label="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="notif-card-body">${escapeHtml(n.message)}</div>
      ${hasPath ? `
        <div class="notif-card-footer">
          <span class="notif-card-action">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            Open ${pathBase}${n.meta.line ? `:${n.meta.line}` : ''}
          </span>
        </div>
      ` : ''}
    `;

    // Dismiss button click
    const dismissBtn = card.querySelector('.notif-card-dismiss');
    dismissBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissActivity(n.id);
      card.style.opacity = '0';
      card.style.transform = 'translateX(10px)';
      setTimeout(() => {
        card.remove();
        renderActivityList(currentActivityFilter);
      }, 140);
    });

    // Navigation on card click
    card.addEventListener('click', async () => {
      markActivityRead(n.id);
      card.classList.remove('unread');

      if (n.meta?.path) {
        try {
          const fileData = await invoke('read_file', { path: n.meta.path });
          const m = await import('./editor/monaco.js');
          m.openFileInTab(fileData);
          if (n.meta?.line) {
            const ed = m.getActiveEditor();
            if (ed) {
              ed.revealLineInCenter(n.meta.line);
              ed.setPosition({ lineNumber: n.meta.line, column: 1 });
            }
          }
          document.getElementById('activity-center-backdrop').style.display = 'none';
          document.getElementById('activity-center').style.display = 'none';
        } catch (e) {
          showToast(`Could not open file: ${e}`, 'error', 3000);
        }
      } else if (category === 'task' || category === 'milestone') {
        // Switch to Agent / Tasks view
        document.querySelector('[data-view="agent"]')?.click();
        document.getElementById('activity-center-backdrop').style.display = 'none';
        document.getElementById('activity-center').style.display = 'none';
      }
    });

    list.appendChild(card);
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
  const recents = getRecentWorkspaces();
  if (recents.length === 0) {
    openWelcomeScreen();
    return;
  }
  const last = recents[0];
  try {
    await enterWorkspace(last.path);
    showToast(`Restored workspace: ${last.name || last.path}`, 'success', 2200);
  } catch (e) {
    console.warn(`Workspace at "${last.path}" could not be restored automatically:`, e);
    // Prune missing/stale workspace from recent list to avoid repeating errors
    const filtered = recents.filter(r => r.path !== last.path);
    try { localStorage.setItem(RECENT_WS_KEY, JSON.stringify(filtered)); } catch (_) {}
    // Open the welcome screen smoothly without disruptive error alert
    openWelcomeScreen();
  }
}

function formatChatTimestamp(isoStr) {
  if (!isoStr) return 'Recently';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now - d;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (diffDays === 0) {
      if (diffHours < 1) return 'Just now';
      return `Today at ${timeStr}`;
    }
    if (diffDays === 1) {
      return `Yesterday at ${timeStr}`;
    }
    if (diffDays < 7) {
      return `${diffDays} days ago`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (_) {
    return 'Recently';
  }
}

export function openWelcomeScreen() {
  const modal = document.getElementById('modal-welcome');
  if (!modal) return;

  // 1. Populate Recent Workspaces
  const recents = getRecentWorkspaces();
  const host = document.getElementById('welcome-recents');
  if (host) {
    host.innerHTML = '';
    if (recents.length === 0) {
      host.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 8px 0;">No recent workspaces yet. Open a folder to get started.</div>';
    }
    for (const r of recents) {
      const row = document.createElement('button');
      row.className = 'btn btn-secondary btn-sm';
      row.style.cssText = 'justify-content: flex-start; text-align: left; display: flex; flex-direction: column; gap: 1px; padding: 6px 10px; border-radius: 6px;';
      row.innerHTML = `<strong style="font-size: 11.5px; color: var(--text-primary);">${escapeHtml(r.name || 'workspace')}</strong>
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

  // 2. Populate Continue Chat from Yesterday & Previous Sessions
  import('./components/chat-sessions.js').then(cs => {
    const sessions = typeof cs.getSessions === 'function' ? cs.getSessions() : [];
    const activeSession = typeof cs.getActiveSession === 'function' ? cs.getActiveSession() : null;
    const latest = sessions.length > 0 ? sessions[0] : activeSession;

    const continueCard = document.getElementById('welcome-continue-last-chat');
    const timeLabel = document.getElementById('welcome-last-chat-time');
    const titleLabel = document.getElementById('welcome-last-chat-title');
    const snippetLabel = document.getElementById('welcome-last-chat-snippet');
    const sessionsList = document.getElementById('welcome-chat-sessions-list');

    const activateChatAndClose = (sessionId) => {
      if (sessionId && typeof cs.switchSession === 'function') {
        cs.switchSession(sessionId);
      }
      modal.style.display = 'none';

      // Ensure Agent panel is visible
      const agentPanel = document.getElementById('agent-panel');
      const btnToggleAgent = document.getElementById('btn-toggle-agent');
      if (agentPanel) {
        agentPanel.classList.remove('hidden');
        btnToggleAgent?.classList.add('active');
      }
      // Focus chat composer
      const composerInput = document.getElementById('agent-composer-input');
      if (composerInput) {
        setTimeout(() => composerInput.focus(), 100);
      }
    };

    if (latest && continueCard) {
      continueCard.style.display = 'block';
      if (timeLabel) timeLabel.textContent = formatChatTimestamp(latest.updatedAt || latest.createdAt);
      if (titleLabel) titleLabel.textContent = latest.title || 'Previous Chat';

      // Find last user or assistant message snippet
      const msgs = latest.messages || [];
      const lastMsg = msgs.slice().reverse().find(m => !m._ephemeral && m.content);
      if (snippetLabel) {
        snippetLabel.textContent = lastMsg ? String(lastMsg.content).slice(0, 110) : 'Resume conversation where you left off.';
      }

      continueCard.onclick = () => {
        activateChatAndClose(latest.id);
        showToast(`Resumed: ${latest.title || 'Chat'}`, 'info', 2000);
      };
    } else if (continueCard) {
      continueCard.style.display = 'none';
    }

    if (sessionsList) {
      sessionsList.innerHTML = '';
      const displaySessions = sessions.slice(0, 6);
      if (displaySessions.length === 0) {
        sessionsList.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 8px 0;">No previous chats yet. Start a new session.</div>';
      }
      for (const s of displaySessions) {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease;';
        row.innerHTML = `
          <div style="min-width: 0; flex: 1; margin-right: 8px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.title || 'Chat')}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${formatChatTimestamp(s.updatedAt || s.createdAt)} · ${(s.messages || []).length} msgs</div>
          </div>
          <span style="font-size: 10px; color: var(--accent-cyan); font-weight: 500;">Resume ↗</span>
        `;
        row.addEventListener('mouseenter', () => {
          row.style.background = 'rgba(57,197,187,0.08)';
          row.style.borderColor = 'var(--accent-cyan)';
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = 'rgba(255,255,255,0.03)';
          row.style.borderColor = 'var(--border-subtle)';
        });
        row.addEventListener('click', () => {
          activateChatAndClose(s.id);
          showToast(`Resumed: ${s.title || 'Chat'}`, 'info', 2000);
        });
        sessionsList.appendChild(row);
      }
    }

    // Wire up New Chat, Import, Export buttons
    document.getElementById('welcome-btn-new-chat')?.addEventListener('click', () => {
      if (typeof cs.createNewSession === 'function') cs.createNewSession();
      activateChatAndClose(null);
    });

    document.getElementById('welcome-btn-import-chat')?.addEventListener('click', () => {
      if (typeof cs.importSessionFromMarkdown === 'function') cs.importSessionFromMarkdown();
    });

    document.getElementById('welcome-btn-export-chat')?.addEventListener('click', () => {
      if (typeof cs.exportActiveSessionMarkdown === 'function') cs.exportActiveSessionMarkdown();
    });
  }).catch(e => console.warn('Could not populate chat sessions on welcome screen:', e));

  modal.style.display = 'flex';

  // Modal close handlers
  document.getElementById('welcome-modal-close')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };

  // Action buttons
  document.getElementById('welcome-open-folder-btn')?.addEventListener('click', handleOpenFolder);
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

export function rememberWorkspaceTrust(rootPath, trusted = true) {
  if (!rootPath) return;
  try {
    const map = JSON.parse(localStorage.getItem(TRUST_KEY) || '{}');
    map[rootPath] = Boolean(trusted);
    localStorage.setItem(TRUST_KEY, JSON.stringify(map));
  } catch (e) { /* quota */ }
}

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
  // TODO(v2.3): Replace with custom glassmorphic modal
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
  window.__orbital_reindex_timer = setTimeout(() => {
    startWorkspaceIndexing();
    updateGraphStatusIndicator();
    updateDiagnosticsStatusIndicator();
  }, 3000);
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

  // P1: global error capture - saves to C drive (~/.orbital/crash.log) or custom directory
  const reportError = async (message, source) => {
    const detail = `${message}${source ? ` (${source})` : ''}`;
    console.error('[Orbital X Error]', detail);

    try {
      const customDir = localStorage.getItem('orbital_crash_log_dir') || null;
      const savedPath = await invoke('save_crash_report', { entry: detail, custom_dir: customDir });
      showToast('Crash log recorded to disk', 'error', 6000, [
        {
          label: 'Show in Explorer',
          onClick: () => {
            invoke('open_in_explorer', { path: savedPath }).catch(() => {});
          },
          primary: true
        },
        { label: 'Dismiss', onClick: () => {} }
      ]);
    } catch (e) {
      console.warn('Could not write crash log to disk:', e);
    }
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
    const steps = e.detail?.steps || 0;
    recordActivity(`🎯 Agent task run completed (${steps} steps finished)`, 'success', { category: 'milestone' });
    if (isWindowHidden()) {
      notifyNative('Orbital X', `✅ Agent task completed (${steps} steps)`);
    }
  });
}


// CURRENT_VERSION is imported from updater.js

// P3 — update check on application startup
function initUpdateCheck() {
  checkOnStartupOrWorkspace().catch(() => {});
}

// Show update available modal
function showUpdateModal(latest, downloadUrl, changelog) {
  // Remove existing modal if any
  document.getElementById('modal-update-available')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-update-available';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="max-width: 500px; padding: 24px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="font-size: 24px;">✨</div>
        <h2 style="margin: 0; font-size: 18px;">Update Available</h2>
        <button class="icon-btn" id="update-close" style="margin-left: auto;">✕</button>
      </div>
      <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.6;">
        Orbital X v${escapeHtml(latest)} is ready to install!
        ${changelog ? `<div style="margin-top: 8px; font-size: 13px; color: var(--text-primary);"><strong>Changelog:</strong><br><pre style="font-family: var(--font-mono); font-size: 11px; margin: 4px 0; overflow: hidden; max-height: 150px; overflow-y: auto; white-space: pre-wrap;">${escapeHtml(changelog.substring(0, 500))}${changelog.length > 500 ? '...' : ''}</pre></div>` : ''}
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="btn btn-secondary btn-sm" id="update-remind">Remind Later</button>
        <button class="btn btn-primary btn-sm" id="update-download-btn">Download & Install</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    try { localStorage.setItem('orbital_update_dismissed_at', String(Date.now())); } catch (e) { /* quota */ }
  };
  modal.querySelector('#update-close')?.addEventListener('click', close);
  modal.querySelector('#update-remind')?.addEventListener('click', close);
  modal.querySelector('#update-download-btn')?.addEventListener('click', async () => {
    await startDownloadAndInstall(latest, downloadUrl);
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// Download and install update
async function startDownloadAndInstall(latest, downloadUrl) {
  const progressModal = document.getElementById('modal-update-progress');
  if (progressModal) progressModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-update-progress';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="max-width: 400px; padding: 24px; text-align: center;">
      <h2 style="margin: 0 0 16px; font-size: 16px;">Downloading Update v${escapeHtml(latest)}</h2>
      <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px;">
        This version of the auto update is downloading...
      </div>
      <div style="width: 100%; background: var(--bg-surface); border-radius: var(--radius-sm); height: 6px; margin-bottom: 16px;">
        <div id="update-progress-bar" style="width: 0%; height: 100%; background: var(--accent-cyan); border-radius: var(--radius-sm); transition: width 0.3s;"></div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);" id="update-progress-text">Starting download...</div>
    </div>
  `;
  document.body.appendChild(modal);

  try {
    // Get the downloaded installer path
    const result = await invoke('download_update', {
      download_url: downloadUrl,
      progress_channel: '' // We'll use progress events
    });

    // Show restart modal
    modal.remove();
    const restartModal = document.createElement('div');
    restartModal.className = 'modal-backdrop';
    restartModal.id = 'modal-restart-to-update';
    restartModal.style.display = 'flex';
    restartModal.innerHTML = `
      <div class="modal-container" style="max-width: 420px; padding: 24px; text-align: center;">
        <h2 style="margin: 0 0 16px; font-size: 16px;">Update Downloaded</h2>
        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 20px;">
          The update is downloaded. You can restart the application to install the update.
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" id="restart-later-btn">Restart Later</button>
          <button class="btn btn-primary btn-sm" id="restart-now-btn">Restart Now</button>
        </div>
      </div>
    `;
    document.body.appendChild(restartModal);

    restartModal.querySelector('#restart-later-btn')?.addEventListener('click', () => {
      restartModal.remove();
      try { localStorage.setItem('orbital_update_dismissed_at', String(Date.now())); } catch (e) { /* quota */ }
    });
    restartModal.querySelector('#restart-now-btn')?.addEventListener('click', async () => {
      try {
        await invoke('install_update', { installer_path: result.installer_path });
      } catch (e) {
        console.error('Install update failed:', e);
        showToast('Failed to start update installation', 'error', 3000);
      }
      restartModal.remove();
    });
    restartModal.addEventListener('click', (e) => { if (e.target === restartModal) restartModal.remove(); });

  } catch (err) {
    console.error('Download failed:', err);
    modal.querySelector('#update-progress-text').textContent = `Download failed: ${err}`;
    modal.querySelector('#update-progress-bar').style.width = '0%';
  }
}

// checkForUpdatesManually is imported from updater.js

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
        <div><strong style="color: var(--text-primary);">v2.2.8</strong> — Automatic update checking with download prompt, Report Issue from the About dialog, public docs website, and continued polish across the editor, agent, and terminal panels.</div>
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
    try { localStorage.setItem('orbital_seen_version', '2.2.8'); } catch (e) { /* quota */ }
  };
  modal.querySelector('#whatsnew-close').addEventListener('click', close);
  modal.querySelector('#whatsnew-got').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// Accessible Modal Focus Trap (WCAG 2.1 / A11Y compliance)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const activeModal = document.querySelector('.modal-backdrop:not([style*="display: none"]):not([style*="display:none"]), .command-palette-backdrop');
  if (!activeModal) return;

  const focusable = Array.from(activeModal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first || !activeModal.contains(document.activeElement)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last || !activeModal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }
});
