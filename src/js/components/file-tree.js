// ==========================================================================
// Orbital X — File Tree Component (file-tree.js)
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openFileInTab } from '../editor/monaco.js';

// L2/L3: recents + favorites state
let recentFiles = [];
try { recentFiles = JSON.parse(localStorage.getItem('orbital_recent_files') || '[]'); } catch (e) { recentFiles = []; }
let favorites = []; // { path, name }
let treeFilter = '';

export function getRecentFiles() { return recentFiles; }

function pushRecentFile(path, name) {
  recentFiles = [{ path, name }, ...recentFiles.filter(r => r.path !== path)].slice(0, 10);
  try { localStorage.setItem('orbital_recent_files', JSON.stringify(recentFiles)); } catch (e) { /* quota */ }
  renderExplorerTopSections();
}

async function loadFavorites() {
  try {
    const res = await invoke('read_file', { path: '.orbital/favorites.json' });
    const parsed = JSON.parse(res.content || '[]');
    favorites = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    favorites = [];
  }
}

async function saveFavorites() {
  try {
    await invoke('save_file', {
      path: '.orbital/favorites.json',
      content: JSON.stringify(favorites, null, 2),
      description: 'Favorites update',
    });
  } catch (e) { console.warn('favorites save failed', e); }
}

// L1: extension → colored-letter icon map (no CDN dependency — CSP blocks
// external font styles; this keeps identical semantics to devicons mapping)
const EXT_ICON_MAP = {
  js: { c: '#f5de19', t: 'JS' }, mjs: { c: '#f5de19', t: 'JS' }, cjs: { c: '#f5de19', t: 'JS' },
  ts: { c: '#3178c6', t: 'TS' }, tsx: { c: '#3178c6', t: 'TS' },
  rs: { c: '#dea584', t: 'RS' }, py: { c: '#3572A5', t: 'PY' },
  html: { c: '#e34c26', t: '<>' }, css: { c: '#563d7c', t: 'CSS' }, scss: { c: '#c6538c', t: 'SCS' },
  json: { c: '#8bc34a', t: '{}' }, md: { c: '#8c959f', t: 'MD' },
  go: { c: '#00ADD8', t: 'GO' }, java: { c: '#b07219', t: 'JV' },
  toml: { c: '#9c4221', t: 'TML' }, yml: { c: '#cb171e', t: 'YML' }, yaml: { c: '#cb171e', t: 'YML' },
  lock: { c: '#6e7681', t: 'LCK' }, sql: { c: '#dd6b20', t: 'SQL' }, sh: { c: '#89e051', t: 'SH' },
};

export function getTypedFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const meta = EXT_ICON_MAP[ext];
  if (!meta) return { text: '·', color: 'var(--text-muted)' };
  return meta;
}
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
  await loadFavorites();
  renderExplorerTopSections();
  // (original body continues below)
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

  nodeRow.dataset.isDir = node.is_directory ? 'true' : 'false';
  nodeRow.draggable = true;
  const label = document.createElement('span');
  label.className = 'tree-label';
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
  // L1: ctrl/shift multi-select bookkeeping happens in the click handler below (appended)
  nodeRow.classList.add('tree-node-row');

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
        pushRecentFile(node.path, node.name);
        renderExplorerTopSections();
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
        if (!fileData.is_binary) { pushRecentFile(node.path, node.name); renderExplorerTopSections(); m.openFileInTab(fileData); }
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

