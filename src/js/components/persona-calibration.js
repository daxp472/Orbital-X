// ==========================================================================
// Orbital X — Adaptive Persona Engine & Isolated Calibration Studio
// (persona-calibration.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';
import { FocusTrap } from '../utils/focus-trap.js';

let calibFocusTrap = null;

let cachedState = null;
let currentSurveyStep = 0;
let surveyAnswers = [];
let deepInterviewTurns = [];
let deepQuestionIndex = 0;
let deepSynthesisInProgress = false;

// Curated dynamic questions for the standard 3–5 question survey
const STANDARD_SURVEY_QUESTIONS = [
  {
    id: 'code_prose_ratio',
    title: 'Code vs. Explanation Balance',
    question: 'What is your ideal Code-to-Prose ratio when receiving solutions?',
    options: [
      { label: '95% Code / Diffs Only', desc: 'Zero fluff, no preamble; code and diffs immediately.', trait: 'minimalist_code_only' },
      { label: 'Balanced (70% Code, 30% Prose)', desc: 'Direct working code with 1–2 sentence root cause analysis.', trait: 'balanced_pragmatic' },
      { label: 'Explanatory & Mentoring', desc: 'Detailed walkthrough of the architectural reasoning and why it works.', trait: 'educational_explanations' }
    ]
  },
  {
    id: 'proactive_edge_cases',
    title: 'Downstream Edge Cases',
    question: 'How should Orbital X handle non-obvious risks and edge cases?',
    options: [
      { label: 'Proactively Flag Downstream Risks', desc: 'Warn about lock contentions, cache latencies, and breaking changes.', trait: 'proactive_edge_cases' },
      { label: 'Strict Focus on Immediate Task', desc: 'Execute the exact request without expanding technical scope.', trait: 'strict_task_focus' },
      { label: 'Suggest Automated Unit Tests', desc: 'Provide unit test vectors covering boundary conditions.', trait: 'test_driven_verification' }
    ]
  },
  {
    id: 'conversational_cadence',
    title: 'Communication Tone & Cadence',
    question: 'Which communication tone matches your working velocity best?',
    options: [
      { label: 'Calm Chief-of-Staff (Atlas)', desc: '1-sentence executive summary first, poised, strategic peer.', trait: 'strategic_chief_of_staff' },
      { label: 'Pure Terminal Signal (Pulse)', desc: 'Strictly zero conversational filler ("Sure!", "Here is..."). Pure execution.', trait: 'zero_fluff_terminal' },
      { label: 'Warm Pair-Programmer (Nova)', desc: 'Supportive, everyday analogies, accessible mental models.', trait: 'supportive_pair_programmer' },
      { label: 'Strict Kernel Auditor (Vanguard)', desc: 'Hyper-logical, zero-trust security & memory invariants first.', trait: 'zero_trust_security_first' }
    ]
  },
  {
    id: 'refactor_proactivity',
    title: 'Refactoring & Code Quality',
    question: 'When editing files, how should adjacent code improvements be handled?',
    options: [
      { label: 'Autonomous Polishing', desc: 'Clean up nearby lint issues, typings, and variable naming alongside the fix.', trait: 'autonomous_code_polishing' },
      { label: 'Minimal Surgical Edits', desc: 'Touch strictly the lines required for the prompt to minimize diff noise.', trait: 'surgical_minimal_diffs' },
      { label: 'Highlight Improvements in Notes', desc: 'Execute surgical edits, but note potential refactors as next steps.', trait: 'suggestive_refactoring' }
    ]
  },
  {
    id: 'error_rigor',
    title: 'Error Handling & System Rigor',
    question: 'How strictly should error handling and fallible operations be enforced?',
    options: [
      { label: 'Exhaustive Defensive Bounds', desc: 'Prohibit unwrap/expect/silent catch; require contextual error types.', trait: 'strict_defensive_bounds' },
      { label: 'Pragmatic Idiomatic Errors', desc: 'Standard Result/Option or try/catch with early returns.', trait: 'idiomatic_error_handling' },
      { label: 'User-Friendly Debugging Hints', desc: 'Include actionable hints explaining how to reproduce and fix errors.', trait: 'friendly_error_diagnostics' }
    ]
  }
];

