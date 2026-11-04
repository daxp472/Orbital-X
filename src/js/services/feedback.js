
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Orbital X — AI Feedback & Closed-Loop Quality System (feedback.js)
// Tracks happy responses (Likes) and collects structured MCQ feedback on Dislikes
// Re-loops user quality directives directly into the agent's base system prompt
// ==========================================================================

import { showToast } from './notifications.js';

const STORAGE_KEY = 'orbital_feedback_stats';

export function getFeedbackData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { totalLiked: 0, totalDisliked: 0, ratings: {}, dislikes: [] };
    }
    const data = JSON.parse(raw);
    return {
      totalLiked: data.totalLiked || 0,
      totalDisliked: data.totalDisliked || 0,
      ratings: data.ratings || {},
      dislikes: Array.isArray(data.dislikes) ? data.dislikes : []
    };
  } catch (_) {
    return { totalLiked: 0, totalDisliked: 0, ratings: {}, dislikes: [] };
  }
}

export function saveFeedbackData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Could not save feedback to localStorage:', e);
  }
}

/**
 * Handle user clicking 👍 Like on an AI response.
 * Enforces one-like rule and increments community happy responses.
 */
export function handleLikeResponse(messageId, cardEl) {
  const data = getFeedbackData();
  const currentRating = data.ratings[messageId];

  if (currentRating === 'up') {
    showToast("You've already liked this response! Thank you.", 'info', 1800);
    return;
  }

  if (currentRating === 'down') {
    data.totalDisliked = Math.max(0, data.totalDisliked - 1);
  }

  data.ratings[messageId] = 'up';
  data.totalLiked += 1;
  saveFeedbackData(data);

  // Update UI button classes
  const upBtn = cardEl?.querySelector('.msg-action[data-act="up"]');
  const downBtn = cardEl?.querySelector('.msg-action[data-act="down"]');
  if (upBtn) {
    upBtn.classList.add('liked');
    upBtn.style.color = '#22c55e';
    upBtn.style.filter = 'drop-shadow(0 0 6px rgba(34, 197, 94, 0.6))';
  }
  if (downBtn) {
    downBtn.classList.remove('disliked');
    downBtn.style.color = '';
    downBtn.style.filter = '';
  }

  showToast(`✨ Response liked! Total happy responses: ${data.totalLiked}`, 'success', 2200);
}

/**
 * Handle user clicking 👎 Dislike on an AI response.
 * Opens an interactive glassmorphic MCQ box for feedback & re-looping.
 */