let showFileTreeContextMenu = function (x, y, node) {
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

// ==========================================================================
// Parts L — recents, favorites, filter, multi-select actions, DnD move,
// inline create, properties panel
// ==========================================================================

let multiSelectedPaths = new Set();
let lastClickedPath = null;

function explorerHost() {
  return document.getElementById('view-explorer');
}

/** Renders Recents + Favorites + filter above the tree (L2/L3/L1). */
export function renderExplorerTopSections() {
  const host = explorerHost();
  if (!host) return;
  let top = document.getElementById('explorer-top-sections');
  if (!top) {
    top = document.createElement('div');
    top.id = 'explorer-top-sections';
    const treeContainer = document.getElementById('file-tree-container') || host.querySelector('.sidebar-content');
    if (treeContainer) host.insertBefore(top, treeContainer);
    else host.appendChild(top);
  }
  top.innerHTML = '';

  // Filter input (L1)
  const filter = document.createElement('input');
  filter.type = 'text';
  filter.className = 'input-text';
  filter.placeholder = 'Filter files…';
  filter.value = treeFilter;
  filter.style.cssText = 'width: calc(100% - 16px); margin: 6px 8px 4px; font-size: 11px;';
  filter.addEventListener('input', () => {
    treeFilter = filter.value.trim().toLowerCase();
    applyTreeFilter();
  });
  top.appendChild(filter);

  const section = (title, items, onOpen, onClear, isFav) => {
    if (items.length === 0) return;
    const wrap = document.createElement('details');
    wrap.style.cssText = 'margin: 2px 8px 6px; font-size: 11px;';
    const summary = document.createElement('summary');
    summary.style.cssText = 'font-weight: 600; color: var(--text-secondary); cursor: pointer; user-select: none; padding: 2px 0;';
    summary.textContent = `${title} (${items.length})`;
    wrap.appendChild(summary);
    for (const item of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 4px; cursor: pointer; color: var(--text-primary);';
      const typed = getTypedFileIcon(item.name || item.path.split('/').pop());
      row.innerHTML = `
        <span style="color:${typed.c}; font-family: var(--font-mono); font-size: 9px; font-weight: 700; width: 24px; flex-shrink: 0;">${typed.t}</span>
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtmlAttr(item.path)}">${escapeHtmlAttr(item.name || item.path.split('/').pop())}</span>
        ${isFav ? '<button class="git-icon-btn danger" title="Remove from Favorites" style="width: 16px; height: 16px; font-size: 10px;">★</button>' : ''}`;
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.git-icon-btn')) {
          favorites = favorites.filter(f => f.path !== item.path);
          await saveFavorites();
          renderExplorerTopSections();
          return;
        }
        try {
          const fileData = await invoke('read_file', { path: item.path });
          if (fileData.is_binary) return;
          pushRecentFile(item.path, item.name || item.path.split('/').pop());
          openFileInTab(fileData);
        } catch (err) { showToast(`Could not open: ${err}`, 'error', 2600); }
      });
      wrap.appendChild(row);
    }
    if (onClear) {
      const clear = document.createElement('button');
      clear.className = 'btn btn-secondary btn-sm';
      clear.textContent = 'Clear Recents';
      clear.style.cssText = 'margin: 2px 0 4px; padding: 1px 8px; font-size: 9.5px;';
      clear.addEventListener('click', () => { recentFiles = []; try { localStorage.setItem('orbital_recent_files', '[]'); } catch (e) {} renderExplorerTopSections(); });
      wrap.appendChild(clear);
    }
    top.appendChild(wrap);
  };

  section('⭐ Favorites', favorites.map(f => ({ path: f.path, name: f.name })), null, null, true);
  section('🕘 Recent', recentFiles.map(r => ({ path: r.path, name: r.name })), null, true, false);
}

function escapeHtmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** L1: hide non-matching rows, keep folder hierarchy, highlight substring. */
function applyTreeFilter() {
  const host = explorerHost();
  if (!host) return;
  const rows = [...host.querySelectorAll('.tree-node')];
  if (!treeFilter) {
    rows.forEach(r => {
      r.style.display = '';
      unhighlight(r);
      // restore collapsed folders to their prior state (visual only)
      const next = r.nextElementSibling;
      if (next && next.classList?.contains('tree-children')) next.style.display = 'none';
    });
    return;
  }
  rows.forEach(r => {
    const path = (r.dataset.path || '').toLowerCase();
    const isDir = r.dataset.isDir === 'true';
    const name = path.split('/').pop();
    if (isDir) {
      // show folder if any descendant matches (recomputed after files pass)
      r.style.display = '';
    } else {
      const match = name.includes(treeFilter);
      r.style.display = match ? '' : 'none';
      if (match) highlightRow(r, treeFilter);
      else unhighlight(r);
    }
  });
  // Second pass: show folders that have a visible descendant
  rows.filter(r => r.dataset.isDir === 'true').forEach(r => {
    const prefix = (r.dataset.path || '').toLowerCase() + '/';
    const hasVisible = rows.some(x =>
      x.dataset.isDir !== 'true' && x.style.display !== 'none' &&
      (x.dataset.path || '').toLowerCase().startsWith(prefix));
    r.style.display = hasVisible ? '' : 'none';
  });
}

