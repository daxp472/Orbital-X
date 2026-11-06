// ==========================================================================
// Orbital X — Changed Files & Review Tracker (changed-files.js)
// Accurately tracks unique modified files without duplicate/triple counting
// and presents a dedicated direct-to-editor review popup (Features 7 & 8).
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from './tauri.js';
import { showToast } from './notifications.js';

// Canonical Map: lowercase relative path -> FileEntry
// { key, name, relativePath, fullPath, count, lastModified }
const canonicalFilesMap = new Map();

function getFileIcon(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return '🟨';
    case 'ts':
    case 'tsx':
      return '🔷';
    case 'html':
    case 'htm':
      return '🌐';
    case 'css':
    case 'scss':
    case 'less':
      return '🎨';
    case 'json':
      return '📋';
    case 'rs':
      return '🦀';
    case 'md':
    case 'markdown':
      return '📝';
    case 'py':
      return '🐍';
    case 'sh':
    case 'ps1':
    case 'bat':
      return '⚙️';
    default:
      return '📄';
  }
}

/**
 * Normalizes any absolute or relative path to a clean, canonical relative path
 * and returns fullPath and relativePath.
 */
export function normalizeFilePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;

  let clean = rawPath.replace(/\\/g, '/').trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return null;

  // Ignore trailing slashes or directory indicators
  if (clean.endsWith('/')) return null;

  const root = state.workspace?.rootPath
    ? state.workspace.rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
    : '';

  let relPath = clean;
  if (root && clean.toLowerCase().startsWith(root.toLowerCase())) {
    relPath = clean.slice(root.length);
  }

  // Strip leading dots and slashes
  relPath = relPath.replace(/^\.?\/+/, '');
  if (!relPath) return null;

  // Form clean fullPath
  const fullPath = (clean.includes(':') || clean.startsWith('/'))
    ? clean
    : (root ? `${root}/${relPath}` : relPath);

  const name = relPath.split('/').pop() || relPath;
  const canonicalKey = relPath.toLowerCase();

  return {
    canonicalKey,
    name,
    relativePath: relPath,
    fullPath
  };
}

/**
 * Record a modified file with deduplication.
 */
export function recordFileModified(rawPath) {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return;

  const existing = canonicalFilesMap.get(norm.canonicalKey);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastModified = Date.now();
    // Update fullPath/name if more specific
    if (norm.fullPath.includes(':') || norm.fullPath.startsWith('/')) {
      existing.fullPath = norm.fullPath;
    }
  } else {
    canonicalFilesMap.set(norm.canonicalKey, {
      key: norm.canonicalKey,
      name: norm.name,
      relativePath: norm.relativePath,
      fullPath: norm.fullPath,
      count: 1,
      lastModified: Date.now()
    });
  }

  updateChangedFilesUI();
}

export function clearSessionChangedFiles() {
  canonicalFilesMap.clear();
  updateChangedFilesUI();
}

/**
 * Synchronize with Git status without creating duplicates.
 */
export async function refreshChangedFiles() {
  try {
    const res = await invoke('get_git_status');
    if (res && res.is_repo && res.raw) {
      for (const line of res.raw.split('\n')) {
        if (line.startsWith('##') || line.trim().length < 3) continue;
        let p = line.slice(3).trim();
        const arrow = p.indexOf(' -> ');
        if (arrow !== -1) p = p.slice(arrow + 4);
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        if (!p) continue;

        const norm = normalizeFilePath(p);
        if (norm && !canonicalFilesMap.has(norm.canonicalKey)) {
          canonicalFilesMap.set(norm.canonicalKey, {
            key: norm.canonicalKey,
            name: norm.name,
            relativePath: norm.relativePath,
            fullPath: norm.fullPath,
            count: 1,
            lastModified: Date.now()
          });
        }
      }
    }
  } catch (e) {
    // If not a git repo or IPC fails, session tracker remains authoritative
  }
  updateChangedFilesUI();
}

export function getChangedFilesList() {
  return Array.from(canonicalFilesMap.values()).sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
}

export function updateChangedFilesUI() {
  const label = document.getElementById('agent-changed-files-label');
  const bar = document.getElementById('review-changes-bar');
  const count = canonicalFilesMap.size;

  if (label) {
    if (count === 0) {
      label.textContent = '0 Files With Changes';
      if (bar) bar.classList.remove('has-changes');
    } else if (count === 1) {
      label.textContent = '1 File With Changes';
      if (bar) bar.classList.add('has-changes');
    } else {
      label.textContent = `${count} Files With Changes`;
      if (bar) bar.classList.add('has-changes');
    }
  }

  const modalPill = document.getElementById('review-modal-count-pill');
  if (modalPill) {
    modalPill.textContent = `${count} file${count === 1 ? '' : 's'}`;
  }
}

