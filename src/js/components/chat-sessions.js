// ==========================================================================
// Orbital X — Chat Sessions & History Manager (chat-sessions.js)
// Persistence lives on disk via the Rust backend (~/.orbital/chat_sessions.json)
// because WebView localStorage is quota-limited and used to silently drop
// history. localStorage remains as a fallback for browser-preview mode.
// ==========================================================================

import { state } from '../state/store.js';
import { invoke, pickSaveFile } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';
import { appendTimelineCard, renderFullTimeline } from './agent.js';

const STORAGE_KEY_SESSIONS = 'orbital_chat_sessions';
const STORAGE_KEY_ACTIVE = 'orbital_active_session_id';
// Safety valve: even on disk, keep the list bounded so a months-long history
// of tool-heavy sessions can't grow without limit.
const MAX_SESSIONS = 60;
const MAX_MESSAGES_PER_SESSION = 400;

let sessions = [];
let activeSessionId = null;
let persistenceMode = 'disk'; // 'disk' | 'local'

export function initChatSessions() {
  loadSessions();

  const btnNewChat = document.getElementById('btn-new-chat');
  const btnHistory = document.getElementById('btn-chat-history');
  const titleElem = document.getElementById('agent-session-title');

  btnNewChat?.addEventListener('click', () => {
    createNewSession();
  });

  btnHistory?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHistoryDropdown();
  });

  titleElem?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHistoryDropdown();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('chat-history-dropdown');
    if (dropdown && !dropdown.contains(e.target) && e.target !== btnHistory && e.target !== titleElem) {
      dropdown.classList.remove('active');
    }
  });

  // H4: export / import buttons
  document.getElementById('btn-export-chat')?.addEventListener('click', exportActiveSessionMarkdown);
  document.getElementById('btn-import-chat')?.addEventListener('click', importSessionFromMarkdown);
  document.getElementById('btn-export-chat-popover')?.addEventListener('click', exportActiveSessionMarkdown);
  document.getElementById('btn-import-chat-popover')?.addEventListener('click', importSessionFromMarkdown);

  // H4: inline rename on double-click of the title
  titleElem?.addEventListener('dblclick', () => {
    if (titleElem.querySelector('input')) return;
    const current = getActiveSession();
    if (!current) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current.title || '';
    input.style.cssText = 'width: 160px; font-size: 12px; padding: 1px 6px; border: 1px solid var(--border-focus); border-radius: 4px; background: var(--bg-input); color: var(--text-primary);';
    titleElem.textContent = '';
    titleElem.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== current.title) {
        current.title = v;
        saveSessionsToStorage();
      }
      updateTitleDisplay();
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); updateTitleDisplay(); }
    });
    input.addEventListener('blur', commit);
  });

  // Render initial title
  updateTitleDisplay();
}

// H4 helpers ---------------------------------------------------------------

function normalizeFlags(sess) {
  if (typeof sess.pinned !== 'boolean') sess.pinned = false;
  if (typeof sess.archived !== 'boolean') sess.archived = false;
  return sess;
}

function sortSessions() {
  sessions.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

export async function exportActiveSessionMarkdown() {
  const current = getActiveSession();
  if (!current) return;
  const lines = [
    `# ${current.title || 'Orbital X Chat'}`,
    '',
    `> Exported from Orbital X on ${new Date().toLocaleString()}`,
    `> Mode: ${current.mode || 'dev'}`,
    '',
  ];
  for (const m of (current.messages || [])) {
    if (m._ephemeral) continue;
    if (m.role === 'user') {
      lines.push('## User', '', String(m.content || ''), '');
    } else if (m.role === 'assistant') {
      lines.push('## Assistant', '', String(m.content || ''), '');
      if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        lines.push(`_Tools: ${m.tool_calls.map(t => t.name).join(', ')}_`, '');
      }
    }
  }
  lines.push('---', `_Session id: ${current.id}_`);
  const markdown = lines.join('\n');

  // Ask user where to save the file using the native file picker
  const safeName = (current.title || 'session').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase();
  const now = new Date().toISOString().slice(0, 10);
  const defaultFilename = `orbital-chat-${safeName}-${now}.md`;

  try {
    const destinationPath = await pickSaveFile(defaultFilename, 'Markdown Document (*.md)', ['md']);
    if (!destinationPath) {
      // User cancelled the file picker dialog
      return;
    }
    await invoke('save_file', { path: destinationPath, content: markdown, description: 'Chat export' });
    showToast(`Chat exported successfully to ${destinationPath}`, 'success', 3500);
  } catch (e) {
    console.error("Save file dialog error:", e);
    // Fallback: try browser download if native dialog fails
    try {
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFilename;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Chat exported', 'success', 2500);
    } catch (e2) {
      showToast(`Export failed: ${e}`, 'error', 4000);
    }
  }
}

