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

export function parseOrbitalError(rawErr, context = {}) {
  const errStr = String(rawErr?.message || rawErr || '');
  const lower = errStr.toLowerCase();

  // Ollama offline / connection failure
  if (lower.includes('11434') || lower.includes('connection refused') || lower.includes('failed to fetch') || lower.includes('econnrefused')) {
    return {
      code: 'OX-503',
      category: 'OLLAMA_OFFLINE',
      title: 'Local Ollama Daemon Unreachable',
      message: 'Could not connect to Ollama at http://127.0.0.1:11434. The local AI inference server is not running or is blocked.',
      remediation: 'Start Ollama by running "ollama serve" in your terminal, or verify your endpoint in Model Settings.',
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

  // Vision model requirement
  if (lower.includes('vision') || lower.includes('image input') || context.visionRequired) {
    return {
      code: 'OX-415',
      category: 'VISION_UNSUPPORTED',
      title: 'Active Model Does Not Support Vision',
      message: 'The selected model is text-only and cannot process screenshots or image attachments. A multimodal vision model is required.',
      remediation: 'Switch to a compatible vision model (such as llama3.2-vision, llava, or a configured cloud provider).',
      actions: [
        {
          label: 'Open Model Picker',
          primary: true,
          action: () => {
            document.getElementById('status-model-indicator')?.click();
          }
        }
      ],
      details: errStr
    };
  }

  // Sandbox policy violation
  if (lower.includes('policy') || lower.includes('sandbox') || lower.includes('denied') || lower.includes('prohibited')) {
    return {
      code: 'OX-403',
      category: 'SANDBOX_DENIED',
      title: 'Operation Prohibited by Sandbox Policy',
      message: errStr || 'This action was blocked by the active safety mode policy.',
      remediation: 'If you trust this operation, switch safety mode to Balanced or Bypass in the bottom status bar.',
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

  // VFS Transaction conflict
  if (lower.includes('vfs') || lower.includes('checkpoint') || lower.includes('conflict')) {
    return {
      code: 'OX-409',
      category: 'VFS_CONFLICT',
      title: 'Virtual File System Conflict',
      message: errStr || 'A pending file review or staged transaction prevented this change from applying cleanly.',
      remediation: 'Accept or reject existing pending file reviews in the editor before generating new patches.',
      actions: [],
      details: context
    };
  }

  // Compiler / Diagnostic Error
  if (context.isDiagnostic || lower.includes('compiler') || lower.includes('syntaxerror')) {
    return {
      code: 'OX-101',
      category: 'COMPILER_DIAGNOSTIC',
      title: 'Code Verification Diagnostic Failure',
      message: errStr || 'Syntax or build errors were detected during validation.',
      remediation: 'Let the agent self-heal by requesting an automatic diagnostic fix.',
      actions: [
        {
          label: 'Auto-Fix with Agent',
          primary: true,
          action: () => {
            const input = document.getElementById('agent-input');
            if (input) {
              input.value = `Fix these compiler diagnostics:\n${errStr.slice(0, 500)}`;
              document.getElementById('btn-agent-send')?.click();
            }
          }
        }
      ],
      details: errStr
    };
  }

  // Default runtime error
  return {
    code: 'OX-500',
    category: 'RUNTIME_ERROR',
    title: 'Agent Execution Error',
    message: errStr || 'An unexpected execution error occurred.',
    remediation: 'Inspect the technical diagnostics below or retry with simplified instructions.',
    actions: [],
    details: rawErr?.stack || errStr
  };
}

export function renderOrbitalErrorCard(errorData) {
  const data = typeof errorData === 'string' ? parseOrbitalError(errorData) : errorData;
  const card = document.createElement('div');
  card.className = 'ox-error-card';
  card.dataset.code = data.code || 'OX-500';

  card.innerHTML = `
    <div class="ox-error-header">
      <div class="ox-error-badge-group">
        <span class="ox-error-badge">${escapeHtml(data.code || 'OX-500')}</span>
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
        <summary>Technical Details</summary>
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
    const payload = `[Orbital X Diagnostic Report]\nCode: ${data.code}\nCategory: ${data.category}\nTitle: ${data.title}\nMessage: ${data.message}\nRemediation: ${data.remediation || 'N/A'}\nDetails:\n${typeof data.details === 'object' ? JSON.stringify(data.details, null, 2) : data.details || 'None'}\nTimestamp: ${new Date().toISOString()}`;
    await navigator.clipboard.writeText(payload);
    copyBtn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.querySelector('span').textContent = 'Copy Diagnostics';
    }, 2000);
  });
  actionsRow.appendChild(copyBtn);

  return card;
}

