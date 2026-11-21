// ==========================================================================
// Orbital X — Adaptive Persona Engine & Isolated Calibration Studio
// (persona-calibration.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

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

function updateComposerPillUI(personaId) {
  const iconEl = document.getElementById('persona-pill-icon');
  const nameEl = document.getElementById('persona-pill-name');
  const menuEl = document.getElementById('composer-persona-menu');

  const meta = {
    auto: { icon: '✨', name: 'Auto' },
    atlas: { icon: '🛡️', name: 'Atlas' },
    pulse: { icon: '⚡', name: 'Pulse' },
    nova: { icon: '🌟', name: 'Nova' },
    vanguard: { icon: '🔒', name: 'Vanguard' }
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
        const updated = await invoke('persona_set_active', { persona_id: targetId });
        cachedState = updated;
        updateComposerPillUI(targetId);
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
    <div class="modal-container persona-calibration-container" role="dialog" aria-modal="true" aria-label="Auto Mode Personality Calibration">
      <!-- Header -->
      <div class="modal-header persona-calib-header">
        <div class="calib-header-left">
          <span class="calib-header-icon">✨</span>
          <div>
            <div class="calib-header-title">Auto Mode Calibration Studio</div>
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
      descriptive_note: descriptiveNote
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
        interview_log: deepInterviewTurns,
        user_notes: deepInterviewTurns.map(t => `${t.question}: ${t.answer}`).join('\n')
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
// SETTINGS PANEL INTEGRATION (DEEP PERSONA INSPECTOR)
// ==========================================================================

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
    behavioral_constitution: ''
  };

  pane.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-header">
        <h3 class="settings-section-title">AI Personalities &amp; Behavioral Constitutions</h3>
        <p class="settings-section-desc">
          Choose a locked static personality for targeted workflows or activate Auto Mode for self-calibrating intelligence.
        </p>
      </div>

      <!-- Static Personas Grid (4 built-in locked personas) -->
      <div class="persona-cards-grid">
        <div class="persona-card ${autoProfile.active_persona === 'auto' ? 'active-card' : ''}" data-set-persona="auto">
          <div class="persona-card-header">
            <span class="persona-card-icon">✨</span>
            <div>
              <div class="persona-card-title">Auto Mode <span class="persona-tag active">Adaptive</span></div>
              <div class="persona-card-role">Learns from your coding patterns &amp; feedback</div>
            </div>
          </div>
          <div class="persona-card-body">
            Continuously adapts to your tone, code-to-prose preference, and downstream edge case priorities. Fully customizable via Calibration Studio.
          </div>
          <button class="btn btn-sm ${autoProfile.active_persona === 'auto' ? 'btn-primary' : 'btn-secondary'} btn-activate-persona">
            ${autoProfile.active_persona === 'auto' ? '✓ Active' : 'Activate Auto'}
          </button>
        </div>

        <div class="persona-card ${autoProfile.active_persona === 'atlas' ? 'active-card' : ''}" data-set-persona="atlas">
          <div class="persona-card-header">
            <span class="persona-card-icon">🛡️</span>
            <div>
              <div class="persona-card-title">Atlas <span class="persona-tag">Strategic</span></div>
              <div class="persona-card-role">Strategic Co-Pilot &amp; Systems Architect</div>
            </div>
          </div>
          <div class="persona-card-body">
            Opens with a sharp 1-sentence executive summary. Calm, anticipatory chief-of-staff energy that proactively flags downstream risks.
          </div>
          <button class="btn btn-sm ${autoProfile.active_persona === 'atlas' ? 'btn-primary' : 'btn-secondary'} btn-activate-persona">
            ${autoProfile.active_persona === 'atlas' ? '✓ Active' : 'Activate Atlas'}
          </button>
        </div>

        <div class="persona-card ${autoProfile.active_persona === 'pulse' ? 'active-card' : ''}" data-set-persona="pulse">
          <div class="persona-card-header">
            <span class="persona-card-icon">⚡</span>
            <div>
              <div class="persona-card-title">Pulse <span class="persona-tag">Minimalist</span></div>
              <div class="persona-card-role">Pure Terminal Precision &amp; Diffs Only</div>
            </div>
          </div>
          <div class="persona-card-body">
            Strictly zero conversational filler ("Sure!", "Here is..."). Outputs only exact code blocks, unified diffs, and 1–2 sentence root causes.
          </div>
          <button class="btn btn-sm ${autoProfile.active_persona === 'pulse' ? 'btn-primary' : 'btn-secondary'} btn-activate-persona">
            ${autoProfile.active_persona === 'pulse' ? '✓ Active' : 'Activate Pulse'}
          </button>
        </div>

        <div class="persona-card ${autoProfile.active_persona === 'nova' ? 'active-card' : ''}" data-set-persona="nova">
          <div class="persona-card-header">
            <span class="persona-card-icon">🌟</span>
            <div>
              <div class="persona-card-title">Nova <span class="persona-tag">Pair Dev</span></div>
              <div class="persona-card-role">Friendly Pair-Programmer &amp; Collaborative Mentor</div>
            </div>
          </div>
          <div class="persona-card-body">
            Warm, collaborative, and explanatory. Uses intuitive everyday analogies, explains architectural choices, and makes engineering fun.
          </div>
          <button class="btn btn-sm ${autoProfile.active_persona === 'nova' ? 'btn-primary' : 'btn-secondary'} btn-activate-persona">
            ${autoProfile.active_persona === 'nova' ? '✓ Active' : 'Activate Nova'}
          </button>
        </div>

        <div class="persona-card ${autoProfile.active_persona === 'vanguard' ? 'active-card' : ''}" data-set-persona="vanguard">
          <div class="persona-card-header">
            <span class="persona-card-icon">🔒</span>
            <div>
              <div class="persona-card-title">Vanguard <span class="persona-tag">Auditor</span></div>
              <div class="persona-card-role">Strict Kernel Auditor &amp; Zero-Trust Reviewer</div>
            </div>
          </div>
          <div class="persona-card-body">
            Hyper-logical and skeptical. Opens with a structured Audit Assessment of security risks, data races, memory leaks, and invariant proofs.
          </div>
          <button class="btn btn-sm ${autoProfile.active_persona === 'vanguard' ? 'btn-primary' : 'btn-secondary'} btn-activate-persona">
            ${autoProfile.active_persona === 'vanguard' ? '✓ Active' : 'Activate Vanguard'}
          </button>
        </div>
      </div>

      <!-- Auto Mode Inspector & Learned Traits -->
      <div class="settings-subcard" style="margin-top: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div>
            <h4 style="margin: 0; font-size: 14px; font-weight: 600;">What Auto Mode Has Learned About You</h4>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
              Compiled from micro-feedback, prompt cadence, and calibration interviews.
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" id="btn-settings-open-calibration">🚀 Launch Calibration Studio</button>
            <button class="btn btn-secondary btn-sm" id="btn-settings-reset-auto" style="color: var(--accent-error);">↺ Reset Profile</button>
          </div>
        </div>

        <div class="calib-meta-row" style="display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; color: var(--text-secondary);">
          <div>Calibration Streak: <strong style="color: var(--accent-cyan);">${autoProfile.consecutive_descriptive_count}/3</strong></div>
          <div>Total Calibrations: <strong>${autoProfile.total_calibrations_completed || 0}</strong></div>
          <div>Turns in Auto: <strong>${autoProfile.total_turns_in_auto || 0}</strong></div>
          <div>Surveys: <strong>${autoProfile.surveys_disabled ? 'Disabled' : 'Enabled (every 3–7 turns)'}</strong></div>
        </div>

        <div class="traits-section" style="margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Liked Traits &amp; Preferences:</div>
          <div class="traits-chips-row">
            ${autoProfile.liked_traits.length ? autoProfile.liked_traits.map(t => `<span class="trait-chip liked">${escapeHtml(t.replace(/_/g, ' '))}</span>`).join('') : '<span style="font-size: 12px; color: var(--text-muted);">No traits learned yet. Run calibration or give 👍 feedback.</span>'}
          </div>
        </div>

        <div class="traits-section" style="margin-bottom: 14px;">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Disliked Patterns:</div>
          <div class="traits-chips-row">
            ${autoProfile.disliked_traits.length ? autoProfile.disliked_traits.map(t => `<span class="trait-chip disliked">${escapeHtml(t.replace(/_/g, ' '))}</span>`).join('') : '<span style="font-size: 12px; color: var(--text-muted);">None recorded.</span>'}
          </div>
        </div>

        <!-- Behavioral Constitution Live Viewer -->
        <div>
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Active Auto Behavioral Constitution:</div>
          <pre class="constitution-viewer">${escapeHtml(autoProfile.behavioral_constitution)}</pre>
        </div>
      </div>
    </div>
  `;

  // Bind activation buttons
  pane.querySelectorAll('[data-set-persona]').forEach(card => {
    const id = card.getAttribute('data-set-persona');
    card.querySelector('.btn-activate-persona')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const updated = await invoke('persona_set_active', { persona_id: id });
        cachedState = updated;
        updateComposerPillUI(id);
        setupPersonaSettingsUI();
        showToast(`Activated ${id.toUpperCase()} personality`, 'success', 2000);
      } catch (err) {
        showToast(`Failed to activate persona: ${err}`, 'error', 3000);
      }
    });
  });

  // Bind Launch Calibration Studio
  pane.querySelector('#btn-settings-open-calibration')?.addEventListener('click', () => {
    openCalibrationModal(autoProfile.consecutive_descriptive_count >= 3);
  });

  // Bind Reset Auto Profile
  pane.querySelector('#btn-settings-reset-auto')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset your learned Auto Mode profile to defaults?')) {
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
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