export function handleDislikeResponse(messageId, cardEl, messageText) {
  const data = getFeedbackData();
  const currentRating = data.ratings[messageId];

  // Remove any existing feedback dialog
  document.getElementById('orbital-feedback-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'orbital-feedback-modal';
  modal.style.cssText = `
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
    z-index: 999999;
    animation: fadeIn 0.15s ease-out;
  `;

  modal.innerHTML = `
    <div style="
      width: 480px;
      max-width: 90vw;
      background: var(--bg-card, #161b22);
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.14));
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
      padding: 22px;
      color: var(--text-primary, #e6edf3);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      animation: modalSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
          <span>👎</span> Improve Orbital Agent
        </h3>
        <button id="btn-fb-close" style="background: transparent; border: none; color: var(--text-muted, #8b949e); font-size: 16px; cursor: pointer;">✕</button>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary, #8b949e); margin-bottom: 14px; line-height: 1.4;">
        What went wrong with this response? Your answers train the agent's prompt re-looping to prevent similar issues.
      </div>

      <!-- MCQ Checkboxes -->
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; font-size: 12px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 6px;">
          <input type="checkbox" name="fb-reason" value="buggy_code" style="accent-color: var(--accent-cyan, #00e5ff);">
          <span>Incorrect or buggy code (syntax or logic error)</span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 6px;">
          <input type="checkbox" name="fb-reason" value="ignored_instructions" style="accent-color: var(--accent-cyan, #00e5ff);">
          <span>Ignored prompt instructions or skipped requirements</span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 6px;">
          <input type="checkbox" name="fb-reason" value="hallucinated" style="accent-color: var(--accent-cyan, #00e5ff);">
          <span>Hallucinated nonexistent file, import, or tool</span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 6px;">
          <input type="checkbox" name="fb-reason" value="incomplete" style="accent-color: var(--accent-cyan, #00e5ff);">
          <span>Incomplete or cut-off answer</span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 6px;">
          <input type="checkbox" name="fb-reason" value="slow_verbose" style="accent-color: var(--accent-cyan, #00e5ff);">
          <span>Too verbose or slow / unnecessary filler</span>
        </label>
      </div>

      <!-- Optional Details Textarea -->
      <div style="margin-bottom: 14px;">
        <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 4px;">
          Additional details (optional):
        </label>
        <textarea id="fb-comment" placeholder="What should the agent have done instead?" style="
          width: 100%;
          box-sizing: border-box;
          min-height: 60px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
          border-radius: 6px;
          padding: 8px;
          font-size: 11px;
          color: #fff;
          font-family: inherit;
          resize: vertical;
        "></textarea>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-sm btn-secondary" id="btn-fb-skip">Cancel</button>
        <button class="btn btn-sm btn-primary" id="btn-fb-submit">Submit Feedback</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeFn = () => modal.remove();
  modal.querySelector('#btn-fb-close')?.addEventListener('click', closeFn);
  modal.querySelector('#btn-fb-skip')?.addEventListener('click', closeFn);

  modal.querySelector('#btn-fb-submit')?.addEventListener('click', () => {
    const checked = Array.from(modal.querySelectorAll('input[name="fb-reason"]:checked')).map(el => el.value);
    const comment = modal.querySelector('#fb-comment')?.value.trim() || '';

    // Record dislike in data
    const d = getFeedbackData();
    if (d.ratings[messageId] === 'up') {
      d.totalLiked = Math.max(0, d.totalLiked - 1);
    }
    if (d.ratings[messageId] !== 'down') {
      d.totalDisliked += 1;
    }
    d.ratings[messageId] = 'down';

    d.dislikes.push({
      messageId,
      timestamp: new Date().toISOString(),
      reasons: checked.length > 0 ? checked : ['general_dislike'],
      note: comment,
      contextSnippet: (messageText || '').slice(0, 300)
    });

    // Keep only last 50 dislikes
    if (d.dislikes.length > 50) d.dislikes = d.dislikes.slice(-50);
    saveFeedbackData(d);

    // Update UI button classes
    const upBtn = cardEl?.querySelector('.msg-action[data-act="up"]');
    const downBtn = cardEl?.querySelector('.msg-action[data-act="down"]');
    if (downBtn) {
      downBtn.classList.add('disliked');
      downBtn.style.color = '#ef4444';
      downBtn.style.filter = 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.6))';
    }
    if (upBtn) {
      upBtn.classList.remove('liked');
      upBtn.style.color = '';
      upBtn.style.filter = '';
    }

    closeFn();
    showToast('Feedback submitted. Orbital Agent will adjust to avoid this in future turns.', 'success', 2400);
  });
}

/**
 * Returns dynamic quality directives derived from recent user dislikes.
 * Injected into the base agent system prompt for closed-loop self-improvement.
 */
export function getFeedbackDirectivesForPrompt() {
  const data = getFeedbackData();
  const dislikes = data.dislikes || [];
  if (dislikes.length === 0) return '';

  const recent = dislikes.slice(-10);
  const reasonsSet = new Set();
  const notes = [];

  for (const item of recent) {
    if (Array.isArray(item.reasons)) {
      item.reasons.forEach(r => reasonsSet.add(r));
    }
    if (item.note && item.note.length > 4) {
      notes.push(item.note);
    }
  }

  const rules = [];
  if (reasonsSet.has('buggy_code')) {
    rules.push('CODE RIGOR: The user previously reported syntax or logic bugs. Thoroughly verify all code logic, imports, and variables before emitting.');
  }
  if (reasonsSet.has('ignored_instructions')) {
    rules.push('STRICT COMPLIANCE: The user previously noted missed instructions. Follow every detail, step, and constraint requested in the user prompt.');
  }
  if (reasonsSet.has('hallucinated')) {
    rules.push('GROUNDED REALITY: Never fabricate or guess file paths or APIs. Always inspect with search_files or list_files first.');
  }
  if (reasonsSet.has('incomplete')) {
    rules.push('COMPLETENESS: Provide end-to-end, working solutions; never leave unfinished code or placeholders.');
  }
  if (reasonsSet.has('slow_verbose')) {
    rules.push('CONCISENESS: Avoid conversational filler; deliver direct, actionable code and explanations.');
  }

  if (notes.length > 0) {
    rules.push(`USER SPECIFIC DIRECTIVES: ${notes.slice(-2).map(n => `"${escapeHtml(n)}"`).join('; ')}`);
  }

  if (rules.length === 0) return '';

  return `\n\n## CLOSED-LOOP USER QUALITY FEEDBACK (LEARNED FROM PAST USER CORRECTIONS):\n` +
    rules.map(r => `• ${r}`).join('\n') +
    `\nCRITICAL: Strictly adhere to these directives to guarantee user satisfaction.`;
}

