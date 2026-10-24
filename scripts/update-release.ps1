$credInput = @"
protocol=https
host=github.com
"@

$credOutput = $credInput | git credential fill
$token = ""
foreach ($line in ($credOutput -split "`n")) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("password=")) {
        $token = $trimmed.Substring("password=".Length)
        break
    }
}

if (-not $token) {
    throw "GitHub token could not be retrieved from git credential helper."
}

$bodyContent = [System.IO.File]::ReadAllText("RELEASE_NOTES_v2.2.2.md", [System.Text.Encoding]::UTF8)

$payloadObj = @{
    name = "Orbital X v2.2.2 - Official Multi-Platform Release"
    body = $bodyContent
    make_latest = "true"
}

$payloadJson = $payloadObj | ConvertTo-Json -Depth 5

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "Orbital-X-Release-Agent"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$uri = "https://api.github.com/repos/daxp472/Orbital-X/releases/422660190"

$response = Invoke-RestMethod -Uri $uri -Method Patch -Headers $headers -Body $payloadJson -ContentType "application/json; charset=utf-8"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " GitHub Release v2.2.2 Successfully Updated" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Release Title: " $response.name
Write-Host "Tag:           " $response.tag_name
Write-Host "URL:           " $response.html_url
Write-Host "Assets Count:  " $response.assets.Count
Write-Host "Body Updated:  " ($response.body.Length -gt 100)