// Deep Interview cross-questions for the 3-streak isolated chat
const DEEP_INTERVIEW_QUESTIONS = [
  "Welcome to the Deep Persona Architect Studio. What is your primary programming language and what annoys you most when AI assistants help you?",
  "When you receive a bug fix, do you prefer immediate unified diffs or step-by-step explanations of the root cause?",
  "How should the assistant handle assumptions? Should it make safe best-practice leaps, or stop and ask for clarification?",
  "Do you prefer highly concise terminal commands (e.g. bash/pwsh one-liners) or structured multi-step build scripts?",
  "When architecting new modules, what is your stance on third-party dependencies versus lightweight standard library solutions?",
  "What type of unit and integration tests do you consider mandatory before calling a task complete?",
  "How should the assistant format code comments? Self-documenting code with minimal comments, or rich explanatory docstrings?",
  "Are there specific phrases, pleasantries, or habits you strictly forbid your AI assistant from using?",
  "Lastly, summarize in one sentence how you want Orbital X to communicate with you across your entire workflow."
];

// ==========================================================================
// INITIALIZATION & STATE SYNCHRONIZATION
// ==========================================================================

export async function initPersonaEngine() {
  try {
    const state = await invoke('persona_get_state');
    cachedState = state;
    updateComposerPillUI(state.active_persona);
    setupComposerPillEvents();
    return state;
  } catch (err) {
    console.warn('Could not load persona engine state:', err);
    updateComposerPillUI('auto');
    return null;
  }
}

export function getActivePersonaId() {
  return cachedState?.active_persona || 'auto';
}

export function getActivePersonaConstitution() {
  if (!cachedState) return '';
  return cachedState.active_constitution || '';
}

export function getCachedPersonaState() {
  return cachedState;
}

// ==========================================================================
// CHAT COMPOSER PILL & DROPDOWN UI
// ==========================================================================

export const PERSONA_EMOJIS = {
  auto: '✨',
  atlas: '🛡️',
  pulse: '⚡',
  nova: '🤝',
  vanguard: '🔬'
};

function updateComposerPillUI(personaId) {
  const iconEl = document.getElementById('persona-pill-icon');
  const nameEl = document.getElementById('persona-pill-name');
  const menuEl = document.getElementById('composer-persona-menu');

  const meta = {
    auto: { icon: '✨', name: 'Auto' },
    atlas: { icon: '🛡️', name: 'Atlas' },
    pulse: { icon: '⚡', name: 'Pulse' },
    nova: { icon: '🤝', name: 'Nova' },
    vanguard: { icon: '🔬', name: 'Vanguard' }
  }[personaId] || { icon: '✨', name: 'Auto' };

  if (iconEl) iconEl.textContent = meta.icon;
  if (nameEl) nameEl.textContent = meta.name;

  if (menuEl) {
    menuEl.querySelectorAll('.persona-menu-item').forEach(item => {
      const match = item.getAttribute('data-persona') === personaId;
      item.classList.toggle('active', match);
    });
  }
}

function setupComposerPillEvents() {
  const pillBtn = document.getElementById('btn-composer-persona');
  const menu = document.getElementById('composer-persona-menu');
  if (!pillBtn || !menu) return;

  pillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#composer-persona-container')) {
      menu.classList.add('hidden');
    }
  });

  menu.querySelectorAll('.persona-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetId = item.getAttribute('data-persona');
      menu.classList.add('hidden');
      if (!targetId) return;

      try {
        const updated = await invoke('persona_set_active', { personaId: targetId });
        cachedState = updated;
        updateComposerPillUI(targetId);
        setupPersonaSettingsUI();
        const nameMap = { auto: 'Auto (Adaptive)', atlas: 'Atlas (Strategic)', pulse: 'Pulse (Minimalist)', nova: 'Nova (Pair Dev)', vanguard: 'Vanguard (Auditor)' };
        showToast(`Personality set to ${nameMap[targetId] || targetId}`, 'info', 2200);
      } catch (err) {
        showToast(`Failed to switch personality: ${err}`, 'error', 3000);
      }
    });
  });
}

