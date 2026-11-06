// ==========================================================================
// Orbital X — Notification & Activity Center (notifications.js)
//
// K1: premium toasts — typed icons, action buttons, auto-dismiss progress bar.
// K2: Activity Center — person-to-person customizable feed (Feature 6):
//     Reduces hundreds of spammy notifications to a curated set of 15–20
//     meaningful notifications (milestones, plan progress, task completions)
//     while offering balanced and developer-level granularity presets.
// K3: native OS notification bridge — notifyNative() calls the Rust side.
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
// Person-to-Person Notification Persona / Preference (Feature 6)
// 'milestones' = Curated High-Signal (15–20 entries max, summaries only)
// 'balanced'   = Important changes, task progress, git commits
// 'all'        = Granular developer log (every file touch & command)
// ---------------------------------------------------------------------------

const PERSONA_KEY = 'orbital_notification_persona';

export function getNotificationPersona() {
  try {
    return localStorage.getItem(PERSONA_KEY) || 'milestones';
  } catch (e) {
    return 'milestones';
  }
}

export function setNotificationPersona(persona) {
  try {
    localStorage.setItem(PERSONA_KEY, persona || 'milestones');
  } catch (e) {}
}

/**
 * Categorize notification to enable intelligent filtering and aggregation.
 */
export function determineCategory(message, type, meta = {}) {
  if (meta.category) return meta.category;
  if (type === 'error') return 'error';

  const m = (message || '').toLowerCase();

  // Milestone / Task Completion Indicators
  if (
    m.includes('completed') ||
    m.includes('finished') ||
    m.includes('plan approved') ||
    m.includes('implementation') ||
    m.includes('all tasks') ||
    m.includes('milestone') ||
    m.includes('tasks completed') ||
    m.includes('run finished') ||
    m.includes('evidence verified') ||
    m.includes('tests passed') ||
    m.includes('tests failed')
  ) {
    return 'milestone';
  }

  // Task Step Indicators
  if (m.includes('task') || m.includes('step') || m.includes('stage') || m.includes('tool:')) {
    return 'task';
  }

  // File Mutating Indicators
  if (
    m.includes('written directly') ||
    m.includes('saved') ||
    m.includes('modified') ||
    m.includes('deleted') ||
    m.includes('patched') ||
    m.includes('file')
  ) {
    return 'file';
  }

  return 'system';
}

// ---------------------------------------------------------------------------
// K2 — Activity Feed with Smart De-duplication and Curated Filtering
// ---------------------------------------------------------------------------

export function recordActivity(message, type = 'info', meta = {}) {
  state.notifications = state.notifications || [];

  const category = determineCategory(message, type, meta);

  // De-duplication: If identical message arrived within 15 seconds, collapse into a count badge
  const now = Date.now();
  const recent = state.notifications[0];
  if (recent && recent.message === message && (now - new Date(recent.timestamp).getTime()) < 15000) {
    recent.count = (recent.count || 1) + 1;
    recent.timestamp = new Date().toISOString();
    updateUnreadBadge();
    try { localStorage.setItem('orbital_activity', JSON.stringify(state.notifications)); } catch (e) {}
    return;
  }

  state.notifications.unshift({
    id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    message,
    type,
    category,
    timestamp: new Date().toISOString(),
    read: false,
    count: 1,
    meta, // { path?, line?, command? }
  });

  // Keep a maximum buffer of 60 items in storage
  if (state.notifications.length > 60) {
    state.notifications = state.notifications.slice(0, 60);
  }

  updateUnreadBadge();
  try {
    localStorage.setItem('orbital_activity', JSON.stringify(state.notifications));
  } catch (e) {}
}

export function markAllActivityRead() {
  for (const n of state.notifications || []) n.read = true;
  updateUnreadBadge();
  try { localStorage.setItem('orbital_activity', JSON.stringify(state.notifications)); } catch (e) {}
}

export function clearActivity() {
  state.notifications = [];
  updateUnreadBadge();
  try { localStorage.removeItem('orbital_activity'); } catch (e) {}
}

export function loadActivityHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('orbital_activity') || '[]');
    if (Array.isArray(raw)) state.notifications = raw.slice(0, 60);
  } catch (e) {
    state.notifications = [];
  }
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

/**
 * Filter notifications according to persona and category filter chip.
 * When persona is 'milestones', curates to ~15-20 high-value notifications.
 */
export function getFilteredActivities(filterType = 'all', persona = null) {
  const currentPersona = persona || getNotificationPersona();
  const all = (state.notifications || []).slice();

  let filtered = all;

  // 1. Apply Persona Constraints
  if (currentPersona === 'milestones') {
    // Only show milestones, high-level task summaries, and critical errors
    filtered = all.filter(n => n.category === 'milestone' || n.category === 'task' || n.category === 'error' || n.type === 'error');
    // Limit to curated 15–20 essential items
    filtered = filtered.slice(0, 20);
  } else if (currentPersona === 'balanced') {
    // Hide spammy single file reads, keep writes, tasks, and milestones
    filtered = all.filter(n => !n.message.toLowerCase().startsWith('read file'));
    filtered = filtered.slice(0, 35);
  } else {
    // 'all' developer mode
    filtered = all.slice(0, 50);
  }

  // 2. Apply Specific Category Filter if selected
  if (filterType && filterType !== 'all') {
    filtered = filtered.filter(n => n.category === filterType || (filterType === 'error' && n.type === 'error'));
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// K1 — Premium Toasts with Smart Suppression in Milestone Persona
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
 * @param {object} meta
 */
export function showToast(message, type = 'info', durationMs = 3000, actions = [], meta = {}) {
  const container = ensureToastContainer();
  const validTypes = ['info', 'success', 'warning', 'error'];
  const safeType = validTypes.includes(type) ? type : 'info';

  // Always record into activity history with category
  recordActivity(message, safeType, meta);

  // Persona toast suppression:
  // If user prefers 'milestones', suppress repetitive micro toasts (e.g. minor file reads)
  const persona = getNotificationPersona();
  const cat = determineCategory(message, safeType, meta);
  if (persona === 'milestones' && cat === 'file' && !message.includes('Written directly') && safeType === 'info') {
    return { dismiss: () => {} };
  }

  // Max 5 visible stacked toasts
  const existing = container.querySelectorAll('.toast-item:not(.toast-hide)');
  if (existing.length >= 5) {
    existing[existing.length - 1].classList.add('toast-hide');
    setTimeout(() => existing[existing.length - 1]?.remove(), 280);
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

  return { dismiss };
}

// ---------------------------------------------------------------------------
// K3 — Native OS Notification Bridge
// ---------------------------------------------------------------------------

export async function notifyNative(title, body) {
  try {
    const { invoke } = await import('./tauri.js');
    await invoke('notify_native', { title, body });
  } catch (e) {
    showToast(`${title} — ${body}`, 'info', 5000);
  }
}

export function isWindowHidden() {
  return document.hidden || document.visibilityState === 'hidden';
}
