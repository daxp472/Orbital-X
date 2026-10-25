// ==========================================================================
// Orbital X — Chat Sessions & History Manager (chat-sessions.js)
// Persistence lives on disk via the Rust backend (~/.orbital/chat_sessions.json)
// because WebView localStorage is quota-limited and used to silently drop
// history. localStorage remains as a fallback for browser-preview mode.
// ==========================================================================

import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
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

function exportActiveSessionMarkdown() {
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
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orbital-chat-${(current.title || 'session').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSessionFromMarkdown() {
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

  // Reset timeline UI
  renderFullTimeline([]);
  appendTimelineCard('assistant', `Started a new session: <strong>${initialTitle}</strong>. Ready to inspect, code, and execute.`);
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
let showArchived = false;

function renderHistoryList() {
  const listElem = document.getElementById('chat-history-list');
  if (!listElem) return;
  listElem.innerHTML = '';

  // H4: session search across titles + message contents
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'input-text';
  search.placeholder = 'Search sessions…';
  search.value = historySearch;
  search.style.cssText = 'width: 100%; font-size: 11px; margin-bottom: 6px;';
  search.addEventListener('input', () => {
    historySearch = search.value;
    renderHistoryRows(listElem);
  });
  search.addEventListener('keydown', (e) => e.stopPropagation());
  listElem.appendChild(search);

  const archivedToggle = document.createElement('label');
  archivedToggle.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 10px; color: var(--text-muted); cursor: pointer; margin-bottom: 6px;';
  archivedToggle.innerHTML = `<input type="checkbox" ${showArchived ? 'checked' : ''}> Show archived (${sessions.filter(x => x.archived).length})`;
  archivedToggle.querySelector('input').addEventListener('change', (e) => {
    showArchived = e.target.checked;
    renderHistoryList();
  });
  listElem.appendChild(archivedToggle);

  renderHistoryRows(listElem);
}

function renderHistoryRows(listElem) {
  listElem.querySelectorAll('.chat-history-row').forEach(el => el.remove());
  const q = historySearch.trim().toLowerCase();

  const rowsHost = document.createElement('div');
  rowsHost.className = 'chat-history-row';
  rowsHost.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  listElem.appendChild(rowsHost);

  const visible = sessions.filter(sess => {
    if (!showArchived && sess.archived) return false;
    if (!q) return true;
    if ((sess.title || '').toLowerCase().includes(q)) return true;
    return (sess.messages || []).some(m => (m.content || '').toLowerCase().includes(q));
  });

  if (visible.length === 0) {
    rowsHost.innerHTML = `<div style="padding: 12px; color: var(--text-muted); font-size: 11px; text-align: center;">${q ? 'No sessions match.' : 'No chat history yet.'}</div>`;
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
        <div class="chat-history-title">${escapeHtml(sess.pinned ? '📌 ' : '')}${escapeHtml(sess.archived ? '📦 ' : '')}${escapeHtml(sess.title)}</div>
        <div class="chat-history-meta">${msgCount} messages · ${dateStr}</div>
      </div>
      <span style="display: flex; gap: 2px; flex-shrink: 0;">
        <button class="git-icon-btn hist-pin" title="${sess.pinned ? 'Unpin' : 'Pin to top'}" style="color:${sess.pinned ? 'var(--accent-cyan)' : 'var(--text-muted)'};">📌</button>
        <button class="git-icon-btn hist-archive" title="${sess.archived ? 'Unarchive' : 'Archive'}">📦</button>
        <button class="chat-history-del" title="Delete Chat" data-del-id="${sess.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </span>
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
      if (sess.archived && sess.id === activeSessionId && !showArchived) {
        const next = sessions.find(x => !x.archived);
        if (next) switchSession(next.id);
      }
      saveSessionsToStorage();
      renderHistoryList();
    });
    item.querySelector('.chat-history-del')?.addEventListener('click', (e) => deleteSession(sess.id, e));

    rowsHost.appendChild(item);
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