// ==========================================================================
// TURN COMPLETED HOOK (TRIGGERS SURVEY AT RANDOMIZED 3-7 INTERVALS)
// ==========================================================================

export async function onAgentTurnCompleted() {
  if (getActivePersonaId() !== 'auto') return;

  try {
    const check = await invoke('persona_record_turn_completed');
    if (check?.should_trigger_survey) {
      setTimeout(() => {
        openCalibrationModal(check.is_deep_interview);
      }, 1000);
    }
  } catch (err) {
    console.warn('Error recording persona turn:', err);
  }
}

// ==========================================================================
// FLOATING CALIBRATION MODAL CONTROLLER
// ==========================================================================

export function openCalibrationModal(isDeep = false) {
  // If consecutive descriptive count is 3 or more, upgrade automatically to deep interview
  if (!isDeep && cachedState?.auto_profile?.consecutive_descriptive_count >= 3) {
    isDeep = true;
  }

  let modal = document.getElementById('modal-persona-calibration');
  if (!modal) {
    createCalibrationModalDOM();
    modal = document.getElementById('modal-persona-calibration');
  }

  modal.style.display = 'flex';
  modal.setAttribute('data-mode', isDeep ? 'deep' : 'standard');

  if (!calibFocusTrap) {
    calibFocusTrap = new FocusTrap(modal, { onClose: closeCalibrationModal });
  }
  calibFocusTrap.activate();

  const streak = cachedState?.auto_profile?.consecutive_descriptive_count || 0;
  const streakBadge = document.getElementById('calibration-streak-badge');
  if (streakBadge) {
    streakBadge.textContent = isDeep
      ? `🔥 Deep Persona Architect (Streak: ${streak}/3)`
      : `Streak: ${streak}/3`;
  }

  if (isDeep) {
    startDeepInterviewChat();
  } else {
    currentSurveyStep = 0;
    surveyAnswers = [];
    renderStandardSurveyStep();
  }
}

export function closeCalibrationModal() {
  calibFocusTrap?.deactivate();
  const modal = document.getElementById('modal-persona-calibration');
  if (modal) {
    modal.style.display = 'none';
  }
}

function createCalibrationModalDOM() {
  const modal = document.createElement('div');
  modal.id = 'modal-persona-calibration';
  modal.className = 'modal-backdrop persona-calibration-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal-container persona-calibration-container" role="dialog" aria-modal="true" aria-labelledby="calib-modal-title">
      <!-- Header -->
      <div class="modal-header persona-calib-header">
        <div class="calib-header-left">
          <span class="calib-header-icon">${PERSONA_SVGS.auto}</span>
          <div>
            <div class="calib-header-title" id="calib-modal-title">Auto Mode Calibration Studio</div>
            <div class="calib-header-subtitle">Aligning AI behavior directly with how you code</div>
          </div>
          <span class="calib-streak-pill" id="calibration-streak-badge">Streak: 0/3</span>
        </div>
        <div class="calib-header-actions">
          <button class="btn btn-secondary btn-sm calib-toggle-surveys-btn" id="btn-calib-disable-surveys" title="Toggle automatic calibration popups">
            Disable Surveys
          </button>
          <button class="icon-btn calib-close-btn" id="btn-close-calibration" title="Close (Esc)">✕</button>
        </div>
      </div>

      <!-- Body: Standard Questionnaire or Deep Chat -->
      <div class="modal-body persona-calib-body" id="persona-calib-body-content">
        <!-- Injected dynamically -->
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  modal.querySelector('#btn-close-calibration')?.addEventListener('click', closeCalibrationModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCalibrationModal();
  });

  // Toggle Surveys button
  modal.querySelector('#btn-calib-disable-surveys')?.addEventListener('click', async () => {
    try {
      const updated = await invoke('persona_toggle_surveys', { enabled: false });
      cachedState = updated;
      showToast('Auto-calibration surveys disabled. You can re-enable anytime in Settings.', 'info', 3000);
      closeCalibrationModal();
    } catch (err) {
      showToast(`Error updating surveys: ${err}`, 'error', 3000);
    }
  });
}

