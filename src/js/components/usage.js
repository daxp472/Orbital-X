// ==========================================================================
// Orbital X — Token Usage Counter & Dashboard (usage.js)
// Real token accounting across Ollama, OpenAI, Anthropic Claude, and Gemini.
// ==========================================================================

import { invoke } from '../services/tauri.js';

let usageStats = null;
let refreshInterval = null;

export function initUsageDashboard() {
  // Listen for modal open triggers
  const openDashboardBtn = document.getElementById('btn-open-usage-dashboard');
  const sbUsageBtn = document.getElementById('status-token-usage');
  const modal = document.getElementById('modal-usage-dashboard');
  const closeBtn = document.getElementById('btn-close-usage-dashboard');
  const refreshBtn = document.getElementById('btn-refresh-usage');
  const clearBtn = document.getElementById('btn-clear-usage');

  openDashboardBtn?.addEventListener('click', () => showUsageModal());
  sbUsageBtn?.addEventListener('click', () => showUsageModal());
  closeBtn?.addEventListener('click', () => hideUsageModal());
  refreshBtn?.addEventListener('click', () => loadAndRenderUsage(true));
  clearBtn?.addEventListener('click', async () => {
    if (confirm("Reset all recorded token usage history? This action cannot be undone.")) {
      await invoke('clear_token_usage');
      await loadAndRenderUsage(true);
    }
  });

  // Settings modal buttons
  const settingsRefreshBtn = document.getElementById('btn-refresh-settings-usage');
  const settingsClearBtn = document.getElementById('btn-clear-settings-usage');
  settingsRefreshBtn?.addEventListener('click', () => loadAndRenderUsage(true));
  settingsClearBtn?.addEventListener('click', async () => {
    if (confirm("Reset all recorded token usage history? This action cannot be undone.")) {
      await invoke('clear_token_usage');
      await loadAndRenderUsage(true);
    }
  });

  // Modal backdrop click
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) hideUsageModal();
  });

  // Initial fetch for status bar
  loadAndRenderUsage(false);

  // Periodic poll every 15s to update status bar
  if (!refreshInterval) {
    refreshInterval = setInterval(() => {
      loadAndRenderUsage(false);
    }, 15000);
  }
}

export function showUsageModal() {
  const modal = document.getElementById('modal-usage-dashboard');
  if (modal) {
    modal.style.display = 'flex';
    loadAndRenderUsage(true);
  }
}

export function hideUsageModal() {
  const modal = document.getElementById('modal-usage-dashboard');
  if (modal) {
    modal.style.display = 'none';
  }
}

export async function recordClientUsage({
  provider,
  model,
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = null,
  isEstimated = false,
  category = 'chat',
  status = 'completed'
}) {
  const tot = totalTokens !== null ? totalTokens : (promptTokens + completionTokens);
  const record = {
    id: 'tok_' + Math.random().toString(36).substring(2, 10),
    timestamp: new Date().toISOString(),
    provider: provider || 'Unknown',
    model: model || 'default',
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: tot,
    is_estimated: !!isEstimated,
    category,
    status
  };

  try {
    await invoke('record_token_usage', { record });
    loadAndRenderUsage(false);
  } catch (e) {
    console.warn("Failed to record token usage to backend:", e);
  }
}

export async function loadAndRenderUsage(updateModal = true) {
  try {
    const stats = await invoke('get_token_usage_stats');
    if (!stats) return;
    usageStats = stats;

    updateStatusBarPill(stats);

    if (updateModal) {
      renderDashboard(stats);
    }
  } catch (e) {
    console.warn("Error fetching token usage statistics:", e);
  }
}

function updateStatusBarPill(stats) {
  const pill = document.getElementById('status-token-usage');
  const countEl = document.getElementById('status-token-count');
  if (!pill) return;

  const todaySafe = stats.today_tokens || 0;
  const totalSafe = stats.total_tokens || stats.lifetime_tokens || 0;
  const todayReqs = stats.today_requests || 0;

  const todayFormatted = formatTokenNumber(todaySafe);
  const totalFormatted = formatTokenNumber(totalSafe);

  if (countEl) {
    countEl.textContent = `${todayFormatted} tok today`;
  }
  pill.title = `Token Usage Today: ${todaySafe.toLocaleString()} (${todayReqs} reqs)\nLifetime: ${totalSafe.toLocaleString()} tokens\nClick to open detailed Token Usage Dashboard.`;
}

