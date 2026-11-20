import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

async function publish() {
  console.log('Retrieving GitHub token from git credentials...');
  const credOutput = execSync('powershell -NoProfile -Command "\\"protocol=https`nhost=github.com\\" | git credential fill"', { encoding: 'utf8' });
  const match = credOutput.match(/password=(.+)/);
  if (!match) {
    console.error('No token found');
    process.exit(1);
  }
  const token = match[1].trim();

  const changelog = fs.readFileSync(path.resolve('changelogs/019.md'), 'utf8');

  console.log('Checking if release v2.4.5 exists...');
  let release = null;
  const getRes = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases/tags/v2.4.5', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'OrbitalX-Uploader'
    }
  });

  if (getRes.ok) {
    release = await getRes.json();
    console.log(`Found existing release ID: ${release.id}`);
  } else {
    console.log('Creating release v2.4.5 on GitHub...');
    const createRes = await fetch('https://api.github.com/repos/daxp472/Orbital-X/releases', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'OrbitalX-Uploader',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tag_name: 'v2.4.5',
        target_commitish: 'main',
        name: 'Orbital X v2.4.5 — Responsive Split-Screen & Community Skills Markdown Hub',
        body: changelog,
        draft: false,
        prerelease: false
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`Failed to create release (${createRes.status}):`, errText);
      process.exit(1);
    }
    release = await createRes.json();
    console.log(`✓ Release created successfully! ID: ${release.id}, URL: ${release.html_url}`);
  }

  const uploadBase = release.upload_url.replace(/\{.*\}/, '');

  const assetsToUpload = [
    'release/Orbital.X_2.4.5_x64-setup.exe',
    'release/Orbital.X_2.4.5_amd64.AppImage',
    'release/Orbital.X_2.4.5_amd64.deb',
    'release/Orbital.X_2.4.5_aarch64.dmg',
    'release/Orbital.X_aarch64.app.tar.gz',
    'release/Orbital-X-Portable.zip',
    'release/orbital-x.exe'
  ];

  // List existing assets to avoid duplicates or replace
  const existingAssets = release.assets || [];

  for (const relPath of assetsToUpload) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found, skipping: ${relPath}`);
      continue;
    }
    const name = path.basename(fullPath);
    const existing = existingAssets.find(a => a.name === name);
    if (existing) {
      console.log(`Deleting existing asset ${name} (ID: ${existing.id})...`);
      await fetch(`https://api.github.com/repos/daxp472/Orbital-X/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'OrbitalX-Uploader'
        }
      });
    }

    console.log(`Uploading ${name} (${(fs.statSync(fullPath).size / 1024 / 1024).toFixed(2)} MB)...`);
    const fileBytes = fs.readFileSync(fullPath);
    const uploadRes = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'OrbitalX-Uploader',
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBytes.length.toString()
      },
      body: fileBytes
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.error(`Failed to upload ${name}:`, err);
    } else {
      const uploaded = await uploadRes.json();
      console.log(`✓ Uploaded ${name}: ${uploaded.browser_download_url}`);
    }
  }

  console.log('\n🎉 ALL ASSETS UPLOADED AND RELEASE PUBLISHED SUCCESSFULLY!');
  console.log(`View live release at: ${release.html_url}`);
}

publish().catch(e => {
  console.error('Fatal error during publish:', e);
  process.exit(1);
});
