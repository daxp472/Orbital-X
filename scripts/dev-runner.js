// scripts/dev-runner.js
import net from 'net';
import { spawn } from 'child_process';

function checkPort(port, host = 'localhost') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true); // Port is occupied / server running
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function run() {
  const isPort1420InUse = (await checkPort(1420, 'localhost')) || (await checkPort(1420, '127.0.0.1')) || (await checkPort(1420, '::1'));

  if (isPort1420InUse) {
    console.log('[Orbital X] Dev server is already running on port 1420. Reusing active instance.');
    process.exit(0);
  }

  console.log('[Orbital X] Starting fresh Vite dev server on port 1420...');
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'npx.cmd' : 'npx';
  const child = spawn(cmd, ['vite'], { stdio: 'inherit', shell: false });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

run();
