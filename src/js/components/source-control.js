// ==========================================================================
// Orbital X — Source Control / Git Component (source-control.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { openDiffModal, openFileInTab } from '../editor/monaco.js';

export function initSourceControl() {
  ensureCommitUI();

  const refreshBtn = document.getElementById('btn-git-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshGitStatus);
  }
}

function ensureCommitUI() {
  const viewSC = document.getElementById('view-source-control');
  if (!viewSC || document.getElementById('git-commit-all-container')) return;

  // Hide static top commit box if present so commit UI is cleanly below file list
  const topCommitBox = document.getElementById('git-commit-message')?.parentElement;
  if (topCommitBox) {
    topCommitBox.style.display = 'none';
  }

  const container = document.createElement('div');
  container.id = 'git-commit-all-container';
  container.style.cssText = 'padding: 10px; border-top: 1px solid var(--border-subtle); background: var(--bg-surface); flex-shrink: 0;';
  container.innerHTML = `
    <textarea class="input-text" id="git-commit-all-message" placeholder="Commit message..." rows="2" style="width: 100%; resize: none; font-size: 11px; line-height: 1.4; margin-bottom: 6px;"></textarea>
    <button class="btn btn-primary btn-sm" id="btn-git-commit-all" style="width: 100%;">Commit All</button>
    <div id="git-commit-all-status" style="font-size: 11px; margin-top: 6px; min-height: 16px;"></div>
  `;

  viewSC.appendChild(container);

  const commitBtn = container.querySelector('#btn-git-commit-all');
  const commitInput = container.querySelector('#git-commit-all-message');
  const statusEl = container.querySelector('#git-commit-all-status');

  commitBtn?.addEventListener('click', async () => {
    const msg = commitInput?.value.trim();
    if (!msg) {
      if (statusEl) {
        statusEl.textContent = 'Please enter a commit message.';
        statusEl.style.color = 'var(--accent-orange)';
      }
      return;
    }

    commitBtn.disabled = true;
    commitBtn.innerHTML = '<span class="spinner"></span> Committing...';
    if (statusEl) {
      statusEl.textContent = 'Staging and committing all changes...';
      statusEl.style.color = 'var(--text-muted)';
    }

    try {
      await invoke('git_stage_and_commit', { message: msg });
      if (commitInput) commitInput.value = '';
      if (statusEl) {
        statusEl.textContent = '✓ Changes committed successfully!';
        statusEl.style.color = 'var(--accent-green)';
        setTimeout(() => {
          if (statusEl.textContent.includes('successfully')) statusEl.textContent = '';
        }, 4000);
      }
      await refreshGitStatus();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ Commit failed: ${err}`;
        statusEl.style.color = 'var(--accent-red)';
      }
    } finally {
      commitBtn.disabled = false;
      commitBtn.textContent = 'Commit All';
    }
  });
}

export async function refreshGitStatus() {
  ensureCommitUI();
  const container = document.getElementById('git-changes-list');
  const branchHeader = document.getElementById('git-branch-display');
  const badge = document.querySelector('.rail-badge');

  if (!container) return;

  container.innerHTML = '<div style="padding: 10px; font-size: 11px; color: var(--text-muted);"><span class="spinner"></span> Checking Git status...</div>';

  try {
    const status = await invoke('get_git_status');

    if (!status.is_repo) {
      if (branchHeader) branchHeader.textContent = "No Git Repo";
      if (badge) badge.style.display = 'none';
      container.innerHTML = `
        <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 11px;">
          The current workspace is not a Git repository.<br><br>
          <button class="btn btn-secondary btn-sm" id="btn-git-init">Initialize Repository</button>
        </div>
      `;
      container.querySelector('#btn-git-init')?.addEventListener('click', async () => {
        await invoke('run_command', { command: 'git init' });
        await refreshGitStatus();
      });
      return;
    }

    if (branchHeader) branchHeader.textContent = `Branch: ${status.branch}`;
    if (badge) {
      badge.textContent = status.changes.length.toString();
      badge.style.display = status.changes.length > 0 ? 'inline-block' : 'none';
    }

    // Update bottom status bar branch
    const sbGit = document.getElementById('status-git');
    if (sbGit) sbGit.querySelector('span').textContent = `${status.branch}*`;

    if (status.changes.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 11px;">✓ Working tree clean (No changes).</div>';
      return;
    }

    container.innerHTML = '';
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; display: flex; justify-content: space-between;';
    headerRow.innerHTML = `<span>CHANGES</span><span>${status.changes.length}</span>`;
    container.appendChild(headerRow);

    status.changes.forEach(change => {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        transition: background var(--trans-fast);
      `;
      row.className = 'tree-node';

      const statusColor = change.status.includes('M') ? 'var(--accent-cyan)' :
        change.status.includes('?') ? 'var(--accent-green)' :
        change.status.includes('D') ? 'var(--accent-red)' : 'var(--text-primary)';

      row.innerHTML = `
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px;" title="${change.path}">
          ${change.path}
        </span>
        <span style="font-weight: 700; color: ${statusColor}; font-family: var(--font-mono); font-size: 10px;">
          ${change.status}
        </span>
      `;

      row.addEventListener('click', async () => {
        try {
          const diffText = await invoke('get_git_diff', { path: change.path });
          if (diffText && diffText.trim()) {
            // Open Monaco diff editor
            const fileData = await invoke('read_file', { path: change.path });
            openDiffModal(change.path, "HEAD version\n(Run git checkout to revert)", fileData.content, () => {}, () => {});
          } else {
            const fileData = await invoke('read_file', { path: change.path });
            openFileInTab(fileData);
          }
        } catch (e) {
          console.warn("Could not preview diff:", e);
        }
      });

      container.appendChild(row);
    });

  } catch (err) {
    container.innerHTML = `<div style="padding: 10px; color: var(--accent-red); font-size: 11px;">Git error: ${err}</div>`;
  }
}
