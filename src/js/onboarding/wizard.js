// ==========================================================================
// Orbital X — First-Run Onboarding Wizard (wizard.js)
// ==========================================================================

import { state, persistState } from '../state/store.js';
import { applyTheme } from '../components/settings.js';
import { switchMode } from '../components/agent.js';
import { invoke } from '../services/tauri.js';

let currentStep = 1;
const totalSteps = 4;

export function initOnboarding() {
  const modal = document.getElementById('modal-onboarding');
  const prevBtn = document.getElementById('btn-onboarding-prev');
  const nextBtn = document.getElementById('btn-onboarding-next');
  const skipBtn = document.getElementById('btn-skip-onboarding');

  // Trigger from welcome screen
  document.getElementById('btn-welcome-onboarding')?.addEventListener('click', startOnboarding);
  document.getElementById('menu-help')?.addEventListener('click', startOnboarding);

  if (skipBtn) skipBtn.addEventListener('click', closeOnboarding);

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentStep > 1) {
        currentStep--;
        renderStep();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentStep < totalSteps) {
        currentStep++;
        renderStep();
      } else {
        closeOnboarding();
      }
    });
  }

  // Check if first launch
  const hasOnboarded = localStorage.getItem('orbital_onboarded');
  if (!hasOnboarded) {
    setTimeout(startOnboarding, 500);
  }
}

export function startOnboarding() {
  currentStep = 1;
  const modal = document.getElementById('modal-onboarding');
  if (modal) {
    modal.style.display = 'flex';
    renderStep();
  }
}

export function closeOnboarding() {
  const modal = document.getElementById('modal-onboarding');
  if (modal) modal.style.display = 'none';
  localStorage.setItem('orbital_onboarded', 'true');
}

