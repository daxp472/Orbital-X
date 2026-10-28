// ==========================================================================
// Orbital X — Official Showcase Website Client (app.js)
// Apple Design System & Interactive Hardware Advisor
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initOSDetection();
  initModeSwitcher();
  initCopyButtons();
  initFPSSimulator();
  initHardwareAdvisor();
  initTierFilterTabs();
});

// 1. Detect User OS & update main CTA with verified v2.2.6 release URLs
function initOSDetection() {
  const ua = window.navigator.userAgent.toLowerCase();
  const ctaBtn = document.getElementById('hero-download-btn');
  const ctaLabel = document.getElementById('hero-download-label');

  if (!ctaBtn || !ctaLabel) return;

  if (ua.includes('win')) {
    ctaLabel.textContent = 'Download for Windows (x64)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/download/v2.2.6/Orbital.X_2.2.6_x64-setup.exe';
  } else if (ua.includes('mac')) {
    ctaLabel.textContent = 'Download for macOS (.dmg)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/download/v2.2.6/Orbital.X_2.2.6_aarch64.dmg';
  } else if (ua.includes('linux')) {
    ctaLabel.textContent = 'Download for Linux (.AppImage)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/download/v2.2.6/Orbital.X_2.2.6_amd64.AppImage';
  } else {
    ctaLabel.textContent = 'Download Orbital X (v2.2.6)';
    ctaBtn.href = 'https://github.com/daxp472/Orbital-X/releases/tag/v2.2.6';
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

// 3. One-Click Copy to Clipboard with Tactile Feedback
function initCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.borderColor = 'var(--accent-cyan)';
        btn.style.color = '#ffffff';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.borderColor = '';
          btn.style.color = '';
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

// 5. Interactive Hardware Fit Advisor & VRAM Sizer
function initHardwareAdvisor() {
  let selectedVRAM = 8;
  let selectedRAM = 16;

  const vramPills = document.querySelectorAll('#vram-pills .pill-choice');
  const ramPills = document.querySelectorAll('#ram-pills .pill-choice');
  const summaryText = document.getElementById('hw-status-text');
  const modelCards = document.querySelectorAll('.model-card');

  function updateFit() {
    // Update summary text
    let summaryDesc = 'Balanced Developer Rig';
    if (selectedRAM < 16) summaryDesc = '⚠️ Insufficient RAM (Upgrade to 16GB Recommended)';
    else if (selectedVRAM >= 16 && selectedRAM >= 32) summaryDesc = '🚀 High-Performance Workstation';
    else if (selectedVRAM >= 12) summaryDesc = '⚡ Excellent GPU Accelerated Machine';

    if (summaryText) {
      summaryText.textContent = `Hardware: ${selectedVRAM} GB VRAM • ${selectedRAM} GB RAM (${summaryDesc})`;
    }

    modelCards.forEach(card => {
      const vramReq = parseFloat(card.dataset.vramReq || '8');
      const ramReq = parseFloat(card.dataset.ramReq || '16');
      const fitBadge = card.querySelector('.fit-badge');
      if (!fitBadge) return;

      // Reset badge classes
      fitBadge.className = 'fit-badge';

      if (selectedRAM < 16) {
        fitBadge.classList.add('fit-heavy');
        fitBadge.textContent = 'Low RAM (Freeze Risk)';
      } else if (selectedVRAM >= vramReq) {
        fitBadge.classList.add('fit-optimal');
        fitBadge.textContent = '100% GPU VRAM';
      } else if (selectedVRAM >= vramReq * 0.45 && selectedRAM >= ramReq) {
        fitBadge.classList.add('fit-hybrid');
        fitBadge.textContent = 'Hybrid CPU/GPU';
      } else {
        fitBadge.classList.add('fit-heavy');
        fitBadge.textContent = 'VRAM Shortage';
      }
    });
  }

  vramPills.forEach(pill => {
    pill.addEventListener('click', () => {
      vramPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedVRAM = parseFloat(pill.dataset.vram || '8');
      updateFit();
    });
  });

  ramPills.forEach(pill => {
    pill.addEventListener('click', () => {
      ramPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedRAM = parseFloat(pill.dataset.ram || '16');
      updateFit();
    });
  });

  updateFit();
}

// 6. Tier Filter Tabs for Model Cards
function initTierFilterTabs() {
  const tabs = document.querySelectorAll('.tier-tab-btn');
  const cards = document.querySelectorAll('.model-card');

  if (!tabs.length || !cards.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const selectedTier = tab.dataset.tier;

      cards.forEach(card => {
        if (selectedTier === 'all' || card.dataset.tier === selectedTier) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
}
