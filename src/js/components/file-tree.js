// ==========================================================================
// Orbital X — File Tree Component (file-tree.js)
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openFileInTab } from '../editor/monaco.js';
import { showInputDialog, showConfirmDialog } from '../services/dialogs.js';

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

export function getFileSvgIcon(filename, isDir, isExpanded) {
  if (isDir) {
    const lower = (filename || '').toLowerCase();
    if (lower === '.github') {
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="tree-svg-icon" style="color: #94a3b8;"><path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;
    }
    if (lower === '.agents' || lower === '.claude' || lower === '.orbital') {
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#c084fc" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="tree-svg-icon"><circle cx="8" cy="8" r="5"/><path d="M8 5v6M5 8h6"/></svg>`;
    }
    if (lower === 'src' || lower === 'scripts') {
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12a.5.5 0 0 0 .353.147H13A1.5 1.5 0 0 1 14.5 4.7v7.8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5V3z" fill="#0284c7" opacity="0.85"/><path d="M5.5 8.5L4 10l1.5 1.5M10.5 8.5L12 10l-1.5 1.5" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (lower === 'node_modules') {
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#22c55e" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" class="tree-svg-icon"><path d="M8 1.5L2.5 4.5v7L8 14.5l5.5-3v-7L8 1.5z"/><path d="M2.5 4.5L8 7.5l5.5-3M8 7.5v7"/></svg>`;
    }
    if (lower === 'target' || lower === 'dist' || lower === 'release' || lower === 'build') {
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12a.5.5 0 0 0 .353.147H13A1.5 1.5 0 0 1 14.5 4.7v7.8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5V3z" fill="#ec4899" opacity="0.85"/><circle cx="8" cy="8.5" r="2.5" stroke="#fff" stroke-width="1"/></svg>`;
    }
    if (isExpanded) {
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon folder-svg"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12a.5.5 0 0 0 .353.147H13A1.5 1.5 0 0 1 14.5 4.7v1.8H2V3.5a.5.5 0 0 1 .5-.5z" fill="#94a3b8"/><path d="M1.5 6.5h13a.5.5 0 0 1 .49.6l-1.3 6.5a1 1 0 0 1-.98.8H3.29a1 1 0 0 1-.98-.8l-1.3-6.5a.5.5 0 0 1 .49-.6z" fill="#cbd5e1" stroke="#64748b" stroke-width="0.6"/></svg>`;
    }
    return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon folder-svg"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12a.5.5 0 0 0 .353.147H13A1.5 1.5 0 0 1 14.5 4.7v7.8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5V3z" fill="#8094ad" stroke="#64748b" stroke-width="0.5"/><path d="M2.5 4.8h11v7.2a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V4.8z" fill="#94a3b8" opacity="0.3"/></svg>`;
  }

  const ext = (filename || '').split('.').pop().toLowerCase();
  const lower = (filename || '').toLowerCase();

  if (lower.startsWith('license')) {
    return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><circle cx="8" cy="8" r="6" stroke="#eab308" stroke-width="1.2"/><path d="M8 5v4M8 11h.01" stroke="#eab308" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }
  if (lower === '.gitignore' || lower === '.gitmodules' || lower === '.gitattributes') {
    return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="8" y="1" width="8" height="8" rx="1.5" transform="rotate(45 8 1)" fill="#ef4444"/><circle cx="8" cy="6.6" r="1.3" fill="#fff"/><circle cx="5.6" cy="9" r="1.3" fill="#fff"/><circle cx="10.4" cy="9" r="1.3" fill="#fff"/></svg>`;
  }
  if (lower.endsWith('.lock') || lower === 'cargo.lock' || lower === 'package-lock.json') {
    return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="3.5" y="6.5" width="9" height="7.5" rx="1.5" fill="#64748b"/><path d="M5.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="10" r="1.2" fill="#fff"/></svg>`;
  }

  switch (ext) {
    case 'rs':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><circle cx="8" cy="8" r="6" stroke="#ea580c" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2" fill="#ea580c"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="#ea580c" stroke-width="1.3" stroke-linecap="round"/></svg>`;
    case 'js':
    case 'mjs':
    case 'cjs':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#eab308"/><text x="4" y="11.5" font-family="-apple-system, system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#000">JS</text></svg>`;
    case 'ts':
    case 'mts':
    case 'cts':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#3b82f6"/><text x="4" y="11.5" font-family="-apple-system, system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#fff">TS</text></svg>`;
    case 'tsx':
    case 'jsx':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><ellipse cx="8" cy="8" rx="6.5" ry="2.5" stroke="#06b6d4" stroke-width="1.2" transform="rotate(30 8 8)"/><ellipse cx="8" cy="8" rx="6.5" ry="2.5" stroke="#06b6d4" stroke-width="1.2" transform="rotate(90 8 8)"/><ellipse cx="8" cy="8" rx="6.5" ry="2.5" stroke="#06b6d4" stroke-width="1.2" transform="rotate(150 8 8)"/><circle cx="8" cy="8" r="1.3" fill="#06b6d4"/></svg>`;
    case 'html':
    case 'htm':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><path d="M2.5 1.5h11l-1 11.5L8 14.5l-4.5-1.5-1-11.5z" fill="#f97316" opacity="0.2" stroke="#f97316" stroke-width="1.2"/><path d="M5.5 6L4 8l1.5 2M10.5 6l1.5 2-1.5 2M9 5l-2 6" stroke="#f97316" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><path d="M2.5 1.5h11l-1 11.5L8 14.5l-4.5-1.5-1-11.5z" fill="#8b5cf6" opacity="0.2" stroke="#8b5cf6" stroke-width="1.2"/><text x="4.5" y="11" font-family="monospace" font-size="8" font-weight="900" fill="#a78bfa">#</text></svg>`;
    case 'json':
    case 'jsonc':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><text x="2" y="12" font-family="monospace" font-size="11" font-weight="800" fill="#eab308">{ }</text></svg>`;
    case 'md':
    case 'markdown':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="#38bdf8" stroke-width="1.2"/><path d="M4 10V6l2 2 2-2v4M12 8.5l-1.5 1.5L9 8.5M10.5 6v4" stroke="#38bdf8" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'toml':
    case 'yaml':
    case 'yml':
    case 'conf':
    case 'config':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#a855f7" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="tree-svg-icon"><circle cx="8" cy="8" r="2.5"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06"/></svg>`;
    case 'py':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5v1.5H8V8H2.5A2.5 2.5 0 0 0 0 10.5" stroke="#3b82f6" stroke-width="1.2"/><path d="M8 14.5a3.5 3.5 0 0 0 3.5-3.5V9.5H8V8h5.5A2.5 2.5 0 0 0 16 5.5" stroke="#eab308" stroke-width="1.2"/></svg>`;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="2" y="2.5" width="12" height="11" rx="2" stroke="#c084fc" stroke-width="1.2"/><circle cx="5.5" cy="5.5" r="1.2" fill="#c084fc"/><path d="M2.5 11.5l3.5-3.5 2.5 2.5 3-3 2 2" stroke="#c084fc" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'cmd':
    case 'bat':
    case 'ps1':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><rect x="2" y="2.5" width="12" height="11" rx="2" stroke="#22c55e" stroke-width="1.2"/><path d="M4.5 5.5l2.5 2.5-2.5 2.5M8 10.5h3.5" stroke="#22c55e" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    default:
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" class="tree-svg-icon"><path d="M3.5 2.5A1 1 0 0 1 4.5 1.5h5.586a1 1 0 0 1 .707.293l2.414 2.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11z" stroke="#94a3b8" stroke-width="1.2"/><polyline points="10 1.5 10 4.5 13 4.5" stroke="#94a3b8" stroke-width="1.2"/></svg>`;
  }
}

export function getFileIcon(filename, isDir, isExpanded) {
  return getFileSvgIcon(filename, isDir, isExpanded);
}

export async function loadWorkspace(rootPath, cachedMeta = null) {
  await loadFavorites();
  renderExplorerTopSections();
  try {
    const meta = cachedMeta || await invoke('set_workspace', { path: rootPath });
    if (meta) {
      state.workspace.rootPath = meta.root_path;
      state.workspace.name = meta.name;

      // Update UI headers
      const headerTitle = document.getElementById('header-workspace-name');
      if (headerTitle) headerTitle.textContent = meta.name;

      const sbWorkspace = document.getElementById('sb-workspace-text');
      if (sbWorkspace) sbWorkspace.textContent = meta.name;
    }

    await refreshFileTree();
  } catch (e) {
    console.error("Could not open workspace:", e);
    throw e;
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
  nodeRow.style.paddingLeft = `${indentLevel * 14 + 8}px`;

  let isExpanded = false;

  const arrow = document.createElement('span');
  arrow.className = `tree-arrow ${node.is_directory ? '' : 'leaf'}`;
  arrow.innerHTML = node.is_directory
    ? '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tree-chevron-svg"><polyline points="6 4 10 8 6 12"></polyline></svg>'
    : '';
  nodeRow.appendChild(arrow);

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.innerHTML = getFileSvgIcon(node.name, node.is_directory, isExpanded);
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
    childContainer.className = 'tree-subtree';
    childContainer.style.display = 'none';
    node.children.forEach(c => buildNodeElement(c, childContainer, indentLevel + 1));
    parentElem.appendChild(childContainer);
  }

  nodeRow.dataset.path = node.path;
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
        icon.innerHTML = getFileSvgIcon(node.name, true, isExpanded);
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
    const relPath = await showInputDialog("New File", "e.g. script.js or src/module.py");
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
    const folderPath = await showInputDialog("New Folder", "e.g. assets or components/ui");
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
        const newName = await showInputDialog("Rename File", `New name for ${node.name}`, node.name);
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
        const confirmed = await showConfirmDialog(`Delete File`, `Are you sure you want to delete "${node.name}"?`, 'Delete', true);
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

/** Renders optional filter bar above tree when active (L2/L3/L1). */
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

  // Clean, uncluttered tree: keep top section hidden unless an active filter is engaged
  if (!treeFilter) {
    top.innerHTML = '';
    top.style.display = 'none';
    return;
  }

  top.style.display = 'block';
  top.innerHTML = '';

  const filter = document.createElement('input');
  filter.type = 'text';
  filter.className = 'input-text';
  filter.placeholder = 'Filter files…';
  filter.value = treeFilter;
  filter.style.cssText = 'width: calc(100% - 16px); margin: 4px 8px; font-size: 11px;';
  filter.addEventListener('input', () => {
    treeFilter = filter.value.trim().toLowerCase();
    applyTreeFilter();
  });
  top.appendChild(filter);
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
  const name = await showInputDialog('New File', dirPath ? `filename (in ${dirPath}/)` : 'filename (workspace-relative)');
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
  const name = await showInputDialog('New Folder', dirPath ? `name (in ${dirPath}/)` : 'name (workspace-relative)');
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
  if (!(await showConfirmDialog('Delete Files', `Delete ${paths.length} file(s)?`, 'Delete All', true))) return;
  try {
    const manifest = await invoke('execute_tool', {
      name: 'batch_delete_files',
      arguments: { paths },
      mode: 'dev',
    });
    const approved = await showConfirmDialog("Confirm Deletion", `Deletion manifest verified: ${manifest.total_files} files (${Math.round(manifest.total_bytes / 1024)} KB).\n\nConfirm irreversible deletion?`, "Delete Permanently", true);
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

// ==========================================================================
// FIX 3: auto-refresh the explorer whenever the agent (or the user) mutates
// the filesystem. The agent already dispatches orbital:file-written on every
// write; we also listen for a broader mutation event and refresh debounced.
// ==========================================================================

let treeRefreshTimer = null;

function scheduleTreeRefresh() {
  clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(async () => {
    try {
      await refreshFileTree();
      // Re-apply any active filter after the tree re-renders
      if (treeFilter) applyTreeFilter();
    } catch (e) {
      console.warn('Explorer auto-refresh failed:', e);
    }
  }, 350); // debounce: batch rapid mutations (multi-file writes) into one refresh
}

// Agent writes via the write/patch tools
window.addEventListener('orbital:file-written', scheduleTreeRefresh);

// Broader mutations: deletes, renames, directory creates, batch deletes,
// git operations that change the tree, checkpoint restores
window.addEventListener('orbital:files-changed', scheduleTreeRefresh);

// Hook into the agent's tool execution: after any filesystem-mutating tool
// completes, fire the refresh event
(function hookAgentToolRefresh() {
  const origDispatch = window.dispatchEvent.bind(window);
  // The agent already dispatches orbital:file-written for write_file/patch_file.
  // We piggyback on tool completion by watching for tool-box status changes:
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.classList?.contains('tool-box')) {
          // A new tool box was added — watch its status for completion
          const statusEl = node.querySelector('.tool-status-badge');
          if (statusEl) {
            const watch = new MutationObserver(() => {
              const txt = statusEl.textContent || '';
              if (txt.includes('✓') || txt.includes('✗') || txt.includes('Deleted') || txt.includes('Renamed')) {
                // Check which tool it was by looking at the header
                const toolName = node.querySelector('.tool-name-badge')?.textContent || '';
                if (/write|patch|delete|rename|create_dir|batch|mkdir/i.test(toolName)) {
                  scheduleTreeRefresh();
                }
                watch.disconnect();
              }
            });
            watch.observe(statusEl, { childList: true, characterData: true, subtree: true });
          }
        }
      }
    }
  });
  const timeline = document.getElementById('agent-timeline');
  if (timeline) {
    observer.observe(timeline, { childList: true, subtree: true });
  }
})();

