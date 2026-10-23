// ==========================================================================
// Orbital X — Official Showcase Website Client (app.js)
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initOSDetection();
  initModeSwitcher();
  initCopyButtons();
  initFPSSimulator();
});

// 1. Detect User OS & update main CTA
function initOSDetection() {
  const ua = window.navigator.userAgent.toLowerCase();
  const ctaBtn = document.getElementById('hero-download-btn');
  const ctaLabel = document.getElementById('hero-download-label');

  if (!ctaBtn || !ctaLabel) return;

  if (ua.includes('win')) {
    ctaLabel.textContent = 'Download for Windows (x64)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/download/v2.2.1/Orbital.X_2.2.1_x64-setup.exe';
  } else if (ua.includes('mac')) {
    ctaLabel.textContent = 'Download for macOS (.dmg)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/download/v2.2.1/Orbital.X_2.2.1_x64.dmg';
  } else if (ua.includes('linux')) {
    ctaLabel.textContent = 'Download for Linux (.AppImage)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/download/v2.2.1/orbital-x_2.2.1_amd64.AppImage';
  } else {
    ctaLabel.textContent = 'Download Orbital X (v2.2.1)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/tag/v2.2.1';
  }
}

// 2. Interactive Operating Mode Switcher Demo
const modeData = {
  dev: {
    title: '🟢 Dev Mode (Default & Balanced)',
    desc: 'Perfect for day-to-day coding. File searches and inspections are completely automatic. Any file edit or terminal command presents an interactive Approval Card with Monaco Diff preview before execution.',
    fileReads: '⚡ Automatic (0 Prompts)',
    fileWrites: '🛡️ Approval Card with Diff Preview',
    terminal: '🛡️ Approval Required',
    risk: 'Kernel-Enforced Sandboxing',
    badgeClass: 'active'
  },
  pro: {
    title: '🟣 Agent Pro Mode (Autonomous Prototyping)',
    desc: 'High-autonomy execution inside the workspace boundaries. Reads, edits, symbol maps, and allowlisted test/build commands execute automatically without interruption. Perfect for feature generation and automated refactoring.',
    fileReads: '⚡ Automatic',
    fileWrites: '⚡ Automatic (with undo journal)',
    terminal: '⚡ Safe build/test commands auto-run',
    risk: 'Destructive commands strictly blocked',
    badgeClass: 'pro active'
  },
  user: {
    title: '🟠 User Mode (Explicit Audit Trail)',
    desc: 'Strict per-operation confirmation. Every file read, directory search, file write, and terminal command requires explicit user approval before the agent proceeds. Maximum transparency for sensitive codebases.',
    fileReads: '🛡️ Approval Required',
    fileWrites: '🛡️ Approval Required',
    terminal: '🛡️ Approval Required',
    risk: 'Complete Manual Verification',
    badgeClass: 'user active'
  }
};

function initModeSwitcher() {
  const tabs = document.querySelectorAll('.mode-tab-btn');
  const titleEl = document.getElementById('mode-display-title');
  const descEl = document.getElementById('mode-display-desc');
  const readsEl = document.getElementById('mode-rule-reads');
  const writesEl = document.getElementById('mode-rule-writes');
  const terminalEl = document.getElementById('mode-rule-terminal');
  const safetyEl = document.getElementById('mode-rule-safety');

  if (!tabs.length || !titleEl) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.className = 'mode-tab-btn' + (t.dataset.mode === 'pro' ? ' pro' : t.dataset.mode === 'user' ? ' user' : ''));
      const modeKey = tab.dataset.mode;
      const data = modeData[modeKey];
      if (!data) return;

      tab.className = `mode-tab-btn ${data.badgeClass}`;
      titleEl.textContent = data.title;
      descEl.textContent = data.desc;
      readsEl.textContent = data.fileReads;
      writesEl.textContent = data.fileWrites;
      terminalEl.textContent = data.terminal;
      safetyEl.textContent = data.risk;
    });
  });
}

// 3. One-Click Copy to Clipboard
function initCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });
}

// 4. Live FPS & Latency Counter
function initFPSSimulator() {
  const fpsEl = document.getElementById('live-fps-val');
  if (!fpsEl) return;

  let lastTime = performance.now();
  let frameCount = 0;

  function countFrames(now) {
    frameCount++;
    if (now - lastTime >= 1000) {
      const actualFps = Math.round((frameCount * 1000) / (now - lastTime));
      fpsEl.textContent = `${Math.min(actualFps, 144)} FPS`;
      frameCount = 0;
      lastTime = now;
    }
    requestAnimationFrame(countFrames);
  }

  requestAnimationFrame(countFrames);
}
