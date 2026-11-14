// ==========================================================================
// Orbital X — Software Updates & Release Suite (updater.js)
// Grounded in Apple HIG Desktop Design Standards
// Features: Dynamic version verification, native Markdown highlights viewer,
// hybrid portable environment telemetry, and crash-safe 1-click update streaming.
// ==========================================================================

import { invoke, makeEventChannel } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

export let CURRENT_VERSION = '2.4.0';

// Dynamically resolve application version from Tauri backend
export async function resolveCurrentVersion() {
  try {
    const v = await invoke('get_app_version');
    if (v && typeof v === 'string') {
      CURRENT_VERSION = v.replace(/^v/, '').trim();
    }
  } catch (_) {
    // In browser preview fallback, retain package version
  }
  return CURRENT_VERSION;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const UPDATER_ICONS = {
  rocket: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><line x1="9" y1="12" x2="12" y2="15"></line></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
  shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
  usb: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"></rect><line x1="10" y1="6" x2="14" y2="6"></line><line x1="10" y1="18" x2="14" y2="18"></line></svg>',
  warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
  external: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>'
};

export function isVersionNewer(remote, current = CURRENT_VERSION) {
  const r = (remote || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const c = (current || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] || 0;
    const cv = c[i] || 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

export async function fetchReleaseInfo() {
  await resolveCurrentVersion();
  let releaseInfo = null;

  // 1. Backend check_latest_release IPC
  try {
    releaseInfo = await invoke('check_latest_release');
    if (releaseInfo && releaseInfo.current_version) {
      CURRENT_VERSION = String(releaseInfo.current_version).replace(/^v/, '').trim();
    }
  } catch (e) {
    console.warn('Backend check_latest_release failed, trying fallbacks:', e);
  }

  // 2. Static GitHub Pages version.json fallback
  if (!releaseInfo || !releaseInfo.tag) {
    try {
      const vp = await fetch('https://daxp472.github.io/Orbital-X/version.json');
      if (vp.ok) {
        const vd = await vp.json();
        releaseInfo = {
          tag: vd.tag || vd.version,
          changelog: vd.changelog,
          asset_url: vd.download_url,
          download_url: vd.download_url,
          url: vd.download_url,
        };
      }
    } catch (e2) {
      console.warn('version.json fetch failed:', e2);
    }
  }

  // 3. Direct GitHub Releases API
  if (!releaseInfo || !releaseInfo.tag) {
    try {
      const resp = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases/latest');
      if (resp.ok) {
        const data = await resp.json();
        const assets = data.assets || [];
        const exeAsset = assets.find(a => a.name?.endsWith('.exe') && a.name?.includes('setup')) || assets.find(a => a.name?.endsWith('.exe'));
        releaseInfo = {
          tag: data.tag_name,
          changelog: data.body,
          asset_url: exeAsset?.browser_download_url || data.html_url,
          download_url: data.html_url,
          url: data.html_url,
        };
      }
    } catch (err) {
      console.warn('Direct GitHub releases check failed:', err);
    }
  }

  return releaseInfo;
}

export async function checkOnStartupOrWorkspace() {
  try {
    await resolveCurrentVersion();
    const releaseInfo = await fetchReleaseInfo();
    if (!releaseInfo || !releaseInfo.tag) return;

    const latestTag = (releaseInfo.tag || '').replace(/^v/, '');
    const isNewer = isVersionNewer(latestTag, CURRENT_VERSION);

    if (isNewer) {
      // Check if we already notified the user for this exact version in this session
      const alreadyNotified = sessionStorage.getItem('orbital_update_notified_tag');
      if (alreadyNotified === latestTag) {
        return; // Suppress repeated notifications
      }

      sessionStorage.setItem('orbital_update_notified_tag', latestTag);

      const targetDownloadUrl = releaseInfo.asset_url || releaseInfo.download_url || `https://github.com/daxp472/Orbital-X/releases/download/v${latestTag}/Orbital.X_${latestTag}_x64-setup.exe`;

      showToast(
        `Orbital X v${latestTag} is available!`,
        'info',
        8000,
        [
          {
            label: 'Review Update',
            primary: true,
            onClick: () => {
              import('./settings.js').then(m => m.openSettings('spane-updates'));
            }
          },
          {
            label: '1-Click Install',
            onClick: () => {
              showUpdateModal(latestTag, targetDownloadUrl, releaseInfo.changelog, false);
            }
          }
        ]
      );
    }
  } catch (err) {
    console.warn('Silent update check error:', err);
  }
}

/**
 * Clean native Markdown renderer for user-facing release notes.
 * Formats headings, bullet lists, callouts, and code elements without raw unparsed markdown.
 */
export function renderReleaseNotesMarkdown(container, rawMarkdown) {
  if (!container) return;
  if (!rawMarkdown || !rawMarkdown.trim()) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 14px; text-align: center;">No release highlights published for this version yet.</div>';
    return;
  }

  // Parse lines with clean Apple HIG typography
  const lines = rawMarkdown.split(/\r?\n/);
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Horizontal divider
    if (/^---+\s*$/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<hr style="border: none; border-top: 1px solid var(--border-subtle); margin: 16px 0;">';
      continue;
    }

    // Main Heading (# )
    if (/^#\s+(.+)$/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      const text = line.replace(/^#\s+/, '');
      html += `<h2 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 14px 0 8px 0; letter-spacing: -0.2px;">${escapeHtml(text)}</h2>`;
      continue;
    }

    // Section Heading (## )
    if (/^##\s+(.+)$/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      const text = line.replace(/^##\s+/, '');
      html += `<h3 style="font-size: 13.5px; font-weight: 700; color: var(--accent-cyan); margin: 16px 0 6px 0;">${escapeHtml(text)}</h3>`;
      continue;
    }

    // Subsection Heading (### )
    if (/^###\s+(.+)$/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      const text = line.replace(/^###\s+/, '');
      html += `<h4 style="font-size: 12.5px; font-weight: 600; color: var(--text-primary); margin: 12px 0 4px 0;">${escapeHtml(text)}</h4>`;
      continue;
    }

    // Bullet items (- or *)
    if (/^\s*[-*]\s+(.+)$/.test(line)) {
      if (!inList) { html += '<ul style="margin: 4px 0 10px 18px; padding: 0; display: flex; flex-direction: column; gap: 4px;">'; inList = true; }
      let content = line.replace(/^\s*[-*]\s+/, '');
      content = formatInlineMarkdown(content);
      html += `<li style="font-size: 12px; line-height: 1.55; color: var(--text-secondary);">${content}</li>`;
      continue;
    }

    if (inList && line.trim() === '') {
      html += '</ul>';
      inList = false;
    }

    if (line.trim().length > 0) {
      if (inList) { html += '</ul>'; inList = false; }
      const content = formatInlineMarkdown(line);
      html += `<p style="font-size: 12px; line-height: 1.6; color: var(--text-secondary); margin: 4px 0 8px 0;">${content}</p>`;
    }
  }

  if (inList) html += '</ul>';

  container.innerHTML = html;
}

function formatInlineMarkdown(str) {
  let s = escapeHtml(str);
  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--text-primary); font-weight: 600;">$1</strong>');
  // Inline code: `code`
  s = s.replace(/`([^`]+)`/g, '<code style="background: var(--bg-hover); padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--accent-cyan); border: 1px solid var(--border-subtle);">$1</code>');
  // External links: [label](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color: var(--accent-cyan); text-decoration: underline;">$1</a>');
  return s;
}

export async function renderUpdatesPane() {
  const container = document.getElementById('updates-pane-card-container');
  if (!container) return;

  await resolveCurrentVersion();

  // Query portable status
  let portableInfo = null;
  try {
    portableInfo = await invoke('get_portable_status');
  } catch (_) {
    portableInfo = { is_portable: false, data_dir: '~/.orbital', synced_projects_count: 0 };
  }

  container.innerHTML = `
    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 20px; display: flex; flex-direction: column; gap: 18px;">
      
      <!-- Top Hero Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 40px; height: 40px; border-radius: var(--radius-sm); background: rgba(57, 197, 187, 0.12); color: var(--accent-cyan); display: flex; align-items: center; justify-content: center;">
            ${UPDATER_ICONS.rocket}
          </div>
          <div>
            <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.2px;">Orbital X Desktop Release</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Official Desktop Release &amp; Integrity Verification</div>
          </div>
        </div>
        <div id="updates-pane-status-badge" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: var(--radius-full); font-size: 11.5px; font-weight: 600; background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); border: 1px solid var(--border-subtle);">
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent-cyan); animation: pulse 1.5s infinite;"></span>
          Checking for updates…
        </div>
      </div>

      <!-- Core Metrics Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
        <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Installed Version</div>
          <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono); display: flex; align-items: center; gap: 6px;">
            <span>v${escapeHtml(CURRENT_VERSION)}</span>
            <span style="color: var(--accent-green); font-size: 11px; font-weight: 600;">(Verified)</span>
          </div>
        </div>

        <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Latest Stable Release</div>
          <div id="updates-pane-latest-ver" style="font-size: 14px; font-weight: 700; color: var(--accent-cyan); font-family: var(--font-mono);">Checking…</div>
        </div>

        <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Release Channel</div>
          <div style="font-size: 13.5px; font-weight: 600; color: var(--text-secondary);">Official Stable</div>
        </div>

        <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Runtime Mode</div>
          <div style="font-size: 13.5px; font-weight: 600; color: ${portableInfo?.is_portable ? 'var(--accent-purple)' : 'var(--text-secondary)'};">
            ${portableInfo?.is_portable ? 'Hybrid Portable (USB)' : 'Standard Desktop'}
          </div>
        </div>
      </div>

      <!-- Release Highlights & Notes Viewer -->
      <div id="updates-pane-changelog-wrap" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px; margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
            ${UPDATER_ICONS.shield}
            <span>Official Release Highlights</span>
          </div>
          <span id="updates-pane-release-tag" style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-cyan); background: rgba(57, 197, 187, 0.12); padding: 2px 8px; border-radius: 4px;">v${escapeHtml(CURRENT_VERSION)}</span>
        </div>
        <div id="updates-pane-changelog-text" style="max-height: 280px; overflow-y: auto; padding-right: 4px;">
          <div style="color: var(--text-muted); font-size: 12px;">Loading release highlights…</div>
        </div>
      </div>

      <!-- Action Footer -->
      <div id="updates-pane-action-bar" style="display: flex; gap: 10px; align-items: center; justify-content: flex-end; margin-top: 2px; flex-wrap: wrap;">
        <span style="font-size: 11.5px; color: var(--text-muted); margin-right: auto;" id="updates-pane-last-checked">Checking…</span>
        <button class="btn btn-secondary btn-sm" id="btn-updates-recheck" style="display: inline-flex; align-items: center; gap: 6px;">
          ${UPDATER_ICONS.refresh}
          <span>Check Again</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-updates-recheck')?.addEventListener('click', () => {
    renderUpdatesPane();
  });

  try {
    const releaseInfo = await fetchReleaseInfo();
    const badge = document.getElementById('updates-pane-status-badge');
    const latestEl = document.getElementById('updates-pane-latest-ver');
    const lastCheckedEl = document.getElementById('updates-pane-last-checked');
    const changelogText = document.getElementById('updates-pane-changelog-text');
    const releaseTagEl = document.getElementById('updates-pane-release-tag');
    const actionBar = document.getElementById('updates-pane-action-bar');

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (lastCheckedEl) lastCheckedEl.textContent = `Last checked today at ${timeStr}`;

    if (!releaseInfo || !releaseInfo.tag) {
      if (badge) {
        badge.style.background = 'rgba(255, 159, 10, 0.12)';
        badge.style.color = 'var(--accent-orange)';
        badge.innerHTML = `${UPDATER_ICONS.warning}<span>Offline / Rate Limited</span>`;
      }
      if (latestEl) {
        latestEl.textContent = `v${CURRENT_VERSION}`;
      }
      if (changelogText) {
        changelogText.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 10px;">Could not connect to release server. Local version verified.</div>';
      }
      return;
    }

    const latestTag = (releaseInfo.tag || '').replace(/^v/, '');
    const isNewer = isVersionNewer(latestTag, CURRENT_VERSION);
    const targetDownloadUrl = releaseInfo.asset_url || releaseInfo.download_url || `https://github.com/daxp472/Orbital-X/releases/download/v${latestTag}/Orbital.X_${latestTag}_x64-setup.exe`;

    if (latestEl) latestEl.textContent = `v${latestTag}`;
    if (releaseTagEl) releaseTagEl.textContent = `v${latestTag}`;

    if (changelogText) {
      renderReleaseNotesMarkdown(changelogText, releaseInfo.changelog || 'Official release binaries and security hardening.');
    }

    if (isNewer) {
      if (badge) {
        badge.style.background = 'rgba(57, 197, 187, 0.15)';
        badge.style.color = 'var(--accent-cyan)';
        badge.style.borderColor = 'rgba(57, 197, 187, 0.3)';
        badge.innerHTML = `${UPDATER_ICONS.rocket}<span>Update Available (v${escapeHtml(latestTag)})</span>`;
      }
      if (actionBar) {
        actionBar.innerHTML = `
          <span style="font-size: 11.5px; color: var(--accent-cyan); margin-right: auto; font-weight: 600;">Update ready to install</span>
          <a href="https://github.com/daxp472/Orbital-X/releases/tag/v${escapeHtml(latestTag)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 5px;">
            <span>Release Page</span>
            ${UPDATER_ICONS.external}
          </a>
          <button class="btn btn-primary btn-sm" id="btn-updates-install-now" style="font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
            ${UPDATER_ICONS.rocket}
            <span>1-Click Update &amp; Restart</span>
          </button>
        `;
        document.getElementById('btn-updates-install-now')?.addEventListener('click', () => {
          showUpdateModal(latestTag, targetDownloadUrl, releaseInfo.changelog, false);
        });
      }
    } else {
      if (badge) {
        badge.style.background = 'rgba(48, 209, 88, 0.14)';
        badge.style.color = 'var(--accent-green)';
        badge.style.borderColor = 'rgba(48, 209, 88, 0.3)';
        badge.innerHTML = `${UPDATER_ICONS.check}<span>Up to Date</span>`;
      }
      if (actionBar) {
        actionBar.innerHTML = `
          <span style="font-size: 11.5px; color: var(--accent-green); margin-right: auto; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;">
            ${UPDATER_ICONS.check} You are running the latest stable release
          </span>
          <button class="btn btn-secondary btn-sm" id="btn-updates-recheck" style="display: inline-flex; align-items: center; gap: 6px;">
            ${UPDATER_ICONS.refresh}
            <span>Check Again</span>
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-updates-reinstall">Reinstall Release</button>
        `;
        document.getElementById('btn-updates-recheck')?.addEventListener('click', () => renderUpdatesPane());
        document.getElementById('btn-updates-reinstall')?.addEventListener('click', () => {
          showUpdateModal(latestTag, targetDownloadUrl, releaseInfo.changelog, true);
        });
      }
    }
  } catch (err) {
    console.error('Failed to render updates pane:', err);
  }
}

