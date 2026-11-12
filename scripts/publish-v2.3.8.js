// ==========================================================================
// Orbital X — Automated GitHub Release Publisher for v2.3.8
// ==========================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_OWNER = 'daxp472';
const REPO_NAME = 'Orbital-X';
const TAG_NAME = 'v2.3.8';
const RELEASE_TITLE = 'Orbital X v2.3.8 — Hybrid Portable Architecture, Release Highlights & System Synchronizer';
const NOTES_PATH = path.resolve('changelogs/012.md');

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
    console.error('ERROR: No GitHub token available.');
    process.exit(1);
  }
  console.log('GitHub token acquired successfully.');

  const bodyContent = fs.existsSync(NOTES_PATH) ? fs.readFileSync(NOTES_PATH, 'utf-8') : 'Orbital X v2.3.8 Release';

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
    // Update body & title
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

  // 2. Upload assets (Ensure ALL 6 multi-platform assets are attached)
  const assetsToUpload = [
    {
      name: 'orbital-x.exe',
      path: path.resolve('release/orbital-x.exe')
    },
    {
      name: 'Orbital.X_2.3.8_aarch64.dmg',
      path: path.resolve('release/Orbital.X_2.3.8_aarch64.dmg')
    },
    {
      name: 'Orbital.X_2.3.8_amd64.AppImage',
      path: path.resolve('release/Orbital.X_2.3.8_amd64.AppImage')
    },
    {
      name: 'Orbital.X_2.3.8_amd64.deb',
      path: path.resolve('release/Orbital.X_2.3.8_amd64.deb')
    },
    {
      name: 'Orbital.X_2.3.8_x64-setup.exe',
      path: path.resolve('release/Orbital.X_2.3.8_x64-setup.exe')
    },
    {
      name: 'Orbital.X_2.3.8_portable_win64.zip',
      path: path.resolve('release/Orbital.X_2.3.8_portable_win64.zip')
    },
    {
      name: 'Orbital.X_aarch64.app.tar.gz',
      path: path.resolve('release/Orbital.X_aarch64.app.tar.gz')
    }
  ];

  for (const asset of assetsToUpload) {
    if (!fs.existsSync(asset.path)) {
      console.warn(`File not found, skipping: ${asset.path}`);
      continue;
    }

    // Refresh release details to get latest assets list
    const getRelRes = await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Orbital-X-Release'
      }
    });
    const currentRel = await getRelRes.json();

    // Check if asset is already uploaded with the exact same size
    const existingAsset = (currentRel.assets || []).find(a => a.name === asset.name);
    const localSize = fs.statSync(asset.path).size;
    if (existingAsset) {
      if (existingAsset.size === localSize && existingAsset.state === 'uploaded') {
        console.log(`Asset ${asset.name} is already uploaded with matching size (${(localSize / 1024 / 1024).toFixed(1)} MB). Skipping.`);
        continue;
      }
      console.log(`Deleting existing asset ${asset.name} (id: ${existingAsset.id})...`);
      await fetchWithRetry(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Orbital-X-Release'
        }
      });
    }

    console.log(`Uploading ${asset.name} (${(localSize / 1024 / 1024).toFixed(1)} MB)...`);
    const fileData = fs.readFileSync(asset.path);
    const uploadUrl = `https://uploads.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;

    const upRes = await fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream',
        'User-Agent': 'Orbital-X-Release'
      },
      body: fileData
    });

    if (upRes.ok) {
      console.log(`Successfully uploaded ${asset.name}`);
    } else {
      console.error(`Failed to upload ${asset.name}: ${upRes.status} ${await upRes.text()}`);
    }
  }

  console.log(`\nAll done! View release at: ${release.html_url}`);
}

main().catch(err => {
  console.error('Fatal release error:', err);
  process.exit(1);
});

