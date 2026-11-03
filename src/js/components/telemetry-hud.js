// ==========================================================================
// Orbital X — Zero-Allocation Token Telemetry & VRAM Tracker (telemetry-hud.js)
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { state } from '../state/store.js';

let pollerInterval = null;
let historyBuffer = []; // { tps, vramMb, vramTotalMb, cpu, time } max 60 points (60s)
let hudModal = null;
let canvas = null;
let canvasCtx = null;
let isHudOpen = false;

export function initTelemetryHUD() {
  injectStatusBarPill();
  createHudModal();
  startBackgroundTelemetry(2000); // lightweight background ticker
}

function injectStatusBarPill() {
  const statusBar = document.getElementById('status-bar') || document.querySelector('.status-bar');
  if (!statusBar || document.getElementById('sb-telemetry-pill')) return;

  const pill = document.createElement('div');
  pill.id = 'sb-telemetry-pill';
  pill.className = 'status-bar-item status-bar-pill';
  pill.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    padding: 0 8px;
    font-size: 11px;
    font-family: var(--font-code, monospace);
    color: var(--text-secondary);
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    user-select: none;
    transition: background 0.15s ease, color 0.15s ease;
  `;
  pill.title = 'Click to open Native Hardware Telemetry & VRAM Tracker';
  pill.innerHTML = `
    <span style="color: #00e5ff;">⚡</span>
    <span id="sb-telemetry-tps" style="font-weight: 600; color: var(--text-primary);">0.0 tps</span>
    <span style="opacity: 0.4;">•</span>
    <span id="sb-telemetry-vram" style="color: #a78bfa;">0.0 GB VRAM</span>
    <span style="opacity: 0.4;">•</span>
    <span id="sb-telemetry-cpu">0% CPU</span>
  `;

  pill.addEventListener('mouseenter', () => {
    pill.style.background = 'rgba(255, 255, 255, 0.05)';
  });
  pill.addEventListener('mouseleave', () => {
    pill.style.background = 'transparent';
  });
  pill.addEventListener('click', openTelemetryHUD);

  // Insert before right-hand items or at the end
  const rightGroup = statusBar.querySelector('.status-bar-right') || statusBar.lastElementChild;
  if (rightGroup && rightGroup.parentElement === statusBar) {
    statusBar.insertBefore(pill, rightGroup);
  } else {
    statusBar.appendChild(pill);
  }
}

function createHudModal() {
  if (document.getElementById('modal-telemetry-hud')) return;

  hudModal = document.createElement('div');
  hudModal.id = 'modal-telemetry-hud';
  hudModal.className = 'modal-overlay';
  hudModal.style.cssText = `
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    z-index: 10000;
    align-items: center;
    justify-content: center;
  `;

  hudModal.innerHTML = `
    <div style="
      background: var(--bg-surface, #1e2029);
      border: 1px solid var(--border-color, #2d3142);
      border-radius: 12px;
      width: 760px;
      max-width: 94vw;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 48px rgba(0,0,0,0.6);
      overflow: hidden;
      font-family: var(--font-ui, system-ui, sans-serif);
    ">
      <!-- Header -->
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        background: rgba(255, 255, 255, 0.02);
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 18px; color: #00e5ff;">⚡</span>
          <div>
            <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary);">Native Hardware Telemetry & VRAM Tracker</h2>
            <div style="font-size: 11px; color: var(--text-secondary);">Zero-allocation native OS & GPU telemetry streamed via Rust IPC</div>
          </div>
        </div>
        <button id="btn-close-telemetry-hud" style="
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        ">✕</button>
      </div>

      <!-- Main Body -->
      <div style="padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px;">
        <!-- Metrics Cards Grid -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
          <div style="background: rgba(0, 229, 255, 0.06); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #00e5ff; letter-spacing: 0.5px; font-weight: 600;">Tokens / Sec</div>
            <div id="hud-val-tps" style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-top: 4px; font-family: monospace;">0.0</div>
            <div id="hud-sub-tps" style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Real-time stream</div>
          </div>

          <div style="background: rgba(167, 139, 250, 0.06); border: 1px solid rgba(167, 139, 250, 0.2); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #a78bfa; letter-spacing: 0.5px; font-weight: 600;">GPU VRAM</div>
            <div id="hud-val-vram" style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-top: 4px; font-family: monospace;">0.0 GB</div>
            <div id="hud-sub-vram" style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">0% allocated</div>
          </div>

          <div style="background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #f59e0b; letter-spacing: 0.5px; font-weight: 600;">CPU Compute</div>
            <div id="hud-val-cpu" style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-top: 4px; font-family: monospace;">0%</div>
            <div id="hud-sub-cpu" style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Global OS load</div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #10b981; letter-spacing: 0.5px; font-weight: 600;">System RAM</div>
            <div id="hud-val-ram" style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-top: 4px; font-family: monospace;">0.0 GB</div>
            <div id="hud-sub-ram" style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">0% used</div>
          </div>
        </div>

        <!-- Live Graph Section -->
        <div style="background: var(--bg-base, #13141c); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">60-Second Real-Time Telemetry Graph</span>
            <div style="display: flex; align-items: center; gap: 14px; font-size: 11px;">
              <span style="display: flex; align-items: center; gap: 4px; color: #00e5ff;"><span style="width: 8px; height: 8px; background: #00e5ff; border-radius: 2px;"></span> TPS</span>
              <span style="display: flex; align-items: center; gap: 4px; color: #a78bfa;"><span style="width: 8px; height: 8px; background: #a78bfa; border-radius: 2px;"></span> VRAM %</span>
              <span style="display: flex; align-items: center; gap: 4px; color: #f59e0b;"><span style="width: 8px; height: 8px; background: #f59e0b; border-radius: 2px;"></span> CPU %</span>
            </div>
          </div>
          <canvas id="hud-telemetry-canvas" width="680" height="180" style="width: 100%; height: 180px; display: block; border-radius: 4px; background: rgba(0,0,0,0.2);"></canvas>
        </div>

        <!-- Hardware & Model Context Footer -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; font-size: 12px;">
            <div style="color: var(--text-secondary); margin-bottom: 4px;">Detected Primary GPU</div>
            <div id="hud-gpu-name" style="font-weight: 600; color: var(--text-primary);">Scanning hardware...</div>
          </div>
          <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; font-size: 12px;">
            <div style="color: var(--text-secondary); margin-bottom: 4px;">Active Model in VRAM</div>
            <div id="hud-active-model" style="font-weight: 600; color: var(--text-primary);">None (Idle)</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(hudModal);

  hudModal.querySelector('#btn-close-telemetry-hud')?.addEventListener('click', closeTelemetryHUD);
  hudModal.addEventListener('click', (e) => {
    if (e.target === hudModal) closeTelemetryHUD();
  });

  canvas = hudModal.querySelector('#hud-telemetry-canvas');
  if (canvas) canvasCtx = canvas.getContext('2d');
}

export function openTelemetryHUD() {
  if (!hudModal) createHudModal();
  hudModal.style.display = 'flex';
  isHudOpen = true;
  pollTelemetry();
  startBackgroundTelemetry(1000); // Poll every 1s when modal is visible
}

export function closeTelemetryHUD() {
  if (hudModal) hudModal.style.display = 'none';
  isHudOpen = false;
  startBackgroundTelemetry(2500); // Drop back to 2.5s poll when hidden
}

function startBackgroundTelemetry(intervalMs) {
  if (pollerInterval) clearInterval(pollerInterval);
  pollerInterval = setInterval(pollTelemetry, intervalMs);
}

async function pollTelemetry() {
  try {
    const data = await invoke('get_live_telemetry', {
      ollamaUrl: state.ai.endpoint || 'http://localhost:11434',
    });
    if (!data) return;

    updateUI(data);
  } catch (e) {
    // Silently continue if backend is busy
  }
}

function updateUI(data) {
  const tpsFormatted = (data.tokensPerSecond || 0).toFixed(1);
  const vramGb = ((data.vramUsedMb || 0) / 1024).toFixed(1);
  const vramTotalGb = ((data.vramTotalMb || 0) / 1024).toFixed(1);
  const cpuPercent = Math.round(data.cpuPercent || 0);
  const ramGb = ((data.ramUsedMb || 0) / 1024).toFixed(1);
  const ramTotalGb = ((data.ramTotalMb || 0) / 1024).toFixed(1);

  // Status Bar Pill
  const sbTps = document.getElementById('sb-telemetry-tps');
  const sbVram = document.getElementById('sb-telemetry-vram');
  const sbCpu = document.getElementById('sb-telemetry-cpu');
  if (sbTps) sbTps.textContent = `${tpsFormatted} tps`;
  if (sbVram) sbVram.textContent = `${vramGb}/${vramTotalGb} GB VRAM`;
  if (sbCpu) sbCpu.textContent = `${cpuPercent}% CPU`;

  // HUD Modal
  if (isHudOpen) {
    const elTps = document.getElementById('hud-val-tps');
    const elVram = document.getElementById('hud-val-vram');
    const elSubVram = document.getElementById('hud-sub-vram');
    const elCpu = document.getElementById('hud-val-cpu');
    const elRam = document.getElementById('hud-val-ram');
    const elSubRam = document.getElementById('hud-sub-ram');
    const elGpuName = document.getElementById('hud-gpu-name');
    const elModel = document.getElementById('hud-active-model');

    if (elTps) elTps.textContent = tpsFormatted;
    if (elVram) elVram.textContent = `${vramGb} GB`;
    if (elSubVram) elSubVram.textContent = `${Math.round(data.vramPercent || 0)}% of ${vramTotalGb} GB`;
    if (elCpu) elCpu.textContent = `${cpuPercent}%`;
    if (elRam) elRam.textContent = `${ramGb} GB`;
    if (elSubRam) elSubRam.textContent = `${Math.round(data.ramPercent || 0)}% of ${ramTotalGb} GB`;
    if (elGpuName) elGpuName.textContent = data.gpuName || 'Standard GPU';
    if (elModel) {
      elModel.textContent = data.activeModelName && data.activeModelName !== 'None (Idle)'
        ? `${data.activeModelName} (${(data.activeModelVramMb / 1024).toFixed(1)} GB VRAM)`
        : 'None (Idle)';
    }

    // Push into history buffer
    historyBuffer.push({
      tps: data.tokensPerSecond || 0,
      vramPercent: data.vramPercent || 0,
      cpuPercent: cpuPercent,
      time: Date.now(),
    });
    if (historyBuffer.len > 60) historyBuffer.shift();

    renderCanvasGraph();
  }
}

function renderCanvasGraph() {
  if (!canvasCtx || !canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvasCtx;

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= h; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (historyBuffer.length < 2) return;

  const maxTps = Math.max(100, ...historyBuffer.map(p => p.tps));
  const stepX = w / 59;
  const startIdx = Math.max(0, 60 - historyBuffer.length);

  // 1. Draw CPU line (Amber)
  drawLine(historyBuffer, p => 100 - p.cpuPercent, '#f59e0b', 100, stepX, startIdx);

  // 2. Draw VRAM line (Purple)
  drawLine(historyBuffer, p => 100 - p.vramPercent, '#a78bfa', 100, stepX, startIdx);

  // 3. Draw TPS line (Cyan - thicker)
  drawLine(historyBuffer, p => (p.tps / maxTps) * 100, '#00e5ff', 100, stepX, startIdx, 2);
}

function drawLine(points, valueExtractor, color, maxScale, stepX, startIdx, lineWidth = 1.5) {
  if (!canvasCtx || points.length < 2) return;
  const ctx = canvasCtx;
  const h = canvas.height;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  points.forEach((pt, idx) => {
    const x = (startIdx + idx) * stepX;
    const norm = valueExtractor(pt); // 0 to 100
    const y = h - (norm / maxScale) * (h - 10) - 5;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
