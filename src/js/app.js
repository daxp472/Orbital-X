// ==========================================================================
// Orbital X — Main Application Coordinator (app.js)
// ==========================================================================

import { state, loadPersistedState, persistState } from './state/store.js';
import { initMonaco, saveActiveFile } from './editor/monaco.js';
import { loadWorkspace, refreshFileTree } from './components/file-tree.js';
import { initAgent, switchMode } from './components/agent.js';
import { initTerminal } from './components/terminal.js';
import { initMemory, refreshMemories } from './components/memory.js';
import { initSettings, cycleTheme, applyTheme } from './components/settings.js';
import { initOnboarding } from './onboarding/wizard.js';
import { pickFolder, invoke } from './services/tauri.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log("Orbital X Desktop IDE initializing...");

  // 1. Load state
  loadPersistedState();
  applyTheme(state.theme);
  switchMode(state.agentMode);

  // 2. Initialize Monaco Editor in container
  const monacoContainer = document.getElementById('monaco-container');
  if (monacoContainer) {
    initMonaco(monacoContainer);
  }

  // 3. Initialize UI Subsystems
  initAgent();
  initTerminal();
  initMemory();
  initSettings();
  initOnboarding();
  initActivityRail();
  initResizers();
  initGlobalShortcuts();

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

  document.getElementById('btn-new-chat')?.addEventListener('click', () => {
    document.getElementById('btn-clear-chat')?.click();
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

  // Quick Open Folder handler
  const handleOpenFolder = async () => {
    const selected = await pickFolder();
    if (selected) {
      await loadWorkspace(selected);
      refreshMemories();
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

  document.getElementById('rail-settings')?.addEventListener('click', () => {
    document.getElementById('btn-open-settings')?.click();
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
