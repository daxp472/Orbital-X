// ==========================================================================
// Orbital X — Native IDE Menubar Dropdown System (menubar.js)
// Replaces wide/stretched dropdowns with native-grade compact IDE menus
// (matching VS Code, Cursor, and Windsurf specifications).
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';
import { saveActiveFile, closeActiveTab, getActiveEditor, triggerFindWidget, triggerGotoLine, triggerGotoDefinition } from '../editor/monaco.js';
import { openDevToolsFromDropdown, showDebugConsole } from './developer-menu.js';

let activeMenuId = null;
let activeDropdownEl = null;
let isMenubarActive = false;

export function initMenubar() {
  const menuButtons = document.querySelectorAll('.titlebar-menus .menu-item');
  if (!menuButtons.length) return;

  // Bind click & hover across all menubar triggers
  menuButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuId = btn.id;
      if (activeMenuId === menuId) {
        closeMenubar();
      } else {
        openMenu(menuId, btn);
      }
    });

    btn.addEventListener('mouseenter', () => {
      if (isMenubarActive && activeMenuId !== btn.id) {
        openMenu(btn.id, btn);
      }
    });
  });

  // Global dismiss handlers
  document.addEventListener('click', (e) => {
    if (activeDropdownEl && !activeDropdownEl.contains(e.target)) {
      closeMenubar();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMenubarActive) {
      closeMenubar();
    }
  });

  window.addEventListener('blur', () => {
    closeMenubar();
  });
}

export function closeMenubar() {
  if (activeDropdownEl) {
    activeDropdownEl.remove();
    activeDropdownEl = null;
  }
  document.querySelectorAll('.titlebar-menus .menu-item').forEach(b => b.classList.remove('active'));
  activeMenuId = null;
  isMenubarActive = false;
}

function openMenu(menuId, triggerBtn) {
  closeMenubar();

  const items = getMenuItems(menuId);
  if (!items || !items.length) return;

  activeMenuId = menuId;
  isMenubarActive = true;
  triggerBtn.classList.add('active');

  const dropdown = document.createElement('div');
  dropdown.className = 'menubar-dropdown active';
  dropdown.id = `menubar-dropdown-${menuId}`;

  // Build items
  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menubar-dropdown-divider';
      dropdown.appendChild(sep);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `menubar-dropdown-item ${item.disabled ? 'disabled' : ''}`;
    
    const labelSpan = document.createElement('span');
    labelSpan.className = 'item-label';
    labelSpan.textContent = item.label;

    btn.appendChild(labelSpan);

    if (item.shortcut) {
      const scSpan = document.createElement('span');
      scSpan.className = 'item-shortcut';
      scSpan.textContent = item.shortcut;
      btn.appendChild(scSpan);
    }

    if (!item.disabled && typeof item.action === 'function') {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenubar();
        try {
          item.action();
        } catch (err) {
          console.error(`Menubar action error [${item.label}]:`, err);
        }
      });
    }

    dropdown.appendChild(btn);
  });

  document.body.appendChild(dropdown);
  activeDropdownEl = dropdown;

  // Calculate position just below the menubar button
  const rect = triggerBtn.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 2}px`;
  dropdown.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - 290))}px`;
}

