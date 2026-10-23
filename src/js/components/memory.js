// ==========================================================================
// Orbital X — Memory Manager Component (memory.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { state } from '../state/store.js';

export function initMemory() {
  const addBtn = document.getElementById('btn-add-memory');
  if (addBtn) {
    addBtn.addEventListener('click', promptAddMemory);
  }
}

export async function refreshMemories() {
  const container = document.getElementById('memory-list-container');
  if (!container) return;

  try {
    const mems = await invoke('list_memories');
    state.memories = mems || [];

    if (state.memories.length === 0) {
      container.innerHTML = `
        <div style="color: var(--text-muted); font-size: 12px; text-align: center; margin-top: 20px;">
          No durable memories saved yet.<br>Click '+' to store an architecture rule or setup note.
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    state.memories.forEach(mem => {
      const card = document.createElement('div');
      card.className = 'memory-card-item';
      card.style.cssText = 'background: var(--bg-surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 12px; display: flex; flex-direction: column; gap: 4px;';

      function renderCardView() {
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: var(--accent-cyan); font-size: 11px; text-transform: uppercase;">[${escapeHtml(mem.category)}] ${escapeHtml(mem.title)}</strong>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button class="icon-btn btn-edit-memory" title="Edit memory" style="font-size: 11px; padding: 2px 4px;">✏️</button>
              <button class="icon-btn btn-del-memory" title="Delete memory" style="font-size: 11px; padding: 2px 4px;">✕</button>
            </div>
          </div>
          <div class="memory-card-content" style="color: var(--text-primary); font-size: 11px; line-height: 1.4; white-space: pre-wrap;">${escapeHtml(mem.content)}</div>
          <div style="font-size: 9px; color: var(--text-muted);">${new Date(mem.timestamp).toLocaleString()}</div>
        `;

        card.querySelector('.btn-edit-memory')?.addEventListener('click', () => {
          renderEditView();
        });

        card.querySelector('.btn-del-memory')?.addEventListener('click', async () => {
          if (confirm(`Delete memory "${mem.title}"?`)) {
            await invoke('delete_memory', { id: mem.id });
            refreshMemories();
          }
        });
      }

      function renderEditView() {
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: var(--accent-cyan); font-size: 11px; text-transform: uppercase;">[${escapeHtml(mem.category)}] ${escapeHtml(mem.title)}</strong>
          </div>
          <textarea class="input-text memory-edit-textarea" style="width: 100%; font-size: 11px; line-height: 1.4; resize: vertical; min-height: 60px; padding: 6px; font-family: inherit; margin: 4px 0;"></textarea>
          <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
            <button class="btn btn-secondary btn-sm btn-cancel-edit" style="font-size: 10px; padding: 2px 8px;">Cancel</button>
            <button class="btn btn-primary btn-sm btn-save-edit" style="font-size: 10px; padding: 2px 8px;">Save</button>
          </div>
        `;

        const textarea = card.querySelector('.memory-edit-textarea');
        if (textarea) textarea.value = mem.content;

        card.querySelector('.btn-cancel-edit')?.addEventListener('click', () => {
          renderCardView();
        });

        card.querySelector('.btn-save-edit')?.addEventListener('click', async () => {
          const newContent = textarea?.value.trim() ?? '';
          if (!newContent) {
            alert("Memory content cannot be empty.");
            return;
          }

          const saveBtn = card.querySelector('.btn-save-edit');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
          }

          try {
            await invoke('save_memory_entry', {
              category: mem.category || 'architecture',
              title: mem.title,
              content: newContent,
            });
            mem.content = newContent;
            await refreshMemories();
          } catch (err) {
            alert("Failed to save memory: " + err);
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
            }
          }
        });
      }

      renderCardView();
      container.appendChild(card);
    });
  } catch (e) {
    console.warn("Could not load memories:", e);
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function promptAddMemory() {
  const title = prompt("Enter memory title/rule (e.g. 'Use Tauri 2 only'):");
  if (!title) return;

  const content = prompt("Enter memory details/description:");
  if (!content) return;

  try {
    await invoke('save_memory_entry', {
      category: 'architecture',
      title,
      content,
    });
    refreshMemories();
  } catch (e) {
    alert("Error saving memory: " + e);
  }
}
