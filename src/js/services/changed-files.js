// ==========================================================================
// Orbital X — Changed Files & Review Tracker (changed-files.js)
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from './tauri.js';
import { showToast } from './notifications.js';

let sessionChangedFiles = new Set();
let cachedGitFiles = [];

export function recordFileModified(path) {
  if (!path || typeof path !== 'string') return;
  const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
  sessionChangedFiles.add(cleanPath);
  updateChangedFilesUI();
}

export function clearSessionChangedFiles() {
  sessionChangedFiles.clear();
  updateChangedFilesUI();
}

export async function refreshChangedFiles() {
  try {
    const res = await invoke('get_git_status');
    cachedGitFiles = [];
    if (res && res.is_repo && res.raw) {
      for (const line of res.raw.split('\n')) {
        if (line.startsWith('##') || line.trim().length < 3) continue;
        let p = line.slice(3).trim();
        const arrow = p.indexOf(' -> ');
        if (arrow !== -1) p = p.slice(arrow + 4);
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        if (p) cachedGitFiles.push(p.replace(/\\/g, '/'));
      }
    }
  } catch (e) {
    // If not a git repo, fall back to session modified files
  }
  updateChangedFilesUI();
}

export function updateChangedFilesUI() {
  const label = document.getElementById('agent-changed-files-label');
  const bar = document.getElementById('review-changes-bar');
  if (!label) return;

  const allFiles = new Set([...sessionChangedFiles, ...cachedGitFiles]);
  const count = allFiles.size;

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

export function initReviewChangesBar() {
  const btn = document.getElementById('btn-review-changes');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    await refreshChangedFiles();
    const allFiles = Array.from(new Set([...sessionChangedFiles, ...cachedGitFiles]));

    if (allFiles.length === 0) {
      showToast('✓ No uncommitted file changes in workspace.', 'info', 2400);
      return;
    }

    // Switch to Source Control tab to inspect all changes
    const sourceControlBtn = document.getElementById('rail-source-control');
    if (sourceControlBtn) {
      sourceControlBtn.click();
      showToast(`Reviewing ${allFiles.length} changed ${allFiles.length === 1 ? 'file' : 'files'} in Source Control`, 'info', 2200);
    }
  });

  // Listen for file changes emitted by agent or filesystem
  window.addEventListener('orbital:files-changed', (e) => {
    if (e.detail?.path) recordFileModified(e.detail.path);
    refreshChangedFiles();
  });

  window.addEventListener('orbital:git-status-changed', () => {
    refreshChangedFiles();
  });

  // Initial poll
  refreshChangedFiles();
}

