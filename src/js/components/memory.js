// ==========================================================================
// Orbital X — Project Memory & Knowledge Management Page (memory.js)
//
// Apple HIG & Antigravity polished architecture:
// 1. Core Memory Cards Grid: search, category filter, in-place edit, delete,
//    dynamic 1-5 star importance rating, and custom add form drawer.
// 2. Information Directory & Dependencies: real-time dependency inspector
//    (Cargo.toml, package.json, requirements.txt), detected entrypoints, and
//    changelog library records.
// 3. Architectural Graph: structural AST nodes, component hierarchy, and
//    dependency relations via Semantic Graph Engine.
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showConfirmDialog } from '../services/dialogs.js';
import { showToast } from '../services/notifications.js';

const CATEGORY_META = {
  architecture: { icon: '🏛️', label: 'Architecture', color: '#c084fc', bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.28)' },
  convention: { icon: '📏', label: 'Convention', color: 'var(--accent-cyan)', bg: 'rgba(57, 197, 187, 0.12)', border: 'rgba(57, 197, 187, 0.28)' },
  rule: { icon: '📋', label: 'Rule', color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.28)' },
  instruction: { icon: '📝', label: 'Instruction', color: '#facc15', bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.28)' },
  decision: { icon: '🎯', label: 'Decision', color: '#f472b6', bg: 'rgba(236, 72, 153, 0.12)', border: 'rgba(236, 72, 153, 0.28)' },
  progress: { icon: '⚡', label: 'Progress', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.12)', border: 'rgba(251, 146, 60, 0.28)' },
  iteration_history: { icon: '📜', label: 'History', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.28)' },
};

let memorySearchQuery = '';
let modalSearchQuery = '';
let modalCategoryFilter = 'all';
const selectedMemoryIds = new Set();
let isInitialized = false;

export function initMemory() {
  if (isInitialized) return;
  isInitialized = true;

  // Sidebar controls
  document.getElementById('btn-add-memory')?.addEventListener('click', () => openMemoryDrawer());
  document.getElementById('btn-open-memory-modal')?.addEventListener('click', openMemoryManagerModal);
  document.getElementById('btn-open-memory-modal-icon')?.addEventListener('click', openMemoryManagerModal);

  // Modal controls
  const modal = document.getElementById('modal-memory-manager');
  document.getElementById('btn-close-memory-manager')?.addEventListener('click', closeMemoryManagerModal);
  document.getElementById('btn-close-memory-modal')?.addEventListener('click', closeMemoryManagerModal);

  // Backdrop click on modal closes it
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeMemoryManagerModal();
    }
  });

  // Modal Tab switching (Apple Segmented Bar)
  const tabs = document.querySelectorAll('.memory-nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetTab = tab.dataset.mtab;
      switchModalTab(targetTab);
    });
  });

  // Modal search & category filters
  const modalSearch = document.getElementById('memory-modal-search') || document.getElementById('mem-modal-search');
  modalSearch?.addEventListener('input', () => {
    modalSearchQuery = modalSearch.value || '';
    renderModalCoreMemories();
  });

  // Category filter pills
  const filterPills = document.querySelectorAll('.mem-filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      modalCategoryFilter = pill.dataset.cat || 'all';
      renderModalCoreMemories();
    });
  });

  // Modal Add Memory buttons
  document.getElementById('btn-modal-add-memory')?.addEventListener('click', () => openMemoryDrawer());
  document.getElementById('mem-modal-add-btn')?.addEventListener('click', () => openMemoryDrawer());

  // Modal Sync / Refresh button
  document.getElementById('btn-modal-refresh-memory')?.addEventListener('click', async () => {
    showToast('Syncing memory and scanning workspace…', 'info', 1800);
    await refreshMemories();
    const activeTab = document.querySelector('.memory-nav-tab.active')?.dataset?.mtab || 'core';
    switchModalTab(activeTab);
    showToast('✓ Memory & Knowledge Directory synced', 'success', 2000);
  });

  // Drawer Form controls (replaces prompt() with Apple HIG in-place drawer)
  document.getElementById('btn-close-mem-drawer')?.addEventListener('click', closeMemoryDrawer);
  document.getElementById('btn-cancel-mem-drawer')?.addEventListener('click', closeMemoryDrawer);
  document.getElementById('btn-save-mem-drawer')?.addEventListener('click', saveMemoryFromDrawer);

  const drawer = document.getElementById('memory-edit-drawer');
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) {
      closeMemoryDrawer();
    }
  });

  // Drawer star rating selector
  document.querySelectorAll('#mem-drawer-stars .drawer-star').forEach(star => {
    star.addEventListener('click', () => {
      const val = parseInt(star.dataset.val, 10);
      updateDrawerStars(val);
    });
  });

  // Architectural graph re-index button delegation
  document.getElementById('memory-panel-graph')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('#btn-reindex-graph');
    if (btn) {
      showToast('Re-indexing workspace semantic graph…', 'info', 2000);
      try {
        await invoke('graph_reindex');
        showToast('✓ Workspace semantic graph updated', 'success', 2200);
        renderArchitecturalGraph();
      } catch (err) {
        showToast(`Graph index error: ${err}`, 'error', 2500);
      }
    }
  });

  // Close modal on Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('memory-edit-drawer');
      if (drawer && drawer.style.display !== 'none') {
        closeMemoryDrawer();
        e.stopPropagation();
        return;
      }
      if (modal && modal.style.display !== 'none') {
        closeMemoryManagerModal();
        e.stopPropagation();
      }
    }
  });

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
  try {
    const mems = await invoke('list_memories');
    state.memories = Array.isArray(mems) ? mems : [];
  } catch (e) {
    state.memories = [];
  }
  renderSidebarPanel();
  renderModalCoreMemories();
}