export function importSessionFromMarkdown() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.txt';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const messages = [];
      const title = ((text.match(/^# (.+)$/m) || [])[1] || file.name.replace(/\.(md|markdown|txt)$/i, '')).trim();
      const parts = text.split(/^## (User|Assistant)\s*$/m);
      for (let i = 1; i < parts.length; i += 2) {
        const role = parts[i].trim() === 'User' ? 'user' : 'assistant';
        const content = (parts[i + 1] || '').trim();
        if (content) messages.push({ role, content, timestamp: Date.now() });
      }
      if (messages.length === 0) throw new Error('no recognizable messages (expected "## User" / "## Assistant" sections)');
      createNewSession(title.slice(0, 60));
      state.conversation = messages;
      saveActiveSession();
      import('./agent.js').then(m => m.renderFullTimeline(messages));
      showToast(`Imported "${title}" (${messages.length} messages)`, 'success', 3200);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };
  input.click();
}

export async function loadSessions() {
  // Prefer disk persistence through the backend
  try {
    const fromDisk = await invoke('load_chat_sessions');
    if (Array.isArray(fromDisk)) {
      sessions = fromDisk;
      persistenceMode = 'disk';
    } else {
      // First run on this machine — seed from localStorage if present
      sessions = readLocalStorageSessions();
      persistenceMode = 'disk';
    }
  } catch (e) {
    console.warn('Disk chat persistence unavailable, using localStorage:', e);
    sessions = readLocalStorageSessions();
    persistenceMode = 'local';
  }

  activeSessionId = localStorage.getItem(STORAGE_KEY_ACTIVE);

  if (!sessions || sessions.length === 0) {
    const defaultSession = {
      id: 'session-' + Date.now(),
      title: 'Chat 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: state.agentMode || 'agent_pro',
      messages: state.conversation || [],
    };
    sessions = [defaultSession];
    activeSessionId = defaultSession.id;
    saveSessionsToStorage();
  } else if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
    activeSessionId = sessions[0].id;
    saveSessionsToStorage();
  }

  sessions.forEach(normalizeFlags);
  sortSessions();

  // Restore active session into state.conversation
  const current = sessions.find(s => s.id === activeSessionId);
  if (current) {
    state.conversation = current.messages || [];
  }
}

function readLocalStorageSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function getActiveSession() {
  return sessions.find(s => s.id === activeSessionId) || sessions[0];
}

export function getSessions() {
  return sessions;
}

export function saveActiveSession() {
  const current = getActiveSession();
  if (!current) return;

  // Ephemeral nudges/retry notices never belong to persisted history
  current.messages = (state.conversation || []).filter(m => !m._ephemeral);
  current.mode = state.agentMode;
  current.updatedAt = new Date().toISOString();
  normalizeFlags(current);

  // Auto-generate title from the first 7 words of initial user message if still default
  const isDefaultTitle = !current.title ||
    current.title === 'New Chat' ||
    current.title === 'Orbital X IDE Development' ||
    /^Chat\s+\d+$/i.test(current.title.trim());

  if (isDefaultTitle) {
    const firstUserMsg = current.messages.find(m => m.role === 'user');
    if (firstUserMsg && firstUserMsg.content) {
      const words = firstUserMsg.content.trim().split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        current.title = words.slice(0, 7).join(' ').trim();
      }
    }
  }

  saveSessionsToStorage();
  updateTitleDisplay();
}

