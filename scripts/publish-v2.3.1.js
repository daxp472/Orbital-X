// ==========================================================================
// Orbital X — Automated GitHub Release Publisher for v2.3.1
// ==========================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_OWNER = 'daxp472';
const REPO_NAME = 'Orbital-X';
const TAG_NAME = 'v2.3.1';
const RELEASE_TITLE = 'Orbital X v2.3.1 — Multi-Model Speculative Streaming, Native Hardware Telemetry & Strict Context Allocation';
const NOTES_PATH = path.resolve('changelogs/005.md');

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

async function main() {
  const token = getGitHubToken();
  if (!token) {
    console.error('ERROR: No GitHub token available.');
    process.exit(1);
  }
  console.log('GitHub token acquired successfully.');

  const bodyContent = fs.existsSync(NOTES_PATH) ? fs.readFileSync(NOTES_PATH, 'utf-8') : 'Orbital X v2.3.1 Release';

  // 1. Check if release already exists
  console.log(`Checking if release ${TAG_NAME} already exists...`);
  const listRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
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
    const createRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
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
        prerelease: false
      })
    });
    release = await createRes.json();
    console.log(`Created release: ${release.html_url}`);
  } else {
    console.log(`Release ${TAG_NAME} already exists: ${release.html_url}`);
    // Update body & title
    await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Orbital-X-Release'
      },
      body: JSON.stringify({
        name: RELEASE_TITLE,
        body: bodyContent
      })
    });
  }

  // 2. Upload assets
  const assetsToUpload = [
    {
      name: 'Orbital.X_2.3.1_x64-setup.exe',
      path: path.resolve('release/Orbital.X_2.3.1_x64-setup.exe')
    },
    {
      name: 'orbital-x.exe',
      path: path.resolve('release/orbital-x.exe')
    }
  ];

  for (const asset of assetsToUpload) {
    if (!fs.existsSync(asset.path)) {
      console.warn(`File not found, skipping: ${asset.path}`);
      continue;
    }

    // Refresh release details to get latest assets list
    const getRelRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Orbital-X-Release'
      }
    });
    const currentRel = await getRelRes.json();

    // Delete existing asset if present
    const existingAsset = (currentRel.assets || []).find(a => a.name === asset.name);
    if (existingAsset) {
      console.log(`Deleting existing asset ${asset.name} (id: ${existingAsset.id})...`);
      await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Orbital-X-Release'
        }
      });
    }

    console.log(`Uploading ${asset.name} (${(fs.statSync(asset.path).size / 1024 / 1024).toFixed(1)} MB)...`);
    const fileData = fs.readFileSync(asset.path);
    const uploadUrl = `https://uploads.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;

    const upRes = await fetch(uploadUrl, {
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
