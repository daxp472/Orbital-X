// ============================================================================
// Orbital X - Unified Apple / Antigravity Glassmorphic Context Menu System
// Disables default browser contextmenu globally and serves sleek native menus
// ============================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from './notifications.js';
import { getExplorerClipboard, cutEntry, copyEntry, pasteEntry } from '../components/file-tree.js';

let activeMenu = null;
let outsideClickListener = null;
let keyListener = null;

export function dismissContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  document.querySelectorAll('.orbital-context-menu, .tree-context-menu, #file-tree-context-menu').forEach(el => el.remove());
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
    const ic = document.createElement('span');
    ic.className = 'orbital-context-menu-icon';
    if (item.icon) {
      ic.innerHTML = item.icon;
    }
    left.appendChild(ic);
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
  const treeContainer = target.closest('#file-tree-container') || target.closest('#view-explorer') || target.closest('#sidebar-root-header') || target.closest('#sidebar');
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

export function handleTabContextMenu(tabEl, x, y) {
  const tabPath = tabEl.dataset.path || tabEl.dataset.tabId;
  import('../editor/monaco.js').then(m => {
    const tabs = m.getPanelTabs?.(m.getActivePanel()) || [];
    const targetTab = tabs.find(t => t.path === tabPath || t.id === tabPath) || { path: tabPath, title: tabEl.textContent?.trim() };

    const items = [
      {
        label: 'Close',
        shortcut: 'Ctrl+W',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
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
        label: targetTab.isPinned ? 'Unpin Tab' : 'Pin Tab',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z"/></svg>',
        action: () => {
          targetTab.isPinned = !targetTab.isPinned;
          m.renderTabs?.();
        }
      },
      {
        label: 'Split Right',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',
        action: () => m.splitActiveTabRight?.(targetTab)
      },
      { separator: true },
      {
        label: 'Reveal in File Explorer',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        action: async () => {
          if (targetTab.path) {
            try {
              await invoke('open_in_explorer', { path: targetTab.path });
            } catch (_) {}
            import('../components/file-tree.js').then(f => f.revealPathInTree?.(targetTab.path));
          }
        }
      },
      {
        label: 'Copy Relative Path',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        action: () => {
          if (targetTab.path) {
            navigator.clipboard.writeText(targetTab.path);
            showToast('Copied relative path: ' + targetTab.path, 'info', 1600);
          }
        }
      },
      {
        label: 'Copy Full Path',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        action: () => {
          if (targetTab.path) {
            const root = state.workspace.rootPath || '';
            const full = root ? (root.replace(/\\/g, '/') + '/' + targetTab.path.replace(/^\/+/, '')) : targetTab.path;
            navigator.clipboard.writeText(full);
            showToast('Copied full path', 'info', 1600);
          }
        }
      }
    ];

    showUnifiedContextMenu(items, x, y);
  });
}

