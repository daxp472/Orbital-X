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
      card.style.cssText = 'background: var(--bg-surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 12px; display: flex; flex-direction: column; gap: 4px;';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: var(--accent-cyan); font-size: 11px; text-transform: uppercase;">[${mem.category}] ${mem.title}</strong>
          <button class="icon-btn" data-del-id="${mem.id}" title="Delete memory">✕</button>
        </div>
        <div style="color: var(--text-primary); font-size: 11px; line-height: 1.4;">${mem.content}</div>
        <div style="font-size: 9px; color: var(--text-muted);">${new Date(mem.timestamp).toLocaleString()}</div>
      `;

      card.querySelector('button')?.addEventListener('click', async () => {
        if (confirm(`Delete memory "${mem.title}"?`)) {
          await invoke('delete_memory', { id: mem.id });
          refreshMemories();
        }
      });

      container.appendChild(card);
    });
  } catch (e) {
    console.warn("Could not load memories:", e);
  }
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