function getMenuItems(menuId) {
  switch (menuId) {
    case 'menu-file':
      return [
        {
          label: 'New File',
          shortcut: 'Ctrl+N',
          action: () => {
            import('../editor/monaco.js').then(m => {
              const untitledCount = (state.editor.tabs || []).filter(t => t.path.startsWith('untitled:')).length + 1;
              m.openFileInTab({
                path: `untitled:Untitled-${untitledCount}`,
                name: `Untitled-${untitledCount}`,
                content: '',
                isDirty: false
              });
            });
          }
        },
        {
          label: 'Open Workspace Folder...',
          shortcut: 'Ctrl+O',
          action: () => {
            import('../app.js').then(m => m.handleOpenFolder());
          }
        },
        { type: 'separator' },
        {
          label: 'Save File',
          shortcut: 'Ctrl+S',
          action: () => saveActiveFile()
        },
        {
          label: 'Save As...',
          shortcut: 'Ctrl+Shift+S',
          action: async () => {
            const ed = getActiveEditor();
            if (!ed) return;
            const content = ed.getValue();
            const { showInputDialog } = await import('../services/dialogs.js');
            const targetPath = await showInputDialog('Save As', 'Enter workspace relative path:');
            if (targetPath) {
              await invoke('save_file', { path: targetPath, content, description: 'Save As' });
              showToast(`Saved to ${targetPath}`, 'success', 2500);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Close Editor Tab',
          shortcut: 'Ctrl+W',
          action: () => closeActiveTab()
        },
        {
          label: 'Open Settings / Preferences',
          shortcut: 'Ctrl+,',
          action: () => {
            import('./settings.js').then(m => m.openSettings());
          }
        },
        { type: 'separator' },
        {
          label: 'Exit Orbital X',
          shortcut: 'Alt+F4',
          action: async () => {
            try {
              if (window.__TAURI__?.window?.getCurrentWindow) {
                await window.__TAURI__.window.getCurrentWindow().close();
              }
            } catch (e) {
              window.close();
            }
          }
        }
      ];

    case 'menu-edit':
      return [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: () => getActiveEditor()?.trigger('menubar', 'undo')
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          action: () => getActiveEditor()?.trigger('menubar', 'redo')
        },
        { type: 'separator' },
        {
          label: 'Cut',
          shortcut: 'Ctrl+X',
          action: () => document.execCommand('cut')
        },
        {
          label: 'Copy',
          shortcut: 'Ctrl+C',
          action: () => document.execCommand('copy')
        },
        {
          label: 'Paste',
          shortcut: 'Ctrl+V',
          action: async () => {
            try {
              const text = await navigator.clipboard.readText();
              const ed = getActiveEditor();
              if (ed && text) {
                const selection = ed.getSelection();
                ed.executeEdits('menubar', [{ range: selection, text, forceMoveMarkers: true }]);
              }
            } catch (e) {
              document.execCommand('paste');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Find in File',
          shortcut: 'Ctrl+F',
          action: () => triggerFindWidget()
        },
        {
          label: 'Replace in File',
          shortcut: 'Ctrl+H',
          action: () => getActiveEditor()?.getAction('editor.action.startFindReplaceAction')?.run()
        },
        {
          label: 'Format Document',
          shortcut: 'Shift+Alt+F',
          action: () => {
            import('../editor/monaco.js').then(m => m.formatActiveDocument());
          }
        }
      ];

    case 'menu-selection':
      return [
        {
          label: 'Select All',
          shortcut: 'Ctrl+A',
          action: () => getActiveEditor()?.getAction('editor.action.selectAll')?.run()
        },
        {
          label: 'Expand Selection',
          shortcut: 'Shift+Alt+Right',
          action: () => getActiveEditor()?.getAction('editor.action.smartSelect.expand')?.run()
        },
        {
          label: 'Shrink Selection',
          shortcut: 'Shift+Alt+Left',
          action: () => getActiveEditor()?.getAction('editor.action.smartSelect.shrink')?.run()
        },
        { type: 'separator' },
        {
          label: 'Copy Line Up',
          shortcut: 'Shift+Alt+Up',
          action: () => getActiveEditor()?.getAction('editor.action.copyLinesUpAction')?.run()
        },
        {
          label: 'Copy Line Down',
          shortcut: 'Shift+Alt+Down',
          action: () => getActiveEditor()?.getAction('editor.action.copyLinesDownAction')?.run()
        },
        {
          label: 'Duplicate Selection',
          shortcut: 'Ctrl+D',
          action: () => getActiveEditor()?.getAction('editor.action.duplicateSelection')?.run()
        }
      ];

    case 'menu-view':
      return [
        {
          label: 'Command Palette...',
          shortcut: 'Ctrl+Shift+P',
          action: () => {
            import('./command-palette.js').then(m => m.openPalette());
          }
        },
        { type: 'separator' },
        {
          label: 'Show Explorer',
          shortcut: 'Ctrl+Shift+E',
          action: () => document.getElementById('rail-explorer')?.click()
        },
        {
          label: 'Show Search in Files',
          shortcut: 'Ctrl+Shift+F',
          action: () => document.getElementById('rail-search')?.click()
        },
        {
          label: 'Show Source Control (Git)',
          shortcut: 'Ctrl+Shift+G',
          action: () => document.getElementById('rail-source-control')?.click()
        },
        {
          label: 'Show Run & Debug',
          shortcut: 'Ctrl+Shift+D',
          action: () => document.getElementById('rail-debug')?.click()
        },
        {
          label: 'Show Extensions',
          shortcut: 'Ctrl+Shift+X',
          action: () => document.getElementById('rail-extensions')?.click()
        },
        { type: 'separator' },
        {
          label: 'Toggle Terminal',
          shortcut: 'Ctrl+`',
          action: () => {
            const bottom = document.getElementById('bottom-panel');
            const isCollapsed = bottom?.classList.contains('collapsed');
            if (isCollapsed) {
              bottom?.classList.remove('collapsed');
              document.querySelector('.panel-tab[data-tab="terminal"]')?.click();
              import('./terminal.js').then(m => m.focusActiveTerminalInput());
            } else {
              bottom?.classList.add('collapsed');
            }
          }
        },
        {
          label: 'Toggle Agent AI Chat',
          shortcut: 'Ctrl+Shift+A',
          action: () => document.getElementById('rail-agent')?.click()
        },
        {
          label: 'Toggle Split Editor',
          shortcut: 'Ctrl+\\',
          action: () => {
            import('../editor/monaco.js').then(m => m.toggleSplitEditor());
          }
        }
      ];

    case 'menu-go':
      return [
        {
          label: 'Go to File (Quick Open)...',
          shortcut: 'Ctrl+P',
          action: () => {
            // Trigger Ctrl+P Quick Open
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
          }
        },
        {
          label: 'Go to Symbol in File...',
          shortcut: 'Ctrl+Shift+O',
          action: () => getActiveEditor()?.getAction('editor.action.quickOutline')?.run()
        },
        {
          label: 'Go to Line...',
          shortcut: 'Ctrl+G',
          action: () => triggerGotoLine()
        },
        {
          label: 'Go to Definition',
          shortcut: 'F12',
          action: () => triggerGotoDefinition()
        }
      ];

    case 'menu-run':
      return [
        {
          label: 'Start Run & Debug',
          shortcut: 'F5',
          action: () => {
            document.getElementById('rail-debug')?.click();
            document.getElementById('btn-run-project')?.click();
          }
        },
        {
          label: 'Run Active File',
          shortcut: 'Ctrl+F5',
          action: () => {
            const activeTab = state.editor.tabs.find(t => t.id === state.editor.activeTabId);
            if (activeTab?.path) {
              showToast(`Running ${activeTab.name}...`, 'info', 2000);
              import('./terminal.js').then(m => {
                const cmd = activeTab.name.endsWith('.js') ? `node "${activeTab.path}"` :
                            activeTab.name.endsWith('.py') ? `python "${activeTab.path}"` :
                            `echo "Running ${activeTab.name}"`;
                m.createTerminalInstance(null, 'A').then(() => {
                  setTimeout(() => {
                    const session = m.getActiveSession();
                    if (session) m.executeTerminalCommand(session.id, cmd);
                  }, 400);
                });
              });
            } else {
              showToast('No active file to run', 'warning', 2500);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Stop Running Task',
          shortcut: 'Shift+F5',
          action: () => showToast('Run task stopped', 'info', 1800)
        }
      ];

    case 'menu-terminal':
      // Matches Screenshot 2 structure!
      return [
        {
          label: 'New Terminal',
          shortcut: 'Ctrl+Shift+`',
          action: () => {
            import('./terminal.js').then(m => m.createTerminalInstance());
          }
        },
        {
          label: 'Split Terminal',
          shortcut: 'Ctrl+Shift+5',
          action: () => {
            import('./terminal.js').then(m => m.toggleTerminalSplit());
          }
        },
        {
          label: 'New Terminal Window',
          shortcut: 'Ctrl+Shift+Alt+`',
          disabled: true
        },
        { type: 'separator' },
        {
          label: 'Run Task...',
          action: () => {
            document.getElementById('rail-debug')?.click();
          }
        },
        {
          label: 'Run Build Task...',
          shortcut: 'Ctrl+Shift+B',
          action: () => {
            import('./terminal.js').then(m => {
              showToast('Starting Build Task (npm run build)...', 'info', 2000);
              m.createTerminalInstance().then(() => {
                setTimeout(() => {
                  const s = m.getActiveSession();
                  if (s) m.executeTerminalCommand(s.id, 'npm run build');
                }, 350);
              });
            });
          }
        },
        {
          label: 'Run Active File',
          action: () => {
            const activeTab = state.editor.tabs.find(t => t.id === state.editor.activeTabId);
            if (activeTab?.path) {
              import('./terminal.js').then(m => {
                const cmd = activeTab.name.endsWith('.js') ? `node "${activeTab.path}"` :
                            activeTab.name.endsWith('.py') ? `python "${activeTab.path}"` :
                            `echo "${activeTab.name}"`;
                const s = m.getActiveSession();
                if (s) m.executeTerminalCommand(s.id, cmd);
                else m.createTerminalInstance().then(() => {
                  setTimeout(() => {
                    const sess = m.getActiveSession();
                    if (sess) m.executeTerminalCommand(sess.id, cmd);
                  }, 350);
                });
              });
            } else {
              showToast('Open a file first to run', 'info', 2000);
            }
          }
        },
        {
          label: 'Run Selected Text',
          action: () => {
            const ed = getActiveEditor();
            const selText = ed?.getModel()?.getValueInRange(ed.getSelection());
            if (selText) {
              import('./terminal.js').then(m => {
                const s = m.getActiveSession();
                if (s) m.executeTerminalCommand(s.id, selText);
                else showToast('Open terminal to run selection', 'info', 2000);
              });
            } else {
              showToast('Select code text first', 'info', 2000);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Show Running Tasks...',
          disabled: true
        },
        {
          label: 'Restart Running Task...',
          disabled: true
        },
        {
          label: 'Terminate Task...',
          disabled: true
        },
        { type: 'separator' },
        {
          label: 'Clear Terminal Output',
          action: () => {
            import('./terminal.js').then(m => {
              const s = m.getActiveSession();
              if (s) m.executeTerminalCommand(s.id, 'clear');
            });
          }
        }
      ];

    case 'menu-developer':
      // Sleek native IDE styling matching Screenshot 2 (not stretched like Screenshot 1)
      return [
        {
          label: 'Inspect / DevTools',
          shortcut: 'F12',
          action: () => openDevToolsFromDropdown()
        },
        {
          label: 'Debug Console',
          shortcut: 'Console',
          action: () => showDebugConsole()
        },
        {
          label: 'Reload Window',
          shortcut: 'Ctrl+R',
          action: () => window.location.reload()
        },
        { type: 'separator' },
        {
          label: 'Telemetry & VRAM Tracker HUD',
          shortcut: 'HUD',
          action: () => import('./telemetry-hud.js').then(m => m.openTelemetryHUD())
        },
        {
          label: 'Time-Travel Agent Journal',
          shortcut: 'Timeline',
          action: () => import('./time-travel.js').then(m => m.openTimeTravelModal())
        },
        { type: 'separator' },
        {
          label: `Verbose Agent Logs: ${state.agentDebugLogs ? 'ON' : 'OFF'}`,
          action: () => {
            state.agentDebugLogs = !state.agentDebugLogs;
            showToast(`Verbose Agent Logs ${state.agentDebugLogs ? 'ENABLED' : 'DISABLED'}`, 'info', 2000);
          }
        },
        {
          label: 'Copy System Diagnostic Info',
          action: async () => {
            const info = `Orbital X Diagnostic Info:
Version: 2.3.0
OS: ${navigator.userAgent}
Active Workspace: ${state.workspace.rootPath || 'None'}
Agent Mode: ${state.agentMode}
Provider: ${state.ai.provider}
Model: ${state.ai.model}
Date: ${new Date().toISOString()}`;
            try {
              await navigator.clipboard.writeText(info);
              showToast('Diagnostic info copied to clipboard', 'success', 2500);
            } catch (e) {
              showToast('Could not copy diagnostics', 'error', 2000);
            }
          }
        }
      ];

    case 'menu-help':
      return [
        {
          label: 'Getting Started Guide',
          action: () => {
            import('../onboarding/wizard.js').then(w => w.startOnboarding());
          }
        },
        {
          label: 'Documentation (Docs)',
          action: async () => {
            // Open documentation website hub
            try {
              await invoke('open_url', { url: 'https://daxp472.github.io/Orbital-X/docs.html' });
            } catch (e) {
              window.open('https://daxp472.github.io/Orbital-X/docs.html', '_blank');
            }
          }
        },
        {
          label: 'Report Issue...',
          action: async () => {
            // Direct launch into Chrome/external browser!
            try {
              await invoke('open_url', { url: 'https://daxp472.github.io/Orbital-X/report-issue.html' });
            } catch (e) {
              window.open('https://daxp472.github.io/Orbital-X/report-issue.html', '_blank');
            }
          }
        },
        {
          label: 'Check for Updates...',
          action: () => {
            import('./updater.js').then(m => m.checkForUpdatesManually(true));
          }
        },
        { type: 'separator' },
        {
          label: 'Keyboard Shortcuts Reference',
          shortcut: 'F1',
          action: () => {
            document.getElementById('modal-shortcuts-help')?.classList.remove('hidden');
          }
        },
        {
          label: 'Welcome Screen',
          action: () => {
            const modal = document.getElementById('modal-welcome');
            if (modal) modal.style.display = 'flex';
          }
        },
        {
          label: 'About Orbital X',
          action: () => {
            document.getElementById('btn-about-orbital')?.click();
          }
        }
      ];

    default:
      return [];
  }
}

