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

  // Render initial title
  updateTitleDisplay();
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

function renderHistoryList() {
  const listElem = document.getElementById('chat-history-list');
  if (!listElem) return;

  listElem.innerHTML = '';

  if (sessions.length === 0) {
    listElem.innerHTML = `<div style="padding: 12px; color: var(--text-muted); font-size: 11px; text-align: center;">No chat history yet.</div>`;
    return;
  }

  sessions.forEach(sess => {
    const isActive = sess.id === activeSessionId;
    const item = document.createElement('div');
    item.className = `chat-history-item ${isActive ? 'active' : ''}`;

    const dateStr = formatRelativeTime(new Date(sess.updatedAt || sess.createdAt));
    const msgCount = (sess.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').length;

    item.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div class="chat-history-title">${escapeHtml(sess.title)}</div>
        <div class="chat-history-meta">${msgCount} messages · ${dateStr}</div>
      </div>
      <button class="chat-history-del" title="Delete Chat" data-del-id="${sess.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    item.addEventListener('click', () => switchSession(sess.id));
    item.querySelector('.chat-history-del')?.addEventListener('click', (e) => deleteSession(sess.id, e));

    listElem.appendChild(item);
  });
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