function highlightRow(row, term) {
  const label = row.querySelector('.tree-label') || row.querySelector('span:last-child');
  if (!label) return;
  unhighlight(row);
  const text = label.textContent;
  const idx = text.toLowerCase().indexOf(term);
  if (idx === -1) return;
  label.innerHTML = `${escapeHtmlAttr(text.slice(0, idx))}<mark style="background: color-mix(in srgb, var(--accent-cyan) 40%, transparent); color: inherit; border-radius: 2px;">${escapeHtmlAttr(text.slice(idx, idx + term.length))}</mark>${escapeHtmlAttr(text.slice(idx + term.length))}`;
}

function unhighlight(row) {
  const label = row.querySelector('.tree-label');
  if (label && label.querySelector('mark')) {
    label.textContent = label.textContent; // strips mark, keeps text
  }
}

// ---------------------------------------------------------------
// L1: multi-select + extended context menu wiring
// ---------------------------------------------------------------

document.addEventListener('click', (e) => {
  const row = e.target.closest('.tree-node');
  if (!row || !row.dataset.path) return;
  const isDir = row.dataset.isDir === 'true';
  if (isDir) { multiSelectedPaths.clear(); lastClickedPath = null; syncMultiSelectUI(); return; }

  const path = row.dataset.path;
  if (e.ctrlKey || e.metaKey) {
    if (multiSelectedPaths.has(path)) multiSelectedPaths.delete(path);
    else multiSelectedPaths.add(path);
    lastClickedPath = path;
  } else if (e.shiftKey && lastClickedPath) {
    const rows = [...document.querySelectorAll('.tree-node[data-path]')].filter(r => r.dataset.isDir !== 'true');
    const from = rows.findIndex(r => r.dataset.path === lastClickedPath);
    const to = rows.findIndex(r => r.dataset.path === path);
    if (from !== -1 && to !== -1) {
      multiSelectedPaths.clear();
      for (const r of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        multiSelectedPaths.add(r.dataset.path);
      }
    }
  } else {
    multiSelectedPaths.clear();
    multiSelectedPaths.add(path);
    lastClickedPath = path;
  }
  syncMultiSelectUI();
});

function syncMultiSelectUI() {
  document.querySelectorAll('.tree-node').forEach(r => {
    r.classList.toggle('multi-selected', multiSelectedPaths.has(r.dataset.path));
  });
  if (multiSelectedPaths.size > 1) {
    showToast(`${multiSelectedPaths.size} files selected — right-click for bulk actions`, 'info', 2000);
  }
}

// ---------------------------------------------------------------
// L1: inline new file / folder creation
// ---------------------------------------------------------------

export async function promptNewFile(dirPath) {
  const name = prompt(dirPath ? `New file in ${dirPath}/ — filename:` : 'New file name (relative to workspace root):');
  if (!name || !name.trim()) return;
  const path = dirPath ? `${dirPath}/${name.trim()}` : name.trim();
  try {
    await invoke('save_file', { path, content: '', description: 'New file' });
    showToast(`Created ${path}`, 'success', 2200);
    refreshTreeAfterMutation();
  } catch (e) {
    showToast(`Create failed: ${e}`, 'error', 3000);
  }
}

export async function promptNewFolder(dirPath) {
  const name = prompt(dirPath ? `New folder in ${dirPath}/ — name:` : 'New folder name (relative to workspace root):');
  if (!name || !name.trim()) return;
  const path = dirPath ? `${dirPath}/${name.trim()}` : name.trim();
  try {
    await invoke('create_directory', { path });
    showToast(`Created folder ${path}`, 'success', 2200);
    refreshTreeAfterMutation();
  } catch (e) {
    showToast(`Create failed: ${e}`, 'error', 3000);
  }
}

function refreshTreeAfterMutation() {
  document.getElementById('btn-refresh-files')?.click();
}

