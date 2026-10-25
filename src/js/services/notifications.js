// ==========================================================================
// Orbital X — Notification & Activity Center (notifications.js)
//
// K1: premium toasts — typed icons, action buttons, auto-dismiss progress
//     bar, hover-to-pause, max 5 stacked (newest on top).
// K2: Activity Center — every notification lands in a persistent feed
//     (max 50) with unread badge, exposed via the titlebar bell.
// K3: native OS notification bridge — notifyNative() calls the Rust side
//     for system toasts when the window is hidden/minimized.
// ==========================================================================

import { state } from '../state/store.js';

let toastContainer = null;

const ICONS = {
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="9 11 12 14 22 4"></polyline></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
};

// ---------------------------------------------------------------------------
// K2 — activity feed
// ---------------------------------------------------------------------------

export function recordActivity(message, type = 'info', meta = {}) {
  state.notifications = state.notifications || [];
  state.notifications.unshift({
    id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    message,
    type,
    timestamp: new Date().toISOString(),
    read: false,
    meta, // { path?, line?, command? } — used for click-to-navigate
  });
  if (state.notifications.length > 50) state.notifications = state.notifications.slice(0, 50);
  updateUnreadBadge();
  try { localStorage.setItem('orbital_activity', JSON.stringify(state.notifications)); } catch (e) { /* quota */ }
}

export function markAllActivityRead() {
  for (const n of state.notifications || []) n.read = true;
  updateUnreadBadge();
  try { localStorage.setItem('orbital_activity', JSON.stringify(state.notifications)); } catch (e) { /* quota */ }
}

export function clearActivity() {
  state.notifications = [];
  updateUnreadBadge();
  try { localStorage.removeItem('orbital_activity'); } catch (e) { /* quota */ }
}

export function loadActivityHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('orbital_activity') || '[]');
    if (Array.isArray(raw)) state.notifications = raw.slice(0, 50);
  } catch (e) { /* keep empty */ }
  updateUnreadBadge();
}

export function unreadActivityCount() {
  return (state.notifications || []).filter(n => !n.read).length;
}

function updateUnreadBadge() {
  const bell = document.getElementById('btn-activity-center');
  if (!bell) return;
  const count = unreadActivityCount();
  let badge = bell.querySelector('.activity-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'activity-badge';
      bell.appendChild(badge);
    }
    badge.textContent = count > 9 ? '9+' : String(count);
  } else if (badge) {
    badge.remove();
  }
}

// ---------------------------------------------------------------------------
// K1 — premium toasts
// ---------------------------------------------------------------------------

function ensureToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} durationMs  0 = sticky until closed
 * @param {Array<{label: string, onClick: Function, primary?: boolean}>} actions
 */
export function showToast(message, type = 'info', durationMs = 3000, actions = []) {
  const container = ensureToastContainer();
  const validTypes = ['info', 'success', 'warning', 'error'];
  const safeType = validTypes.includes(type) ? type : 'info';

  // K1: max 5 visible — oldest dismissed when a 6th arrives
  const existing = container.querySelectorAll('.toast-item:not(.toast-hide)');
  if (existing.length >= 5) {
    existing[existing.length - 1].classList.add('toast-hide');
    setTimeout(() => existing[existing.length - 1].remove(), 280);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${safeType}`;
  toast.setAttribute('role', safeType === 'error' ? 'alert' : 'status');

  const iconEl = document.createElement('div');
  iconEl.className = 'toast-icon';
  iconEl.innerHTML = ICONS[safeType] || ICONS.info;

  const contentEl = document.createElement('div');
  contentEl.className = 'toast-content';

  const msgEl = document.createElement('div');
  msgEl.className = 'toast-message';
  msgEl.textContent = message;

  contentEl.appendChild(msgEl);

  // K1: action buttons
  if (Array.isArray(actions) && actions.length > 0) {
    const row = document.createElement('div');
    row.className = 'toast-actions';
    for (const action of actions.slice(0, 3)) {
      const btn = document.createElement('button');
      btn.className = `toast-action-btn${action.primary ? ' primary' : ''}`;
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        try { action.onClick?.(); } finally { dismiss(); }
      });
      row.appendChild(btn);
    }
    contentEl.appendChild(row);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close-btn';
  closeBtn.title = 'Dismiss';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.innerHTML = '&times;';

  const progress = document.createElement('div');
  progress.className = 'toast-progress';
  if (durationMs > 0) progress.style.animationDuration = `${durationMs}ms`;

  toast.append(iconEl, contentEl, closeBtn, progress);

  // Newest on top
  container.insertBefore(toast, container.firstChild);

  requestAnimationFrame(() => toast.classList.add('toast-show'));

  let remaining = durationMs;
  let dismissTimeout = null;
  let startedAt = durationMs > 0 ? Date.now() : null;

  const dismiss = () => {
    if (dismissTimeout) clearTimeout(dismissTimeout);
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => toast.parentNode?.removeChild(toast), 280);
  };

  const schedule = () => {
    if (remaining <= 0) return;
    startedAt = Date.now();
    progress.style.animationPlayState = 'running';
    dismissTimeout = setTimeout(dismiss, remaining);
  };

  const pause = () => {
    if (!dismissTimeout) return;
    clearTimeout(dismissTimeout);
    dismissTimeout = null;
    remaining -= Date.now() - startedAt;
    progress.style.animationPlayState = 'paused';
  };

  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('mouseleave', schedule);
  closeBtn.addEventListener('click', dismiss);

  if (durationMs > 0) schedule();
  else progress.style.display = 'none';

  recordActivity(message, safeType);
  return { dismiss };
}

// ---------------------------------------------------------------------------
// K3 — native OS notification (via Rust), used when minimized/hidden
// ---------------------------------------------------------------------------

export async function notifyNative(title, body) {
  try {
    const { invoke } = await import('./tauri.js');
    await invoke('notify_native', { title, body });
  } catch (e) {
    // Browser preview / plugin unavailable — fall back to an in-app toast
    showToast(`${title} — ${body}`, 'info', 5000);
  }
}

/** True when the webview window is likely not visible to the user. */
export function isWindowHidden() {
  return document.hidden || document.visibilityState === 'hidden';
}
