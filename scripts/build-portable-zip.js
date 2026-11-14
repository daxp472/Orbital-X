import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const stagingDir = path.resolve('release/Orbital.X_Portable_v2.4.0');
const zipPath = path.resolve('release/Orbital.X_2.4.0_portable_win64.zip');

if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}

fs.mkdirSync(path.join(stagingDir, 'Data/.orbital/extensions'), { recursive: true });
fs.mkdirSync(path.join(stagingDir, 'Data/.orbital/skills'), { recursive: true });
fs.writeFileSync(path.join(stagingDir, 'Data/PORTABLE'), 'PORTABLE_MODE=1\n');

// Copy binary
fs.copyFileSync(path.resolve('release/orbital-x.exe'), path.join(stagingDir, 'orbital-x.exe'));

// Create starter settings.json
const settings = {
  version: '2.4.0',
  theme: 'space-cadet',
  portableMode: true,
  ai: {
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    endpoint: 'http://127.0.0.1:11434',
    speculativeStreaming: true
  }
};
fs.writeFileSync(path.join(stagingDir, 'Data/.orbital/settings.json'), JSON.stringify(settings, null, 2));

const readme = `========================================================================
Orbital X Portable v2.4.0 — USB Development Environment
========================================================================

Welcome to Orbital X Portable!

HOW TO USE ON ANY COMPUTER:
1. Copy this entire folder (or extract this ZIP) directly onto your USB drive or external drive.
2. Plug your USB drive into any Windows 10 or 11 computer (64-bit).
3. Run 'orbital-x.exe' or 'launch-portable.bat'.
4. No administrator privileges or system installation required!

WHAT TRAVELS ON YOUR USB DRIVE:
- Your complete IDE preferences, editor configurations, and themes
- Installed extensions and community skills (under Data/.orbital/)
- Agent custom instructions and conversation chat history
- Backups of your project memory

WHAT USES THE HOST COMPUTER'S POWER:
- Host Ollama runtime and locally downloaded AI models (at http://127.0.0.1:11434)
- Host GPU acceleration, CPU cores, and system memory
- Local compilers and runtimes (Cargo, Rust, Node.js, Python, TypeScript)
- Fast host workspace storage (your project files remain on host storage)

PROJECT MEMORY & INDEPENDENCE:
- Each project workspace maintains its own '.orbital/' folder on the host computer.
- You can synchronize or back up workspace memory to this portable drive at any time
  via Settings -> Developer Options -> 'Backup Workspace Memory to USB'.
- If the USB drive is unplugged, your project code and local workspace memory remain safe!

For support, documentation, and source code, visit:
https://daxp472.github.io/Orbital-X/
========================================================================
`;
fs.writeFileSync(path.join(stagingDir, 'README-PORTABLE.txt'), readme);

const launcherBat = `@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0orbital-x.exe" --portable
`;
fs.writeFileSync(path.join(stagingDir, 'launch-portable.bat'), launcherBat);

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log('Compressing portable package into ZIP...');
const ps = spawnSync('powershell', [
  '-NoProfile',
  '-Command',
  `$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`
], { stdio: 'inherit' });

if (fs.existsSync(zipPath)) {
  const stat = fs.statSync(zipPath);
  console.log(`Created ${path.basename(zipPath)} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  console.error('Failed to create zip:', ps.error);
}