// ---------------------------------------------------------------
// L1: drag & drop move (via rename_file) — wired onto directory rows as
// drop targets and file/folder rows as drag sources.
// ---------------------------------------------------------------

function wireTreeDragDrop() {
  const host = explorerHost();
  if (!host || host.dataset.dndWired) return;
  host.dataset.dndWired = '1';

  host.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.tree-node');
    if (!row?.dataset.path) return;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', row.dataset.path); } catch (err) { /* IE */ }
    row.classList.add('dragging');
  });
  host.addEventListener('dragend', (e) => {
    host.querySelectorAll('.tree-node').forEach(r => r.classList.remove('dragging', 'drop-into'));
  });
  host.addEventListener('dragover', (e) => {
    const row = e.target.closest('.tree-node');
    if (!row?.dataset.path) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    host.querySelectorAll('.tree-node').forEach(r => r.classList.remove('drop-into'));
    row.classList.add('drop-into');
  });
  host.addEventListener('drop', async (e) => {
    const row = e.target.closest('.tree-node');
    if (!row?.dataset.path) return;
    e.preventDefault();
    const srcPath = e.dataTransfer.getData('text/plain');
    const destDir = row.dataset.path;
    const rowIsDir = row.dataset.isDir === 'true';
    if (!srcPath || !rowIsDir) return;
    if (destDir === srcPath || destDir.startsWith(srcPath + '/') || destDir.startsWith(srcPath + '\\')) {
      showToast('Cannot move a folder into itself', 'warning', 2500);
      return;
    }
    const newName = srcPath.split(/[\\/]/).pop();
    const target = `${destDir}/${newName}`;
    if (target === srcPath) return;
    try {
      await invoke('execute_tool', {
        name: 'rename_file',
        arguments: { from: srcPath, to: target },
        mode: 'dev',
      });
      showToast(`Moved to ${target}`, 'success', 2400);
      refreshTreeAfterMutation();
    } catch (err) {
      showToast(`Move failed: ${err}`, 'error', 3200);
    }
  });
}
setTimeout(wireTreeDragDrop, 800);

// ---------------------------------------------------------------
// L4: properties panel + extended context menu items
// ---------------------------------------------------------------