// ---------------------------------------------------------------------------
// Sidebar Memory Panel
// ---------------------------------------------------------------------------

function renderSidebarPanel() {
  const host = document.getElementById('memory-list-container');
  if (!host) return;
  host.innerHTML = '';

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
    host.insertAdjacentHTML('beforeend', '<div class="pack-empty" style="padding: 12px; font-size: 11px; color: var(--text-muted); text-align: center;">No memories match search.</div>');
    return;
  }

  // Group by category
  const groups = new Map();
  for (const m of filtered) {
    const cat = m.category || 'instruction';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(m);
  }
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
      host.appendChild(sidebarMemoryCard(m));
    }
  }
}

function sidebarMemoryCard(m) {
  const card = document.createElement('div');
  card.className = 'pack-card';
  const importance = m.importance || 3;

  card.innerHTML = `
    <div class="pack-title-row">
      <span class="pack-name" title="${esc(m.title)}">${esc(m.title)}</span>
      <span class="pack-meta">${esc(relAge(m.timestamp))}</span>
    </div>
    <div class="pack-desc">${esc((m.content || '').slice(0, 140))}${(m.content || '').length > 140 ? '…' : ''}</div>
    <div class="pack-actions" style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
      <span class="mem-stars" title="Importance — the agent prioritizes higher ratings">
        ${[1, 2, 3, 4, 5].map(i => `<span class="mem-star ${i <= importance ? 'on' : ''}" data-star="${i}" style="color: ${i <= importance ? '#eab308' : 'rgba(255,255,255,0.15)'}; font-size: 11px; cursor: pointer;">★</span>`).join('')}
      </span>
      <div style="display: flex; gap: 4px;">
        <button class="btn btn-secondary btn-sm mem-edit" style="padding: 1px 7px; font-size: 10px;">Edit</button>
        <button class="btn btn-danger btn-sm mem-del" style="padding: 1px 7px; font-size: 10px;">✕</button>
      </div>
    </div>
  `;

  card.querySelectorAll('.mem-star').forEach(star => {
    star.addEventListener('click', async () => {
      const val = parseInt(star.dataset.star, 10);
      await updateImportance(m.id, val);
    });
  });

  card.querySelector('.mem-edit')?.addEventListener('click', () => {
    openMemoryDrawer(m);
  });

  card.querySelector('.mem-del')?.addEventListener('click', async () => {
    if (!(await showConfirmDialog('Delete Memory', `Delete memory "${m.title}"?`, 'Delete', true))) return;
    deleteMemoryById(m.id);
  });

  return card;
}

