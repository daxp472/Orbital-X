// ==========================================================================
// Orbital X — Dedicated Structured Error Presentation (errors.js)
//
// Distinct, separate, enterprise-grade error formatting for Orbital X:
// - Standardized error codes (OX-100 to OX-500)
// - Pillar & subsystem category badges
// - Actionable remediation guidance
// - 1-click interactive quick-fix action buttons
// - Collapsible diagnostic telemetry & raw payloads
// ==========================================================================

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==========================================================================
// Orbital X — Dedicated Structured 4-Stage Error Framework (errors.js)
//
// Organized into 4 clearly distinguished diagnostic stages:
// - STAGE 1: LOCAL OLLAMA / DAEMON (daemon offline, model missing, VRAM exhaustion)
// - STAGE 2: AI MODEL & PROVIDER (vision unsupported, rate limits, API keys, context limit)
// - STAGE 3: ORBITAL X ENGINE FAULT (runtime exceptions, JS errors, IPC breaks)
// - STAGE 4: WORKSPACE & USER ACTION (file not found, safety policy, normal operations)
// ==========================================================================

export const ERROR_STAGES = {
  STAGE_1_OLLAMA: {
    id: 1,
    name: 'STAGE 1: LOCAL OLLAMA / RUNTIME',
    badge: 'OLLAMA_ERROR',
    color: '#ff9800',
    dot: '🟠',
    desc: 'Local model daemon, missing weights, or GPU VRAM allocation'
  },
  STAGE_2_MODEL: {
    id: 2,
    name: 'STAGE 2: AI MODEL & PROVIDER',
    badge: 'MODEL_ERROR',
    color: '#00e5ff',
    dot: '🔵',
    desc: 'Model capability mismatch, provider quota, or context limit'
  },
  STAGE_3_INTERNAL: {
    id: 3,
    name: 'STAGE 3: ORBITAL X CORE ENGINE',
    badge: 'ENGINE_FAULT',
    color: '#b388ff',
    dot: '🟣',
    desc: 'Internal IDE script exception, logic error, or IPC break'
  },
  STAGE_4_NORMAL: {
    id: 4,
    name: 'STAGE 4: WORKSPACE & ACTION',
    badge: 'NORMAL_ERROR',
    color: '#4caf50',
    dot: '🟢',
    desc: 'Workspace filesystem, file permission, or safety policy'
  }
};