export async function showFileProperties(path) {
  document.getElementById('file-properties-modal')?.remove();
  let info = {};
  try {
    const fileData = await invoke('read_file', { path });
    info = {
      size: fileData.size_bytes,
      lines: fileData.total_lines,
      binary: fileData.is_binary,
      language: (path.split('.').pop() || '').toUpperCase(),
    };
  } catch (e) {
    showToast(`Could not read ${path}: ${e}`, 'error', 3000);
    return;
  }
  let gitStatus = 'clean';
  try {
    const st = await invoke('get_git_status');
    if (st?.is_repo) {
      const match = (st.raw || '').split('\n').find(l => l.slice(3).trim().includes(path.split('/').pop()));
      if (match) gitStatus = match.startsWith('??') ? 'untracked' : 'modified';
    }
  } catch (e) { /* not a repo */ }

  const fmtSize = (b) => {
    if (!Number.isFinite(b)) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(2)} MB`;
  };

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'file-properties-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="width: 420px; max-width: 92vw; padding: 16px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
        <strong style="font-size: 13px;">Properties</strong>
        <button class="icon-btn" id="props-close" style="margin-left: auto;">✕</button>
      </div>
      <div style="font-size: 11.5px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 6px;">
        <div><strong style="color: var(--text-primary);">Path:</strong> <span style="font-family: var(--font-mono); word-break: break-all;">${escapeHtmlAttr(path)}</span></div>
        <div><strong style="color: var(--text-primary);">Size:</strong> ${fmtSize(info.size)}</div>
        <div><strong style="color: var(--text-primary);">Lines:</strong> ${info.binary ? '— (binary)' : info.lines ?? '—'}</div>
        <div><strong style="color: var(--text-primary);">Language:</strong> ${info.binary ? 'Binary' : escapeHtmlAttr(info.language || 'unknown')}</div>
        <div><strong style="color: var(--text-primary);">Encoding:</strong> UTF-8</div>
        <div><strong style="color: var(--text-primary);">Git status:</strong> ${escapeHtmlAttr(gitStatus)}</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#props-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/** Bulk actions on the current multi-selection (L1). */
export async function bulkDeleteSelected() {
  const paths = [...multiSelectedPaths];
  if (paths.length === 0) { showToast('Nothing selected', 'info', 1600); return; }
  if (!confirm(`Delete ${paths.length} file(s)?\n\n${paths.slice(0, 8).join('\n')}${paths.length > 8 ? '\n…' : ''}`)) return;
  try {
    const manifest = await invoke('execute_tool', {
      name: 'batch_delete_files',
      arguments: { paths },
      mode: 'dev',
    });
    const approved = confirm(`Deletion manifest verified: ${manifest.total_files} files (${Math.round(manifest.total_bytes / 1024)} KB).\n\nConfirm irreversible deletion?`);
    if (!approved) { showToast('Deletion cancelled', 'info', 1800); return; }
    const res = await invoke('execute_tool', {
      name: 'batch_delete_files',
      arguments: { manifest_id: manifest.manifest_id },
      mode: 'dev',
    });
    showToast(`Deleted ${res.total_deleted} file(s)`, 'success', 2600);
    multiSelectedPaths.clear();
    refreshTreeAfterMutation();
  } catch (e) {
    showToast(`Bulk delete failed: ${e}`, 'error', 3500);
  }
}

export async function copySelectedPaths() {
  const paths = [...multiSelectedPaths];
  if (paths.length === 0) return;
  await navigator.clipboard.writeText(paths.join('\n'));
  showToast(`Copied ${paths.length} path(s)`, 'success', 1800);
}

/** Context menu items are injected into the existing file-tree menu by
 *  augmenting showFileTreeContextMenu through a wrapper. */
const origShowMenu = showFileTreeContextMenu;
showFileTreeContextMenu = function (x, y, node) {
  origShowMenu(x, y, node);
  // Inject extra items after the original menu renders (it is in the DOM now)
  const menu = document.getElementById('file-tree-context-menu');
  if (!menu || node.is_directory === true) {
    if (menu && node.is_directory) {
      const sep = document.createElement('div');
      sep.className = 'tree-context-separator';
      menu.appendChild(sep);
      addMenuItem(menu, 'New File', '📝', () => promptNewFile(node.path));
      addMenuItem(menu, 'New Folder', '📁', () => promptNewFolder(node.path));
    }
    return;
  }
  const sep = document.createElement('div');
  sep.className = 'tree-context-separator';
  menu.appendChild(sep);

  addMenuItem(menu, 'Add to Favorites', '⭐', async () => {
    if (!favorites.some(f => f.path === node.path)) {
      favorites.push({ path: node.path, name: node.name });
      await saveFavorites();
      renderExplorerTopSections();
      showToast('Added to Favorites', 'success', 1800);
    }
  });
  addMenuItem(menu, 'Properties', '🧾', () => showFileProperties(node.path));
  if (multiSelectedPaths.size > 1) {
    addMenuItem(menu, `Delete Selected (${multiSelectedPaths.size})`, '🗑️', bulkDeleteSelected);
    addMenuItem(menu, `Copy Paths (${multiSelectedPaths.size})`, '📋', copySelectedPaths);
  }
};

function addMenuItem(menu, label, icon, action) {
  const row = document.createElement('div');
  row.className = 'tree-context-item';
  row.innerHTML = `<span class="ctx-icon">${icon}</span><span class="ctx-label">${escapeHtmlAttr(label)}</span>`;
  row.addEventListener('click', () => {
    document.getElementById('file-tree-context-menu')?.remove();
    action();
  });
  menu.appendChild(row);
}

// aria (N3): explorer tree semantics
export function initExplorerA11y() {
  const host = explorerHost();
  const treeContainer = document.getElementById('file-tree-container') || host?.querySelector('.sidebar-content');
  if (treeContainer && !treeContainer.getAttribute('role')) {
    treeContainer.setAttribute('role', 'tree');
    treeContainer.setAttribute('aria-label', 'File explorer');
  }
}
setTimeout(initExplorerA11y, 500);
