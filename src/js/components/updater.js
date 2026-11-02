// ==========================================================================
// Orbital X — 1-Click Update System (updater.js)
// Checks GitHub releases for latest binaries, performs version comparison,
// and offers 1-click seamless update download & launch.
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

export const CURRENT_VERSION = '2.2.9';

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

export async function checkForUpdatesManually(isUserTriggered = true) {
  if (isUserTriggered) {
    showToast('Checking for latest Orbital X updates...', 'info', 2000);
  }

  try {
    let releaseInfo = null;

    // First try backend check_latest_release IPC
    try {
      releaseInfo = await invoke('check_latest_release');
    } catch (e) {
      // Fast fallback: GitHub Pages static version manifest (zero rate limit)
      try {
        const vp = await fetch('https://daxp472.github.io/Orbital-X/version.json');
        if (vp.ok) {
          const vd = await vp.json();
          releaseInfo = {
            tag: vd.tag || vd.version,
            changelog: vd.changelog,
            download_url: vd.download_url
          };
        }
      } catch (e2) {
        // Fallback: direct fetch from GitHub releases API
        try {
          const resp = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases/latest');
          if (resp.ok) {
            const data = await resp.json();
            releaseInfo = {
              tag: data.tag_name,
              changelog: data.body,
              download_url: data.assets?.[0]?.browser_download_url || data.html_url
            };
          }
        } catch (err) {
          console.warn('Direct GitHub releases check failed:', err);
        }
      }
    }

    if (!releaseInfo || !releaseInfo.tag) {
      if (isUserTriggered) {
        showToast(`You are on the latest release (v${CURRENT_VERSION}).`, 'success', 3000);
      }
      return;
    }

    const latestTag = (releaseInfo.tag || '').replace(/^v/, '');
    const isNewer = isVersionNewer(latestTag, CURRENT_VERSION);

    if (isNewer) {
      showUpdateModal(latestTag, releaseInfo.download_url, releaseInfo.changelog);
    } else {
      if (isUserTriggered) {
        showToast(`Orbital X is up to date (v${CURRENT_VERSION}).`, 'success', 3000);
      }
    }
  } catch (err) {
    console.error('Update check failed:', err);
    if (isUserTriggered) {
      showToast('Could not check for updates. Check internet connection.', 'error', 3000);
    }
  }
}

export function showUpdateModal(latest, downloadUrl, changelog) {
  document.getElementById('modal-update-available')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modal-update-available';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="max-width: 520px; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8);">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="font-size: 26px;">🚀</div>
        <div>
          <h2 style="margin: 0; font-size: 18px; font-weight: 700;">Update Available</h2>
          <div style="font-size: 12px; color: var(--accent-cyan); margin-top: 2px;">
            Current: v${escapeHtml(CURRENT_VERSION)} &nbsp;→&nbsp; <strong>v${escapeHtml(latest)}</strong>
          </div>
        </div>
        <button class="icon-btn" id="update-close-btn" style="margin-left: auto; font-size: 16px;">✕</button>
      </div>

      <div style="font-size: 13.5px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.6;">
        A new version of <strong>Orbital X (v${escapeHtml(latest)})</strong> is available with the latest features, security patches, and performance optimizations.
        ${changelog ? `
          <div style="margin-top: 12px; background: rgba(0, 0, 0, 0.35); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 14px;">
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Release Highlights</div>
            <pre style="font-family: var(--font-mono); font-size: 11.5px; color: var(--text-primary); margin: 0; max-height: 140px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(changelog.substring(0, 600))}${changelog.length > 600 ? '...' : ''}</pre>
          </div>
        ` : ''}
      </div>

      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button class="btn btn-secondary btn-sm" id="update-remind-btn">Remind Later</button>
        <button class="btn btn-primary btn-sm" id="update-download-btn" style="display: flex; align-items: center; gap: 6px;">
          <span>⚡ 1-Click Update</span>
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
    close();
    showToast(`Opening download for v${latest}...`, 'info', 3000);
    const targetUrl = downloadUrl || `https://github.com/daxp472/Orbital-X/releases/tag/v${latest}`;
    try {
      await invoke('open_url', { url: targetUrl });
    } catch (e) {
      window.open(targetUrl, '_blank');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
}