// ==========================================================================
// FIX 9: Functional Outline & Timeline sections in the explorer
// ==========================================================================

const SYMBOL_RE = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|struct|enum|trait|interface|const|let|var|def|fn|pub\s+fn|impl|type)\s+([A-Za-z_$][\w$]*)/g;

export function refreshOutline() {
  const host = document.getElementById('outline-symbols');
  if (!host) return;

  const m = null;
  import('../editor/monaco.js').then((mon) => {
    const ed = mon.getActiveEditor?.();
    const model = ed?.getModel();
    if (!model) {
      host.innerHTML = '<span style="color: var(--text-muted); font-size: 10px;">Open a file to see its symbols</span>';
      return;
    }

    const content = model.getValue();
    const lang = model.getLanguageId();
    const symbols = [];
    let match;
    const re = new RegExp(SYMBOL_RE.source, 'g');
    while ((match = re.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const kind = /class|struct|interface|impl/.test(match[0]) ? 'class' :
                   /const|let|var/.test(match[0]) ? 'var' : 'fn';
      symbols.push({ name: match[1], line, kind });
    }

    if (symbols.length === 0) {
      host.innerHTML = '<span style="color: var(--text-muted); font-size: 10px;">No symbols found</span>';
      return;
    }

    const ICONS = { fn: 'ƒ', class: '◇', var: '▪' };
    const COLORS = { fn: 'var(--accent-cyan)', class: 'var(--accent-purple)', var: 'var(--accent-orange)' };
    host.innerHTML = '';
    for (const sym of symbols.slice(0, 50)) {
      const row = document.createElement('div');
      row.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 1px 4px; cursor: pointer; border-radius: 3px; font-family: var(--font-mono);`;
      row.innerHTML = `<span style="color: ${COLORS[sym.kind]}; font-weight: 700; width: 14px; text-align: center; flex-shrink: 0;">${ICONS[sym.kind]}</span>
        <span style="color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${sym.name}</span>
        <span style="color: var(--text-muted); font-size: 9px;">:${sym.line}</span>`;
      row.addEventListener('click', () => {
        ed.revealLineInCenter(sym.line);
        ed.setPosition({ lineNumber: sym.line, column: 1 });
        ed.focus();
      });
      host.appendChild(row);
    }
  }).catch(() => {});
}

export async function refreshTimeline() {
  const host = document.getElementById('timeline-commits');
  if (!host) return;

  const mon = await import('../editor/monaco.js');
  const ed = mon.getActiveEditor?.();
  const model = ed?.getModel();
  if (!model) {
    host.innerHTML = '<span style="color: var(--text-muted); font-size: 10px;">Open a file to see its git history</span>';
    return;
  }
  const panel = mon.getActivePanel();
  const tabs = mon.getPanelTabs(panel);
  const activeId = panel === 'left' ? state.editor.activeTabId : state.editor.rightActiveTabId;
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;
  const relPath = tab.relativePath || tab.name;

  try {
    const res = await invoke('run_git_command', {
      args: ['log', '--no-color', '--pretty=format:%h|%ar|%s', '-10', '--', relPath],
    });
    const commits = (res.stdout || '').split('\n').filter(Boolean);
    if (commits.length === 0) {
      host.innerHTML = '<span style="color: var(--text-muted); font-size: 10px;">No commits for this file</span>';
      return;
    }
    host.innerHTML = '';
    for (const line of commits) {
      const [hash, when, ...msgParts] = line.split('|');
      const msg = msgParts.join('|');
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 4px; cursor: pointer; border-radius: 3px; font-size: 10px;';
      row.innerHTML = `<span style="font-family: var(--font-mono); color: var(--accent-orange); flex-shrink: 0;">${hash}</span>
        <span style="color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${msg}</span>
        <span style="color: var(--text-muted); font-size: 9px; flex-shrink: 0;">${when}</span>`;
      row.addEventListener('click', () => {
        import('./source-control.js').then(sc => {
          // Show the commit diff for this file
          invoke('run_git_command', { args: ['show', '--no-color', '--stat', '-p', hash, '--', relPath] }).then(res => {
            if (res.stdout) {
              showToast(`Commit ${hash} — see terminal for full diff`, 'info', 3000);
              // Write to terminal for inspection
              import('./terminal.js').then(t => {
                t.executeTerminalCommand(`git show ${hash} -- ${relPath}`);
              });
            }
          });
        });
      });
      host.appendChild(row);
    }
  } catch (e) {
    host.innerHTML = '<span style="color: var(--text-muted); font-size: 10px;">Not a git repository</span>';
  }
}

// Refresh outline + timeline whenever the active tab changes
window.addEventListener('orbital:tab-changed', () => {
  refreshOutline();
  refreshTimeline();
});

// Also refresh when the outline/timeline sections are opened
document.getElementById('outline-section')?.addEventListener('toggle', (e) => {
  if (e.target.open) refreshOutline();
});
document.getElementById('timeline-section')?.addEventListener('toggle', (e) => {
  if (e.target.open) refreshTimeline();
});
