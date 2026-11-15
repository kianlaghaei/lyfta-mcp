# One-time setup of an unguessable MCP URL. This is a secret URL, not a login password.
# Never print or commit the URL; anyone with it could read/write the connected Lyfta account.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$store = Join-Path (Join-Path $env:APPDATA 'LyftaMCP') 'owner-secrets.dpapi.clixml'
if (!(Test-Path $store)) {throw 'Owner DPAPI backup is required'}
$entry = Import-Clixml -Path $store
if ($entry.PSObject.Properties.Name -contains 'LinkSlug') {
  throw 'Connector link is already provisioned. Use copy-noauth-link.ps1 instead.'
}
$bytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
$slug = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$pending = "$store.pending"
[pscustomobject]@{
  OwnerPassword = $entry.OwnerPassword
  McpToken = $entry.McpToken
  LinkSlug = (ConvertTo-SecureString -String $slug -AsPlainText -Force)
} | Export-Clixml -Path $pending
Push-Location (Join-Path $repo 'oauth-gateway')
try {
  $slug | npx wrangler secret put MCP_LINK_SLUG
  if ($LASTEXITCODE -ne 0) {throw 'Unable to add secret MCP_LINK_SLUG'}
} finally {Pop-Location}
Move-Item -Force -Path $pending -Destination $store
Write-Output 'Passwordless ChatGPT connector URL enabled.'
Write-Output 'The unguessable URL was saved to your Windows-protected credentials; it was not printed.'
Write-Output 'To copy the entire MCP URL, run scripts/copy-noauth-link.ps1.'