export function createNewSession(title = null) {
  // Save existing session first
  saveActiveSession();

  const nextNum = sessions.length + 1;
  const initialTitle = title || `Chat ${nextNum}`;
  const newId = 'session-' + Date.now();
  const newSession = {
    id: newId,
    title: initialTitle,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: state.agentMode || 'agent_pro',
    messages: [],
  };

  sessions.unshift(newSession);
  activeSessionId = newId;
  state.conversation = [];
  saveSessionsToStorage();

  // Reset timeline UI to clean welcome hero (Image 2) with starter cards
  renderFullTimeline([]);
  updateTitleDisplay();
  closeHistoryDropdown();
}

export function switchSession(sessionId) {
  if (sessionId === activeSessionId) {
    closeHistoryDropdown();
    return;
  }

  saveActiveSession();

  const target = sessions.find(s => s.id === sessionId);
  if (!target) return;

  activeSessionId = target.id;
  state.conversation = target.messages || [];
  saveSessionsToStorage();

  renderFullTimeline(state.conversation);
  updateTitleDisplay();
  closeHistoryDropdown();
}

export function deleteSession(sessionId, event) {
  if (event) event.stopPropagation();

  if (sessions.length <= 1) {
    // If last session, reset it instead of deleting
    sessions[0].messages = [];
    sessions[0].title = 'Chat 1';
    sessions[0].updatedAt = new Date().toISOString();
    state.conversation = [];
    saveSessionsToStorage();
    renderFullTimeline([]);
    updateTitleDisplay();
    renderHistoryList();
    return;
  }

  sessions = sessions.filter(s => s.id !== sessionId);

  if (activeSessionId === sessionId) {
    activeSessionId = sessions[0].id;
    state.conversation = sessions[0].messages || [];
    renderFullTimeline(state.conversation);
  }

  saveSessionsToStorage();
  updateTitleDisplay();
  renderHistoryList();
}

function updateTitleDisplay() {
  const titleElem = document.getElementById('agent-session-title');
  const current = getActiveSession();
  if (titleElem && current) {
    titleElem.textContent = current.title;
    titleElem.title = `Current Chat: ${current.title} (Click to switch)`;
  }
}

function toggleHistoryDropdown() {
  const dropdown = document.getElementById('chat-history-dropdown');
  if (!dropdown) return;

  if (dropdown.classList.contains('active')) {
    closeHistoryDropdown();
  } else {
    renderHistoryList();
    dropdown.classList.add('active');
  }
}

function closeHistoryDropdown() {
  const dropdown = document.getElementById('chat-history-dropdown');
  dropdown?.classList.remove('active');
}

let historySearch = '';
let historyTab = 'all'; // 'all' | 'pinned' | 'archived'

const CHAT_ICONS = {
  pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1v3.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"></path></svg>',
  archive: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>',
  trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  search: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
  chat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
};

