# Rotate ONLY the OAuth owner password to a user-friendly, strongly random 20-character credential.
# The Cloudflare Worker-to-Worker bearer and Lyfta key remain unchanged.
# Password stays private and is saved with Windows DPAPI for the current user.
$ErrorActionPreference='Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$store = Join-Path (Join-Path $env:APPDATA 'LyftaMCP') 'owner-secrets.dpapi.clixml'
if (!(Test-Path $store)) { throw 'Encrypted owner credential backup not found' }
$entry = Import-Clixml -Path $store
$alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
$limit = [Math]::Floor(256/$alphabet.Length)*$alphabet.Length
$builder = New-Object System.Text.StringBuilder
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  while ($builder.Length -lt 20) {
    $bytes = New-Object byte[] 1
    $rng.GetBytes($bytes)
    if ([int]$bytes[0] -lt $limit) {
      [void]$builder.Append($alphabet[[int]$bytes[0] % $alphabet.Length])
    }
  }
} finally { $rng.Dispose() }
$password = $builder.ToString()
$pending = "$store.pending"
[pscustomobject]@{
  OwnerPassword = (ConvertTo-SecureString $password -AsPlainText -Force)
  McpToken = $entry.McpToken
} | Export-Clixml -Path $pending
Push-Location (Join-Path $repo 'oauth-gateway')
try {
  $password | npx wrangler secret put OAUTH_OWNER_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare secret update failed; backup was left untouched' }
} finally { Pop-Location }
Move-Item -Path $pending -Destination $store -Force
Write-Output 'OAuth owner password rotated to a strong, 20-character copy-friendly secret.'
Write-Output 'Saved only in Cloudflare Secrets and the current user Windows DPAPI backup.'
Write-Output 'Use copy-owner-password.ps1 to copy it to the clipboard. No secret value was printed.'
