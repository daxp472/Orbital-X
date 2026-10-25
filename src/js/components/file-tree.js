// ==========================================================================
// Orbital X — File Tree Component (file-tree.js)
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openFileInTab } from '../editor/monaco.js';
import { showToast } from '../services/notifications.js';

export function getFileIcon(filename, isDir, isExpanded) {
  if (isDir) {
    return isExpanded ? '📂' : '📁';
  }

  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return '🟨';
    case 'ts':
    case 'tsx':
      return '🔷';
    case 'rs':
      return '🟠';
    case 'py':
      return '🐍';
    case 'html':
    case 'htm':
      return '🌐';
    case 'css':
    case 'scss':
    case 'less':
      return '🎨';
    case 'json':
      return '📋';
    case 'md':
    case 'markdown':
      return '📝';
    case 'toml': return '⚙️';
    case 'lock': return '🔒';
    case 'gitignore': return '👁️';
    default: return '📄';
  }
}

export async function loadWorkspace(rootPath) {
  try {
    const meta = await invoke('set_workspace', { path: rootPath });
    state.workspace.rootPath = meta.root_path;
    state.workspace.name = meta.name;

    // Update UI headers
    const headerTitle = document.getElementById('header-workspace-name');
    if (headerTitle) headerTitle.textContent = meta.name;

    const sbWorkspace = document.getElementById('sb-workspace-text');
    if (sbWorkspace) sbWorkspace.textContent = meta.name;

    await refreshFileTree();
  } catch (e) {
    alert("Could not open workspace: " + e);
  }
}

export async function refreshFileTree() {
  const container = document.getElementById('file-tree-container');
  if (!container || !state.workspace.rootPath) return;

  try {
    const tree = await invoke('get_file_tree', { max_depth: 4 });
    state.workspace.files = tree;
    renderTree(tree, container);
  } catch (e) {
    container.innerHTML = `<div style="padding: 12px; color: var(--accent-red); font-size: 12px;">Error loading tree: ${e}</div>`;
  }
}

function renderTree(treeNode, container) {
  container.innerHTML = '';
  if (!treeNode || !treeNode.children) {
    container.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 12px;">Empty folder</div>';
    return;
  }

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';

  treeNode.children.forEach(child => {
    buildNodeElement(child, list, 0);
  });

  container.appendChild(list);
}

function buildNodeElement(node, parentElem, indentLevel) {
  const nodeRow = document.createElement('div');
  nodeRow.className = 'tree-node';
  nodeRow.style.paddingLeft = `${indentLevel * 14 + 10}px`;

  let isExpanded = false;

  const arrow = document.createElement('span');
  arrow.className = `tree-arrow ${node.is_directory ? '' : 'leaf'}`;
  arrow.textContent = node.is_directory ? '▶' : '';
  nodeRow.appendChild(arrow);

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = getFileIcon(node.name, node.is_directory, isExpanded);
  nodeRow.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = node.name;
  label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis';
  label.style.whiteSpace = 'nowrap';
  nodeRow.appendChild(label);

  parentElem.appendChild(nodeRow);

  // Subtree container for directories
  let childContainer = null;
  if (node.is_directory && node.children && node.children.length > 0) {
    childContainer = document.createElement('div');
    childContainer.style.display = 'none';
    node.children.forEach(c => buildNodeElement(c, childContainer, indentLevel + 1));
    parentElem.appendChild(childContainer);
  }

  nodeRow.dataset.path = node.path;

  // A5: single click = preview tab; double click = permanent tab
  let clickTimer = null;
  nodeRow.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Toggle active row styling
    document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
    nodeRow.classList.add('selected');

    if (node.is_directory) {
      if (childContainer) {
        isExpanded = !isExpanded;
        childContainer.style.display = isExpanded ? 'block' : 'none';
        arrow.classList.toggle('expanded', isExpanded);
        icon.textContent = getFileIcon(node.name, true, isExpanded);
      }
      return;
    }

    // File click — wait to disambiguate single vs double click
    clearTimeout(clickTimer);
    clickTimer = setTimeout(async () => {
      try {
        const fileData = await invoke('read_file', { path: node.path });
        if (fileData.is_binary) {
          showToast("Cannot view binary files in the code editor.", "warning");
          return;
        }
        openFileInTab(fileData, { preview: true });
      } catch (err) {
        console.error("Error opening file:", err);
        showToast("Error opening file: " + err, "error");
      }
    }, 200);
  });

  nodeRow.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (node.is_directory) return;
    clearTimeout(clickTimer);
    // Double click opens (or promotes) the tab as permanent
    import('../editor/monaco.js').then(async (m) => {
      // If a preview tab for this path exists, promote it
      const existing = (m.getPanelTabs?.(m.getActivePanel()) || []).find(t => t.path === node.path);
      if (existing && existing.isPreview) {
        existing.isPreview = false;
        m.renderTabs();
      }
      try {
        const fileData = await invoke('read_file', { path: node.path });
        if (!fileData.is_binary) m.openFileInTab(fileData);
      } catch (err) { console.warn(err); }
    });
  });

  // Right-click context menu
  nodeRow.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
    nodeRow.classList.add('selected');

    showFileTreeContextMenu(e.clientX, e.clientY, node);
  });
}

