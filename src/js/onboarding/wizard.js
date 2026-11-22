// ==========================================================================
// Orbital X — First-Run Onboarding Wizard (wizard.js)
// ==========================================================================

import { state, persistState } from '../state/store.js';
import { applyTheme } from '../components/settings.js';
import { switchMode } from '../components/agent.js';
import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';
import { FocusTrap } from '../utils/focus-trap.js';

let onboardingFocusTrap = null;

let currentStep = 1;
const totalSteps = 5;

export function initOnboarding() {
  const modal = document.getElementById('modal-onboarding');
  const prevBtn = document.getElementById('btn-onboarding-prev');
  const nextBtn = document.getElementById('btn-onboarding-next');
  const skipBtn = document.getElementById('btn-skip-onboarding');

  // Trigger from welcome screen
  document.getElementById('btn-welcome-onboarding')?.addEventListener('click', startOnboarding);

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
    if (!onboardingFocusTrap) {
      onboardingFocusTrap = new FocusTrap(modal, { onClose: closeOnboarding });
    }
    onboardingFocusTrap.activate();
    renderStep();
  }
}

export function closeOnboarding() {
  onboardingFocusTrap?.deactivate();
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

  // O2: clickable progress dots + per-step skip
  renderProgressDots();
  const skipBtn = document.getElementById('btn-onboarding-skip-step');
  if (skipBtn) {
    skipBtn.style.display = currentStep < totalSteps ? 'inline-flex' : 'none';
  }

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
          const models = res.models_available || [];
          const hasCoderModel = models.some(m => /qwen|coder|deepseek|llama|code/i.test(m));
          if (hasCoderModel) {
            statusText.innerHTML = `✓ Ollama is running — ${models.length} model${models.length === 1 ? '' : 's'} installed (${models[0]}). Local coding is ready.`;
            statusText.style.color = 'var(--accent-green)';
          } else {
            statusText.innerHTML = `
              <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
                <div style="color: var(--accent-orange);">✓ Ollama is running, but no code models were found.</div>
                <div style="font-size: 11px; color: var(--text-secondary);">We recommend <strong>qwen2.5-coder:7b</strong> for high-speed local coding and Monaco diff generation.</div>
                <button class="btn btn-primary btn-sm" id="btn-pull-recommended" style="width: fit-content; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                  <span>⚡ 1-Click Pull qwen2.5-coder:7b</span>
                </button>
                <div id="pull-progress-status" style="display: none; font-size: 10.5px; color: var(--accent-cyan);"></div>
              </div>
            `;
            const pullBtn = statusText.querySelector('#btn-pull-recommended');
            const pullStatus = statusText.querySelector('#pull-progress-status');
            pullBtn?.addEventListener('click', async () => {
              pullBtn.disabled = true;
              pullBtn.textContent = 'Pulling model…';
              if (pullStatus) {
                pullStatus.style.display = 'block';
                pullStatus.textContent = 'Connecting to Ollama library…';
              }
              try {
                await invoke('ollama_pull_model', { name: 'qwen2.5-coder:7b' });
                showToast('✓ Successfully pulled qwen2.5-coder:7b!', 'success', 4000);
                state.ai.model = 'qwen2.5-coder:7b';
                persistState();
                runCheck();
              } catch (pErr) {
                if (pullStatus) pullStatus.textContent = `Pull error: ${pErr}`;
                pullBtn.disabled = false;
                pullBtn.textContent = 'Retry Pull';
              }
            });
          }
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
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <div style="font-size: 16px; font-weight: 600;">Step 4: The 60-Second Guided Tour</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
            Here is where the 4 primary controls are placed in Orbital X:
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 14px;">💬</span>
              <strong style="font-size: 12px; color: var(--accent-cyan);">1. AI Chat Composer</strong>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
              Docked on the <strong>bottom-right</strong> (or toggle with <code>Ctrl+L</code>). Type prompts, mention files with <code>@</code>, or paste screenshots.
            </div>
          </div>

          <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 14px;">🏛️</span>
              <strong style="font-size: 12px; color: var(--accent-purple);">2. Memory & Knowledge</strong>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
              Located on the <strong>left activity bar</strong> (or <code>Ctrl+Shift+M</code>). Stores persistent architecture rules, conventions, and stack memory.
            </div>
          </div>

          <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 14px;">💻</span>
              <strong style="font-size: 12px; color: var(--accent-green);">3. Integrated Terminals</strong>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
              Docked in the <strong>bottom panel</strong> (toggle with <code>Ctrl+\`</code>). Hosts up to 3 live Agent Terminals (1, 2, 3) with real-time Stop/Kill.
            </div>
          </div>

          <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 14px;">🔍</span>
              <strong style="font-size: 12px; color: #f59e0b);">4. Review Changes & Diff</strong>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
              Positioned in the <strong>top header</strong>. Inspect side-by-side Monaco diffs of AI-modified files before saving or committing.
            </div>
          </div>
        </div>

        <div style="font-size: 11px; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; border: 1px dashed var(--border-subtle);">
          💡 <strong>Pro Tip:</strong> Press <code>Ctrl+P</code> to fuzzy-search any file, and <code>Ctrl+Shift+P</code> to open the full Command Palette.
        </div>
      </div>
    `;
  } else if (currentStep === 5) {
    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 16px; font-weight: 600;">Step 5: Pick Your Theme & Test Drive</div>
        <div style="font-size: 12px; color: var(--text-secondary);">
          Choose your visual appearance, or launch an interactive sample project to test Agent Pro and Monaco diff immediately.
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 4px;">
          <div class="theme-card ${state.theme === 'orbit-dark' ? 'selected' : ''}" data-theme="orbit-dark" style="border: 2px solid ${state.theme === 'orbit-dark' ? 'var(--accent-cyan)' : 'var(--border-color)'}; padding: 10px; border-radius: 8px; background: #0d1117; cursor: pointer; text-align: center;">
            <div style="font-weight: 600; color: #f0f6fc; font-size: 11.5px;">Orbit Dark</div>
            <div style="font-size: 10px; color: #8b949e; margin-top: 2px;">Charcoal & Cyan</div>
          </div>

          <div class="theme-card ${state.theme === 'nebula-light' ? 'selected' : ''}" data-theme="nebula-light" style="border: 2px solid ${state.theme === 'nebula-light' ? 'var(--accent-cyan)' : 'var(--border-color)'}; padding: 10px; border-radius: 8px; background: #ffffff; cursor: pointer; text-align: center;">
            <div style="font-weight: 600; color: #1f2328; font-size: 11.5px;">Nebula Light</div>
            <div style="font-size: 10px; color: #57606a; margin-top: 2px;">Slate & White</div>
          </div>

          <div class="theme-card ${state.theme === 'midnight-blue' ? 'selected' : ''}" data-theme="midnight-blue" style="border: 2px solid ${state.theme === 'midnight-blue' ? 'var(--accent-cyan)' : 'var(--border-color)'}; padding: 10px; border-radius: 8px; background: #080d1a; cursor: pointer; text-align: center;">
            <div style="font-weight: 600; color: #f8fafc; font-size: 11.5px;">Midnight Blue</div>
            <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Cosmic Navy</div>
          </div>
        </div>

        <div style="margin-top: 8px; padding: 12px 14px; background: rgba(57, 197, 187, 0.08); border: 1px solid rgba(57, 197, 187, 0.25); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div>
            <div style="font-weight: 600; font-size: 12px; color: var(--text-primary);">Test Agent Pro with Sample Project</div>
            <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 2px;">
              Loads a lightweight calculator workspace with tests so you can test Agent Pro and Monaco diff immediately.
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-load-sample-project" style="white-space: nowrap; padding: 6px 14px; font-weight: 600;">
            🚀 Load Sample Project
          </button>
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

    body.querySelector('#btn-load-sample-project')?.addEventListener('click', () => {
      launchInteractiveSampleProject();
    });
  }
}

