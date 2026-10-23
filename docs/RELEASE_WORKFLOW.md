# Orbital X — Multi-Platform Release Workflow Guide

This document outlines the end-to-end process for versioning, building, and publishing multi-platform desktop releases for **Orbital X** across Windows, macOS, and Linux.

---

## 1. Overview & Architecture

Orbital X uses **Tauri 2** combined with **GitHub Actions** to automate desktop application compilation and distribution. When a semantic release tag (e.g. `v2.1.2`) is pushed or the workflow is triggered manually, GitHub Actions executes parallel matrix builds on native virtual runners:

| Platform | Runner OS | Build Targets / Artifacts | Output Format |
|---|---|---|---|
| **Windows** | `windows-latest` | NSIS Installer | `Orbital X_<version>_x64-setup.exe` |
| **macOS** | `macos-latest` | Apple Disk Image & App Bundle | `Orbital X_<version>_x64.dmg` / `.app` |
| **Linux** | `ubuntu-22.04` | AppImage & Debian Package | `orbital-x_<version>_amd64.AppImage`, `orbital-x_<version>_amd64.deb` |

Bundle targets are configured centrally in `src-tauri/tauri.conf.json`:
```json
"bundle": {
  "active": true,
  "targets": ["nsis", "app", "appimage", "deb", "dmg"],
  "licenseFile": "LICENSE.txt",
  "category": "DeveloperTool"
}
```

---

## 2. Release Version Bumping

Orbital X maintains version parity across three configuration files:
1. `src-tauri/tauri.conf.json` (`version`)
2. `package.json` (`version`)
3. `src-tauri/Cargo.toml` (`[package].version`)

Use the included PowerShell script [`scripts/bump-version.ps1`](../scripts/bump-version.ps1) to bump all files in a single command.

### Standard Usage

```powershell
# Bump patch version (e.g. 2.1.1 -> 2.1.2)
.\scripts\bump-version.ps1

# Bump minor version (e.g. 2.1.1 -> 2.2.0)
.\scripts\bump-version.ps1 -Type minor

# Bump major version (e.g. 2.1.1 -> 3.0.0)
.\scripts\bump-version.ps1 -Type major

# Set an explicit version
.\scripts\bump-version.ps1 -TargetVersion 2.3.0

# Preview changes without modifying files
.\scripts\bump-version.ps1 -DryRun
```

The script automatically preserves clean UTF-8 encoding (without BOM) and validates semantic version formatting.

---

## 3. Step-by-Step Release Procedure

### Step 1: Prepare the Release Branch
Ensure all planned features and bugfixes are committed on your working branch (e.g. `gemini/studio`):
```bash
git checkout gemini/studio
git status
```

### Step 2: Bump the Version
Run the bump script:
```powershell
.\scripts\bump-version.ps1
```

### Step 3: Commit the Version Bump
Stage the updated configuration files and commit:
```bash
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml
git commit -m "chore(release): bump version to 2.1.2"
```

### Step 4: Push Branch Changes
Push the commit to your branch:
```bash
git push origin gemini/studio
```

### Step 5: Tag the Release
Create an annotated or lightweight git tag starting with `v` matching the new version:
```bash
git tag v2.1.2
git push origin v2.1.2
```

> [!IMPORTANT]
> The release workflow specifically listens to the tag pattern `v*` (e.g. `v2.1.2`). Tags that do not start with `v` will not trigger automated builds.

---

## 4. GitHub Actions Release Pipeline (`release.yml`)

The workflow file [`.github/workflows/release.yml`](../.github/workflows/release.yml) handles the multi-platform build matrix:

```yaml
jobs:
  build-and-release:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-22.04, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
```

### Automated Steps on Each Runner:
1. **Checkout Repository**: Pulls the tagged commit.
2. **Setup Node.js (v20)**: Installs cached `npm` dependencies with `npm ci`.
3. **Setup Rust Toolchain**: Installs stable Rust compiler via `dtolnay/rust-toolchain@stable`.
4. **Linux System Dependencies**: On `ubuntu-22.04`, installs required WebKit and GTK packages:
   ```bash
   sudo apt-get update
   sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev
   ```
5. **Build & Package**: `tauri-apps/tauri-action@v0` compiles the frontend (`npm run build`), builds the Rust binary, packages the bundle installers, and uploads all assets to the GitHub Release.

### Manual Triggering (`workflow_dispatch`)
You can also trigger a release manually from the GitHub web UI:
1. Navigate to **Actions** > **Release Multi-Platform Desktop Builds**.
2. Click **Run workflow**.
3. Select the branch or tag to build.

---

## 5. Post-Release Verification Checklist

After the GitHub Actions workflow completes successfully:

- [ ] **GitHub Releases Page**: Verify a new release is published with all binary assets attached:
  - `.exe` NSIS installer (Windows)
  - `.dmg` image (macOS)
  - `.AppImage` standalone binary (Linux)
  - `.deb` Debian package (Linux)
- [ ] **Windows Smoke Test**: Install via the NSIS installer; check that Monaco editor, agent modes, and terminal start properly.
- [ ] **macOS Smoke Test**: Mount the `.dmg`, drag to Applications, and launch.
- [ ] **Linux Smoke Test**: Run `chmod +x *.AppImage && ./*.AppImage` on an Ubuntu/Debian desktop environment.
- [ ] **Winget Submission** (Optional): If updating Microsoft Winget packages, update manifests in `manifests/` and validate using [`scripts/test-winget-manifest.ps1`](../scripts/test-winget-manifest.ps1).

---

## 6. Troubleshooting Common Issues

### 1. `ubuntu-22.04` WebKit2GTK Build Failures
- **Cause**: Tauri 2 requires `libwebkit2gtk-4.1-dev`. Older distributions using `libwebkit2gtk-4.0-dev` will fail.
- **Fix**: Ensure `release.yml` includes `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev` in the setup step.

### 2. GitHub Token Permission Errors
- **Symptom**: `Error: Resource not accessible by integration` during release creation.
- **Fix**: Verify `.github/workflows/release.yml` defines `permissions: contents: write`.

### 3. macOS Gatekeeper Warnings
- **Cause**: Unsigned or ad-hoc signed macOS applications will show a security prompt on first launch.
- **Workaround for Users**: Right-click the app > click **Open** > confirm **Open Anyway**, or run `xattr -d com.apple.quarantine /Applications/Orbital\ X.app`.
