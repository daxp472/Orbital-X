// ==========================================================================
// Orbital X — The "Time-Travel" Agent Journal (time-travel.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { showConfirmDialog } from '../services/dialogs.js';
import { showToast } from '../services/notifications.js';

let modal = null;
let turnsList = [];
let selectedTurn = null;
let selectedFile = null;

export function initTimeTravel() {
  createTimeTravelModal();
}

function createTimeTravelModal() {
  if (document.getElementById('modal-time-travel')) return;

  modal = document.createElement('div');
  modal.id = 'modal-time-travel';
  modal.className = 'modal-overlay';
  modal.style.cssText = `
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.76);
    backdrop-filter: blur(8px);
    z-index: 10000;
    align-items: center;
    justify-content: center;
  `;

  modal.innerHTML = `
    <div style="
      background: var(--bg-surface, #1e2029);
      border: 1px solid var(--border-color, #2d3142);
      border-radius: 12px;
      width: 920px;
      max-width: 95vw;
      height: 84vh;
      max-height: 800px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 60px rgba(0,0,0,0.65);
      overflow: hidden;
      font-family: var(--font-ui, system-ui, sans-serif);
    ">
      <!-- Header -->
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 22px;
        border-bottom: 1px solid var(--border-color);
        background: rgba(255, 255, 255, 0.02);
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 20px;">⏱️</span>
          <div>
            <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary);">The Time-Travel Agent Journal</h2>
            <div style="font-size: 11px; color: var(--text-secondary);">Visual git-like timeline tracking AI edits with 1-click atomic workspace rollback</div>
          </div>
        </div>
        <button id="btn-close-time-travel" style="
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        ">✕</button>
      </div>

      <!-- Scrubber Slider Bar -->
      <div style="padding: 14px 22px; background: rgba(0, 0, 0, 0.25); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 16px;">
        <span style="font-size: 12px; font-weight: 600; color: var(--text-secondary); white-space: nowrap;">Scrub Timeline:</span>
        <input type="range" id="tt-timeline-slider" min="0" max="0" value="0" style="flex: 1; accent-color: var(--accent-cyan, #00e5ff); cursor: pointer;">
        <span id="tt-slider-label" style="font-size: 12px; font-family: monospace; color: var(--accent-cyan, #00e5ff); white-space: nowrap;">0 / 0 Turns</span>
      </div>

      <!-- Split Main View: Left Turns List, Right Diff Details -->
      <div style="flex: 1; display: grid; grid-template-columns: 340px 1fr; overflow: hidden;">
        <!-- Left: Turns Timeline List -->
        <div id="tt-turns-container" style="
          border-right: 1px solid var(--border-color);
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: rgba(0,0,0,0.1);
        ">
          <div style="text-align: center; color: var(--text-secondary); padding: 40px 10px; font-size: 13px;">
            No agent turns recorded yet.<br>Ask the agent to create or modify files to view snapshots.
          </div>
        </div>

        <!-- Right: Turn Inspection & Diff -->
        <div id="tt-detail-container" style="display: flex; flex-direction: column; overflow: hidden; background: var(--bg-base, #13141c);">
          <div style="padding: 40px 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">
            Select a turn snapshot on the left to inspect multi-file modifications and review diffs.
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#btn-close-time-travel')?.addEventListener('click', closeTimeTravelModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeTimeTravelModal();
  });

  const slider = modal.querySelector('#tt-timeline-slider');
  slider?.addEventListener('input', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (turnsList[idx]) {
      selectTurn(turnsList[idx]);
    }
  });
}

export async function openTimeTravelModal() {
  if (!modal) createTimeTravelModal();
  modal.style.display = 'flex';
  await refreshTimeTravelTurns();
}

export function closeTimeTravelModal() {
  if (modal) modal.style.display = 'none';
}

export async function refreshTimeTravelTurns() {
  if (!modal) return;
  try {
    const rawTurns = await invoke('list_agent_turns');
    turnsList = (rawTurns || []).slice().reverse(); // Newest first for list, but keep track

    const slider = modal.querySelector('#tt-timeline-slider');
    const sliderLabel = modal.querySelector('#tt-slider-label');
    if (slider && sliderLabel) {
      slider.max = Math.max(0, turnsList.length - 1);
      slider.value = 0;
      sliderLabel.textContent = turnsList.length > 0 ? `Turn 1 of ${turnsList.length}` : '0 Turns';
    }

    renderTurnsList();
    if (turnsList.length > 0) {
      selectTurn(turnsList[0]);
    } else {
      renderEmptyDetail();
    }
  } catch (e) {
    console.error('Failed to load agent turns:', e);
  }
}

function renderTurnsList() {
  const container = modal.querySelector('#tt-turns-container');
  if (!container) return;

  if (turnsList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-secondary); padding: 40px 10px; font-size: 13px;">
        No agent turns recorded yet.<br>Ask the agent to create or modify files to view snapshots.
      </div>
    `;
    return;
  }

  container.innerHTML = turnsList.map((turn, idx) => {
    const isSelected = selectedTurn && selectedTurn.id === turn.id;
    const dateStr = formatTimestamp(turn.timestampMs || Date.parse(turn.timestamp));
    const promptShort = turn.prompt.length > 80 ? turn.prompt.slice(0, 80) + '…' : turn.prompt;

    return `
      <div class="tt-turn-card" data-turn-id="${turn.id}" style="
        background: ${isSelected ? 'rgba(0, 229, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)'};
        border: 1px solid ${isSelected ? 'var(--accent-cyan, #00e5ff)' : 'var(--border-color)'};
        border-radius: 8px;
        padding: 10px 12px;
        cursor: pointer;
        transition: all 0.15s ease;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-size: 11px; font-weight: 700; color: var(--accent-cyan, #00e5ff);">TURN #${turnsList.length - idx}</span>
          <span style="font-size: 10px; color: var(--text-secondary);">${dateStr}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-primary); font-weight: 500; margin-bottom: 6px; line-height: 1.3;">
          ${escapeHtml(promptShort || 'Autonomous agent action')}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; font-family: monospace;">
          <span style="color: var(--text-secondary);">📄 ${turn.fileCount || (turn.filePaths || []).length} file(s)</span>
          <span style="color: #10b981;">+${turn.totalAdditions || 0}</span>
          <span style="color: #ef4444;">-${turn.totalDeletions || 0}</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.tt-turn-card').forEach(card => {
    card.addEventListener('click', () => {
      const turnId = card.getAttribute('data-turn-id');
      const found = turnsList.find(t => t.id === turnId);
      if (found) selectTurn(found);
    });
  });
}

async function selectTurn(turn) {
  selectedTurn = turn;
  renderTurnsList();

  const slider = modal.querySelector('#tt-timeline-slider');
  const sliderLabel = modal.querySelector('#tt-slider-label');
  const idx = turnsList.findIndex(t => t.id === turn.id);
  if (slider && idx !== -1) {
    slider.value = idx;
    if (sliderLabel) sliderLabel.textContent = `Turn ${turnsList.length - idx} of ${turnsList.length}`;
  }

  // Fetch full details
  try {
    const full = await invoke('get_agent_turn_diff', { snapshotId: turn.id });
    renderTurnDetail(full || turn);
  } catch (e) {
    renderTurnDetail(turn);
  }
}

function renderEmptyDetail() {
  const detail = modal.querySelector('#tt-detail-container');
  if (detail) {
    detail.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">
        No turns to inspect.
      </div>
    `;
  }
}