function renderHistoryList() {
  const dropdown = document.getElementById('chat-history-dropdown');
  if (!dropdown) return;

  const pinnedCount = sessions.filter(s => s.pinned).length;
  const archivedCount = sessions.filter(s => s.archived).length;
  const activeCount = sessions.filter(s => !s.archived).length;

  dropdown.innerHTML = `
    <div class="chat-history-header">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="color: var(--accent-cyan); display: flex; align-items: center;">${CHAT_ICONS.chat}</span>
        <span>Recent Conversations</span>
        <span style="font-size: 10px; background: rgba(57, 197, 187, 0.15); color: var(--accent-cyan); padding: 1px 6px; border-radius: 10px; font-weight: 600;">${sessions.length}</span>
      </div>
      <div style="display: flex; gap: 4px; align-items: center;">
        <button class="btn btn-secondary btn-sm" id="btn-import-chat-popover" style="font-size: 10.5px; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px;" title="Import Chat File">
          <span>Import</span>
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-export-chat-popover" style="font-size: 10.5px; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px;" title="Export Active Chat">
          <span>Export</span>
        </button>
      </div>
    </div>

    <div class="chat-history-toolbar">
      <div class="chat-history-search-wrap">
        <span class="chat-history-search-icon">${CHAT_ICONS.search}</span>
        <input type="text" id="chat-history-search-input" class="chat-history-search-input" placeholder="Search conversations &amp; messages…" value="${escapeHtml(historySearch)}" />
        ${historySearch ? '<button class="chat-history-search-clear" id="chat-history-clear-search">✕</button>' : ''}
      </div>

      <div class="chat-history-filter-tabs">
        <button class="chat-history-filter-btn ${historyTab === 'all' ? 'active' : ''}" data-tab="all">
          Active (${activeCount})
        </button>
        <button class="chat-history-filter-btn ${historyTab === 'pinned' ? 'active' : ''}" data-tab="pinned">
          Pinned (${pinnedCount})
        </button>
        <button class="chat-history-filter-btn ${historyTab === 'archived' ? 'active' : ''}" data-tab="archived">
          Archived (${archivedCount})
        </button>
      </div>
    </div>

    <div class="chat-history-list" id="chat-history-items-container"></div>
  `;

  // Attach search events
  const searchInput = dropdown.querySelector('#chat-history-search-input');
  searchInput?.addEventListener('input', (e) => {
    historySearch = e.target.value;
    renderHistoryRows();
  });
  searchInput?.addEventListener('keydown', (e) => e.stopPropagation());

  dropdown.querySelector('#chat-history-clear-search')?.addEventListener('click', () => {
    historySearch = '';
    renderHistoryList();
  });

  // Attach tab filter events
  dropdown.querySelectorAll('.chat-history-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      historyTab = btn.dataset.tab;
      dropdown.querySelectorAll('.chat-history-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderHistoryRows();
    });
  });

  // Re-bind import/export buttons in popover header
  dropdown.querySelector('#btn-import-chat-popover')?.addEventListener('click', importSessionFromMarkdown);
  dropdown.querySelector('#btn-export-chat-popover')?.addEventListener('click', exportActiveSessionMarkdown);

  renderHistoryRows();
}