// ==========================================================================
// STANDARD CALIBRATION FLOW (3–5 DYNAMIC QUESTIONS + DESCRIPTIVE BOX)
// ==========================================================================

function renderStandardSurveyStep() {
  const container = document.getElementById('persona-calib-body-content');
  if (!container) return;

  if (currentSurveyStep < STANDARD_SURVEY_QUESTIONS.length) {
    const q = STANDARD_SURVEY_QUESTIONS[currentSurveyStep];
    container.innerHTML = `
      <div class="calib-step-view">
        <div class="calib-progress-bar-wrap">
          <div class="calib-progress-bar" style="width: ${((currentSurveyStep + 1) / (STANDARD_SURVEY_QUESTIONS.length + 1)) * 100}%"></div>
        </div>
        <div class="calib-step-indicator">Question ${currentSurveyStep + 1} of ${STANDARD_SURVEY_QUESTIONS.length + 1} • ${q.title}</div>
        <h3 class="calib-question-title">${q.question}</h3>

        <div class="calib-options-grid">
          ${q.options.map((opt, idx) => `
            <div class="calib-option-card" data-trait="${opt.trait}">
              <div class="calib-option-radio"></div>
              <div class="calib-option-text">
                <div class="calib-option-label">${opt.label}</div>
                <div class="calib-option-desc">${opt.desc}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="calib-footer-actions">
          <button class="btn btn-secondary btn-sm" id="btn-calib-skip-step">Skip for Now</button>
          <button class="btn btn-primary btn-sm" id="btn-calib-next-step" disabled>Next Question →</button>
        </div>
      </div>
    `;

    let selectedTrait = null;
    const cards = container.querySelectorAll('.calib-option-card');
    const nextBtn = container.querySelector('#btn-calib-next-step');

    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTrait = card.getAttribute('data-trait');
        if (nextBtn) nextBtn.disabled = false;
      });
    });

    nextBtn?.addEventListener('click', () => {
      if (selectedTrait) {
        surveyAnswers.push(selectedTrait);
      }
      currentSurveyStep++;
      renderStandardSurveyStep();
    });

    container.querySelector('#btn-calib-skip-step')?.addEventListener('click', () => {
      closeCalibrationModal();
    });
  } else {
    // Final Step: Free-form Descriptive Note
    const streak = cachedState?.auto_profile?.consecutive_descriptive_count || 0;
    container.innerHTML = `
      <div class="calib-step-view">
        <div class="calib-progress-bar-wrap">
          <div class="calib-progress-bar" style="width: 100%"></div>
        </div>
        <div class="calib-step-indicator">Final Step • Custom Constitution Directives</div>
        <h3 class="calib-question-title">Describe your ideal AI style in your own words</h3>
        <p class="calib-question-subtitle">
          Writing your custom preferences here levels up your calibration streak (<strong>${streak}/3</strong>). 
          Achieving 3 consecutive descriptive calibrations unlocks the <strong>Deep Persona Architect Studio</strong>.
        </p>

        <textarea class="calib-descriptive-textarea" id="calib-descriptive-input" placeholder="e.g. 'I work primarily in Rust and TypeScript. I want zero apologies, immediate unified diffs, explicit types, and proactive checks for memory safety and lock contention.'"></textarea>

        <div class="calib-footer-actions">
          <button class="btn btn-secondary btn-sm" id="btn-calib-skip-final">Skip Note (Save Answers)</button>
          <button class="btn btn-primary btn-sm" id="btn-calib-save-all">Lock In My Calibration ✨</button>
        </div>
      </div>
    `;

    container.querySelector('#btn-calib-skip-final')?.addEventListener('click', async () => {
      await submitCalibrationData(null);
    });

    container.querySelector('#btn-calib-save-all')?.addEventListener('click', async () => {
      const input = document.getElementById('calib-descriptive-input');
      const note = input?.value?.trim() || null;
      await submitCalibrationData(note);
    });
  }
}

async function submitCalibrationData(descriptiveNote) {
  try {
    const updated = await invoke('persona_submit_survey', {
      answers: surveyAnswers,
      descriptiveNote: descriptiveNote
    });
    cachedState = updated;
    closeCalibrationModal();

    const streak = updated.auto_profile.consecutive_descriptive_count;
    if (streak >= 3) {
      showToast(`🎉 Streak 3/3 reached! Deep Persona Architect Studio unlocked!`, 'success', 4000);
    } else if (descriptiveNote) {
      showToast(`✨ Auto-Persona calibrated! Streak: ${streak}/3`, 'success', 3000);
    } else {
      showToast(`✓ Preferences saved.`, 'info', 2200);
    }
  } catch (err) {
    showToast(`Error submitting calibration: ${err}`, 'error', 3000);
  }
}

// ==========================================================================
// 3-STREAK ESCALATION: DEEP PERSONA ARCHITECT ISOLATED CHAT
// ==========================================================================

function startDeepInterviewChat() {
  const container = document.getElementById('persona-calib-body-content');
  if (!container) return;

  deepInterviewTurns = [];
  deepQuestionIndex = 0;

  container.innerHTML = `
    <div class="calib-deep-chat-view">
      <div class="calib-deep-chat-messages" id="calib-deep-chat-history">
        <!-- Turn bubbles appear here -->
      </div>

      <div class="calib-deep-chat-input-bar">
        <textarea class="calib-deep-input" id="calib-deep-input" placeholder="Type your answer and press Enter to respond..." rows="2"></textarea>
        <button class="btn btn-primary btn-sm" id="btn-calib-deep-send">Send</button>
        <button class="btn btn-secondary btn-sm" id="btn-calib-deep-finish" style="margin-left: 6px;">Lock It In</button>
      </div>
    </div>
  `;

  const input = container.querySelector('#calib-deep-input');
  const sendBtn = container.querySelector('#btn-calib-deep-send');
  const finishBtn = container.querySelector('#btn-calib-deep-finish');

  sendBtn?.addEventListener('click', () => handleDeepUserAnswer());
  finishBtn?.addEventListener('click', () => finishDeepSynthesis());
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleDeepUserAnswer();
    }
  });

  // Post initial question
  setTimeout(() => {
    postDeepAssistantMessage(DEEP_INTERVIEW_QUESTIONS[0]);
  }, 300);
}

function postDeepAssistantMessage(text) {
  const history = document.getElementById('calib-deep-chat-history');
  if (!history) return;

  const msg = document.createElement('div');
  msg.className = 'calib-deep-bubble assistant';
  msg.innerHTML = `
    <div class="calib-bubble-header">
      <span class="calib-bubble-avatar">✨</span>
      <span class="calib-bubble-author">Deep Persona Architect</span>
      <span class="calib-bubble-count">Q ${deepQuestionIndex + 1} of ${DEEP_INTERVIEW_QUESTIONS.length}</span>
    </div>
    <div class="calib-bubble-content">${escapeHtml(text)}</div>
  `;
  history.appendChild(msg);
  history.scrollTop = history.scrollHeight;
}

function postDeepUserMessage(text) {
  const history = document.getElementById('calib-deep-chat-history');
  if (!history) return;

  const msg = document.createElement('div');
  msg.className = 'calib-deep-bubble user';
  msg.innerHTML = `
    <div class="calib-bubble-header">
      <span class="calib-bubble-author">You</span>
    </div>
    <div class="calib-bubble-content">${escapeHtml(text)}</div>
  `;
  history.appendChild(msg);
  history.scrollTop = history.scrollHeight;
}

function handleDeepUserAnswer() {
  const input = document.getElementById('calib-deep-input');
  const text = input?.value?.trim();
  if (!text) return;

  input.value = '';
  postDeepUserMessage(text);

  const currentQ = DEEP_INTERVIEW_QUESTIONS[deepQuestionIndex] || `Interview Topic #${deepQuestionIndex + 1}`;
  deepInterviewTurns.push({ question: currentQ, answer: text });
  deepQuestionIndex++;

  if (deepQuestionIndex < DEEP_INTERVIEW_QUESTIONS.length) {
    setTimeout(() => {
      postDeepAssistantMessage(DEEP_INTERVIEW_QUESTIONS[deepQuestionIndex]);
    }, 600);
  } else {
    // All questions completed!
    finishDeepSynthesis();
  }
}

async function finishDeepSynthesis() {
  if (deepSynthesisInProgress) return;
  deepSynthesisInProgress = true;

  const history = document.getElementById('calib-deep-chat-history');
  if (history) {
    const wrap = document.createElement('div');
    wrap.className = 'calib-deep-bubble assistant final-wrap';
    wrap.innerHTML = `
      <div class="calib-bubble-content" style="color: var(--accent-cyan); font-weight: 600;">
        Thank you—we've gathered deep insight into how you think and code. Updating your Auto Mode profile now...
      </div>
    `;
    history.appendChild(wrap);
    history.scrollTop = history.scrollHeight;
  }

  // Update status bar or show spinner indicator
  const statusPill = document.createElement('div');
  statusPill.id = 'persona-synthesis-status-pill';
  statusPill.className = 'status-pill synthesis-live-indicator';
  statusPill.innerHTML = `
    <span class="spinner-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent-cyan); animation:pulse 1s infinite;"></span>
    <span>Synthesizing Auto-Persona…</span>
  `;
  document.querySelector('.status-bar-left')?.prepend(statusPill);

  // Auto-close modal after exactly 1.8 seconds per requirement!
  setTimeout(async () => {
    closeCalibrationModal();
    try {
      const updated = await invoke('persona_synthesize_deep_profile', {
        interviewLog: deepInterviewTurns,
        userNotes: deepInterviewTurns.map(t => `${t.question}: ${t.answer}`).join('\n')
      });
      cachedState = updated;
      showToast('✨ Auto-Persona synthesized and locked in! Your unique Behavioral Constitution is now active.', 'success', 4500);
    } catch (err) {
      showToast(`Synthesis error: ${err}`, 'error', 3000);
    } finally {
      statusPill.remove();
      deepSynthesisInProgress = false;
    }
  }, 1800);
}

// ==========================================================================
// SETTINGS PANEL INTEGRATION (APPLE HIG PERSONA STUDIO)
// ==========================================================================

const PERSONA_CONFIGS = [
  {
    id: 'auto',
    name: 'Auto Mode',
    badge: 'Adaptive AI',
    badgeClass: 'adaptive',
    emoji: '✨',
    avatarClass: 'auto',
    desc: 'Learns and refines coding style, detail level, and tone from your ongoing feedback reactions.'
  },
  {
    id: 'atlas',
    name: 'Atlas',
    badge: 'Strategic',
    badgeClass: 'strategic',
    emoji: '🛡️',
    avatarClass: 'atlas',
    desc: 'Chief-of-staff delivery: 1-sentence executive summaries, clean execution, and proactive edge cases.'
  },
  {
    id: 'pulse',
    name: 'Pulse',
    badge: 'Minimalist',
    badgeClass: 'minimal',
    emoji: '⚡',
    avatarClass: 'pulse',
    desc: 'Zero conversational filler. Strictly exact code, unified diffs, and surgical root causes.'
  },
  {
    id: 'nova',
    name: 'Nova',
    badge: 'Pair Dev',
    badgeClass: 'pair',
    emoji: '🤝',
    avatarClass: 'nova',
    desc: 'Warm, collaborative mentor explaining architectural rationale with clear mental models.'
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    badge: 'Auditor',
    badgeClass: 'auditor',
    emoji: '🔬',
    avatarClass: 'vanguard',
    desc: 'Strict kernel auditor assessing memory safety, race conditions, and architectural invariants.'
  }
];

export function setupPersonaSettingsUI() {
  const pane = document.getElementById('spane-persona');
  if (!pane) return;

  const state = cachedState;
  const autoProfile = state?.auto_profile || {
    active_persona: 'auto',
    liked_traits: [],
    disliked_traits: [],
    surveys_disabled: false,
    consecutive_descriptive_count: 0,
    total_turns_in_auto: 0,
    total_calibrations_completed: 0,
    behavioral_constitution: ''
  };

  const activeId = autoProfile.active_persona || 'auto';

  pane.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-header">
        <div class="settings-section-title">AI Personalities &amp; Archetypes</div>
        <div class="settings-section-desc">
          Choose the communication and architectural persona Orbital X uses across your project. In Auto Mode, your feedback dynamically refines tone, detail, and technical conventions.
        </div>
      </div>

      <!-- Apple Inset Grouped Persona Selector -->
      <div class="persona-selection-group" role="radiogroup" aria-label="AI Personality Archetypes">
        ${PERSONA_CONFIGS.map(p => {
          const isSelected = activeId === p.id;
          return `
            <div class="persona-option-row ${isSelected ? 'is-active' : ''}" data-set-persona="${p.id}" role="radio" aria-checked="${isSelected}" tabindex="0">
              <div class="persona-option-left">
                <div class="persona-option-avatar ${p.avatarClass}">${p.emoji}</div>
                <div class="persona-option-text">
                  <div class="persona-option-heading">
                    <span class="persona-option-name">${escapeHtml(p.name)}</span>
                    <span class="persona-tagline-badge ${p.badgeClass}">${escapeHtml(p.badge)}</span>
                    ${isSelected ? '<span class="persona-active-indicator"><span class="dot"></span> Active</span>' : ''}
                  </div>
                  <div class="persona-option-desc">${escapeHtml(p.desc)}</div>
                </div>
              </div>
              <div class="persona-option-radio ${isSelected ? 'checked' : ''}" aria-hidden="true">
                ${isSelected ? '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>' : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Adaptive Intelligence Studio Section -->
    <div class="settings-section" style="margin-top: 24px;">
      <div class="settings-section-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
        <div>
          <div class="settings-section-title">Adaptive Intelligence Studio</div>
          <div class="settings-section-desc">
            Live telemetry and behavioral alignment rules learned during your coding sessions.
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0; align-items: center;">
          <button class="btn btn-primary btn-sm" id="btn-settings-open-calibration" type="button">
            Calibrate Preferences...
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-settings-reset-auto" type="button" title="Reset Auto constitution to factory defaults">
            Reset Auto
          </button>
        </div>
      </div>

      <!-- Telemetry Bar -->
      <div class="persona-telemetry-bar">
        <div class="telemetry-pill">Turns in Auto: <strong>${autoProfile.total_turns_in_auto || 0}</strong></div>
        <div class="telemetry-pill">Calibrations: <strong>${autoProfile.total_calibrations_completed || 0}</strong></div>
        <div class="telemetry-pill">Calibration Streak: <strong>${autoProfile.consecutive_descriptive_count || 0}/3</strong></div>
        <label class="telemetry-pill" style="cursor: pointer; user-select: none;">
          <input type="checkbox" id="persona-toggle-surveys-chk" ${autoProfile.surveys_disabled ? '' : 'checked'} style="margin-right: 6px; cursor: pointer;">
          Surveys Enabled
        </label>
      </div>

      <!-- Traits Grid -->
      <div class="persona-traits-grid">
        <div class="persona-traits-box">
          <div class="traits-box-label">Reinforced Signals (👍 Feedback)</div>
          <div class="traits-chips-container">
            ${autoProfile.liked_traits.length ? autoProfile.liked_traits.map(t => `<span class="trait-chip liked">✓ ${escapeHtml(t.replace(/_/g, ' '))}</span>`).join('') : '<span class="trait-empty">No positive signals recorded yet</span>'}
          </div>
        </div>
        <div class="persona-traits-box">
          <div class="traits-box-label">Avoided Constraints (👎 Feedback)</div>
          <div class="traits-chips-container">
            ${autoProfile.disliked_traits.length ? autoProfile.disliked_traits.map(t => `<span class="trait-chip disliked">✕ ${escapeHtml(t.replace(/_/g, ' '))}</span>`).join('') : '<span class="trait-empty">No negative constraints recorded yet</span>'}
          </div>
        </div>
      </div>

      <!-- Active Constitution Inset -->
      <div class="persona-constitution-block">
        <div class="constitution-toolbar">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="constitution-title">Active Behavioral Constitution</span>
            <span class="constitution-pill-state">${activeId === 'auto' ? 'Dynamic Auto Profile' : `${activeId.toUpperCase()} (Static Archetype)`}</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-copy-constitution" type="button" style="font-size: 11px; padding: 2px 8px;">Copy</button>
        </div>
        <pre class="constitution-code-box" id="persona-constitution-pre">${escapeHtml(autoProfile.behavioral_constitution || 'No active constitution loaded.')}</pre>
      </div>
    </div>
  `;

  // Bind activation clicks on persona rows
  pane.querySelectorAll('[data-set-persona]').forEach(row => {
    const id = row.getAttribute('data-set-persona');
    row.addEventListener('click', async () => {
      try {
        const updated = await invoke('persona_set_active', { personaId: id });
        cachedState = updated;
        updateComposerPillUI(id);
        setupPersonaSettingsUI();
        const nameMap = { auto: 'Auto', atlas: 'Atlas', pulse: 'Pulse', nova: 'Nova', vanguard: 'Vanguard' };
        showToast(`Activated ${nameMap[id] || id} personality`, 'success', 2000);
      } catch (err) {
        showToast(`Failed to activate persona: ${err}`, 'error', 3000);
      }
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      }
    });
  });

  // Bind Launch Calibration Studio
  pane.querySelector('#btn-settings-open-calibration')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCalibrationModal(autoProfile.consecutive_descriptive_count >= 3);
  });

  // Bind Reset Auto Profile
  pane.querySelector('#btn-settings-reset-auto')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const { showConfirmDialog } = await import('../services/dialogs.js');
    if (await showConfirmDialog('Reset Auto Mode Profile', 'Are you sure you want to reset your learned Auto Mode profile to defaults?', 'Reset', true)) {
      try {
        const updated = await invoke('persona_reset_auto');
        cachedState = updated;
        setupPersonaSettingsUI();
        showToast('Auto Mode profile has been reset to factory defaults.', 'info', 2500);
      } catch (err) {
        showToast(`Reset error: ${err}`, 'error', 3000);
      }
    }
  });

  // Bind Survey Toggle
  pane.querySelector('#persona-toggle-surveys-chk')?.addEventListener('change', async (e) => {
    try {
      const updated = await invoke('persona_toggle_surveys', { enabled: e.target.checked });
      cachedState = updated;
      showToast(e.target.checked ? 'Surveys enabled' : 'Surveys disabled', 'info', 2000);
    } catch (err) {
      showToast(`Toggle error: ${err}`, 'error', 3000);
    }
  });

  // Bind Copy Constitution
  pane.querySelector('#btn-copy-constitution')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = autoProfile.behavioral_constitution || '';
    navigator.clipboard.writeText(text).then(() => {
      showToast('Constitution copied to clipboard', 'success', 1800);
    }).catch(() => {
      showToast('Failed to copy', 'error', 2000);
    });
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
