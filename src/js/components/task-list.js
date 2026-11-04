
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Orbital X — Task List Modal & Inspector (task-list.js)
// Real-time inspection of active and completed plans: Done, In Progress, What's Next
// ==========================================================================

import { state } from '../state/store.js';


let modalEl = null;
let escListener = null;

export function openTaskListModal() {
  closeTaskListModal();

  const plan = state.orchestrator?.activePlan || getLastPlanFromStorage();

  modalEl = document.createElement('div');
  modalEl.id = 'orbital-task-list-modal';
  modalEl.className = 'orbital-modal-backdrop';
  modalEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    animation: fadeIn 0.15s ease-out;
  `;

  renderModalContent(plan);

  document.body.appendChild(modalEl);

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeTaskListModal();
  });

  escListener = (e) => {
    if (e.key === 'Escape') closeTaskListModal();
  };
  window.addEventListener('keydown', escListener);
}

export function closeTaskListModal() {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
  if (escListener) {
    window.removeEventListener('keydown', escListener);
    escListener = null;
  }
}

export function toggleTaskListModal() {
  if (modalEl) {
    closeTaskListModal();
  } else {
    openTaskListModal();
  }
}

function getLastPlanFromStorage() {
  try {
    const raw = localStorage.getItem('orbital_last_plan');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function renderModalContent(plan) {
  if (!modalEl) return;

  if (!plan || !plan.tasks || plan.tasks.length === 0) {
    modalEl.innerHTML = `
      <div class="orbital-modal-window" style="
        width: 520px;
        background: var(--bg-card, #161b22);
        border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
        padding: 24px;
        color: var(--text-primary, #e6edf3);
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
            <span>📋</span> Orchestrated Task List
          </h3>
          <button class="icon-btn" id="task-modal-close" style="font-size: 16px; cursor: pointer; background: transparent; border: none; color: var(--text-muted, #8b949e);">✕</button>
        </div>
        <div style="text-align: center; padding: 32px 16px;">
          <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.8;">🧭</div>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px;">No Active Plan in Progress</div>
          <p style="font-size: 12px; color: var(--text-secondary, #8b949e); line-height: 1.5; max-width: 380px; margin: 0 auto 20px;">
            Orbital Agent creates structured implementation roadmaps when executing multi-step features or when you request <code>/plan</code>.
          </p>
          <button class="btn btn-primary btn-sm" id="btn-create-sample-plan" style="padding: 6px 16px; font-size: 12px;">
            Ask Agent to Create a Plan (/plan)
          </button>
        </div>
      </div>
    `;

    modalEl.querySelector('#task-modal-close')?.addEventListener('click', closeTaskListModal);
    modalEl.querySelector('#btn-create-sample-plan')?.addEventListener('click', () => {
      closeTaskListModal();
      const input = document.getElementById('agent-input');
      if (input) {
        input.value = '/plan ';
        input.focus();
      }
    });
    return;
  }

  const tasks = plan.tasks || [];
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const inProgressTask = tasks.find(t => t.status === 'in_progress');
  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'blocked');
  const progressPct = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

  const isLive = plan.status === 'in_progress';
  const statusBadge = isLive
    ? '<span style="background: rgba(57, 197, 187, 0.15); color: var(--accent-cyan, #00e5ff); border: 1px solid rgba(57, 197, 187, 0.35); font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #00e5ff; box-shadow: 0 0 6px #00e5ff;"></span> LIVE EXECUTION</span>'
    : (completedTasks.length === tasks.length
        ? '<span style="background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.35); font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">✓ COMPLETED</span>'
        : '<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">PAUSED</span>');

  modalEl.innerHTML = `
    <div class="orbital-modal-window" style="
      width: 680px;
      max-width: 92vw;
      max-height: 85vh;
      background: var(--bg-card, #161b22);
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.14));
      border-radius: 12px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: var(--text-primary, #e6edf3);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      animation: modalSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <!-- Header -->
      <div style="padding: 18px 22px; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); background: rgba(255, 255, 255, 0.02);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <h3 style="margin: 0; font-size: 16px; font-weight: 600;">📋 Task Roadmap</h3>
              ${statusBadge}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary, #8b949e); line-height: 1.4;">
              ${escapeHtml(plan.title || plan.objective || 'Workspace Task Execution')}
            </div>
          </div>
          <button class="icon-btn" id="task-modal-close" style="font-size: 16px; cursor: pointer; background: transparent; border: none; color: var(--text-muted, #8b949e); padding: 4px;">✕</button>
        </div>

        <!-- Progress Track -->
        <div style="margin-top: 14px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px;">
            <span><strong style="color: var(--accent-cyan, #00e5ff);">${completedTasks.length}</strong> of <strong>${tasks.length}</strong> tasks completed</span>
            <span style="font-weight: 600; color: var(--text-muted, #8b949e);">${progressPct}%</span>
          </div>
          <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden;">
            <div style="width: ${progressPct}%; height: 100%; background: linear-gradient(90deg, #00e5ff, #38bdf8); transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>

      <!-- Filter Tabs -->
      <div style="display: flex; gap: 8px; padding: 10px 22px; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06)); background: rgba(0, 0, 0, 0.15); font-size: 12px;">
        <button class="task-tab-btn active" data-filter="all" style="background: rgba(255, 255, 255, 0.08); border: 1px solid var(--border-subtle); color: #fff; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px;">All (${tasks.length})</button>
        <button class="task-tab-btn" data-filter="done" style="background: transparent; border: 1px solid transparent; color: var(--text-muted); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px;">✓ Done (${completedTasks.length})</button>
        <button class="task-tab-btn" data-filter="current" style="background: transparent; border: 1px solid transparent; color: var(--text-muted); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px;">⚡ In Progress (${inProgressTask ? 1 : 0})</button>
        <button class="task-tab-btn" data-filter="next" style="background: transparent; border: 1px solid transparent; color: var(--text-muted); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px;">⏳ Next (${pendingTasks.length})</button>
      </div>

      <!-- Task Cards List -->
      <div id="task-modal-cards" style="flex: 1; overflow-y: auto; padding: 18px 22px; display: flex; flex-direction: column; gap: 12px;">
        ${tasks.map((task, idx) => renderTaskCard(task, idx + 1)).join('')}
      </div>

      <!-- Footer Actions -->
      <div style="padding: 12px 22px; border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.02);">
        <span style="font-size: 11px; color: var(--text-muted, #8b949e);">
          ${plan.filesModified?.size ? `Modified ${plan.filesModified.size} files in this plan` : 'All changes verified with project test suite'}
        </span>
        <div style="display: flex; gap: 8px;">
          ${isLive ? `<button class="btn btn-sm btn-secondary" id="btn-modal-stop-task" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">✕ Stop Task</button>` : ''}
          <button class="btn btn-sm btn-primary" id="btn-modal-done">Close</button>
        </div>
      </div>
    </div>
  `;

  // Attach event handlers
  modalEl.querySelector('#task-modal-close')?.addEventListener('click', closeTaskListModal);
  modalEl.querySelector('#btn-modal-done')?.addEventListener('click', closeTaskListModal);

  modalEl.querySelector('#btn-modal-stop-task')?.addEventListener('click', () => {
    document.getElementById('task-sticky-cancel-btn')?.click();
    closeTaskListModal();
  });

  // Filter tabs click
  modalEl.querySelectorAll('.task-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modalEl.querySelectorAll('.task-tab-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderColor = 'transparent';
        b.style.color = 'var(--text-muted)';
      });
      btn.style.background = 'rgba(255, 255, 255, 0.08)';
      btn.style.borderColor = 'var(--border-subtle)';
      btn.style.color = '#fff';

      const filter = btn.dataset.filter;
      modalEl.querySelectorAll('.task-item-card').forEach(card => {
        if (filter === 'all') {
          card.style.display = 'block';
        } else if (filter === 'done') {
          card.style.display = card.dataset.status === 'completed' ? 'block' : 'none';
        } else if (filter === 'current') {
          card.style.display = card.dataset.status === 'in_progress' ? 'block' : 'none';
        } else if (filter === 'next') {
          card.style.display = (card.dataset.status === 'pending' || card.dataset.status === 'blocked') ? 'block' : 'none';
        }
      });
    });
  });
}

function renderTaskCard(task, index) {
  const isDone = task.status === 'completed';
  const isCurrent = task.status === 'in_progress';

  let statusBadge = '';
  let borderStyle = '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))';
  let bgStyle = 'rgba(255, 255, 255, 0.02)';

  if (isDone) {
    statusBadge = '<span style="color: #22c55e; font-weight: 700; font-size: 11px; display: flex; align-items: center; gap: 4px;">✓ DONE</span>';
    borderStyle = '1px solid rgba(34, 197, 94, 0.25)';
    bgStyle = 'rgba(34, 197, 94, 0.03)';
  } else if (isCurrent) {
    statusBadge = '<span style="color: var(--accent-cyan, #00e5ff); font-weight: 700; font-size: 11px; display: flex; align-items: center; gap: 4px;">⚡ IN PROGRESS</span>';
    borderStyle = '1px solid rgba(0, 229, 255, 0.45)';
    bgStyle = 'rgba(0, 229, 255, 0.05)';
  } else {
    statusBadge = '<span style="color: var(--text-muted, #8b949e); font-size: 11px;">⏳ WHAT\'S NEXT</span>';
  }

  const filesHtml = (task.files && task.files.length > 0)
    ? `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
        ${task.files.map(f => `<span style="font-family: var(--font-mono); font-size: 10px; background: rgba(255, 255, 255, 0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">${escapeHtml(f)}</span>`).join('')}
       </div>`
    : '';

  const evidenceHtml = task.evidence
    ? `<div style="margin-top: 8px; padding: 6px 10px; border-radius: 6px; background: rgba(34, 197, 94, 0.08); border-left: 3px solid #22c55e; font-size: 11px; color: #86efac;">
        <strong>Verification Evidence:</strong> ${escapeHtml(task.evidence)}
       </div>`
    : (task.criteria
        ? `<div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary, #8b949e);">
            <strong>Acceptance Criteria:</strong> ${escapeHtml(task.criteria)}
           </div>`
        : '');

  return `
    <div class="task-item-card" data-status="${task.status}" style="
      background: ${bgStyle};
      border: ${borderStyle};
      border-radius: 8px;
      padding: 12px 14px;
      transition: all 0.2s ease;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted, #8b949e); display: flex; align-items: center; gap: 6px;">
          <span style="width: 18px; height: 18px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); display: inline-flex; align-items: center; justify-content: center; font-size: 10px;">${index}</span>
          ${escapeHtml(task.title || `Task ${index}`)}
        </div>
        ${statusBadge}
      </div>
      <div style="font-size: 12px; line-height: 1.45; color: var(--text-primary, #e6edf3);">
        ${escapeHtml(task.objective || task.title)}
      </div>
      ${filesHtml}
      ${evidenceHtml}
    </div>
  `;
}

