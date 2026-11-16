# One-time production secret provisioning. Run locally as the owner after BOTH Workers are deployed.
# No secrets are printed or committed. PSCredential-like SecureStrings are DPAPI-encrypted for the current Windows user.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$storeDir = Join-Path $env:APPDATA 'LyftaMCP'
$store = Join-Path $storeDir 'owner-secrets.dpapi.clixml'
if (Test-Path $store) { throw "Existing protected secret backup detected at $store. Refusing to rotate credentials." }
New-Item -Path $storeDir -ItemType Directory -Force | Out-Null

function New-SecureRandomString {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
$gatewayPassword = New-SecureRandomString
$mcpToken = New-SecureRandomString

# Backup before provisioning in case a network/CLI error occurs mid-operation.
[pscustomobject]@{
  OwnerPassword = (ConvertTo-SecureString -String $gatewayPassword -AsPlainText -Force)
  McpToken = (ConvertTo-SecureString -String $mcpToken -AsPlainText -Force)
} | Export-Clixml -Path $store
Write-Output "Credentials backed up with Windows DPAPI at $store"
Write-Output "Provisioning private Worker-to-Worker token; secrets are not printed."

Push-Location (Join-Path $repo 'worker')
try {
  $mcpToken | npx wrangler secret put MCP_ACCESS_TOKEN
  if ($LASTEXITCODE -ne 0) { throw 'Failed to provision main Worker token' }
} finally { Pop-Location }

Push-Location (Join-Path $repo 'oauth-gateway')
try {
  $mcpToken | npx wrangler secret put MCP_ACCESS_TOKEN
  if ($LASTEXITCODE -ne 0) { throw 'Failed to provision gateway Worker token' }
  $gatewayPassword | npx wrangler secret put OAUTH_OWNER_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Failed to provision gateway owner password' }
} finally { Pop-Location }

Write-Output "Worker-to-Worker token and OAuth owner passphrase configured."
Write-Output "Lyfta API key is NOT provisioned. Owner must supply it securely via 'npx wrangler secret put LYFTA_API_KEY' in worker/."
Write-Output "To copy the owner password to clipboard locally, see oauth-gateway/scripts/copy-owner-password.ps1."
