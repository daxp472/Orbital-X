import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const version = pkg.version || '2.4.4';

const stagingDir = path.resolve(`release/Orbital.X_Portable_v${version}`);
const universalZip = path.resolve(`release/Orbital-X-Portable.zip`);
const universalZipNamed = path.resolve(`release/Orbital X Portable.zip`);
const versionedZip = path.resolve(`release/Orbital.X_${version}_portable.zip`);

if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}

// Create Portable directory structure
fs.mkdirSync(path.join(stagingDir, 'Data/.orbital/extensions'), { recursive: true });
fs.mkdirSync(path.join(stagingDir, 'Data/.orbital/skills'), { recursive: true });
fs.writeFileSync(path.join(stagingDir, 'Data/PORTABLE'), 'PORTABLE_MODE=1\n');
fs.writeFileSync(path.join(stagingDir, 'PORTABLE'), 'PORTABLE_MODE=1\n');

// 1. Windows Binary & Launchers
const candidatePaths = [
  path.resolve('release/orbital-x.exe'),
  path.resolve('src-tauri/target/release/orbital-x.exe'),
  path.resolve('src-tauri/target/release/Orbital X.exe'),
];
const exeSrc = candidatePaths.find(p => fs.existsSync(p));
if (exeSrc) {
  fs.copyFileSync(exeSrc, path.join(stagingDir, 'Orbital X.exe'));
  fs.copyFileSync(exeSrc, path.join(stagingDir, 'orbital-x.exe'));
  console.log(`✓ Staged Windows executable: Orbital X.exe`);
} else {
  console.warn('Windows binary not found in candidate paths:', candidatePaths);
}

const webviewDll = path.resolve('src-tauri/target/release/WebView2Loader.dll');
if (fs.existsSync(webviewDll)) {
  fs.copyFileSync(webviewDll, path.join(stagingDir, 'WebView2Loader.dll'));
}

const launcherBat = `@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0Orbital X.exe" --portable
`;
fs.writeFileSync(path.join(stagingDir, 'launch-portable.bat'), launcherBat);

// 2. macOS Application Bundle & Launcher
const macTarCandidates = [
  path.resolve('release/Orbital.X_aarch64.app.tar.gz'),
  path.resolve(`release/Orbital.X_${version}_aarch64.app.tar.gz`),
  path.resolve('src-tauri/target/release/bundle/macos/Orbital X.app'),
];

let macFound = false;
for (const macPath of macTarCandidates) {
  if (fs.existsSync(macPath)) {
    if (macPath.endsWith('.tar.gz')) {
      console.log(`Extracting macOS app from ${path.basename(macPath)}...`);
      spawnSync('tar', ['-xzf', macPath, '-C', stagingDir], { stdio: 'inherit' });
      macFound = true;
      break;
    } else if (fs.statSync(macPath).isDirectory()) {
      spawnSync('powershell', ['-NoProfile', '-Command', `Copy-Item -Recurse '${macPath}' '${stagingDir}\\Orbital X.app'`], { stdio: 'inherit' });
      macFound = true;
      break;
    }
  }
}
if (macFound) {
  console.log(`✓ Staged macOS bundle: Orbital X.app`);
}

const macScript = `#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
open "$DIR/Orbital X.app" --args --portable
`;
fs.writeFileSync(path.join(stagingDir, 'launch-mac.command'), macScript, { mode: 0o755 });

// 3. Linux AppImage & Launcher
const linuxCandidates = [
  path.resolve('release/Orbital-X.AppImage'),
  path.resolve('release/Orbital x 3/Orbital.X_2.3.9_amd64.AppImage'),
  path.resolve('release/Orbital x 3/Orbital.X_2.3.8_amd64.AppImage'),
  path.resolve('src-tauri/target/release/bundle/appimage/orbital-x.AppImage'),
];
const linuxSrc = linuxCandidates.find(p => fs.existsSync(p));
if (linuxSrc) {
  fs.copyFileSync(linuxSrc, path.join(stagingDir, 'Orbital-X.AppImage'));
  console.log(`✓ Staged Linux AppImage: Orbital-X.AppImage`);
}

const linuxScript = `#!/usr/bin/env bash
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
chmod +x "$DIR/Orbital-X.AppImage" 2>/dev/null
exec "$DIR/Orbital-X.AppImage" --portable "$@"
`;
fs.writeFileSync(path.join(stagingDir, 'launch-linux.sh'), linuxScript, { mode: 0o755 });

// 4. Shared Configuration & Documentation
const settings = {
  version: version,
  theme: 'orbit-dark',
  portableMode: true,
  ai: {
    provider: 'ollama',
    model: 'llama3:latest',
    endpoint: 'http://127.0.0.1:11434',
    speculativeStreaming: true
  }
};
fs.writeFileSync(path.join(stagingDir, 'Data/.orbital/settings.json'), JSON.stringify(settings, null, 2));

const readme = `========================================================================
Orbital X Universal Portable v${version} — 3-in-1 USB Development Environment
========================================================================

One universal package for all your computers (Windows, macOS, and Linux).
Extract or copy this folder directly to any USB drive or portable storage.
Plug into ANY laptop or workstation and launch with 1 click:

HOW TO RUN:
• WINDOWS: Double-click 'Orbital X.exe' or 'launch-portable.bat'
• MACOS:   Double-click 'Orbital X.app' or 'launch-mac.command'
• LINUX:   Double-click 'Orbital-X.AppImage' or run './launch-linux.sh'

100% ZERO INSTALLATION & ZERO-TRACE:
- No administrator permissions required on any computer.
- All configuration, editor preferences, agent skills, chat history,
  and project memories are saved in the shared './Data/' folder.
- When you move your USB drive between Windows, Mac, and Linux, your
  customizations and chat history travel with you automatically.

WHAT TRAVELS ON YOUR USB DRIVE:
- Your personalized themes, keybindings, and editor settings (Data/.orbital/)
- Custom agent instruction skills and prompts
- Agent conversation history and persistent knowledge rules

WHAT USES THE HOST COMPUTER'S POWER:
- Host Ollama runtime and locally downloaded AI models (http://127.0.0.1:11434)
- Host GPU acceleration, CPU cores, and RAM
- Local project source files and build tools (Node.js, Cargo, Python)

Documentation & Updates:
https://daxp472.github.io/Orbital-X/
========================================================================
`;
fs.writeFileSync(path.join(stagingDir, 'README-PORTABLE.txt'), readme);

// 5. Compress Universal Archive
const targets = [universalZip, universalZipNamed, versionedZip];

for (const dest of targets) {
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  console.log(`Compressing universal bundle into ${path.basename(dest)}...`);
  spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${dest}' -CompressionLevel Optimal`
  ], { stdio: 'inherit' });

  if (fs.existsSync(dest)) {
    const stat = fs.statSync(dest);
    console.log(`✓ Created ${path.basename(dest)} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  }
}
