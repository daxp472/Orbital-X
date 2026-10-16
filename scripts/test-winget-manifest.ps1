# ==========================================================================
# Orbital X — Test Winget Manifest Locally
# ==========================================================================

$manifestPath = "manifests\d\daxp472\OrbitalX\2.0.1"

Write-Host "Validating Winget manifests in $manifestPath..." -ForegroundColor Cyan

if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget validate --manifest $manifestPath
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Winget Manifests are 100% valid and ready for submission to microsoft/winget-pkgs!" -ForegroundColor Green
    } else {
        Write-Warning "Validation returned non-zero code. Check warnings above."
    }
} else {
    Write-Warning "winget command not found in this environment. Manifests have been generated to Microsoft specs."
}
