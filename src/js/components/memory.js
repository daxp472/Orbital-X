// ==========================================================================
// Orbital X — Project Memory Panel (memory.js)
//
// I6: grouped by category with icons, full-text search, importance stars
// (1-5, the agent injects high-importance entries first), relative age,
// and bulk delete. Backed by the Rust MemoryService (memory.json).
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showConfirmDialog } from '../services/dialogs.js';
import { showToast } from '../services/notifications.js';

const CATEGORY_META = {
  architecture: { icon: '🏛️', label: 'Architecture' },
  convention: { icon: '📏', label: 'Conventions' },
  rule: { icon: '📋', label: 'Rules' },
  instruction: { icon: '📝', label: 'Instructions' },
};

let memorySearchQuery = '';
const selectedMemoryIds = new Set();

export function initMemory() {
  document.getElementById('btn-add-memory')?.addEventListener('click', addMemoryPrompt);
  refreshMemories();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function relAge(timestamp) {
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export async function refreshMemories() {
  const host = document.getElementById('memory-list-container');
  if (!host) return;
  try {
    const mems = await invoke('list_memories');
    state.memories = mems || [];
  } catch (e) {
    state.memories = [];
  }
  renderMemoryPanel();
}

function renderMemoryPanel() {
  const host = document.getElementById('memory-list-container');
  if (!host) return;
  host.innerHTML = '';

  // Search box (I6)
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'input-text';
  search.placeholder = 'Search memories…';
  search.value = memorySearchQuery;
  search.style.cssText = 'width: 100%; font-size: 11px; margin-bottom: 8px;';
  search.addEventListener('input', () => {
    memorySearchQuery = search.value;
    renderMemoryPanel();
  });
  host.appendChild(search);

  const memories = state.memories || [];
  const q = memorySearchQuery.trim().toLowerCase();
  const filtered = q
    ? memories.filter(m =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.content || '').toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q))
    : memories;

  if (memories.length === 0) {
    host.insertAdjacentHTML('beforeend',
      '<div style="color: var(--text-muted); font-size: 12px; text-align: center; margin-top: 16px; line-height: 1.6;">No durable memories yet.<br>Click \'+\' to record an architectural rule or setup instruction.</div>');
    return;
  }
  if (filtered.length === 0) {
    host.insertAdjacentHTML('beforeend', '<div class="pack-empty">No memories match your search.</div>');
    return;
  }

  // Bulk delete bar when anything is selected
  if (selectedMemoryIds.size > 0) {
    const bulk = document.createElement('div');
    bulk.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
    bulk.innerHTML = `
      <button class="btn btn-danger btn-sm" id="mem-bulk-delete" style="flex: 1;">Delete selected (${selectedMemoryIds.size})</button>
      <button class="btn btn-secondary btn-sm" id="mem-bulk-clear">Clear</button>
    `;
    bulk.querySelector('#mem-bulk-delete').addEventListener('click', async () => {
      if (!confirm(`Delete ${selectedMemoryIds.size} memory entries?`)) return;
      for (const id of [...selectedMemoryIds]) {
        try { await invoke('delete_memory', { id }); } catch (e) { console.warn(e); }
      }
      selectedMemoryIds.clear();
      showToast('Memories deleted', 'success', 2200);
      refreshMemories();
    });
    bulk.querySelector('#mem-bulk-clear').addEventListener('click', () => {
      selectedMemoryIds.clear();
      renderMemoryPanel();
    });
    host.appendChild(bulk);
  }

  // Group by category (I6)
  const groups = new Map();
  for (const m of filtered) {
    const cat = m.category || 'instruction';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(m);
  }
  // High importance first within groups
  for (const list of groups.values()) {
    list.sort((a, b) => (b.importance || 3) - (a.importance || 3));
  }

  for (const [cat, list] of groups) {
    const meta = CATEGORY_META[cat] || { icon: '🗂️', label: cat };
    const header = document.createElement('div');
    header.style.cssText = 'font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: var(--text-secondary); margin: 6px 0 4px;';
    header.textContent = `${meta.icon} ${meta.label} (${list.length})`;
    host.appendChild(header);

    for (const m of list) {
      host.appendChild(memoryCard(m));
    }
  }
}

function memoryCard(m) {
  const card = document.createElement('div');
  card.className = 'pack-card';
  const importance = m.importance || 3;

  card.innerHTML = `
    <div class="pack-title-row">
      <input type="checkbox" class="mem-select" title="Select for bulk delete" ${selectedMemoryIds.has(m.id) ? 'checked' : ''}>
      <span class="pack-name" title="${esc(m.title)}">${esc(m.title)}</span>
      <span class="pack-meta">${esc(relAge(m.timestamp))}</span>
    </div>
    <div class="pack-desc">${esc((m.content || '').slice(0, 160))}${(m.content || '').length > 160 ? '…' : ''}</div>
    <div class="pack-actions">
      <span class="mem-stars" title="Importance — the agent injects high-importance entries first">
        ${[1, 2, 3, 4, 5].map(i => `<span class="mem-star ${i <= importance ? 'on' : ''}" data-star="${i}">★</span>`).join('')}
      </span>
      <button class="btn btn-secondary btn-sm mem-view" style="padding: 1px 8px; font-size: 10px;">View</button>
      <button class="btn btn-danger btn-sm mem-del" style="padding: 1px 8px; font-size: 10px;">Delete</button>
    </div>
    <div class="pack-detail mem-full" style="display: none;"></div>
  `;

  card.querySelector('.mem-select')?.addEventListener('change', (e) => {
    if (e.target.checked) selectedMemoryIds.add(m.id);
    else selectedMemoryIds.delete(m.id);
    renderMemoryPanel();
  });

  card.querySelectorAll('.mem-star').forEach(star => {
    star.style.cursor = 'pointer';
    star.addEventListener('click', async () => {
      const val = parseInt(star.dataset.star, 10);
      try {
        const res = await invoke('set_memory_importance', { id: m.id, importance: val });
        if (res && res.success) {
          m.importance = val;
          renderMemoryPanel();
        } else {
          showToast(res?.error || 'Could not set importance', 'error', 2500);
        }
      } catch (e) {
        showToast(`Failed: ${e}`, 'error', 2500);
      }
    });
  });

  card.querySelector('.mem-view')?.addEventListener('click', () => {
    const full = card.querySelector('.mem-full');
    if (full.style.display === 'none') {
      full.style.display = 'block';
      full.textContent = m.content || '';
    } else {
      full.style.display = 'none';
    }
  });

  card.querySelector('.mem-del')?.addEventListener('click', async () => {
    if (!(await showConfirmDialog('Delete Memory', `Delete memory "${m.title}"?`, 'Delete', true))) return;
    try {
      await invoke('delete_memory', { id: m.id });
      selectedMemoryIds.delete(m.id);
      showToast('Memory deleted', 'success', 1800);
      refreshMemories();
    } catch (e) {
      showToast(`Delete failed: ${e}`, 'error', 2500);
    }
  });

  return card;
}

async function addMemoryPrompt() {
  const title = prompt('Memory title (e.g. "Build commands"):');
  if (!title || !title.trim()) return;
  const category = prompt('Category (architecture / convention / rule / instruction):', 'convention') || 'convention';
  const content = prompt('Memory content:');
  if (!content || !content.trim()) return;
  try {
    await invoke('save_memory_entry', {
      category: category.trim(),
      title: title.trim(),
      content: content.trim(),
    });
    showToast('Memory saved', 'success', 1800);
    refreshMemories();
  } catch (e) {
    showToast(`Save failed: ${e}`, 'error', 2500);
  }
}