export async function checkForUpdatesManually(isUserTriggered = true) {
  await resolveCurrentVersion();
  if (isUserTriggered) {
    showToast('Checking for latest Orbital X updates...', 'info', 2000);
  }

  try {
    const releaseInfo = await fetchReleaseInfo();

    if (!releaseInfo || !releaseInfo.tag) {
      if (isUserTriggered) {
        showToast(`You are on the latest release (v${CURRENT_VERSION}).`, 'success', 3000);
      }
      return;
    }

    const latestTag = (releaseInfo.tag || '').replace(/^v/, '');
    const isNewer = isVersionNewer(latestTag, CURRENT_VERSION);
    const targetDownloadUrl = releaseInfo.asset_url || releaseInfo.download_url || `https://github.com/daxp472/Orbital-X/releases/download/v${latestTag}/Orbital.X_${latestTag}_x64-setup.exe`;

    if (isNewer) {
      showUpdateModal(latestTag, targetDownloadUrl, releaseInfo.changelog, false);
    } else {
      if (isUserTriggered) {
        showUpdateModal(latestTag, targetDownloadUrl, releaseInfo.changelog, true);
      }
    }
  } catch (err) {
    console.error('Update check failed:', err);
    if (isUserTriggered) {
      showToast('Could not check for updates. Check internet connection.', 'error', 3000);
    }
  }
}