export function initFileTreeHeaderActions() {
  // 1. New File Action
  document.getElementById('btn-new-file')?.addEventListener('click', async () => {
    if (!state.workspace.rootPath) {
      alert("Please open a workspace folder first to create files.");
      return;
    }
    const relPath = prompt("Enter file name or relative path (e.g. script.js or src/module.py):");
    if (!relPath || !relPath.trim()) return;

    try {
      await invoke('save_file', {
        path: relPath.trim(),
        content: '',
        description: 'Created via Explorer New File'
      });
      await refreshFileTree();
      const fileData = await invoke('read_file', { path: relPath.trim() });
      openFileInTab(fileData);
    } catch (e) {
      alert("Failed to create file: " + e);
    }
  });

  // 2. New Folder Action
  document.getElementById('btn-new-folder')?.addEventListener('click', async () => {
    if (!state.workspace.rootPath) {
      alert("Please open a workspace folder first to create folders.");
      return;
    }
    const folderPath = prompt("Enter new folder path (e.g. assets or components/ui):");
    if (!folderPath || !folderPath.trim()) return;

    try {
      await invoke('create_directory', { path: folderPath.trim() });
      await refreshFileTree();
    } catch (e) {
      alert("Failed to create folder: " + e);
    }
  });

  // 3. Refresh Action
  document.getElementById('btn-refresh-files')?.addEventListener('click', () => {
    refreshFileTree();
  });

  // 4. Collapse All Folders Action
  document.getElementById('btn-collapse-folders')?.addEventListener('click', () => {
    const container = document.getElementById('file-tree-container');
    if (!container) return;
    container.querySelectorAll('div > div[style*="display: block"]').forEach(el => el.style.display = 'none');
    container.querySelectorAll('.tree-arrow.expanded').forEach(el => el.classList.remove('expanded'));
  });
}

// ==========================================================================
// Right-Click Context Menu Implementation
// ==========================================================================

let activeContextMenu = null;

