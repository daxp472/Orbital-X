// ==========================================================================
// Orbital X — 1-Click Update System (updater.js)
// Checks GitHub releases for latest binaries, performs version comparison,
// streams download with progress, and restarts to launch installer.
// ==========================================================================

import { invoke, makeEventChannel } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

export const CURRENT_VERSION = '2.3.5';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  let releaseInfo = null;

  // 1. Backend check_latest_release IPC
  try {
    releaseInfo = await invoke('check_latest_release');
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
    const releaseInfo = await fetchReleaseInfo();
    if (!releaseInfo || !releaseInfo.tag) return;

    const latestTag = (releaseInfo.tag || '').replace(/^v/, '');
    const isNewer = isVersionNewer(latestTag, CURRENT_VERSION);

    if (isNewer) {
      // Check if we already notified the user for this exact version in this session
      const alreadyNotified = sessionStorage.getItem('orbital_update_notified_tag');
      if (alreadyNotified === latestTag) {
        return; // Suppress repeated notifications across workspace switches
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

export async function renderUpdatesPane() {
  const container = document.getElementById('updates-pane-card-container');
  if (!container) return;

  container.innerHTML = `
    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 20px; display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 14px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(57, 197, 187, 0.12); display: flex; align-items: center; justify-content: center; font-size: 20px;">
            🚀
          </div>
          <div>
            <div style="font-size: 15px; font-weight: 700; color: var(--text-primary);">Orbital X Desktop</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Official Desktop Release Channel</div>
          </div>
        </div>
        <div id="updates-pane-status-badge" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11.5px; font-weight: 600; background: rgba(255, 255, 255, 0.08); color: var(--text-secondary);">
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent-cyan); animation: pulse 1.5s infinite;"></span>
          Checking for updates…
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
        <div style="background: var(--bg-card); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Installed Version</div>
          <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono);">v${escapeHtml(CURRENT_VERSION)}</div>
        </div>
        <div style="background: var(--bg-card); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Latest Stable Release</div>
          <div id="updates-pane-latest-ver" style="font-size: 14px; font-weight: 700; color: var(--accent-cyan); font-family: var(--font-mono);">Checking…</div>
        </div>
        <div style="background: var(--bg-card); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Release Channel</div>
          <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary);">Stable (Official)</div>
        </div>
      </div>

      <div id="updates-pane-changelog-wrap" style="display: none; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px;">
        <div style="font-size: 11.5px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Release Highlights</div>
        <pre id="updates-pane-changelog-text" style="font-family: var(--font-mono); font-size: 11.5px; color: var(--text-primary); margin: 0; max-height: 160px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5;"></pre>
      </div>

      <div id="updates-pane-action-bar" style="display: flex; gap: 10px; align-items: center; justify-content: flex-end; margin-top: 4px; flex-wrap: wrap;">
        <span style="font-size: 11.5px; color: var(--text-muted); margin-right: auto;" id="updates-pane-last-checked">Checking…</span>
        <button class="btn btn-secondary btn-sm" id="btn-updates-recheck">Check Again</button>
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
    const changelogWrap = document.getElementById('updates-pane-changelog-wrap');
    const changelogText = document.getElementById('updates-pane-changelog-text');
    const actionBar = document.getElementById('updates-pane-action-bar');

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (lastCheckedEl) lastCheckedEl.textContent = `Last checked today at ${timeStr}`;

    if (!releaseInfo || !releaseInfo.tag) {
      if (badge) {
        badge.style.background = 'rgba(255, 159, 10, 0.15)';
        badge.style.color = 'var(--accent-orange)';
        badge.innerHTML = `<span>⚠️</span> Offline / Rate Limited`;
      }
      if (latestEl) {
        latestEl.textContent = 'Unavailable';
        latestEl.style.color = 'var(--text-muted)';
      }
      if (actionBar) {
        actionBar.innerHTML = `
          <span style="font-size: 11.5px; color: var(--text-muted); margin-right: auto;">Last checked today at ${timeStr}</span>
          <a href="https://github.com/daxp472/Orbital-X/releases" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">View on GitHub ↗</a>
          <button class="btn btn-primary btn-sm" id="btn-updates-recheck">Retry Check</button>
        `;
        document.getElementById('btn-updates-recheck')?.addEventListener('click', () => renderUpdatesPane());
      }
      return;
    }

    const latestTag = (releaseInfo.tag || '').replace(/^v/, '');
    const isNewer = isVersionNewer(latestTag, CURRENT_VERSION);
    const targetDownloadUrl = releaseInfo.asset_url || releaseInfo.download_url || `https://github.com/daxp472/Orbital-X/releases/download/v${latestTag}/Orbital.X_${latestTag}_x64-setup.exe`;

    if (latestEl) latestEl.textContent = `v${latestTag}`;

    if (releaseInfo.changelog && changelogWrap && changelogText) {
      changelogWrap.style.display = 'block';
      changelogText.textContent = releaseInfo.changelog;
    }

    if (isNewer) {
      if (badge) {
        badge.style.background = 'rgba(57, 197, 187, 0.18)';
        badge.style.color = 'var(--accent-cyan)';
        badge.innerHTML = `<span>🚀</span> Update Available (v${escapeHtml(latestTag)})`;
      }
      if (actionBar) {
        actionBar.innerHTML = `
          <span style="font-size: 11.5px; color: var(--accent-cyan); margin-right: auto; font-weight: 600;">Update ready to install</span>
          <a href="https://github.com/daxp472/Orbital-X/releases/tag/v${escapeHtml(latestTag)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Release Notes ↗</a>
          <button class="btn btn-primary btn-sm" id="btn-updates-install-now" style="font-weight: 700;">⚡ 1-Click Update &amp; Restart</button>
        `;
        document.getElementById('btn-updates-install-now')?.addEventListener('click', () => {
          showUpdateModal(latestTag, targetDownloadUrl, releaseInfo.changelog, false);
        });
      }
    } else {
      if (badge) {
        badge.style.background = 'rgba(48, 209, 88, 0.18)';
        badge.style.color = 'var(--accent-green)';
        badge.innerHTML = `<span>✓</span> Up to Date`;
      }
      if (actionBar) {
        actionBar.innerHTML = `
          <span style="font-size: 11.5px; color: var(--accent-green); margin-right: auto; font-weight: 600;">✓ You are on the latest version</span>
          <button class="btn btn-secondary btn-sm" id="btn-updates-recheck">Check Again</button>
          <button class="btn btn-secondary btn-sm" id="btn-updates-reinstall">Reinstall Latest</button>
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
        // App is up to date, but show modal with reinstall option so user is never blocked
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

  const modalTitle = isAlreadyUpToDate ? 'Orbital X is Up to Date' : 'Update Available';
  const versionIndicator = isAlreadyUpToDate
    ? `<span style="color: var(--accent-green); font-weight: 600;">✓ Current: v${escapeHtml(CURRENT_VERSION)} (Latest)</span>`
    : `Current: v${escapeHtml(CURRENT_VERSION)} &nbsp;→&nbsp; <strong style="color: var(--accent-cyan);">v${escapeHtml(latest)}</strong>`;

  const actionBtnText = isAlreadyUpToDate ? '⚡ Reinstall Latest Version' : '⚡ 1-Click Update & Restart';

  modal.innerHTML = `
    <div class="modal-container" style="max-width: 520px; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8);">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="font-size: 26px;">${isAlreadyUpToDate ? '✨' : '🚀'}</div>
        <div>
          <h2 style="margin: 0; font-size: 18px; font-weight: 700;">${modalTitle}</h2>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
            ${versionIndicator}
          </div>
        </div>
        <button class="icon-btn" id="update-close-btn" style="margin-left: auto; font-size: 16px;">✕</button>
      </div>

      <div style="font-size: 13.5px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.6;">
        ${isAlreadyUpToDate
          ? `You are running the latest version of <strong>Orbital X (v${escapeHtml(CURRENT_VERSION)})</strong>. If you are experiencing issues or want a clean copy, you can download and reinstall anytime.`
          : `A new version of <strong>Orbital X (v${escapeHtml(latest)})</strong> is available with performance improvements, bug fixes, and new features.`
        }
        ${changelog ? `
          <div style="margin-top: 12px; background: rgba(0, 0, 0, 0.35); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 14px;">
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Release Highlights</div>
            <pre style="font-family: var(--font-mono); font-size: 11.5px; color: var(--text-primary); margin: 0; max-height: 140px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(changelog.substring(0, 600))}${changelog.length > 600 ? '...' : ''}</pre>
          </div>
        ` : ''}
      </div>

      <div id="update-modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; align-items: center;">
        <button class="btn btn-secondary btn-sm" id="update-remind-btn">${isAlreadyUpToDate ? 'Close' : 'Remind Later'}</button>
        <button class="btn btn-primary btn-sm" id="update-download-btn" style="display: flex; align-items: center; gap: 6px; font-weight: 600;">
          <span>${actionBtnText}</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

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
        <div style="background: rgba(255, 255, 255, 0.1); border-radius: 6px; height: 10px; overflow: hidden; position: relative;">
          <div id="update-progress-bar" style="background: linear-gradient(90deg, #00d4ff, #10b981); height: 100%; width: 0%; border-radius: 6px; transition: width 0.15s ease-out;"></div>
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
          <div style="display: flex; align-items: center; gap: 10px; color: #10b981; font-size: 13.5px; font-weight: 600;">
            <span style="font-size: 18px;">✓</span>
            <span>Update downloaded successfully and verified!</span>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
            Orbital X needs to restart to complete installation. Click <strong>Restart Application</strong> below to exit and launch the setup installer now.
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
            <button class="btn btn-secondary btn-sm" id="update-later-btn">Install Later</button>
            <button class="btn btn-primary btn-sm" id="update-restart-btn" style="background: #10b981; border-color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 6px; box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);">
              <span>🔄 Restart Application</span>
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
          <div style="color: #ef4444; font-size: 12.5px;">
            ⚠️ In-app download failed: ${escapeHtml(err?.message || err)}
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
