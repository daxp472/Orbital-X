// ============================================================================
// Orbital X - Unified Apple / Antigravity Glassmorphic Context Menu System
// Disables default browser contextmenu globally and serves sleek native menus
// ============================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from './notifications.js';

let activeMenu = null;
let outsideClickListener = null;
let keyListener = null;

export function dismissContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  if (outsideClickListener) {
    window.removeEventListener('pointerdown', outsideClickListener, true);
    outsideClickListener = null;
  }
  if (keyListener) {
    window.removeEventListener('keydown', keyListener, true);
    keyListener = null;
  }
}

export function showUnifiedContextMenu(items, x, y) {
  dismissContextMenu();
  if (!items || items.length === 0) return;

  const menu = document.createElement('div');
  menu.className = 'orbital-context-menu';
  menu.addEventListener('contextmenu', (e) => e.preventDefault());

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'orbital-context-menu-separator';
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement('div');
    row.className = `orbital-context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`;
    
    const left = document.createElement('div');
    left.className = 'orbital-context-menu-label';
    if (item.icon) {
      const ic = document.createElement('span');
      ic.className = 'orbital-context-menu-icon';
      ic.innerHTML = item.icon;
      left.appendChild(ic);
    }
    const text = document.createElement('span');
    text.textContent = item.label;
    left.appendChild(text);
    row.appendChild(left);

    if (item.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'orbital-context-menu-shortcut';
      sc.textContent = item.shortcut;
      row.appendChild(sc);
    }

    if (!item.disabled) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissContextMenu();
        if (typeof item.action === 'function') {
          item.action();
        }
      });
    }

    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  // Boundary adjustment to prevent overflowing window bounds
  const rect = menu.getBoundingClientRect();
  let finalX = x;
  let finalY = y;

  if (finalX + rect.width > window.innerWidth - 8) {
    finalX = window.innerWidth - rect.width - 8;
  }
  if (finalY + rect.height > window.innerHeight - 8) {
    finalY = window.innerHeight - rect.height - 8;
  }
  menu.style.left = `${Math.max(8, finalX)}px`;
  menu.style.top = `${Math.max(8, finalY)}px`;

  activeMenu = menu;

  outsideClickListener = (e) => {
    if (activeMenu && !activeMenu.contains(e.target)) {
      dismissContextMenu();
    }
  };
  keyListener = (e) => {
    if (e.key === 'Escape') {
      dismissContextMenu();
    }
  };

  setTimeout(() => {
    window.addEventListener('pointerdown', outsideClickListener, true);
    window.addEventListener('keydown', keyListener, true);
  }, 10);
}

// Global router determining context menu items based on right-click target
export function handleGlobalContextMenu(e) {
  const target = e.target;
  const x = e.clientX;
  const y = e.clientY;

  // 1. Check if inside Monaco Editor
  const monacoEditor = target.closest('.monaco-editor');
  if (monacoEditor) {
    handleEditorContextMenu(x, y);
    return;
  }

  // 2. Check if inside an Editor Tab
  const tabEl = target.closest('.tab') || target.closest('.editor-tab');
  if (tabEl) {
    handleTabContextMenu(tabEl, x, y);
    return;
  }

  // 3. Check if inside File Tree
  const treeNode = target.closest('.tree-node');
  const treeContainer = target.closest('#file-tree-container') || target.closest('#view-explorer');
  if (treeNode || treeContainer) {
    handleTreeContextMenu(treeNode, x, y);
    return;
  }

  // 4. Check if inside Terminal
  const termContainer = target.closest('#tab-content-terminal') || target.closest('#terminal-mount');
  if (termContainer) {
    handleTerminalContextMenu(x, y);
    return;
  }

  // 5. Check if inside Agent Timeline / Chat
  const agentTimeline = target.closest('#agent-timeline') || target.closest('#agent-panel');
  if (agentTimeline) {
    handleAgentContextMenu(x, y);
    return;
  }

  // 6. General IDE background / default context menu
  handleGeneralContextMenu(x, y);
}

// --- Specific Context Handlers ---

