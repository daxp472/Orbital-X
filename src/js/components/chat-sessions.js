// ==========================================================================
// Orbital X — Chat Sessions & History Manager (chat-sessions.js)
// ==========================================================================

import { state } from '../state/store.js';
import { appendTimelineCard, renderFullTimeline } from './agent.js';

const STORAGE_KEY_SESSIONS = 'orbital_chat_sessions';
const STORAGE_KEY_ACTIVE = 'orbital_active_session_id';

let sessions = [];
let activeSessionId = null;

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

export function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    sessions = raw ? JSON.parse(raw) : [];
  } catch (e) {
    sessions = [];
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

export function getActiveSession() {
  return sessions.find(s => s.id === activeSessionId) || sessions[0];
}

export function saveActiveSession() {
  const current = getActiveSession();
  if (!current) return;

  current.messages = state.conversation || [];
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
  try {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
    if (activeSessionId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE, activeSessionId);
    }
  } catch (e) {
    console.warn("Could not persist sessions to localStorage:", e);
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