/**
 * Opens the dedicated Review Changes Popup (Feature 8)
 * Displays filename on left, path on right, and opens into Monaco editor on click.
 */
export function openReviewChangesModal() {
  const modal = document.getElementById('modal-review-changes');
  if (!modal) return;

  refreshChangedFiles();
  modal.style.display = 'flex';

  const searchInput = document.getElementById('review-files-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }

  renderReviewChangesList('');
}

export function closeReviewChangesModal() {
  const modal = document.getElementById('modal-review-changes');
  if (modal) modal.style.display = 'none';
}

function renderReviewChangesList(filterQuery = '') {
  const container = document.getElementById('review-changes-file-list');
  if (!container) return;

  const all = getChangedFilesList();
  const query = (filterQuery || '').toLowerCase().trim();

  const filtered = query
    ? all.filter(f => f.name.toLowerCase().includes(query) || f.relativePath.toLowerCase().includes(query))
    : all;

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="review-change-empty">
        ${all.length === 0 ? '✓ No file changes recorded in this session.' : 'No changed files match "' + escapeHtml(filterQuery) + '".'}
      </div>
    `;
    return;
  }

  for (const file of filtered) {
    const row = document.createElement('div');
    row.className = 'review-change-row';
    row.dataset.path = file.fullPath;
    row.title = `Click to view and edit ${file.relativePath} in editor`;

    const icon = getFileIcon(file.name);
    row.innerHTML = `
      <div class="review-change-left">
        <span class="review-change-icon">${icon}</span>
        <span class="review-change-name">${escapeHtml(file.name)}</span>
      </div>
      <div class="review-change-right">
        <span class="review-change-path">${escapeHtml(file.relativePath)}</span>
      </div>
    `;

    row.addEventListener('click', async () => {
      await openFileDirectlyIntoEditor(file);
      closeReviewChangesModal();
    });

    container.appendChild(row);
  }
}

async function openFileDirectlyIntoEditor(file) {
  try {
    const fileData = await invoke('read_file', { path: file.fullPath });
    if (!fileData) {
      showToast(`Could not open ${file.name}`, 'warning', 2500);
      return;
    }
    const monacoModule = await import('../editor/monaco.js');
    monacoModule.openFileInTab(fileData);
    monacoModule.getActiveEditor()?.focus();
    showToast(`Opened ${file.name} in editor`, 'info', 1800);
  } catch (err) {
    console.error('Failed to open changed file:', err);
    showToast(`Error opening file: ${err?.message || err}`, 'error', 3500);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initReviewChangesBar() {
  const btn = document.getElementById('btn-review-changes');
  if (btn) {
    btn.addEventListener('click', () => {
      openReviewChangesModal();
    });
  }

  // Wire Modal Controls
  document.getElementById('btn-close-review-modal')?.addEventListener('click', closeReviewChangesModal);
  document.getElementById('btn-review-modal-done')?.addEventListener('click', closeReviewChangesModal);

  document.getElementById('modal-review-changes')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-review-changes') closeReviewChangesModal();
  });

  document.getElementById('review-files-search')?.addEventListener('input', (e) => {
    renderReviewChangesList(e.target.value);
  });

  document.getElementById('btn-review-clear-session')?.addEventListener('click', () => {
    clearSessionChangedFiles();
    renderReviewChangesList('');
    showToast('Changed files tracker cleared', 'info', 2000);
  });

  document.getElementById('btn-review-open-all')?.addEventListener('click', async () => {
    const all = getChangedFilesList();
    if (all.length === 0) return;
    closeReviewChangesModal();
    showToast(`Opening ${all.length} files in tabs...`, 'info', 2000);
    for (const f of all.slice(0, 10)) {
      await openFileDirectlyIntoEditor(f);
    }
  });

  // Listen for file changes emitted by agent or filesystem
  window.addEventListener('orbital:files-changed', (e) => {
    if (e.detail?.path) recordFileModified(e.detail.path);
    updateChangedFilesUI();
  });

  window.addEventListener('orbital:git-status-changed', () => {
    refreshChangedFiles();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-review-changes');
      if (modal && modal.style.display === 'flex') {
        closeReviewChangesModal();
      }
    }
  });

  // Initial poll
  refreshChangedFiles();
}