function handleEditorContextMenu(x, y) {
  const selText = window.getSelection()?.toString() || '';
  const items = [
    {
      label: 'Cut',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
      shortcut: 'Ctrl+X',
      action: () => document.execCommand('cut')
    },
    {
      label: 'Copy',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      shortcut: 'Ctrl+C',
      action: () => document.execCommand('copy')
    },
    {
      label: 'Paste',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
      shortcut: 'Ctrl+V',
      action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          document.execCommand('insertText', false, text);
        } catch (_) {}
      }
    },
    { separator: true },
    {
      label: 'Format Document',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>',
      shortcut: 'Alt+Shift+F',
      action: () => {
        import('../editor/monaco.js').then(m => m.formatCurrentDocument?.());
      }
    },
    {
      label: 'Explain Selection with Agent',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      disabled: !selText,
      action: () => {
        const input = document.getElementById('agent-input');
        if (input && selText) {
          input.value = `Explain this code snippet:\n\`\`\`\n${selText.slice(0, 500)}\n\`\`\``;
          input.focus();
        }
      }
    },
    {
      label: 'Fix / Refactor Selection',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
      disabled: !selText,
      action: () => {
        const input = document.getElementById('agent-input');
        if (input && selText) {
          input.value = `Review and refactor this code to improve clarity and performance:\n\`\`\`\n${selText.slice(0, 500)}\n\`\`\``;
          input.focus();
        }
      }
    }
  ];

  showUnifiedContextMenu(items, x, y);
}

function handleTabContextMenu(tabEl, x, y) {
  const tabPath = tabEl.dataset.path || tabEl.dataset.tabId;
  import('../editor/monaco.js').then(m => {
    const tabs = m.getPanelTabs?.(m.getActivePanel()) || [];
    const targetTab = tabs.find(t => t.path === tabPath || t.id === tabPath) || { path: tabPath, title: tabEl.textContent?.trim() };

    const items = [
      {
        label: 'Close',
        shortcut: 'Ctrl+W',
        action: () => m.closeTab?.(targetTab.id || targetTab.path)
      },
      {
        label: 'Close Others',
        action: () => m.closeOtherTabs?.(targetTab.id || targetTab.path)
      },
      {
        label: 'Close to the Right',
        action: () => m.closeTabsToRight?.(targetTab.id || targetTab.path)
      },
      {
        label: 'Close All',
        action: () => m.closeAllTabs?.()
      },
      { separator: true },
      {
        label: 'Copy Path',
        action: () => {
          if (targetTab.path) {
            navigator.clipboard.writeText(targetTab.path);
            showToast('Path copied to clipboard', 'info', 1800);
          }
        }
      },
      {
        label: 'Split Right',
        action: () => m.splitActiveTabRight?.(targetTab)
      }
    ];

    showUnifiedContextMenu(items, x, y);
  });
}