export function parseOrbitalError(rawErr, context = {}) {
  const errStr = String(rawErr?.message || rawErr || '');
  const lower = errStr.toLowerCase();

  // ========================================================================
  // STAGE 1: LOCAL OLLAMA & DAEMON ISSUES
  // ========================================================================

  // 1A. Ollama offline or connection refused
  if (lower.includes('11434') || lower.includes('connection refused') || lower.includes('failed to fetch') || lower.includes('econnrefused')) {
    return {
      stage: ERROR_STAGES.STAGE_1_OLLAMA,
      code: 'OX-101',
      category: 'OLLAMA_OFFLINE',
      title: 'Local Ollama Server Is Offline',
      message: 'Could not connect to Ollama at http://127.0.0.1:11434. The local AI inference server is stopped or blocked by firewall.',
      remediation: 'Start Ollama by launching the Ollama desktop app or running "ollama serve" in your terminal.',
      actions: [
        {
          label: 'Test Connection',
          primary: true,
          action: async () => {
            const { invoke } = await import('@tauri-apps/api/core');
            const { showToast } = await import('./notifications.js');
            try {
              const res = await invoke('test_provider_connection', { provider: 'ollama', apiKey: '', model: '', baseUrl: null });
              showToast(res ? 'Ollama connection successful!' : 'Still unreachable', res ? 'success' : 'error', 3000);
            } catch (e) {
              showToast(`Connection failed: ${e}`, 'error', 3000);
            }
          }
        },
        {
          label: 'Open Settings',
          primary: false,
          action: () => {
            document.querySelector('[data-view="settings"]')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // 1B. Model not found in Ollama
  if (lower.includes('not found') && (lower.includes('model') || lower.includes('pull'))) {
    const modelName = context.model || 'selected model';
    return {
      stage: ERROR_STAGES.STAGE_1_OLLAMA,
      code: 'OX-102',
      category: 'OLLAMA_MODEL_NOT_PULLED',
      title: `Model Not Downloaded in Ollama`,
      message: `The model '${modelName}' is not installed locally on your system yet.`,
      remediation: `Run "ollama run ${modelName}" in your command prompt to download it, or pick an installed model from the dropdown.`,
      actions: [
        {
          label: 'Pick Another Model',
          primary: true,
          action: () => {
            document.getElementById('composer-model-selector')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // 1C. Out of VRAM / GPU allocation error
  if (lower.includes('out of memory') || lower.includes('vram') || lower.includes('cuda out of memory') || lower.includes('cannot allocate memory')) {
    return {
      stage: ERROR_STAGES.STAGE_1_OLLAMA,
      code: 'OX-103',
      category: 'OLLAMA_OUT_OF_MEMORY',
      title: 'GPU / Memory Limit Exceeded',
      message: 'Your system or GPU ran out of memory while loading or generating tokens with this model.',
      remediation: 'Switch to a lighter 1.5B or 3B model (e.g. qwen2.5-coder:1.5b or llama3.2:3b), or compact your chat context.',
      actions: [
        {
          label: 'Compact Context',
          primary: true,
          action: () => {
            document.getElementById('popover-btn-compact')?.click();
          }
        },
        {
          label: 'Pick Lighter Model',
          primary: false,
          action: () => {
            document.getElementById('composer-model-selector')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // ========================================================================
  // STAGE 2: AI MODEL & PROVIDER CAPABILITIES
  // ========================================================================

  // 2A. Vision model requirement (Image attached with text-only model)
  if (lower.includes('vision') || lower.includes('image input') || context.visionRequired) {
    return {
      stage: ERROR_STAGES.STAGE_2_MODEL,
      code: 'OX-201',
      category: 'VISION_UNSUPPORTED',
      title: 'Active Model Cannot Understand Images',
      message: 'You attached an image or screenshot, but the currently selected model is text-only.',
      remediation: 'Switch to a multimodal vision model: Ollama (llama3.2-vision, llava, moondream) or Cloud (gpt-4o, claude-3-5-sonnet, gemini-2.0-flash).',
      actions: [
        {
          label: 'Switch to Vision Model',
          primary: true,
          action: () => {
            document.getElementById('composer-model-selector')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // 2B. Provider Rate Limits or Quota Exceeded
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || lower.includes('insufficient_quota') || lower.includes('credit')) {
    return {
      stage: ERROR_STAGES.STAGE_2_MODEL,
      code: 'OX-202',
      category: 'RATE_LIMIT_QUOTA',
      title: 'API Rate Limit or Quota Reached',
      message: 'The AI provider rejected the request due to rate limiting or zero available credit balance.',
      remediation: 'Switch to your free local Ollama model to continue coding immediately without cloud fees.',
      actions: [
        {
          label: 'Switch to Local Ollama',
          primary: true,
          action: async () => {
            const { state } = await import('../state/store.js');
            state.ai.provider = 'ollama';
            state.ai.model = 'qwen2.5-coder:1.5b';
            const nameEl = document.getElementById('composer-model-name');
            if (nameEl) nameEl.textContent = 'Ollama (qwen2.5-coder)';
            const { showToast } = await import('./notifications.js');
            showToast('Switched to Local Ollama', 'info', 2500);
          }
        }
      ],
      details: errStr
    };
  }

  // 2C. Invalid or Expired API Key
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid_api_key') || lower.includes('invalid api key')) {
    return {
      stage: ERROR_STAGES.STAGE_2_MODEL,
      code: 'OX-203',
      category: 'AUTH_FAILED',
      title: 'Invalid or Missing API Key',
      message: 'The cloud AI provider rejected your API key as invalid or expired.',
      remediation: 'Update your API key in Settings > AI Providers, or switch to local Ollama.',
      actions: [
        {
          label: 'Configure API Key',
          primary: true,
          action: () => {
            document.querySelector('[data-view="settings"]')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // 2D. Context Window Overflow
  if (lower.includes('context_length_exceeded') || lower.includes('maximum context length') || lower.includes('context window full')) {
    return {
      stage: ERROR_STAGES.STAGE_2_MODEL,
      code: 'OX-204',
      category: 'CONTEXT_FULL',
      title: 'Context Window Capacity Reached',
      message: 'The conversation and active file tokens have filled the model context window.',
      remediation: 'Click Compact Context to summarize prior turns into working memory while keeping your chat intact.',
      actions: [
        {
          label: 'Compact Context Now',
          primary: true,
          action: () => {
            document.getElementById('popover-btn-compact')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // ========================================================================
  // STAGE 3: ORBITAL X CORE ENGINE & SCRIPT BREAKS
  // ========================================================================

  // 3A. JavaScript / IDE Runtime Exception
  if (lower.includes('referenceerror') || lower.includes('typeerror') || lower.includes('is not defined') || lower.includes('is not a function') || lower.includes('cannot read property') || lower.includes('null is not an object')) {
    return {
      stage: ERROR_STAGES.STAGE_3_INTERNAL,
      code: 'OX-301',
      category: 'ENGINE_RUNTIME_EXCEPTION',
      title: 'Orbital X Core Script Exception',
      message: `An unexpected script exception occurred in the IDE runtime: ${errStr.split('\n')[0]}`,
      remediation: 'Orbital X trapped this exception to protect your workspace. You can restart the agent turn safely.',
      actions: [
        {
          label: 'Restart Turn',
          primary: true,
          action: () => {
            document.getElementById('btn-agent-send')?.click();
          }
        }
      ],
      details: rawErr?.stack || errStr
    };
  }

  // 3B. VFS Transaction Conflict
  if (lower.includes('vfs') || lower.includes('checkpoint') || lower.includes('conflict') || lower.includes('transaction lock')) {
    return {
      stage: ERROR_STAGES.STAGE_3_INTERNAL,
      code: 'OX-302',
      category: 'VFS_CONFLICT',
      title: 'Virtual File System Transaction Conflict',
      message: 'A pending file review or uncommitted virtual diff blocked new file modifications.',
      remediation: 'Review or reject pending file changes in the editor before generating new patches.',
      actions: [
        {
          label: 'Review Changes',
          primary: true,
          action: () => {
            document.getElementById('btn-review-changes')?.click();
          }
        }
      ],
      details: context
    };
  }

  // ========================================================================
  // STAGE 4: WORKSPACE & NORMAL USER ACTIONS
  // ========================================================================

  // 4A. Sandbox safety policy restriction
  if (lower.includes('policy') || lower.includes('sandbox') || lower.includes('denied') || lower.includes('prohibited')) {
    return {
      stage: ERROR_STAGES.STAGE_4_NORMAL,
      code: 'OX-401',
      category: 'SANDBOX_DENIED',
      title: 'Action Blocked by Safety Policy',
      message: errStr || 'This action was blocked by the active safety mode policy.',
      remediation: 'If you trust this action, switch safety mode to Balanced or Bypass in the status bar.',
      actions: [
        {
          label: 'Safety Settings',
          primary: true,
          action: () => {
            document.querySelector('[data-view="settings"]')?.click();
          }
        }
      ],
      details: context
    };
  }

  // 4B. File Not Found or Path Invalid
  if (lower.includes('no such file') || lower.includes('enoent') || lower.includes('path not found')) {
    return {
      stage: ERROR_STAGES.STAGE_4_NORMAL,
      code: 'OX-402',
      category: 'FILE_NOT_FOUND',
      title: 'Workspace File Not Found',
      message: errStr || 'The requested file could not be located in the current project directory.',
      remediation: 'Verify that the path is relative to the project root, or attach it using the @ context button.',
      actions: [],
      details: context
    };
  }

  // 4C. Default standard runtime error
  return {
    stage: ERROR_STAGES.STAGE_4_NORMAL,
    code: 'OX-400',
    category: 'GENERAL_ERROR',
    title: 'Operation Could Not Complete',
    message: errStr || 'An unexpected execution issue occurred during this turn.',
    remediation: 'Inspect the technical diagnostics below or retry with a simplified instruction.',
    actions: [],
    details: rawErr?.stack || errStr
  };
}

export function renderOrbitalErrorCard(errorData) {
  const data = typeof errorData === 'string' ? parseOrbitalError(errorData) : errorData;
  const stage = data.stage || ERROR_STAGES.STAGE_4_NORMAL;
  const card = document.createElement('div');
  card.className = 'ox-error-card';
  card.dataset.code = data.code || 'OX-400';

  card.innerHTML = `
    <div class="ox-error-header">
      <div class="ox-error-badge-group">
        <span class="ox-error-stage-pill" style="border-color: ${stage.color}; color: ${stage.color}; background: color-mix(in srgb, ${stage.color} 10%, transparent);">
          ${stage.name}
        </span>
        <span class="ox-error-badge">${escapeHtml(data.code || 'OX-400')}</span>
        <span class="ox-error-category">${escapeHtml(data.category || 'ERROR')}</span>
      </div>
      <span class="ox-error-timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    <div class="ox-error-title">${escapeHtml(data.title || 'Error')}</div>
    <div class="ox-error-body">${escapeHtml(data.message || '')}</div>
    ${data.remediation ? `
      <div class="ox-error-remediation">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        <span>${escapeHtml(data.remediation)}</span>
      </div>
    ` : ''}
    <div class="ox-error-actions"></div>
    ${data.details ? `
      <details class="ox-error-details">
        <summary>Technical Diagnostics &amp; Stack</summary>
        <pre>${escapeHtml(typeof data.details === 'object' ? JSON.stringify(data.details, null, 2) : String(data.details))}</pre>
      </details>
    ` : ''}
  `;

  const actionsRow = card.querySelector('.ox-error-actions');
  if (data.actions && Array.isArray(data.actions)) {
    for (const act of data.actions) {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${act.primary ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = act.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        act.action?.();
      });
      actionsRow.appendChild(btn);
    }
  }

  // Copy Diagnostics button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-sm btn-secondary ox-copy-btn';
  copyBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    <span>Copy Diagnostics</span>
  `;
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const payload = `[Orbital X Diagnostic Report]\nStage: ${stage.name}\nCode: ${data.code}\nCategory: ${data.category}\nTitle: ${data.title}\nMessage: ${data.message}\nRemediation: ${data.remediation || 'N/A'}\nDetails:\n${typeof data.details === 'object' ? JSON.stringify(data.details, null, 2) : data.details || 'None'}\nTimestamp: ${new Date().toISOString()}`;
    await navigator.clipboard.writeText(payload);
    copyBtn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.querySelector('span').textContent = 'Copy Diagnostics';
    }, 2000);
  });
  actionsRow.appendChild(copyBtn);

  return card;
}

