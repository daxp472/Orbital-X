// ==========================================================================
// Orbital X — Styled Dialog Service (dialogs.js)
//
// Replaces ALL native browser prompt()/confirm() calls with proper
// Orbital X styled modals. Native dialogs in Tauri show the ugly
// "tauri localhost wants to..." banner — these never do.
// ==========================================================================

let dialogActive = false;

/**
 * Styled input dialog (replaces native prompt()).
 * Returns a Promise<string|null> — resolves with the value or null on cancel.
 */
export function showInputDialog(title, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    if (dialogActive) { resolve(null); return; }
    dialogActive = true;

    document.getElementById('orbital-input-dialog')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'orbital-input-dialog';
    backdrop.style.cssText = 'display: flex; align-items: center; justify-content: center; z-index: 9000;';
    backdrop.innerHTML = `
      <div class="modal-container" style="width: 400px; max-width: 92vw; padding: 20px; display: flex; flex-direction: column; gap: 14px;">
        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${escapeHtml(title)}</div>
        <input type="text" class="input-text" id="orbital-dialog-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}"
          style="width: 100%; font-size: 13px; padding: 8px 12px;" autofocus />
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" id="orbital-dialog-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="orbital-dialog-ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('#orbital-dialog-input');
    const okBtn = backdrop.querySelector('#orbital-dialog-ok');
    const cancelBtn = backdrop.querySelector('#orbital-dialog-cancel');

    const finish = (value) => {
      dialogActive = false;
      backdrop.remove();
      resolve(value);
    };

    okBtn.addEventListener('click', () => finish(input.value));
    cancelBtn.addEventListener('click', () => finish(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(null); });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    window.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); window.removeEventListener('keydown', escHandler); }
    });

    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/**
 * Styled confirmation dialog (replaces native confirm()).
 * Returns a Promise<boolean>.
 */
export function showConfirmDialog(title, message, confirmLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    if (dialogActive) { resolve(false); return; }
    dialogActive = true;

    document.getElementById('orbital-confirm-dialog')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'orbital-confirm-dialog';
    backdrop.style.cssText = 'display: flex; align-items: center; justify-content: center; z-index: 9000;';
    backdrop.innerHTML = `
      <div class="modal-container" style="width: 380px; max-width: 92vw; padding: 20px; display: flex; flex-direction: column; gap: 14px;">
        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${escapeHtml(title)}</div>
        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" id="orbital-dialog-cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" id="orbital-dialog-ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const okBtn = backdrop.querySelector('#orbital-dialog-ok');
    const cancelBtn = backdrop.querySelector('#orbital-dialog-cancel');

    const finish = (value) => {
      dialogActive = false;
      backdrop.remove();
      resolve(value);
    };

    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(false); });

    window.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); window.removeEventListener('keydown', escHandler); }
      else if (e.key === 'Enter') { e.preventDefault(); finish(true); window.removeEventListener('keydown', escHandler); }
    });

    setTimeout(() => okBtn.focus(), 30);
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