// ---------------------------------------------------------------------------
// Full Knowledge Directory Modal
// ---------------------------------------------------------------------------

export function openMemoryManagerModal() {
  const modal = document.getElementById('modal-memory-manager');
  if (!modal) return;
  modal.style.display = 'flex';
  refreshMemories();
  switchModalTab('core');
}

export function closeMemoryManagerModal() {
  const modal = document.getElementById('modal-memory-manager');
  if (modal) modal.style.display = 'none';
  closeMemoryDrawer();
}

function switchModalTab(tabId) {
  const panels = {
    core: document.getElementById('memory-panel-core'),
    info: document.getElementById('memory-panel-info'),
    graph: document.getElementById('memory-panel-graph'),
  };

  Object.keys(panels).forEach(k => {
    if (panels[k]) {
      panels[k].style.display = k === tabId ? 'flex' : 'none';
    }
  });

  if (tabId === 'core') {
    renderModalCoreMemories();
  } else if (tabId === 'info') {
    renderInformationDirectory();
  } else if (tabId === 'graph') {
    renderArchitecturalGraph();
  }
}

// ---------------------------------------------------------------------------
// Modal Tab 1: Core Memory Cards Grid
// ---------------------------------------------------------------------------

function renderModalCoreMemories() {
  const grid = document.getElementById('memory-modal-cards-grid');
  const countPill = document.getElementById('mem-modal-count-pill');
  if (!grid) return;
  grid.innerHTML = '';

  const memories = state.memories || [];
  if (countPill) countPill.textContent = `${memories.length} item${memories.length === 1 ? '' : 's'}`;

  const q = modalSearchQuery.trim().toLowerCase();
  const catFilter = modalCategoryFilter;

  const filtered = memories.filter(m => {
    if (catFilter !== 'all') {
      const mc = (m.category || '').toLowerCase();
      if (catFilter === 'history') {
        if (mc !== 'iteration_history' && mc !== 'progress') return false;
      } else if (mc !== catFilter.toLowerCase()) {
        return false;
      }
    }
    if (q) {
      return (m.title || '').toLowerCase().includes(q) ||
             (m.content || '').toLowerCase().includes(q) ||
             (m.category || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Sort: highest importance first, then newest
  filtered.sort((a, b) => {
    const diff = (b.importance || 3) - (a.importance || 3);
    if (diff !== 0) return diff;
    return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 16px; color: var(--text-muted); text-align: center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4; margin-bottom: 12px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">No memories found</div>
        <div style="font-size: 12px; max-width: 320px;">${memories.length === 0 ? 'Click "+ Add Memory" to store workspace rules, tech stack decisions, or conventions.' : 'No memories match your current search or category filter.'}</div>
      </div>
    `;
    return;
  }

  for (const m of filtered) {
    grid.appendChild(modalMemoryCard(m));
  }
}

function modalMemoryCard(m) {
  const card = document.createElement('div');
  card.className = 'memory-modal-card';

  const rawCat = (m.category || 'convention').toLowerCase();
  const meta = CATEGORY_META[rawCat] || {
    icon: '🗂️',
    label: m.category || 'Note',
    color: 'var(--accent-cyan)',
    bg: 'rgba(57, 197, 187, 0.12)',
    border: 'rgba(57, 197, 187, 0.28)',
  };
  const importance = m.importance || 3;

  card.innerHTML = `
    <div class="memory-card-header">
      <div class="memory-card-title-group">
        <span style="font-size: 14px;">${meta.icon}</span>
        <span class="memory-card-title" title="${esc(m.title)}">${esc(m.title)}</span>
      </div>
      <span class="memory-card-badge" style="color: ${meta.color}; background: ${meta.bg}; border: 1px solid ${meta.border};">${esc(meta.label)}</span>
    </div>

    <div class="memory-card-snippet">${esc(m.content || '')}</div>

    <div class="memory-card-footer">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="mem-stars" title="Set importance (1-5 stars)">
          ${[1, 2, 3, 4, 5].map(i => `<span class="mem-modal-star ${i <= importance ? 'on' : ''}" data-star="${i}">★</span>`).join('')}
        </span>
        <span style="font-size: 10px; color: var(--text-muted);">${esc(relAge(m.timestamp))}</span>
      </div>

      <div style="display: flex; gap: 6px;">
        <button class="mem-btn-edit btn-card-edit" title="Edit this memory">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        <button class="mem-btn-delete btn-card-del" title="Delete this memory">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>Delete</span>
        </button>
      </div>
    </div>
  `;

  card.querySelectorAll('.mem-modal-star').forEach(star => {
    star.addEventListener('click', async () => {
      const val = parseInt(star.dataset.star, 10);
      await updateImportance(m.id, val);
    });
  });

  card.querySelector('.btn-card-edit')?.addEventListener('click', () => {
    openMemoryDrawer(m);
  });

  card.querySelector('.btn-card-del')?.addEventListener('click', async () => {
    if (!(await showConfirmDialog('Delete Memory', `Delete memory "${m.title}"?`, 'Delete', true))) return;
    deleteMemoryById(m.id);
  });

  return card;
}

async function updateImportance(id, importance) {
  try {
    const res = await invoke('set_memory_importance', { id, importance });
    if (res && res.success) {
      const item = (state.memories || []).find(x => x.id === id);
      if (item) item.importance = importance;
      renderSidebarPanel();
      renderModalCoreMemories();
    }
  } catch (e) {
    showToast(`Failed: ${e}`, 'error', 2000);
  }
}

async function deleteMemoryById(id) {
  try {
    await invoke('delete_memory', { id });
    selectedMemoryIds.delete(id);
    state.memories = (state.memories || []).filter(x => x.id !== id);
    showToast('Memory removed', 'success', 1800);
    renderSidebarPanel();
    renderModalCoreMemories();
  } catch (e) {
    showToast(`Delete failed: ${e}`, 'error', 2500);
  }
}

// ---------------------------------------------------------------------------
// Drawer Form (In-place modal overlay — replaces prompt())
// ---------------------------------------------------------------------------

function updateDrawerStars(val) {
  const stars = document.querySelectorAll('#mem-drawer-stars .drawer-star');
  stars.forEach(s => {
    const v = parseInt(s.dataset.val, 10);
    s.classList.toggle('on', v <= val);
  });
  const impInput = document.getElementById('mem-edit-importance');
  if (impInput) impInput.value = String(val);
  const label = document.getElementById('mem-importance-label');
  if (label) {
    const labels = {
      5: '★★★★★ (Critical Anchor)',
      4: '★★★★☆ (High Priority)',
      3: '★★★☆☆ (Normal)',
      2: '★★☆☆☆ (Low)',
      1: '★☆☆☆☆ (Trivial)',
    };
    label.textContent = labels[val] || `${val} stars`;
  }
}

function openMemoryDrawer(existing = null) {
  const drawer = document.getElementById('memory-edit-drawer');
  if (!drawer) return;

  const titleHeader = document.getElementById('mem-drawer-title');
  const idInput = document.getElementById('mem-edit-id');
  const titleInput = document.getElementById('mem-edit-title');
  const catSelect = document.getElementById('mem-edit-category');
  const contentInput = document.getElementById('mem-edit-content');

  const imp = existing ? (existing.importance || 3) : 3;

  if (existing) {
    if (titleHeader) titleHeader.textContent = 'Edit Durable Memory';
    if (idInput) idInput.value = existing.id || '';
    if (titleInput) titleInput.value = existing.title || '';
    if (catSelect) catSelect.value = existing.category || 'convention';
    if (contentInput) contentInput.value = existing.content || '';
  } else {
    if (titleHeader) titleHeader.textContent = 'Add Durable Memory';
    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    if (catSelect) catSelect.value = 'convention';
    if (contentInput) contentInput.value = '';
  }

  updateDrawerStars(imp);
  drawer.style.display = 'flex';
  setTimeout(() => titleInput?.focus(), 50);
}

function closeMemoryDrawer() {
  const drawer = document.getElementById('memory-edit-drawer');
  if (drawer) drawer.style.display = 'none';
}

async function saveMemoryFromDrawer() {
  const id = document.getElementById('mem-edit-id')?.value;
  const title = document.getElementById('mem-edit-title')?.value?.trim();
  const category = document.getElementById('mem-edit-category')?.value || 'convention';
  const importance = parseInt(document.getElementById('mem-edit-importance')?.value || '3', 10);
  const content = document.getElementById('mem-edit-content')?.value?.trim();

  if (!title) {
    showToast('Please enter a memory title', 'error', 2200);
    document.getElementById('mem-edit-title')?.focus();
    return;
  }
  if (!content) {
    showToast('Please enter memory instructions/content', 'error', 2200);
    document.getElementById('mem-edit-content')?.focus();
    return;
  }

  try {
    // If editing existing, delete old first
    if (id) {
      await invoke('delete_memory', { id });
    }

    const saved = await invoke('save_memory_entry', {
      category,
      title,
      content,
    });

    if (saved && saved.id && importance !== 3) {
      await invoke('set_memory_importance', { id: saved.id, importance });
    }

    showToast('✓ Memory saved to project store', 'success', 2200);
    closeMemoryDrawer();
    refreshMemories();
  } catch (err) {
    showToast(`Save failed: ${err}`, 'error', 3000);
  }
}

// ---------------------------------------------------------------------------
// Modal Tab 2: Information Directory & Dependencies
// ---------------------------------------------------------------------------

async function renderInformationDirectory() {
  const host = document.getElementById('info-directory-content');
  if (!host) return;
  host.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);"><span class="spinner"></span> Scanning project dependencies and information library…</div>';

  try {
    // 1. Fetch librarian directory records
    const dirRecords = await invoke('get_information_directory', { query: '', category: null }).catch(() => []);
    
    // 2. Fetch dependencies directly by checking workspace root files
    let packageJson = null;
    let cargoToml = null;
    let requirementsTxt = null;

    try {
      const res = await invoke('read_file', { path: 'package.json' });
      if (res && res.content) packageJson = JSON.parse(res.content);
    } catch (_) {}

    try {
      const res = await invoke('read_file', { path: 'Cargo.toml' });
      if (res && res.content) cargoToml = res.content;
    } catch (_) {}

    try {
      const res = await invoke('read_file', { path: 'requirements.txt' });
      if (res && res.content) requirementsTxt = res.content;
    } catch (_) {}

    let html = '<div style="display: flex; flex-direction: column; gap: 16px; overflow-y: auto; max-height: calc(85vh - 180px); padding-right: 4px;">';

    // Section 1: Detected Dependencies & Stack
    html += `
      <div style="background: linear-gradient(145deg, rgba(23, 29, 38, 0.75) 0%, rgba(15, 19, 26, 0.88) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px 18px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div style="font-weight: 700; font-size: 13.5px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
            <span>📦</span> Workspace Dependencies &amp; Toolchain
          </div>
          <span style="font-size: 10px; color: var(--accent-cyan); background: rgba(57, 197, 187, 0.12); border: 1px solid rgba(57, 197, 187, 0.25); padding: 2px 7px; border-radius: 10px; font-weight: 600;">Auto-detected</span>
        </div>
    `;

    if (packageJson) {
      const deps = packageJson.dependencies || {};
      const devDeps = packageJson.devDependencies || {};
      const allDepKeys = Object.keys(deps);
      const allDevKeys = Object.keys(devDeps);

      html += `
        <div style="margin-bottom: 10px;">
          <div style="font-size: 11px; font-weight: 600; color: var(--accent-cyan); margin-bottom: 6px;">Node.js / NPM Packages (${allDepKeys.length + allDevKeys.length})</div>
          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            ${allDepKeys.map(k => `<span style="font-size: 10.5px; font-family: var(--font-mono, monospace); background: rgba(57, 197, 187, 0.1); border: 1px solid rgba(57, 197, 187, 0.25); color: var(--accent-cyan); padding: 2px 7px; border-radius: 4px;">${esc(k)}@${esc(deps[k])}</span>`).join('')}
            ${allDevKeys.map(k => `<span style="font-size: 10.5px; font-family: var(--font-mono, monospace); background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: var(--text-secondary); padding: 2px 7px; border-radius: 4px;">${esc(k)} (dev)</span>`).join('')}
          </div>
        </div>
      `;
    }

    if (cargoToml) {
      const lines = cargoToml.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).slice(0, 20);
      html += `
        <div style="margin-bottom: 10px;">
          <div style="font-size: 11px; font-weight: 600; color: var(--accent-orange); margin-bottom: 6px;">Rust Crates (Cargo.toml)</div>
          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            ${lines.map(l => {
              const [k, v] = l.split('=');
              return `<span style="font-size: 10.5px; font-family: var(--font-mono, monospace); background: rgba(255, 159, 10, 0.1); border: 1px solid rgba(255, 159, 10, 0.25); color: var(--accent-orange); padding: 2px 7px; border-radius: 4px;">${esc(k.trim())}</span>`;
            }).join('')}
          </div>
        </div>
      `;
    }

    if (requirementsTxt) {
      const pyLines = requirementsTxt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      html += `
        <div style="margin-bottom: 10px;">
          <div style="font-size: 11px; font-weight: 600; color: var(--accent-green); margin-bottom: 6px;">Python Packages (requirements.txt)</div>
          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            ${pyLines.map(l => `<span style="font-size: 10.5px; font-family: var(--font-mono, monospace); background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.25); color: var(--accent-green); padding: 2px 7px; border-radius: 4px;">${esc(l)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    if (!packageJson && !cargoToml && !requirementsTxt) {
      html += `<div style="font-size: 11px; color: var(--text-muted);">No package manifests found at workspace root.</div>`;
    }

    html += `</div>`;

    // Section 2: Historical Changelogs & Information Directory
    html += `
      <div style="background: linear-gradient(145deg, rgba(23, 29, 38, 0.75) 0%, rgba(15, 19, 26, 0.88) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px 18px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">
        <div style="font-weight: 700; font-size: 13.5px; color: var(--text-primary); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>📚</span> Knowledge Library Records &amp; Changelogs
          </div>
          <span style="font-size: 10px; color: #c084fc; background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.25); padding: 2px 7px; border-radius: 10px; font-weight: 600;">${Array.isArray(dirRecords) ? dirRecords.length : 0} Records</span>
        </div>
    `;

    if (Array.isArray(dirRecords) && dirRecords.length > 0) {
      html += '<div style="display: flex; flex-direction: column; gap: 8px;">';
      for (const rec of dirRecords) {
        html += `
          <div style="background: rgba(10, 13, 18, 0.55); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 10px 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: 12.5px; font-weight: 700; color: var(--text-primary);">${esc(rec.title || rec.id)}</span>
              <span style="font-size: 9.5px; color: #c084fc; background: rgba(168, 85, 247, 0.12); padding: 2px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase;">${esc(rec.source || 'Knowledge')}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.5; font-family: var(--font-mono, monospace); white-space: pre-wrap;">${esc((rec.content || '').slice(0, 300))}${(rec.content || '').length > 300 ? '…' : ''}</div>
          </div>
        `;
      }
      html += '</div>';
    } else {
      html += `<div style="font-size: 11.5px; color: var(--text-muted); padding: 8px 0;">No changelog markdown files found in \`changelogs/\`. As the agent completes milestones, records are stored here automatically.</div>`;
    }

    html += `</div></div>`;
    host.innerHTML = html;
  } catch (err) {
    host.innerHTML = `<div style="color: var(--accent-red); padding: 16px;">Failed to load information directory: ${err}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Modal Tab 3: Architectural Graph
// ---------------------------------------------------------------------------

async function renderArchitecturalGraph() {
  const host = document.getElementById('arch-graph-content');
  if (!host) return;
  host.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);"><span class="spinner"></span> Querying Semantic Graph Engine…</div>';

  try {
    const stats = await invoke('graph_get_stats').catch(() => null);
    const focused = await invoke('graph_get_focused_context', { activeFile: state.editor?.activeTabPath || '' }).catch(() => null);

    let html = `
      <div style="display: flex; flex-direction: column; gap: 14px; overflow-y: auto; max-height: calc(85vh - 180px); padding-right: 4px;">
        <div style="background: linear-gradient(145deg, rgba(23, 29, 38, 0.75) 0%, rgba(15, 19, 26, 0.88) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px 18px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">
          <div style="font-weight: 700; font-size: 13.5px; color: var(--text-primary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🕸️</span> Semantic Graph Architecture Summary
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 10px;">
            <div style="background: rgba(10, 13, 18, 0.55); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px;">Indexed Files</div>
              <div style="font-size: 20px; font-weight: 700; color: var(--accent-cyan); margin-top: 3px;">${stats?.file_count ?? stats?.indexed_files ?? 'Active'}</div>
            </div>
            <div style="background: rgba(10, 13, 18, 0.55); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px;">Symbols &amp; AST Nodes</div>
              <div style="font-size: 20px; font-weight: 700; color: #c084fc; margin-top: 3px;">${stats?.symbol_count ?? 'Computed'}</div>
            </div>
            <div style="background: rgba(10, 13, 18, 0.55); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px;">Graph Edges / Calls</div>
              <div style="font-size: 20px; font-weight: 700; color: #4ade80; margin-top: 3px;">${stats?.edge_count ?? 'Indexed'}</div>
            </div>
          </div>
        </div>
    `;

    if (focused && focused.components) {
      html += `
        <div style="background: linear-gradient(145deg, rgba(23, 29, 38, 0.75) 0%, rgba(15, 19, 26, 0.88) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px 18px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">
          <div style="font-weight: 700; font-size: 13.5px; color: var(--text-primary); margin-bottom: 10px;">Key Components &amp; Entrypoints</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${(focused.components || []).map(c => `
              <div style="font-size: 11px; font-family: var(--font-mono, monospace); color: var(--text-secondary); background: rgba(10, 13, 18, 0.55); padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">${esc(c)}</div>
            `).join('')}
          </div>
        </div>
      `;
    }

    html += `
        <div style="background: rgba(57, 197, 187, 0.08); border: 1px solid rgba(57, 197, 187, 0.25); border-radius: 10px; padding: 12px 16px; font-size: 11.5px; color: var(--text-secondary); display: flex; align-items: center; justify-content: space-between;">
          <span>💡 Semantic Code Graph continuously indexes symbols and call hierarchies in background.</span>
          <button class="btn btn-secondary btn-sm" id="btn-reindex-graph" style="font-size: 10.5px; padding: 4px 10px; border-radius: 6px;">Re-index Workspace</button>
        </div>
      </div>
    `;

    host.innerHTML = html;
    document.getElementById('btn-reindex-graph')?.addEventListener('click', async () => {
      showToast('Re-indexing semantic AST code graph…', 'info', 2200);
      try {
        await invoke('query_code_graph', { query: 'reindex', mode: 'all' });
        showToast('✓ Code graph index refreshed', 'success', 2000);
        renderArchitecturalGraph();
      } catch (_) {}
    });
  } catch (err) {
    host.innerHTML = `<div style="color: var(--accent-red); padding: 16px;">Failed to load architectural graph: ${err}</div>`;
  }
}