function handleTreeContextMenu(nodeEl, x, y) {
  const path = nodeEl?.dataset.path;
  const isDir = nodeEl?.dataset.isDir === 'true';

  if (nodeEl) {
    document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
    nodeEl.classList.add('selected');
  }

  const items = [];
  if (path) {
    if (!isDir) {
      // -------------------------------------------------------------
      // FILE CONTEXT MENU
      // -------------------------------------------------------------
      const filename = path.split('/').pop() || path;
      const parentDir = path.split('/').slice(0, -1).join('/');

      items.push(
        {
          label: 'Open',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
          shortcut: 'Enter',
          action: async () => {
            try {
              const fileData = await invoke('read_file', { path });
              if (fileData.is_binary) {
                showToast('Cannot view binary files in code editor', 'warning');
                return;
              }
              const { openFileInTab } = await import('../editor/monaco.js');
              openFileInTab(fileData);
            } catch (err) {
              showToast('Error opening file: ' + err, 'error');
            }
          }
        },
        {
          label: 'Open to the Side',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',
          action: async () => {
            try {
              const fileData = await invoke('read_file', { path });
              if (fileData.is_binary) return;
              const monaco = await import('../editor/monaco.js');
              monaco.openFileInTab(fileData);
              monaco.splitActiveTabRight?.(fileData);
            } catch (err) {
              showToast('Error opening to side: ' + err, 'error');
            }
          }
        },
        { separator: true },
        {
          label: 'Cut',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
          shortcut: 'Ctrl+X',
          action: () => cutEntry(path, false)
        },
        {
          label: 'Copy',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
          shortcut: 'Ctrl+C',
          action: () => copyEntry(path, false)
        },
        {
          label: 'Paste',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
          shortcut: 'Ctrl+V',
          disabled: !getExplorerClipboard(),
          action: () => pasteEntry(parentDir)
        },
        { separator: true },
        {
          label: 'Rename...',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
          shortcut: 'F2',
          action: async () => {
            const { showInputDialog } = await import('./dialogs.js');
            const newName = await showInputDialog('Rename File', filename);
            if (newName && newName.trim() && newName.trim() !== filename) {
              const newPath = parentDir ? parentDir + '/' + newName.trim() : newName.trim();
              await invoke('execute_tool', { name: 'rename_file', arguments: { from: path, to: newPath }, mode: state.agentMode });
              import('../components/file-tree.js').then(f => f.refreshFileTree());
            }
          }
        },
        {
          label: 'Delete',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          danger: true,
          shortcut: 'Del',
          action: async () => {
            const { showConfirmDialog } = await import('./dialogs.js');
            const ok = await showConfirmDialog('Delete File', 'Are you sure you want to delete ' + filename + '?');
            if (ok) {
              await invoke('execute_tool', { name: 'delete_file', arguments: { path }, mode: state.agentMode });
              import('../components/file-tree.js').then(f => f.refreshFileTree());
            }
          }
        },
        { separator: true },
        {
          label: 'New File...',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
          action: async () => {
            const { showInputDialog } = await import('./dialogs.js');
            const name = await showInputDialog('New File', 'e.g. index.js');
            if (name && name.trim()) {
              const fullRel = parentDir ? parentDir + '/' + name.trim() : name.trim();
              await invoke('save_file', { path: fullRel, content: '', description: 'Created from context menu' });
              const f = await import('../components/file-tree.js');
              await f.refreshFileTree();
              const fileData = await invoke('read_file', { path: fullRel });
              const { openFileInTab } = await import('../editor/monaco.js');
              openFileInTab(fileData);
            }
          }
        },
        {
          label: 'New Folder...',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
          action: async () => {
            const { showInputDialog } = await import('./dialogs.js');
            const name = await showInputDialog('New Folder', 'e.g. components');
            if (name && name.trim()) {
              const fullRel = parentDir ? parentDir + '/' + name.trim() : name.trim();
              await invoke('create_directory', { path: fullRel });
              import('../components/file-tree.js').then(f => f.refreshFileTree());
            }
          }
        },
        { separator: true },
        {
          label: 'Reveal in File Explorer',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
          action: async () => {
            try {
              await invoke('open_in_explorer', { path });
            } catch (err) {
              console.warn('Could not reveal in explorer:', err);
            }
          }
        },
        {
          label: 'Copy Relative Path',
          shortcut: 'Shift+Alt+C',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
          action: () => {
            navigator.clipboard.writeText(path);
            showToast('Copied relative path: ' + path, 'info', 1600);
          }
        },
        {
          label: 'Copy Path',
          shortcut: 'Shift+Alt+P',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
          action: () => {
            const root = state.workspace.rootPath || '';
            const full = root ? (root.replace(/\\/g, '/') + '/' + path.replace(/^\/+/, '')) : path;
            navigator.clipboard.writeText(full);
            showToast('Copied path', 'info', 1600);
          }
        },
        {
          label: 'Tag in Agent Chat (@)',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
          action: () => {
            const input = document.getElementById('agent-input');
            if (input) {
              input.value = '@' + path + ' ' + input.value;
              input.focus();
            }
          }
        }
      );
    } else {
      // -------------------------------------------------------------
      // FOLDER CONTEXT MENU
      // -------------------------------------------------------------
      const folderName = path.split('/').pop() || path;
      const parentDir = path.split('/').slice(0, -1).join('/');

      items.push(
        {
          label: 'New File...',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
          action: async () => {
            const { showInputDialog } = await import('./dialogs.js');
            const name = await showInputDialog('New File', 'e.g. script.js');
            if (name && name.trim()) {
              const fullRel = path + '/' + name.trim();
              await invoke('save_file', { path: fullRel, content: '', description: 'Created from context menu' });
              const f = await import('../components/file-tree.js');
              await f.refreshFileTree();
              const fileData = await invoke('read_file', { path: fullRel });
              const { openFileInTab } = await import('../editor/monaco.js');
              openFileInTab(fileData);
            }
          }
        },
        {
          label: 'New Folder...',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
          action: async () => {
            const { showInputDialog } = await import('./dialogs.js');
            const name = await showInputDialog('New Folder', 'e.g. subfolder');
            if (name && name.trim()) {
              const fullRel = path + '/' + name.trim();
              await invoke('create_directory', { path: fullRel });
              import('../components/file-tree.js').then(f => f.refreshFileTree());
            }
          }
        },
        { separator: true },
        {
          label: 'Cut',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
          shortcut: 'Ctrl+X',
          action: () => cutEntry(path, true)
        },
        {
          label: 'Copy',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
          shortcut: 'Ctrl+C',
          action: () => copyEntry(path, true)
        },
        {
          label: 'Paste',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
          shortcut: 'Ctrl+V',
          disabled: !getExplorerClipboard(),
          action: () => pasteEntry(path)
        },
        { separator: true },
        {
          label: 'Rename...',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
          shortcut: 'F2',
          action: async () => {
            const { showInputDialog } = await import('./dialogs.js');
            const newName = await showInputDialog('Rename Folder', folderName);
            if (newName && newName.trim() && newName.trim() !== folderName) {
              const newPath = parentDir ? parentDir + '/' + newName.trim() : newName.trim();
              await invoke('execute_tool', { name: 'rename_file', arguments: { from: path, to: newPath }, mode: state.agentMode });
              import('../components/file-tree.js').then(f => f.refreshFileTree());
            }
          }
        },
        {
          label: 'Delete',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          danger: true,
          shortcut: 'Del',
          action: async () => {
            const { showConfirmDialog } = await import('./dialogs.js');
            const ok = await showConfirmDialog('Delete Folder', 'Are you sure you want to delete folder ' + folderName + ' and all its contents?');
            if (ok) {
              await invoke('execute_tool', { name: 'delete_directory', arguments: { path }, mode: state.agentMode });
              import('../components/file-tree.js').then(f => f.refreshFileTree());
            }
          }
        },
        { separator: true },
        {
          label: 'Reveal in File Explorer',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
          action: async () => {
            try {
              await invoke('open_in_explorer', { path });
            } catch (err) {
              console.warn('Could not reveal in explorer:', err);
            }
          }
        },
        {
          label: 'Copy Relative Path',
          shortcut: 'Shift+Alt+C',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
          action: () => {
            navigator.clipboard.writeText(path);
            showToast('Copied relative path: ' + path, 'info', 1600);
          }
        },
        {
          label: 'Copy Path',
          shortcut: 'Shift+Alt+P',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
          action: () => {
            const root = state.workspace.rootPath || '';
            const full = root ? (root.replace(/\\/g, '/') + '/' + path.replace(/^\/+/, '')) : path;
            navigator.clipboard.writeText(full);
            showToast('Copied path', 'info', 1600);
          }
        },
        {
          label: 'Tag in Agent Chat (@)',
          icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
          action: () => {
            const input = document.getElementById('agent-input');
            if (input) {
              input.value = '@' + path + ' ' + input.value;
              input.focus();
            }
          }
        }
      );
    }
  } else {
    // -------------------------------------------------------------
    // EMPTY SPACE / WORKSPACE ROOT CONTAINER CONTEXT MENU
    // -------------------------------------------------------------
    items.push(
      {
        label: 'New File...',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const filename = await showInputDialog('New File', 'e.g. index.js or src/main.py');
          if (filename && filename.trim()) {
            const cleanPath = filename.trim();
            await invoke('save_file', { path: cleanPath, content: '', description: 'Created via explorer' });
            const f = await import('../components/file-tree.js');
            await f.refreshFileTree();
            const fileData = await invoke('read_file', { path: cleanPath });
            const { openFileInTab } = await import('../editor/monaco.js');
            openFileInTab(fileData);
          }
        }
      },
      {
        label: 'New Folder...',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
        action: async () => {
          const { showInputDialog } = await import('./dialogs.js');
          const foldername = await showInputDialog('New Folder', 'e.g. src or assets');
          if (foldername && foldername.trim()) {
            await invoke('create_directory', { path: foldername.trim() });
            import('../components/file-tree.js').then(f => f.refreshFileTree());
          }
        }
      },
      { separator: true },
      {
        label: 'Paste',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
        shortcut: 'Ctrl+V',
        disabled: !getExplorerClipboard(),
        action: () => pasteEntry('')
      },
      { separator: true },
      {
        label: 'Refresh Explorer',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
        action: () => {
          import('../components/file-tree.js').then(f => f.refreshFileTree());
        }
      },
      {
        label: 'Reveal in File Explorer',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        action: async () => {
          try {
            await invoke('open_in_explorer', { path: '' });
          } catch (err) {
            console.warn('Could not reveal workspace root:', err);
          }
        }
      },
      {
        label: 'Collapse All Folders',
        icon: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/></svg>',
        action: () => {
          document.getElementById('btn-collapse-folders')?.click();
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