function handleTreeContextMenu(nodeEl, x, y) {
  const path = nodeEl?.dataset.path;
  const isDir = nodeEl?.dataset.isDir === 'true';

  const items = [];
  if (path) {
    items.push(
      {
        label: 'New File...',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const targetDir = isDir ? path : path.split('/').slice(0, -1).join('/');
          const filename = await showInputDialog('New File', 'e.g. index.js or utils/helper.ts');
          if (filename) {
            const fullRel = targetDir ? `${targetDir}/${filename}` : filename;
            await invoke('save_file', { path: fullRel, content: '', description: 'Created from context menu' });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      {
        label: 'New Folder...',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const targetDir = isDir ? path : path.split('/').slice(0, -1).join('/');
          const foldername = await showInputDialog('New Folder', 'e.g. components');
          if (foldername) {
            const fullRel = targetDir ? `${targetDir}/${foldername}` : foldername;
            await invoke('create_directory', { path: fullRel });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      { separator: true },
      {
        label: 'Rename...',
        shortcut: 'F2',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const oldName = path.split('/').pop();
          const newName = await showInputDialog('Rename', oldName);
          if (newName && newName !== oldName) {
            const parent = path.split('/').slice(0, -1).join('/');
            const newPath = parent ? `${parent}/${newName}` : newName;
            await invoke('execute_tool', { name: 'rename_file', arguments: { from: path, to: newPath }, mode: state.agentMode });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      {
        label: 'Delete',
        danger: true,
        shortcut: 'Del',
        action: async () => {
          const { showConfirmDialog } = await import('./dialogs.js');
          const ok = await showConfirmDialog('Delete File', `Are you sure you want to delete '${path}'?`);
          if (ok) {
            const tool = isDir ? 'delete_directory' : 'delete_file';
            await invoke('execute_tool', { name: tool, arguments: { path }, mode: state.agentMode });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      { separator: true },
      {
        label: 'Copy Path',
        action: () => {
          navigator.clipboard.writeText(path);
          showToast('Copied path', 'info', 1600);
        }
      },
      {
        label: 'Copy Relative Path',
        action: () => {
          navigator.clipboard.writeText(path);
          showToast('Copied relative path', 'info', 1600);
        }
      },
      {
        label: 'Tag in Agent Chat (@)',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
        action: () => {
          const input = document.getElementById('agent-input');
          if (input) {
            input.value = `@${path} ` + input.value;
            input.focus();
          }
        }
      }
    );
  } else {
    items.push(
      {
        label: 'New File...',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const filename = await showInputDialog('New File', 'e.g. index.js');
          if (filename) {
            await invoke('save_file', { path: filename, content: '', description: 'Created via context menu' });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      {
        label: 'New Folder...',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const foldername = await showInputDialog('New Folder', 'e.g. src');
          if (foldername) {
            await invoke('create_directory', { path: foldername });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      {
        label: 'Refresh Explorer',
        action: () => {
          import('../components/file-tree.js').then(f => f.refreshFileTree());
        }
      }
    );
  }

  showUnifiedContextMenu(items, x, y);
}

function handleTerminalContextMenu(x, y) {
  const items = [
    {
      label: 'Copy',
      shortcut: 'Ctrl+Shift+C',
      action: () => document.execCommand('copy')
    },
    {
      label: 'Paste',
      shortcut: 'Ctrl+Shift+V',
      action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          import('../components/terminal.js').then(t => t.sendTerminalInput(text));
        } catch (_) {}
      }
    },
    { separator: true },
    {
      label: 'Clear Terminal',
      shortcut: 'Ctrl+L',
      action: () => {
        import('../components/terminal.js').then(t => t.clearActiveTerminal?.());
      }
    },
    {
      label: 'New Terminal',
      shortcut: 'Ctrl+Shift+`',
      action: () => {
        document.getElementById('btn-new-terminal')?.click();
      }
    },
    {
      label: 'Split Terminal',
      action: () => {
        document.getElementById('btn-split-terminal')?.click();
      }
    }
  ];

  showUnifiedContextMenu(items, x, y);
}

function handleAgentContextMenu(x, y) {
  const items = [
    {
      label: 'Clear Conversation Context',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      action: () => {
        document.getElementById('popover-btn-clear')?.click();
      }
    },
    {
      label: 'Compact Context Window',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/></svg>',
      action: () => {
        document.getElementById('popover-btn-compact')?.click();
      }
    },
    { separator: true },
    {
      label: 'Export Chat as Markdown',
      icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      action: () => {
        import('../components/agent.js').then(a => a.exportChatToMarkdown?.());
      }
    }
  ];

  showUnifiedContextMenu(items, x, y);
}

function handleGeneralContextMenu(x, y) {
  const items = [
    {
      label: 'Command Palette...',
      shortcut: 'Ctrl+Shift+P',
      action: () => {
        import('../components/command-palette.js').then(c => c.showCommandPalette?.());
      }
    },
    { separator: true },
    {
      label: 'Toggle Terminal',
      shortcut: 'Ctrl+`',
      action: () => {
        document.getElementById('btn-collapse-panel')?.click();
      }
    },
    {
      label: 'Focus AI Agent',
      shortcut: 'Ctrl+L',
      action: () => {
        document.getElementById('agent-input')?.focus();
      }
    },
    { separator: true },
    {
      label: 'Open Folder...',
      shortcut: 'Ctrl+O',
      action: () => {
        document.getElementById('btn-open-folder-inline')?.click() || document.getElementById('btn-open-folder')?.click();
      }
    },
    {
      label: 'Reload IDE Window',
      shortcut: 'Ctrl+R',
      action: () => window.location.reload()
    }
  ];

  showUnifiedContextMenu(items, x, y);
}

// Global initialization: bind window-wide right-click interceptor
export function initUnifiedContextMenu() {
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handleGlobalContextMenu(e);
  }, true);
}
