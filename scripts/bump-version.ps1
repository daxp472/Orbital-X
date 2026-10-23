<#
.SYNOPSIS
    Bumps the application release version across project configuration files.

.DESCRIPTION
    Reads current version from src-tauri/tauri.conf.json, increments the patch version
    (or custom type/target version), and writes back to tauri.conf.json, package.json,
    and Cargo.toml without BOM.

.PARAMETER Type
    Version segment to bump: 'patch' (default), 'minor', or 'major'.

.PARAMETER TargetVersion
    Optional explicit version string (e.g. '2.2.0') overriding automatic calculation.

.PARAMETER DryRun
    Previews the version changes without writing files.

.EXAMPLE
    .\scripts\bump-version.ps1
    # Bumps patch: 2.1.1 -> 2.1.2

.EXAMPLE
    .\scripts\bump-version.ps1 -Type minor
    # Bumps minor: 2.1.1 -> 2.2.0

.EXAMPLE
    .\scripts\bump-version.ps1 -TargetVersion 2.3.0
#>

[CmdletBinding()]
param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Type = 'patch',

    [string]$TargetVersion = '',

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Determine workspace root directory
$rootDir = if ($PSScriptRoot) {
    (Resolve-Path "$PSScriptRoot\..").Path
} else {
    (Get-Location).Path
}

$tauriConfPath = Join-Path $rootDir "src-tauri\tauri.conf.json"
$packageJsonPath = Join-Path $rootDir "package.json"
$cargoTomlPath = Join-Path $rootDir "src-tauri\Cargo.toml"

if (-not (Test-Path $tauriConfPath)) {
    throw "Configuration file not found: $tauriConfPath"
}
if (-not (Test-Path $packageJsonPath)) {
    throw "Configuration file not found: $packageJsonPath"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# 1. Read current version from src-tauri/tauri.conf.json
$tauriContent = [System.IO.File]::ReadAllText($tauriConfPath, $utf8NoBom)
if ($tauriContent -notmatch '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)(-[^"]*)?"') {
    throw "Could not parse current version from $tauriConfPath"
}

$major = [int]$matches[1]
$minor = [int]$matches[2]
$patch = [int]$matches[3]
$oldVersion = "$major.$minor.$patch"

# 2. Determine new version
$newVersion = ''
if ($TargetVersion -ne '') {
    if ($TargetVersion -notmatch '^\d+\.\d+\.\d+') {
        throw "Invalid target version format '$TargetVersion'. Expected semantic version (e.g. 2.1.2)."
    }
    $newVersion = $TargetVersion
} else {
    switch ($Type) {
        'major' { $newVersion = "$($major + 1).0.0" }
        'minor' { $newVersion = "$major.$($minor + 1).0" }
        'patch' { $newVersion = "$major.$minor.$($patch + 1)" }
    }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Orbital X Version Bump" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Current Version: $oldVersion"
Write-Host "New Version:     $newVersion ($Type bump)" -ForegroundColor Green

if ($DryRun) {
    Write-Host "`n[DRY RUN] No files were modified." -ForegroundColor Yellow
    return $newVersion
}

# 3. Update src-tauri/tauri.conf.json
$oldTauriPattern = '"version": "' + $oldVersion + '"'
$newTauriPattern = '"version": "' + $newVersion + '"'
if (-not $tauriContent.Contains($oldTauriPattern)) {
    throw "Target pattern '$oldTauriPattern' not found in $tauriConfPath"
}
$updatedTauriContent = $tauriContent.Replace($oldTauriPattern, $newTauriPattern)
[System.IO.File]::WriteAllText($tauriConfPath, $updatedTauriContent, $utf8NoBom)
Write-Host "[OK] Updated src-tauri/tauri.conf.json" -ForegroundColor Green

# 4. Update package.json
$packageContent = [System.IO.File]::ReadAllText($packageJsonPath, $utf8NoBom)
$oldPkgPattern = '"version": "' + $oldVersion + '"'
$newPkgPattern = '"version": "' + $newVersion + '"'
if (-not $packageContent.Contains($oldPkgPattern)) {
    throw "Target pattern '$oldPkgPattern' not found in $packageJsonPath"
}
$updatedPackageContent = $packageContent.Replace($oldPkgPattern, $newPkgPattern)
[System.IO.File]::WriteAllText($packageJsonPath, $updatedPackageContent, $utf8NoBom)
Write-Host "[OK] Updated package.json" -ForegroundColor Green

# 5. Update src-tauri/Cargo.toml (if present)
if (Test-Path $cargoTomlPath) {
    $cargoContent = [System.IO.File]::ReadAllText($cargoTomlPath, $utf8NoBom)
    $oldCargoPattern = 'version = "' + $oldVersion + '"'
    $newCargoPattern = 'version = "' + $newVersion + '"'
    if ($cargoContent.Contains($oldCargoPattern)) {
        $updatedCargoContent = $cargoContent.Replace($oldCargoPattern, $newCargoPattern)
        [System.IO.File]::WriteAllText($cargoTomlPath, $updatedCargoContent, $utf8NoBom)
        Write-Host "[OK] Updated src-tauri/Cargo.toml" -ForegroundColor Green
    }
}

Write-Host "`nSuccessfully bumped release version to $newVersion" -ForegroundColor Yellow
return $newVersion
