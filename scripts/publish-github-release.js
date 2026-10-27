// ==========================================================================
// Orbital X — Automated GitHub Release Publisher
// ==========================================================================

import fs from 'node:fs';
import path from 'node:path';

const REPO_OWNER = 'daxp472';
const REPO_NAME = 'Orbital-X';
const TAG_NAME = 'v2.2.5';
const RELEASE_TITLE = 'Orbital X v2.2.5 — Explorer UI & SVG Icons, Speed & Repetition Fixes';
const NOTES_PATH = path.resolve('release/notes/RELEASE_NOTES_v2.2.5.md');

// Retrieve token from Git Credential Manager or env
import { spawnSync } from 'node:child_process';

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

  const bodyContent = fs.readFileSync(NOTES_PATH, 'utf-8');

  // 1. Create or check release
  console.log(`Checking if release ${TAG_NAME} already exists...`);
  const listRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Orbital-X-Release'
    }
  });

  const releases = await listRes.json();
  let release = releases.find(r => r.tag_name === TAG_NAME);

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

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create release: ${createRes.status} ${errText}`);
    }
    release = await createRes.json();
    console.log(`Release created successfully! ID: ${release.id}, URL: ${release.html_url}`);
  } else {
    console.log(`Release ${TAG_NAME} already exists with ID: ${release.id}. Updating body...`);
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
        body: bodyContent,
        draft: false,
        prerelease: false
      })
    });
  }

  // 2. Upload Assets
  const assetsToUpload = [
    { filePath: 'release/Orbital.X_2.2.5_x64-setup.exe', name: 'Orbital.X_2.2.5_x64-setup.exe' },
    { filePath: 'release/Orbital X_2.2.5_x64-setup.exe', name: 'Orbital X_2.2.5_x64-setup.exe' },
    { filePath: 'release/orbital-x.exe', name: 'orbital-x.exe' }
  ];

  for (const asset of assetsToUpload) {
    const fullPath = path.resolve(asset.filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`Asset file not found: ${fullPath}, skipping...`);
      continue;
    }

    const stat = fs.statSync(fullPath);
    console.log(`\nPreparing asset: ${asset.name} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);

    // Check if asset already exists in release
    const existingAsset = release.assets ? release.assets.find(a => a.name === asset.name) : null;
    if (existingAsset) {
      console.log(`Deleting existing asset ${asset.name} (ID: ${existingAsset.id})...`);
      await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Orbital-X-Release'
        }
      });
      console.log(`Deleted existing asset ${asset.name}.`);
    }

    console.log(`Uploading ${asset.name}...`);
    const fileStream = fs.readFileSync(fullPath);
    const uploadUrl = `https://uploads.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size.toString(),
        'User-Agent': 'Orbital-X-Release'
      },
      body: fileStream
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error(`Failed to upload ${asset.name}: ${uploadRes.status} ${errText}`);
    } else {
      const uploadedData = await uploadRes.json();
      console.log(`Successfully uploaded ${asset.name}! Download URL: ${uploadedData.browser_download_url}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`All assets uploaded! Release v2.2.5 is published.`);
  console.log(`View online at: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${TAG_NAME}`);
  console.log(`======================================================`);
}

main().catch(err => {
  console.error('Fatal error during release publishing:', err);
  process.exit(1);
});
