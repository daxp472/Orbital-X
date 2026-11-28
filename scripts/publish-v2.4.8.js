import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

  const changelog = fs.readFileSync(path.resolve('changelogs/022.md'), 'utf8');

  let release = null;
  const getRes = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases/tags/v2.4.8', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OrbitalX-Uploader',
    },
  });

  if (getRes.ok) {
    release = await getRes.json();
    console.log(`Found existing release ID: ${release.id}`);
  } else {
    console.log('Creating release v2.4.8 on GitHub...');
    const createRes = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OrbitalX-Uploader',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag_name: 'v2.4.8',
        target_commitish: 'main',
        name: 'Orbital X v2.4.8 — 30+ tok/s Local Agent, Universal GitHub Skills & Flagship Polish',
        body: changelog,
        draft: false,
        prerelease: false,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`Failed to create release (${createRes.status}):`, errText);
      process.exit(1);
    }
    release = await createRes.json();
    console.log(`Created release v2.4.8 (ID: ${release.id})`);
  }

  const uploadBase = release.upload_url.replace(/\{.*\}/, '');
  const assetsToUpload = [
    'release/Orbital.X_2.4.8_x64-setup.exe',
    'release/Orbital.X_2.4.8_amd64.AppImage',
    'release/Orbital.X_2.4.8_amd64.deb',
    'release/Orbital.X_2.4.8_aarch64.dmg',
    'release/Orbital.X_aarch64.app.tar.gz',
    'release/Orbital-X-Portable.zip',
    'release/orbital-x.exe',
  ];

  const existingAssets = release.assets || [];

  for (const relPath of assetsToUpload) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found, skipping: ${relPath}`);
      continue;
    }
    const name = path.basename(fullPath);
    const existing = existingAssets.find((a) => a.name === name);
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

    console.log(`Uploading ${name} (${(fs.statSync(fullPath).size / 1024 / 1024).toFixed(2)} MB)...`);
    const fileBytes = fs.readFileSync(fullPath);
    const uploadRes = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OrbitalX-Uploader',
        'Content-Type': 'application/octet-stream',
      },
      body: fileBytes,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error(`Failed to upload ${name}:`, errText);
    } else {
      console.log(`Uploaded ${name} successfully.`);
    }
  }

  console.log(`Release URL: ${release.html_url}`);
}

publish().catch((err) => {
  console.error('Publish failed:', err.message);
  process.exit(1);
});