function renderDashboard(stats) {
  const container = document.getElementById('usage-dashboard-content');
  const settingsContainer = document.getElementById('settings-token-usage-container');
  if (!container && !settingsContainer) return;

  const todayVal = stats.today_tokens || 0;
  const totalVal = stats.total_tokens || stats.lifetime_tokens || 0;
  const monthVal = stats.month_tokens || 0;
  const totalReqs = stats.total_requests || stats.lifetime_requests || 0;

  const todayFormatted = formatTokenNumber(todayVal);
  const totalFormatted = formatTokenNumber(totalVal);
  const monthFormatted = formatTokenNumber(monthVal);

  const lastReqTime = stats.last_request_time
    ? new Date(stats.last_request_time).toLocaleString()
    : 'No requests yet';

  // Providers breakdown list
  const providers = Object.entries(stats.by_provider || {});
  const models = Object.entries(stats.by_model || {});

  // 7-day sparkline/bar calculations
  const maxDay = Math.max(...(stats.seven_days || []).map(d => d.total_tokens), 100);

  const sevenDaysHtml = (stats.seven_days || []).map(day => {
    const heightPercent = Math.min(100, Math.round((day.total_tokens / maxDay) * 100));
    const label = day.date.slice(5); // "MM-DD"
    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;">
        <div style="font-size: 10px; color: var(--text-muted);">${formatTokenNumber(day.total_tokens)}</div>
        <div style="width: 100%; height: 70px; background: var(--bg-surface); border-radius: 4px; display: flex; align-items: flex-end; padding: 2px;">
          <div style="width: 100%; height: ${Math.max(heightPercent, 4)}%; background: linear-gradient(180deg, var(--accent-cyan) 0%, var(--accent-purple) 100%); border-radius: 2px; transition: height 0.3s ease;" title="${day.date}: ${day.total_tokens.toLocaleString()} tokens (${day.requests} requests)"></div>
        </div>
        <div style="font-size: 10px; color: var(--text-secondary);">${label}</div>
      </div>
    `;
  }).join('');

  const htmlContent = `
    <!-- Top Highlights Grid -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px;">
      <div class="usage-stat-card">
        <div class="stat-label">TODAY'S TOKENS</div>
        <div class="stat-val" style="color: var(--accent-cyan);">${todayFormatted}</div>
        <div class="stat-sub">
          <span title="Prompt tokens">▲ ${(stats.today_prompt_tokens || 0).toLocaleString()}</span>
          <span style="opacity: 0.5;">|</span>
          <span title="Completion tokens">▼ ${(stats.today_completion_tokens || 0).toLocaleString()}</span>
        </div>
      </div>

      <div class="usage-stat-card">
        <div class="stat-label">REQUESTS TODAY</div>
        <div class="stat-val" style="color: var(--accent-purple);">${(stats.today_requests || 0).toLocaleString()}</div>
        <div class="stat-sub">Lifetime: ${totalReqs.toLocaleString()}</div>
      </div>

      <div class="usage-stat-card">
        <div class="stat-label">THIS MONTH</div>
        <div class="stat-val" style="color: var(--text-primary-bright);">${monthFormatted}</div>
        <div class="stat-sub">${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
      </div>

      <div class="usage-stat-card">
        <div class="stat-label">ALL-TIME TOKENS</div>
        <div class="stat-val" style="color: var(--accent-blue);">${totalFormatted}</div>
        <div class="stat-sub">${totalVal.toLocaleString()} exact</div>
      </div>
    </div>

    <!-- 7-Day Trend Chart -->
    <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-weight: 600; font-size: 12px; color: var(--text-primary-bright);">7-Day Consumption Trend</span>
        <span style="font-size: 11px; color: var(--text-muted);">Local timezone date boundaries</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: flex-end; padding: 4px 0;">
        ${sevenDaysHtml || '<div style="color: var(--text-muted); font-size: 11px; padding: 20px; text-align: center; width: 100%;">No request activity recorded in the last 7 days.</div>'}
      </div>
    </div>

    <!-- Provider & Model Breakdown Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
      <!-- Providers -->
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px;">
        <div style="font-weight: 600; font-size: 12px; color: var(--text-primary-bright); margin-bottom: 8px;">Breakdown by Provider</div>
        ${providers.length === 0 ? '<div style="font-size: 11px; color: var(--text-muted);">No provider usage yet.</div>' : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${providers.map(([prov, tok]) => `
              <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--border-subtle);">
                <span style="font-weight: 500;">${prov}</span>
                <span style="font-family: var(--font-mono); color: var(--accent-cyan);">${tok.toLocaleString()} (${Math.round((tok / (totalVal || 1)) * 100)}%)</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Models -->
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px;">
        <div style="font-weight: 600; font-size: 12px; color: var(--text-primary-bright); margin-bottom: 8px;">Breakdown by Model</div>
        ${models.length === 0 ? '<div style="font-size: 11px; color: var(--text-muted);">No model usage yet.</div>' : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${models.map(([mod, tok]) => `
              <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--border-subtle);">
                <span style="font-family: var(--font-mono); font-size: 10px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${mod}">${mod}</span>
                <span style="font-family: var(--font-mono); color: var(--accent-purple);">${tok.toLocaleString()}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Accounting Accuracy & Last Request Footer -->
    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-activity); border: 1px solid var(--border-subtle); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 11px;">
      <div style="display: flex; gap: 12px; align-items: center;">
        <span><strong>Reported vs Estimated:</strong></span>
        <span style="color: var(--accent-green);">● ${(stats.reported_count || stats.reported_tokens || 0).toLocaleString()} provider-reported</span>
        <span style="color: var(--accent-orange);">◐ ${(stats.estimated_count || stats.estimated_tokens || 0).toLocaleString()} estimated fallback</span>
      </div>
      <div style="color: var(--text-muted);">
        Most recent request: <span style="color: var(--text-secondary);">${lastReqTime}</span>
      </div>
    </div>
  `;

  if (container) container.innerHTML = htmlContent;
  if (settingsContainer) settingsContainer.innerHTML = htmlContent;
}

export function formatTokenNumber(num) {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}