function renderStep() {
  const body = document.getElementById('onboarding-step-body');
  const prevBtn = document.getElementById('btn-onboarding-prev');
  const nextBtn = document.getElementById('btn-onboarding-next');

  if (!body) return;

  prevBtn.style.display = currentStep > 1 ? 'inline-flex' : 'none';
  nextBtn.textContent = currentStep === totalSteps ? 'Get Started' : 'Next';

  if (currentStep === 1) {
    body.innerHTML = `
      <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <div style="position: relative; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center;">
          <img src="/logo.png" alt="Orbital X" style="width: 58px; height: 58px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 24px rgba(57, 197, 187, 0.55), 0 0 48px rgba(188, 140, 255, 0.35);" />
        </div>
        <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">Welcome to Orbital X</div>
        <div style="font-size: 13px; color: var(--text-secondary); max-width: 440px; line-height: 1.5;">
          A memory-conscious, autonomous AI coding environment built with Rust and modern web standards.
          Keep complete control of your workspace with explicit permissions and validation.
        </div>
        <div style="background: var(--bg-surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); width: 100%; text-align: left; font-size: 12px; margin-top: 8px;">
          ✓ Local-first & provider-neutral<br>
          ✓ 3 Autonomy Modes: Agent Pro, Dev, and User<br>
          ✓ Integrated Monaco diff review & test validation
        </div>
      </div>
    `;
  } else if (currentStep === 2) {
    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 16px; font-weight: 600;">Step 2: Choose Your AI Provider</div>
        <div style="font-size: 12px; color: var(--text-secondary);">
          Connect to local models or cloud providers using your own keys.
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
        <label style="display: flex; align-items: center; gap: 10px; background: var(--bg-surface); padding: 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color);">
          <input type="radio" name="ob-provider" value="ollama" ${state.ai.provider === 'ollama' ? 'checked' : ''} />
          <div>
            <strong>Ollama (Local Inference)</strong>
            <div style="font-size: 11px; color: var(--text-secondary);">100% private, runs entirely on your hardware via localhost:11434.</div>
          </div>
        </label>

        <div id="ob-ollama-status" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; background: var(--bg-surface); border: 1px solid var(--border-subtle); font-size: 11px;">
          <span id="ob-ollama-status-text" style="color: var(--text-muted);">Checking whether Ollama is running…</span>
          <button class="btn btn-secondary btn-sm" id="ob-ollama-recheck" style="margin-left: auto; padding: 2px 8px; font-size: 10px;">Re-check</button>
        </div>

          <label style="display: flex; align-items: center; gap: 10px; background: var(--bg-surface); padding: 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color);">
            <input type="radio" name="ob-provider" value="anthropic" ${state.ai.provider === 'anthropic' ? 'checked' : ''} />
            <div>
              <strong>Anthropic Claude API</strong>
              <div style="font-size: 11px; color: var(--text-secondary);">Claude 3.7 Sonnet / 3.5 Sonnet using your Anthropic API key.</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; background: var(--bg-surface); padding: 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color);">
            <input type="radio" name="ob-provider" value="openai" ${state.ai.provider === 'openai' ? 'checked' : ''} />
            <div>
              <strong>OpenAI API</strong>
              <div style="font-size: 11px; color: var(--text-secondary);">GPT-4o, o3-mini using your OpenAI API key.</div>
            </div>
          </label>
        </div>
      </div>
    `;

    body.querySelectorAll('input[name="ob-provider"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.ai.provider = e.target.value;
        persistState();
      });
    });

    const statusText = body.querySelector('#ob-ollama-status-text');
    const recheckBtn = body.querySelector('#ob-ollama-recheck');
    const runCheck = async () => {
      if (!statusText) return;
      statusText.textContent = 'Checking whether Ollama is running…';
      statusText.style.color = 'var(--text-muted)';
      try {
        const res = await invoke('test_provider_connection', {
          provider: 'ollama',
          apiKey: '',
          model: '',
          baseUrl: state.ai.endpoint,
        });
        if (res && res.success) {
          statusText.innerHTML = `✓ Ollama is running — ${res.models_available.length} model${res.models_available.length === 1 ? '' : 's'} installed. Local coding is ready.`;
          statusText.style.color = 'var(--accent-green)';
        } else {
          throw new Error(res?.message || 'not reachable');
        }
      } catch (e) {
        statusText.innerHTML = `✗ Ollama was not detected at <code>${state.ai.endpoint}</code>. Install it from <strong>ollama.com</strong> (or <code>winget install Ollama.Ollama</code>), start it, then re-check. You can still finish setup and use cloud providers meanwhile.`;
        statusText.style.color = 'var(--accent-orange)';
      }
    };
    recheckBtn?.addEventListener('click', runCheck);
    runCheck();
  } else if (currentStep === 3) {
    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 16px; font-weight: 600;">Step 3: Select Default Operating Mode</div>
        <div style="font-size: 12px; color: var(--text-secondary);">
          Choose how much autonomy Orbital X has inside your projects. You can switch anytime.
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label style="display: flex; align-items: flex-start; gap: 10px; background: var(--bg-surface); padding: 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color);">
            <input type="radio" name="ob-mode" value="dev" ${state.agentMode === 'dev' ? 'checked' : ''} />
            <div>
              <strong style="color: var(--accent-cyan);">Dev Mode (Recommended)</strong>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                Routine code inspection and searching are streamlined. File modifications show a diff, and terminal commands require approval.
              </div>
            </div>
          </label>

          <label style="display: flex; align-items: flex-start; gap: 10px; background: var(--bg-surface); padding: 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color);">
            <input type="radio" name="ob-mode" value="agent_pro" ${state.agentMode === 'agent_pro' ? 'checked' : ''} />
            <div>
              <strong style="color: var(--accent-purple);">Agent Pro Mode</strong>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                High autonomy within workspace boundaries. Reads, writes, and test scripts execute with minimal interruptions.
              </div>
            </div>
          </label>

          <label style="display: flex; align-items: flex-start; gap: 10px; background: var(--bg-surface); padding: 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color);">
            <input type="radio" name="ob-mode" value="user" ${state.agentMode === 'user' ? 'checked' : ''} />
            <div>
              <strong style="color: var(--accent-orange);">User Mode</strong>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                Total control: asks for your explicit permission before every file read, edit, or shell command.
              </div>
            </div>
          </label>
        </div>
      </div>
    `;

    body.querySelectorAll('input[name="ob-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        switchMode(e.target.value);
        persistState();
      });
    });
  } else if (currentStep === 4) {
    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 16px; font-weight: 600;">Step 4: Pick Your Theme</div>
        <div style="font-size: 12px; color: var(--text-secondary);">
          Choose your favorite visual theme.
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px;">
          <div class="theme-card ${state.theme === 'orbit-dark' ? 'selected' : ''}" data-theme="orbit-dark" style="border: 2px solid ${state.theme === 'orbit-dark' ? 'var(--accent-cyan)' : 'var(--border-color)'}; padding: 12px; border-radius: 8px; background: #0d1117; cursor: pointer; text-align: center;">
            <div style="font-weight: 600; color: #f0f6fc; font-size: 12px;">Orbit Dark</div>
            <div style="font-size: 10px; color: #8b949e; margin-top: 4px;">Charcoal & Cyan</div>
          </div>

          <div class="theme-card ${state.theme === 'nebula-light' ? 'selected' : ''}" data-theme="nebula-light" style="border: 2px solid ${state.theme === 'nebula-light' ? 'var(--accent-cyan)' : 'var(--border-color)'}; padding: 12px; border-radius: 8px; background: #ffffff; cursor: pointer; text-align: center;">
            <div style="font-weight: 600; color: #1f2328; font-size: 12px;">Nebula Light</div>
            <div style="font-size: 10px; color: #57606a; margin-top: 4px;">Slate & White</div>
          </div>

          <div class="theme-card ${state.theme === 'midnight-blue' ? 'selected' : ''}" data-theme="midnight-blue" style="border: 2px solid ${state.theme === 'midnight-blue' ? 'var(--accent-cyan)' : 'var(--border-color)'}; padding: 12px; border-radius: 8px; background: #080d1a; cursor: pointer; text-align: center;">
            <div style="font-weight: 600; color: #f8fafc; font-size: 12px;">Midnight Blue</div>
            <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Cosmic Navy</div>
          </div>
        </div>
      </div>
    `;

    body.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
        const theme = card.dataset.theme;
        applyTheme(theme);
        renderStep();
      });
    });
  }
}
