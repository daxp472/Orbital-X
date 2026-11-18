// ==========================================================================
// Orbital X — Automated GitHub Release Publisher for v2.4.3
// ==========================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_OWNER = 'daxp472';
const REPO_NAME = 'Orbital-X';
const TAG_NAME = 'v2.4.3';
const RELEASE_TITLE = 'Orbital X v2.4.3 — Frameless Window Architecture, Full-Height Windows 11 Controls & Unified Theme Engine';
const NOTES_PATH = path.resolve('changelogs/017.md');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const res = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf-8'
    });
    if (res.stdout) {
      const match = res.stdout.match(/password=(.+)/);
      if (match) return match[1].trim();
    }
  } catch (err) {
    console.error('Failed to get token from git credential manager:', err.message);
  }
  return null;
}

async function fetchWithRetry(url, options = {}, retries = 5, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      console.warn(`Attempt ${attempt}/${retries} failed for ${url}: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay * attempt));
    }
  }
}

async function main() {
  const token = getGitHubToken();
  if (!token) {
    console.error('ERROR: No GitHub token available via environment or Git Credential Manager.');
    process.exit(1);
  }
  console.log('GitHub authentication verified.');

  const bodyContent = fs.existsSync(NOTES_PATH) ? fs.readFileSync(NOTES_PATH, 'utf-8') : 'Orbital X v2.4.3 Release';

  // 1. Check if release already exists
  console.log(`Checking if release ${TAG_NAME} already exists...`);
  const listRes = await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Orbital-X-Release'
    }
  });

  const releases = await listRes.json();
  let release = Array.isArray(releases) ? releases.find(r => r.tag_name === TAG_NAME) : null;

  if (!release) {
    console.log(`Creating release ${TAG_NAME}...`);
    const createRes = await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Orbital-X-Release'
      },
      body: JSON.stringify({
        tag_name: TAG_NAME,
        target_commitish: 'main',
        name: RELEASE_TITLE,
        body: bodyContent,
        draft: false,
        prerelease: false,
        make_latest: 'true'
      })
    });
    release = await createRes.json();
    if (!createRes.ok) {
      console.error(`Failed to create release: ${createRes.status}`, release);
      process.exit(1);
    }
    console.log(`Created release: ${release.html_url}`);
  } else {
    console.log(`Release ${TAG_NAME} already exists: ${release.html_url}`);
    const patchRes = await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Orbital-X-Release'
      },
      body: JSON.stringify({
        name: RELEASE_TITLE,
        body: bodyContent,
        make_latest: 'true'
      })
    });
    release = await patchRes.json();
    console.log(`Updated release: ${release.html_url}`);
  }

  // 2. Upload release assets
  const assetsToUpload = [
    {
      name: 'Orbital.X_2.4.3_x64-setup.exe',
      path: path.resolve('release/Orbital.X_2.4.3_x64-setup.exe')
    },
    {
      name: 'Orbital X_2.4.3_x64-setup.exe',
      path: path.resolve('release/Orbital X_2.4.3_x64-setup.exe')
    },
    {
      name: 'Orbital.X_2.4.3_portable_win64.zip',
      path: path.resolve('release/Orbital.X_2.4.3_portable_win64.zip')
    },
    {
      name: 'orbital-x.exe',
      path: path.resolve('release/orbital-x.exe')
    },
    {
      name: 'Orbital.X_2.4.3_aarch64.dmg',
      path: path.resolve('release/Orbital.X_2.4.3_aarch64.dmg')
    },
    {
      name: 'Orbital.X_aarch64.app.tar.gz',
      path: path.resolve('release/Orbital.X_aarch64.app.tar.gz')
    },
    {
      name: 'Orbital.X_2.4.3_amd64.AppImage',
      path: path.resolve('release/Orbital.X_2.4.3_amd64.AppImage')
    },
    {
      name: 'Orbital.X_2.4.3_amd64.deb',
      path: path.resolve('release/Orbital.X_2.4.3_amd64.deb')
    }
  ];

  for (const asset of assetsToUpload) {
    if (!fs.existsSync(asset.path)) {
      console.warn(`File not found, skipping: ${asset.path}`);
      continue;
    }

    const stats = fs.statSync(asset.path);

    // Fetch latest assets for this release to be 100% in sync
    const curReleaseRes = await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Orbital-X-Release'
      }
    });
    const curRelease = await curReleaseRes.json();
    const existingAsset = curRelease.assets ? curRelease.assets.find(a => a.name === asset.name) : null;

    if (existingAsset) {
      if (existingAsset.size === stats.size) {
        console.log(`✓ Asset ${asset.name} is already attached and verified (${(existingAsset.size / 1024 / 1024).toFixed(2)} MB). Skipping.`);
        continue;
      }
      console.log(`Asset ${asset.name} exists with different size. Deleting older version...`);
      await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Orbital-X-Release'
        }
      });
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`Uploading ${asset.name} (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
    const fileStream = fs.readFileSync(asset.path);

    let contentType = 'application/octet-stream';
    if (asset.name.endsWith('.exe')) contentType = 'application/vnd.microsoft.portable-executable';
    else if (asset.name.endsWith('.zip')) contentType = 'application/zip';
    else if (asset.name.endsWith('.dmg')) contentType = 'application/x-apple-diskimage';
    else if (asset.name.endsWith('.deb')) contentType = 'application/vnd.debian.binary-package';
    else if (asset.name.endsWith('.AppImage')) contentType = 'application/x-executable';
    else if (asset.name.endsWith('.tar.gz')) contentType = 'application/gzip';

    let uploadOk = false;
    for (let uploadAttempt = 1; uploadAttempt <= 5; uploadAttempt++) {
      try {
        const uploadUrl = `https://uploads.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': contentType,
            'Content-Length': String(stats.size),
            'User-Agent': 'Orbital-X-Release'
          },
          body: fileStream,
          duplex: 'half'
        });

        if (uploadRes.ok) {
          const uploadedAsset = await uploadRes.json();
          console.log(`✓ Uploaded ${asset.name} (${(uploadedAsset.size / 1024 / 1024).toFixed(2)} MB)`);
          uploadOk = true;
          break;
        } else {
          const errText = await uploadRes.text();
          console.warn(`Upload attempt ${uploadAttempt} failed for ${asset.name} (${uploadRes.status}): ${errText}`);
          if (uploadAttempt < 5) await new Promise(r => setTimeout(r, 3000 * uploadAttempt));
        }
      } catch (err) {
        console.warn(`Upload attempt ${uploadAttempt} error for ${asset.name}: ${err.message}`);
        if (uploadAttempt < 5) await new Promise(r => setTimeout(r, 3000 * uploadAttempt));
      }
    }

    if (!uploadOk) {
      console.error(`Failed to upload ${asset.name} after 5 attempts.`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n==========================================');
  console.log(`All assets processed for ${TAG_NAME}!`);
  console.log(`Release URL: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${TAG_NAME}`);
  console.log('==========================================');
}

main().catch(err => {
  console.error('Fatal error during release publishing:', err);
  process.exit(1);
});