// O2: clickable progress dots + per-step skip + VS Code settings import
function renderProgressDots() {
  const modal = document.getElementById('modal-onboarding');
  if (!modal) return;
  let dots = modal.querySelector('.onboarding-dots');
  const footer = modal.querySelector('.onboarding-footer') || modal.querySelector('#btn-onboarding-next')?.parentElement;
  if (!footer) return;
  if (!dots) {
    dots = document.createElement('div');
    dots.className = 'onboarding-dots';
    dots.style.cssText = 'display: flex; gap: 6px; margin-right: auto;';
    footer.insertBefore(dots, footer.firstChild);

    // per-step skip link
    const skipStep = document.createElement('button');
    skipStep.className = 'btn btn-secondary btn-sm';
    skipStep.id = 'btn-onboarding-skip-step';
    skipStep.textContent = 'Skip this step';
    skipStep.addEventListener('click', () => {
      currentStep = Math.min(currentStep + 1, totalSteps);
      renderStep();
    });
    footer.insertBefore(skipStep, dots.nextSibling);

    // VS Code settings import
    const vsBtn = document.createElement('button');
    vsBtn.className = 'btn btn-secondary btn-sm';
    vsBtn.textContent = 'Import from VS Code';
    vsBtn.title = 'Map common settings from your VS Code user settings.json';
    vsBtn.addEventListener('click', importFromVSCode);
    footer.insertBefore(vsBtn, footer.firstChild.nextSibling);
  }
  dots.innerHTML = '';
  for (let i = 1; i <= totalSteps; i++) {
    const dot = document.createElement('span');
    dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; cursor: pointer; background: ${i === currentStep ? 'var(--accent-cyan)' : (i < currentStep ? 'var(--accent-green)' : 'var(--border-color)')};`;
    dot.title = `Step ${i}`;
    dot.addEventListener('click', () => { currentStep = i; renderStep(); });
    dots.appendChild(dot);
  }
}

async function importFromVSCode() {
  // Read the VS Code user settings via the backend (frontend cannot touch
  // arbitrary files). Mapped: font settings, word wrap, tab size, minimap.
  try {
    const res = await invoke('run_command', {
      command: 'Get-Content "$env:APPDATA\Code\User\settings.json" -Raw',
      timeout_seconds: 10,
    });
    const raw = (res.stdout || '').trim();
    if (!raw) throw new Error('settings.json not found');
    // VS Code allows JSONC — strip // comments crudely
    const cleaned = raw.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(cleaned);
    const { state } = await import('../state/store.js');
    const mon = await import('../editor/monaco.js');
    const ed = state.settings.editor || (state.settings.editor = {});
    if (parsed['editor.fontSize']) ed.fontSize = Number(parsed['editor.fontSize']);
    if (parsed['editor.fontFamily']) ed.fontFamily = parsed['editor.fontFamily'];
    if (parsed['editor.fontLigatures'] !== undefined) ed.fontLigatures = !!parsed['editor.fontLigatures'];
    if (parsed['editor.wordWrap']) ed.wordWrap = parsed['editor.wordWrap'];
    if (parsed['editor.tabSize']) ed.tabSize = Number(parsed['editor.tabSize']);
    if (parsed['editor.minimap.enabled'] !== undefined) ed.minimap = !!parsed['editor.minimap.enabled'];
    mon.applyEditorSettings();
    showToast('Imported common editor settings from VS Code', 'success', 2800);
    renderStep();
  } catch (e) {
    showToast(`VS Code import: ${e.message || e}`, 'warning', 3600);
  }
}

export async function launchInteractiveSampleProject() {
  closeOnboarding();
  try {
    const sampleCode = `// Orbital X Interactive Sample Project
// Try Agent Pro + Monaco Diff: Ask the agent to add functions or tests!

export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}
`;
    const testCode = `// Unit tests for calculator
import { add, subtract } from './calculator.js';

console.log('Testing add(2, 3)...', add(2, 3) === 5 ? 'PASS' : 'FAIL');
console.log('Testing subtract(5, 2)...', subtract(5, 2) === 3 ? 'PASS' : 'FAIL');
`;
    await invoke('write_file', { path: 'calculator.js', content: sampleCode, description: 'Sample project' }).catch(() => {});
    await invoke('write_file', { path: 'calculator.test.js', content: testCode, description: 'Sample tests' }).catch(() => {});

    const { openFileInTab } = await import('../editor/monaco.js');
    openFileInTab({
      path: 'calculator.js',
      name: 'calculator.js',
      relative_path: 'calculator.js',
      content: sampleCode,
      is_binary: false,
      language: 'javascript'
    });

    const inputElem = document.getElementById('agent-input');
    if (inputElem) {
      inputElem.value = 'Add a multiply and divide function to calculator.js and update calculator.test.js';
      inputElem.focus();
    }
    showToast('🚀 Interactive Sample Project loaded! Ready to test Agent Pro.', 'success', 3500);
  } catch (err) {
    showToast(`Sample project: ${err}`, 'info', 3000);
  }
}
