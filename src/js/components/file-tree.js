// ==========================================================================
// Orbital X — File Tree Component (file-tree.js)
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { openFileInTab } from '../editor/monaco.js';

export function getFileIcon(filename, isDir, isExpanded) {
  if (isDir) {
    return isExpanded ? '📂' : '📁';
  }

  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'rs': return '🦀';
    case 'js':
    case 'mjs':
    case 'cjs': return '📜';
    case 'ts':
    case 'tsx': return '📘';
    case 'py': return '🐍';
    case 'html': return '🌐';
    case 'css':
    case 'scss': return '🎨';
    case 'json': return '📋';
    case 'md': return '📝';
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
    } else {
      // It's a file, read and open in Monaco
      try {
        const fileData = await invoke('read_file', { path: node.path });
        if (fileData.is_binary) {
          alert("Cannot view binary files in the code editor.");
          return;
        }
        openFileInTab(fileData);
      } catch (err) {
        alert("Error opening file: " + err);
      }
    }
  });
}