function renderTurnDetail(turn) {
  const detail = modal.querySelector('#tt-detail-container');
  if (!detail) return;

  const files = turn.files || [];
  if (files.length > 0 && !selectedFile) {
    selectedFile = files[0];
  } else if (selectedFile) {
    selectedFile = files.find(f => f.path === selectedFile.path) || files[0];
  }

  const dateStr = new Date(turn.timestampMs || Date.parse(turn.timestamp)).toLocaleString();

  detail.innerHTML = `
    <!-- Top Bar with Rollback CTA -->
    <div style="
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
    ">
      <div>
        <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px;">
          Prompt: "${escapeHtml(turn.prompt || 'Agent Action')}"
        </div>
        <div style="font-size: 11px; color: var(--text-secondary);">
          Recorded at ${dateStr} • Multi-file atomic checkpoint
        </div>
      </div>
      <button id="btn-rollback-to-turn" style="
        background: #ef4444;
        color: #fff;
        border: none;
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
      ">
        ⏪ Roll Back Workspace to this Minute
      </button>
    </div>

    <!-- Files & Diff Container -->
    <div style="flex: 1; display: grid; grid-template-rows: auto 1fr; overflow: hidden;">
      <!-- File Selector Pills -->
      <div style="display: flex; gap: 8px; padding: 10px 18px; border-bottom: 1px solid var(--border-color); overflow-x: auto; background: rgba(0,0,0,0.15);">
        ${files.map(f => {
          const isAct = selectedFile && selectedFile.path === f.path;
          return `
            <button class="tt-file-tab" data-file-path="${escapeHtml(f.path)}" style="
              background: ${isAct ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)'};
              color: ${isAct ? 'var(--accent-cyan, #00e5ff)' : 'var(--text-secondary)'};
              border: 1px solid ${isAct ? 'var(--accent-cyan, #00e5ff)' : 'transparent'};
              border-radius: 4px;
              padding: 4px 10px;
              font-size: 11px;
              font-family: monospace;
              cursor: pointer;
              white-space: nowrap;
            ">
              ${f.kind === 'create' ? '✨ ' : f.kind === 'delete' ? '🗑️ ' : '📝 '}
              ${escapeHtml(f.relativePath || f.path)}
              <span style="color: #10b981; margin-left: 4px;">+${f.additions || 0}</span>
              <span style="color: #ef4444;">-${f.deletions || 0}</span>
            </button>
          `;
        }).join('')}
      </div>

      <!-- Diff Viewer -->
      <div id="tt-diff-viewer" style="flex: 1; overflow-y: auto; padding: 14px 18px; font-family: var(--font-code, monospace); font-size: 11px; line-height: 1.5; background: #0b0c10;">
        ${renderDiffContent(selectedFile)}
      </div>
    </div>
  `;

  // Bind file tab clicks
  detail.querySelectorAll('.tt-file-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-file-path');
      selectedFile = files.find(f => f.path === p);
      renderTurnDetail(turn);
    });
  });

  // Bind rollback button
  detail.querySelector('#btn-rollback-to-turn')?.addEventListener('click', async () => {
    const confirm = await showConfirmDialog(
      'Atomic Workspace Rollback',
      `Roll back your entire directory tree to the state of Turn #${turnsList.length - turnsList.findIndex(t => t.id === turn.id)}?\n\nEvery file created or modified by subsequent agent turns will be atomically reverted in one shot.`,
      'Roll Back Now',
      true
    );
    if (!confirm) return;

    try {
      const res = await invoke('time_travel_rollback', { snapshotId: turn.id });
      showToast(`Workspace atomically restored to turn (${res.reverted || 0} files reverted)`, 'success', 3500);
      window.dispatchEvent(new CustomEvent('orbital:workspace-reloaded'));
      closeTimeTravelModal();
    } catch (e) {
      showToast(`Rollback failed: ${e}`, 'error', 4000);
    }
  });
}

function renderDiffContent(file) {
  if (!file) {
    return `<div style="color: var(--text-secondary); text-align: center; padding: 30px;">No file selected.</div>`;
  }

  if (file.diffUnified) {
    const lines = file.diffUnified.split('\n');
    return lines.map(line => {
      if (line.startsWith('+')) {
        return `<div style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 1px 4px;">${escapeHtml(line)}</div>`;
      } else if (line.startsWith('-')) {
        return `<div style="background: rgba(239, 68, 68, 0.15); color: #f87171; padding: 1px 4px;">${escapeHtml(line)}</div>`;
      }
      return `<div style="color: #9ca3af; padding: 1px 4px;">${escapeHtml(line)}</div>`;
    }).join('');
  }

  return `<pre style="margin: 0; color: #e5e7eb;">${escapeHtml(file.afterContent || '')}</pre>`;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
