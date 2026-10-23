// ==========================================================================
// Orbital X — Notification Toast Service (notifications.js)
// ==========================================================================

let toastContainer = null;

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

const ICONS = {
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="9 11 12 14 22 4"></polyline></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
};

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} durationMs
 */
export function showToast(message, type = 'info', durationMs = 3000) {
  const container = ensureToastContainer();
  const validTypes = ['info', 'success', 'warning', 'error'];
  const safeType = validTypes.includes(type) ? type : 'info';

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${safeType}`;

  const iconEl = document.createElement('div');
  iconEl.className = 'toast-icon';
  iconEl.innerHTML = ICONS[safeType] || ICONS.info;

  const msgEl = document.createElement('div');
  msgEl.className = 'toast-message';
  msgEl.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close-btn';
  closeBtn.title = 'Dismiss';
  closeBtn.innerHTML = '&times;';

  toast.appendChild(iconEl);
  toast.appendChild(msgEl);
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  let dismissTimeout = null;

  const dismiss = () => {
    if (dismissTimeout) clearTimeout(dismissTimeout);
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  };

  closeBtn.addEventListener('click', dismiss);

  if (durationMs > 0) {
    dismissTimeout = setTimeout(dismiss, durationMs);
  }

  return { dismiss };
}