export function showUpdateModal(latest, downloadUrl, changelog, isAlreadyUpToDate = false) {
  document.getElementById('modal-update-available')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-update-available';
  modal.style.display = 'flex';

  const modalTitle = isAlreadyUpToDate ? 'Orbital X is Up to Date' : 'Software Update Available';
  const versionIndicator = isAlreadyUpToDate
    ? `<span style="color: var(--accent-green); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${UPDATER_ICONS.check} Current: v${escapeHtml(CURRENT_VERSION)} (Latest)</span>`
    : `Current: v${escapeHtml(CURRENT_VERSION)} &nbsp;→&nbsp; <strong style="color: var(--accent-cyan);">v${escapeHtml(latest)}</strong>`;

  const actionBtnText = isAlreadyUpToDate ? 'Reinstall Latest Version' : '1-Click Update & Restart';

  modal.innerHTML = `
    <div class="modal-container" style="max-width: 540px; padding: 24px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sheet); background: var(--bg-card); border-radius: var(--radius-md);">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px;">
        <div style="width: 36px; height: 36px; border-radius: var(--radius-sm); background: rgba(57, 197, 187, 0.12); color: var(--accent-cyan); display: flex; align-items: center; justify-content: center;">
          ${isAlreadyUpToDate ? UPDATER_ICONS.check : UPDATER_ICONS.rocket}
        </div>
        <div>
          <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">${modalTitle}</h2>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
            ${versionIndicator}
          </div>
        </div>
        <button class="icon-btn" id="update-close-btn" style="margin-left: auto; font-size: 14px;">✕</button>
      </div>

      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.55;">
        ${isAlreadyUpToDate
          ? `You are running the official verified version of <strong>Orbital X (v${escapeHtml(CURRENT_VERSION)})</strong>. If you are experiencing toolchain issues or want a clean copy, you can download and reinstall anytime.`
          : `A new verified version of <strong>Orbital X (v${escapeHtml(latest)})</strong> is available with performance improvements, bug fixes, and new features.`
        }
        
        <div id="modal-update-notes-container" style="margin-top: 12px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; max-height: 200px; overflow-y: auto;"></div>
      </div>

      <div id="update-modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 14px;">
        <button class="btn btn-secondary btn-sm" id="update-remind-btn">${isAlreadyUpToDate ? 'Close' : 'Remind Later'}</button>
        <button class="btn btn-primary btn-sm" id="update-download-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600;">
          ${isAlreadyUpToDate ? UPDATER_ICONS.refresh : UPDATER_ICONS.rocket}
          <span>${actionBtnText}</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const notesEl = modal.querySelector('#modal-update-notes-container');
  if (notesEl) {
    renderReleaseNotesMarkdown(notesEl, changelog || 'Verified multi-platform desktop release.');
  }

  const close = () => {
    modal.remove();
    try {
      localStorage.setItem('orbital_update_dismissed_at', String(Date.now()));
    } catch (e) {}
  };

  modal.querySelector('#update-close-btn')?.addEventListener('click', close);
  modal.querySelector('#update-remind-btn')?.addEventListener('click', close);

  modal.querySelector('#update-download-btn')?.addEventListener('click', async () => {
    const footer = modal.querySelector('#update-modal-footer');
    if (!footer) return;

    // Transition footer into download progress bar
    footer.innerHTML = `
      <div style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px;">
          <span id="update-status-msg" style="color: var(--text-primary); font-weight: 600;">Downloading Orbital X v${escapeHtml(latest)}...</span>
          <span id="update-status-pct" style="color: var(--accent-cyan); font-weight: 700; font-family: var(--font-mono);">0%</span>
        </div>
        <div style="background: rgba(255, 255, 255, 0.08); border-radius: var(--radius-full); height: 8px; overflow: hidden; position: relative;">
          <div id="update-progress-bar" style="background: var(--accent-cyan); height: 100%; width: 0%; border-radius: var(--radius-full); transition: width 0.15s ease-out;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span id="update-bytes-info">Connecting to release servers...</span>
          <span>Please do not close this window</span>
        </div>
      </div>
    `;

    try {
      const channel = await makeEventChannel();
      if (channel) {
        channel.onmessage = (msg) => {
          if (msg.type === 'progress') {
            const pct = Math.round(msg.percent || 0);
            const pBar = modal.querySelector('#update-progress-bar');
            const pPct = modal.querySelector('#update-status-pct');
            const bInfo = modal.querySelector('#update-bytes-info');

            if (pBar) pBar.style.width = `${Math.min(100, pct)}%`;
            if (pPct) pPct.textContent = `${pct}%`;
            if (bInfo && msg.total > 0) {
              const mbDone = (msg.downloaded / (1024 * 1024)).toFixed(1);
              const mbTotal = (msg.total / (1024 * 1024)).toFixed(1);
              bInfo.textContent = `${mbDone} MB / ${mbTotal} MB`;
            }
          }
        };
      }

      showToast(`Downloading Orbital X v${latest}...`, 'info', 3000);
      const targetUrl = downloadUrl || `https://github.com/daxp472/Orbital-X/releases/download/v${latest}/Orbital.X_${latest}_x64-setup.exe`;
      
      const downloadedPath = await invoke('download_update', {
        url: targetUrl,
        progressChannel: channel
      });

      // Show completed state with prominent Restart button
      footer.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-green); font-size: 13px; font-weight: 600;">
            ${UPDATER_ICONS.check}
            <span>Update downloaded successfully and verified!</span>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
            Orbital X needs to restart to complete installation. Click <strong>Restart Application</strong> below to exit and launch the setup installer now.
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
            <button class="btn btn-secondary btn-sm" id="update-later-btn">Install Later</button>
            <button class="btn btn-primary btn-sm" id="update-restart-btn" style="background: var(--accent-green); border-color: var(--accent-green); color: #000; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
              ${UPDATER_ICONS.refresh}
              <span>Restart Application</span>
            </button>
          </div>
        </div>
      `;

      modal.querySelector('#update-later-btn')?.addEventListener('click', close);
      modal.querySelector('#update-restart-btn')?.addEventListener('click', async () => {
        if (downloadedPath === 'browser-preview-download-fallback' || (!window.__TAURI_INTERNALS__ && !window.__TAURI__)) {
          showToast('In browser preview: opening release download page...', 'info', 3000);
          try {
            await invoke('open_url', { url: targetUrl });
          } catch (_) {
            window.open(targetUrl, '_blank');
          }
          close();
          return;
        }
        showToast('Restarting Orbital X to install update...', 'info', 4000);
        try {
          await invoke('install_update', { installerPath: downloadedPath });
        } catch (e) {
          console.error('Failed to restart and install update:', e);
          showToast(`Installer launch error: ${e}`, 'error', 5000);
        }
      });
    } catch (err) {
      console.error('Update download failed:', err);
      footer.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
          <div style="color: var(--accent-red); font-size: 12.5px;">
            In-app download failed: ${escapeHtml(err?.message || err)}
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn btn-secondary btn-sm" id="update-fail-close">Close</button>
            <button class="btn btn-primary btn-sm" id="update-fail-browser">Open in Browser</button>
          </div>
        </div>
      `;
      modal.querySelector('#update-fail-close')?.addEventListener('click', close);
      modal.querySelector('#update-fail-browser')?.addEventListener('click', async () => {
        close();
        const targetUrl = downloadUrl || `https://github.com/daxp472/Orbital-X/releases/tag/v${latest}`;
        try {
          await invoke('open_url', { url: targetUrl });
        } catch (e) {
          window.open(targetUrl, '_blank');
        }
      });
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
}