function renderHistoryRows() {
  const container = document.getElementById('chat-history-items-container');
  if (!container) return;
  container.innerHTML = '';

  const q = historySearch.trim().toLowerCase();

  const visible = sessions.filter(sess => {
    // Tab filter
    if (historyTab === 'all' && sess.archived) return false;
    if (historyTab === 'pinned' && (!sess.pinned || sess.archived)) return false;
    if (historyTab === 'archived' && !sess.archived) return false;

    // Search query filter
    if (!q) return true;
    if ((sess.title || '').toLowerCase().includes(q)) return true;
    return (sess.messages || []).some(m => (m.content || '').toLowerCase().includes(q));
  });

  if (visible.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 14px; color: var(--text-muted); font-size: 11.5px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px;">
        <span style="opacity: 0.5;">${CHAT_ICONS.chat}</span>
        <span>${q ? 'No conversations match "' + escapeHtml(q) + '"' : (historyTab === 'archived' ? 'No archived conversations' : (historyTab === 'pinned' ? 'No pinned conversations' : 'No chat history yet'))}</span>
      </div>
    `;
    return;
  }

  for (const sess of visible) {
    const isActive = sess.id === activeSessionId;
    const item = document.createElement('div');
    item.className = `chat-history-item ${isActive ? 'active' : ''}`;

    const dateStr = formatRelativeTime(new Date(sess.updatedAt || sess.createdAt));
    const msgCount = (sess.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').length;

    item.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div class="chat-history-title">
          <span>${escapeHtml(sess.title)}</span>
          ${sess.pinned ? `<span class="chat-history-badge chat-history-badge-pinned">Pinned</span>` : ''}
          ${sess.archived ? `<span class="chat-history-badge chat-history-badge-archived">Archived</span>` : ''}
        </div>
        <div class="chat-history-meta">
          <span>${msgCount} message${msgCount === 1 ? '' : 's'}</span>
          <span>•</span>
          <span>${dateStr}</span>
        </div>
      </div>
      <div class="chat-history-actions">
        <button class="chat-action-btn hist-pin" title="${sess.pinned ? 'Unpin conversation' : 'Pin to top'}" style="color:${sess.pinned ? 'var(--accent-cyan)' : 'var(--text-muted)'};">
          ${CHAT_ICONS.pin}
        </button>
        <button class="chat-action-btn hist-archive" title="${sess.archived ? 'Unarchive' : 'Archive conversation'}" style="color:${sess.archived ? 'var(--accent-cyan)' : 'var(--text-muted)'};">
          ${CHAT_ICONS.archive}
        </button>
        <button class="chat-action-btn del-btn chat-history-del" title="Delete conversation" data-del-id="${sess.id}">
          ${CHAT_ICONS.trash}
        </button>
      </div>
    `;

    item.addEventListener('click', () => switchSession(sess.id));

    item.querySelector('.hist-pin')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sess.pinned = !sess.pinned;
      sortSessions();
      saveSessionsToStorage();
      renderHistoryList();
    });

    item.querySelector('.hist-archive')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sess.archived = !sess.archived;
      if (sess.archived && sess.id === activeSessionId && historyTab !== 'archived') {
        const next = sessions.find(x => !x.archived);
        if (next) switchSession(next.id);
      }
      saveSessionsToStorage();
      renderHistoryList();
    });

    item.querySelector('.chat-history-del')?.addEventListener('click', (e) => deleteSession(sess.id, e));

    container.appendChild(item);
  }
}

function formatRelativeTime(date) {
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function saveSessionsToStorage() {
  sortSessions();
  // Bound growth: oldest sessions beyond the cap are pruned (never the active one)
  if (sessions.length > MAX_SESSIONS) {
    const overflow = sessions.length - MAX_SESSIONS;
    const activeIdx = sessions.findIndex(s => s.id === activeSessionId);
    const removable = sessions.filter(s => s.id !== activeSessionId).slice(-overflow - 1);
    const keep = new Set(removable.map(s => s.id));
    sessions = sessions.filter((s, i) => !keep.has(s.id) || i === activeIdx);
    sessions = sessions.slice(-MAX_SESSIONS);
  }
  // Bound per-session size (tool-heavy sessions can grow very large)
  for (const s of sessions) {
    if (Array.isArray(s.messages) && s.messages.length > MAX_MESSAGES_PER_SESSION) {
      s.messages = s.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }
  }

  // Disk persistence (primary) — fire-and-forget with local fallback
  invoke('save_chat_sessions', { sessions })
    .catch((e) => {
      if (persistenceMode !== 'local') {
        console.warn('Disk chat save failed, falling back to localStorage:', e);
        persistenceMode = 'local';
      }
      writeLocalStorage();
    });

  // Keep a lightweight local copy for instant boot before disk round-trip
  if (persistenceMode === 'local') {
    writeLocalStorage();
  }

  if (activeSessionId) {
    localStorage.setItem(STORAGE_KEY_ACTIVE, activeSessionId);
  }
}

function writeLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
  } catch (e) {
    // Quota exceeded even after pruning — drop the oldest sessions until it fits
    while (sessions.length > 1) {
      const activeIdx = sessions.findIndex(s => s.id === activeSessionId);
      const dropIdx = activeIdx === 0 ? sessions.length - 1 : 0;
      sessions.splice(dropIdx, 1);
      try {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
        return;
      } catch (e2) { /* keep trimming */ }
    }
    console.warn('Chat history could not be persisted locally:', e);
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
