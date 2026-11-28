import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

function uploadFileStream(uploadUrl, token, filePath, size) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: 0,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'OrbitalX-Uploader',
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

async function publish() {
  const credOutput = execSync(
    'powershell -NoProfile -Command "\\"protocol=https`nhost=github.com\\" | git credential fill"',
    { encoding: 'utf8' }
  );
  const match = credOutput.match(/password=(.+)/);
  if (!match) {
    console.error('GitHub credential not found');
    process.exit(1);
  }
  const token = match[1].trim();

  const getRes = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases/tags/v2.4.8', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OrbitalX-Uploader',
    },
  });

  if (!getRes.ok) {
    console.error('Release v2.4.8 not found');
    process.exit(1);
  }
  const release = await getRes.json();
  console.log(`Found release v2.4.8 (ID: ${release.id})`);

  const uploadBase = release.upload_url.replace(/\{.*\}/, '');
  const assetsToUpload = [
    'release/Orbital.X_2.4.8_x64-setup.exe',
    'release/Orbital.X_2.4.8_amd64.deb',
    'release/Orbital.X_2.4.8_aarch64.dmg',
    'release/Orbital.X_aarch64.app.tar.gz',
    'release/orbital-x.exe',
    'release/Orbital.X_2.4.8_amd64.AppImage',
    'release/Orbital-X-Portable.zip',
  ];

  const existingAssets = release.assets || [];

  for (const relPath of assetsToUpload) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found, skipping: ${relPath}`);
      continue;
    }
    const name = path.basename(fullPath);
    const size = fs.statSync(fullPath).size;
    const existing = existingAssets.find((a) => a.name === name);
    if (existing && existing.state === 'uploaded' && existing.size === size) {
      console.log(`Already uploaded: ${name} (${(size / 1024 / 1024).toFixed(2)} MB)`);
      continue;
    }
    if (existing) {
      await fetch(`https://api.github.com/repos/daxp472/Orbital-X/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'OrbitalX-Uploader',
        },
      });
    }

    console.log(`Uploading ${name} (${(size / 1024 / 1024).toFixed(2)} MB)...`);
    let uploaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await uploadFileStream(`${uploadBase}?name=${encodeURIComponent(name)}`, token, fullPath, size);
        uploaded = true;
        break;
      } catch (err) {
        console.warn(`Attempt ${attempt} failed for ${name}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2500));
        else throw err;
      }
    }
    if (uploaded) console.log(`Uploaded ${name} successfully.`);
  }

  console.log(`Release URL: ${release.html_url}`);
}

publish().catch((err) => {
  console.error('Publish failed:', err.message);
  process.exit(1);
});