export function dismissFileTreeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showFileTreeContextMenu(x, y, node) {
  dismissFileTreeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tree-context-menu';
  menu.id = 'file-tree-context-menu';

  // Prevent browser context menu on our custom menu
  menu.addEventListener('contextmenu', (e) => e.preventDefault());

  const items = [
    {
      label: 'Open',
      icon: '📄',
      action: async () => {
        if (!node.is_directory) {
          try {
            const fileData = await invoke('read_file', { path: node.path });
            if (fileData.is_binary) {
              alert("Cannot view binary files in the code editor.");
              return;
            }
            openFileInTab(fileData);
          } catch (e) {
            alert("Error opening file: " + e);
          }
        }
      }
    },
    {
      label: 'Copy Path',
      icon: '📋',
      action: () => {
        navigator.clipboard.writeText(node.path);
      }
    },
    {
      label: 'Reveal in Explorer',
      icon: '📂',
      action: async () => {
        try {
          await invoke('run_command', { command: `explorer /select,"${node.path}"` });
        } catch (e) {
          console.warn("Could not reveal in explorer:", e);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Rename...',
      icon: '✏️',
      action: async () => {
        const newName = prompt(`Rename "${node.name}" to:`, node.name);
        if (!newName || !newName.trim() || newName.trim() === node.name) return;
        const trimmed = newName.trim();
        const lastSlash = Math.max(node.path.lastIndexOf('/'), node.path.lastIndexOf('\\'));
        const dir = lastSlash !== -1 ? node.path.substring(0, lastSlash) : '';
        const newPath = dir ? `${dir}/${trimmed}` : trimmed;
        try {
          await invoke('execute_tool', {
            name: 'rename_file',
            arguments: { from: node.path, to: newPath },
            mode: 'agent_pro'
          });
          await refreshFileTree();
        } catch (e) {
          try {
            await invoke('run_command', {
              command: `powershell -Command "Rename-Item -LiteralPath '${node.path}' -NewName '${trimmed}'"`
            });
            await refreshFileTree();
          } catch (err) {
            alert("Rename failed: " + err);
          }
        }
      }
    },
    {
      label: 'Delete',
      icon: '🗑️',
      danger: true,
      action: async () => {
        const confirmed = confirm(`Are you sure you want to delete "${node.name}"?`);
        if (!confirmed) return;
        try {
          await invoke('execute_tool', {
            name: 'delete_file',
            arguments: { path: node.path },
            mode: 'agent_pro'
          });
          await refreshFileTree();
        } catch (e) {
          try {
            await invoke('run_command', {
              command: `powershell -Command "Remove-Item -LiteralPath '${node.path}' -Recurse -Force"`
            });
            await refreshFileTree();
          } catch (err) {
            alert("Delete failed: " + err);
          }
        }
      }
    }
  ];

  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'tree-context-menu-separator';
      menu.appendChild(sep);
      return;
    }

    const menuItem = document.createElement('div');
    menuItem.className = `tree-context-menu-item ${item.danger ? 'danger' : ''}`;
    menuItem.innerHTML = `<span style="font-size: 13px; opacity: 0.85;">${item.icon}</span> <span>${item.label}</span>`;
    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissFileTreeContextMenu();
      item.action();
    });
    menu.appendChild(menuItem);
  });

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Viewport bounds detection
  const rect = menu.getBoundingClientRect();
  const posX = Math.min(x, window.innerWidth - rect.width - 8);
  const posY = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, posX)}px`;
  menu.style.top = `${Math.max(8, posY)}px`;

  // Dismiss on click outside or Escape
  const onClickOutside = (e) => {
    if (!menu.contains(e.target)) {
      dismissFileTreeContextMenu();
      cleanupListeners();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      dismissFileTreeContextMenu();
      cleanupListeners();
    }
  };

  const cleanupListeners = () => {
    window.removeEventListener('click', onClickOutside);
    window.removeEventListener('contextmenu', onClickOutside);
    window.removeEventListener('keydown', onKeyDown);
  };

  setTimeout(() => {
    window.addEventListener('click', onClickOutside);
    window.addEventListener('contextmenu', onClickOutside);
    window.addEventListener('keydown', onKeyDown);
  }, 10);
}

// ==========================================================================
// Quick Open (Ctrl+P) Command Palette Implementation
// ==========================================================================

export function dismissQuickOpen() {
  document.getElementById('quick-open-overlay')?.remove();
}

export function openQuickOpen() {
  dismissQuickOpen();
  dismissFileTreeContextMenu();

  let allFiles = [];
  let selectedIndex = 0;
  let filteredFiles = [];

  const backdrop = document.createElement('div');
  backdrop.className = 'quick-open-backdrop';
  backdrop.id = 'quick-open-overlay';

  const container = document.createElement('div');
  container.className = 'quick-open-container';
  container.innerHTML = `
    <div class="quick-open-header">
      <span style="opacity: 0.6; font-size: 13px;">🔍</span>
      <input type="text" class="quick-open-input" id="quick-open-input" placeholder="Type file name to open..." />
    </div>
    <div class="quick-open-results" id="quick-open-results">
      <div class="quick-open-empty">Loading workspace files...</div>
    </div>
  `;

  backdrop.appendChild(container);
  document.body.appendChild(backdrop);

  const input = container.querySelector('#quick-open-input');
  const resultsContainer = container.querySelector('#quick-open-results');

  setTimeout(() => input?.focus(), 15);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      dismissQuickOpen();
    }
  });

  async function openSelectedFile(file) {
    if (!file) return;
    dismissQuickOpen();
    try {
      const fileData = await invoke('read_file', { path: file.path });
      if (fileData.is_binary) {
        alert("Cannot view binary files in code editor.");
        return;
      }
      openFileInTab(fileData);
    } catch (e) {
      alert("Error opening file: " + e);
    }
  }

  function renderResults() {
    resultsContainer.innerHTML = '';
    if (filteredFiles.length === 0) {
      resultsContainer.innerHTML = '<div class="quick-open-empty">No matching files found.</div>';
      return;
    }

    filteredFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = `quick-open-item ${index === selectedIndex ? 'selected' : ''}`;
      item.innerHTML = `
        <span style="font-size: 13px;">${getFileIcon(file.name, false)}</span>
        <span style="font-weight: 500;">${file.name}</span>
        <span class="quick-open-item-path" title="${file.relativePath}">${file.relativePath}</span>
      `;
      item.addEventListener('click', () => {
        openSelectedFile(file);
      });
      resultsContainer.appendChild(item);
    });

    const activeEl = resultsContainer.children[selectedIndex];
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function filterList(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      filteredFiles = allFiles.slice(0, 25);
    } else {
      filteredFiles = allFiles.filter(f =>
        f.name.toLowerCase().includes(q) || f.relativePath.toLowerCase().includes(q)
      ).slice(0, 25);
    }
    selectedIndex = 0;
    renderResults();
  }

  input?.addEventListener('input', () => {
    filterList(input.value);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredFiles.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredFiles.length;
        renderResults();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredFiles.length > 0) {
        selectedIndex = (selectedIndex - 1 + filteredFiles.length) % filteredFiles.length;
        renderResults();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredFiles.length > 0 && filteredFiles[selectedIndex]) {
        openSelectedFile(filteredFiles[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismissQuickOpen();
    }
  });

  // Fetch workspace files
  (async () => {
    let tree = null;
    try {
      tree = await invoke('get_file_tree', { max_depth: 5 });
    } catch (e) {
      try {
        tree = await invoke('execute_tool', {
          name: 'list_files',
          arguments: { max_depth: 5 },
          mode: 'agent_pro'
        });
      } catch (err) {
        console.warn("Could not load tree for quick open:", err);
      }
    }

    allFiles = [];
    function traverse(node, relPath = '') {
      if (!node) return;
      const currentRel = relPath ? `${relPath}/${node.name}` : (node.name || '');
      if (!node.is_directory) {
        allFiles.push({
          name: node.name,
          path: node.path,
          relativePath: node.relative_path || currentRel || node.name
        });
      }
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(child => traverse(child, node.name ? currentRel : ''));
      }
    }

    traverse(tree);
    filteredFiles = allFiles.slice(0, 25);
    renderResults();
  })();
}

// Global Ctrl+P shortcut
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openQuickOpen();
  }
});

// ---------------------------------------------------------------------------
// Reveal a file path in the tree: expands ancestors, scrolls, and flashes it.
// Used by the tab context menu ("Reveal in File Explorer") and Ctrl+T results.
// ---------------------------------------------------------------------------
export function revealPathInTree(targetPath) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
  const target = norm(targetPath);
  if (!target) return;

  // Expand every ancestor directory row, root first
  const parts = target.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    const row = document.querySelector(`.tree-node[data-path]`);
    // find matching row (paths may differ in case/slash form)
    const rows = Array.from(document.querySelectorAll('.tree-node'));
    const dirRow = rows.find(r => norm(r.dataset.path) === prefix);
    if (dirRow) {
      // If its subtree is hidden, click to expand
      const next = dirRow.nextElementSibling;
      if (next && next.style && next.style.display === 'none') {
        dirRow.click();
      }
    }
  }

  const allRows = Array.from(document.querySelectorAll('.tree-node'));
  const fileRow = allRows.find(r => norm(r.dataset.path) === target);
  if (fileRow) {
    fileRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
    fileRow.classList.add('selected');
    fileRow.classList.add('reveal-flash');
    setTimeout(() => fileRow.classList.remove('reveal-flash'), 1200);
  }
}
