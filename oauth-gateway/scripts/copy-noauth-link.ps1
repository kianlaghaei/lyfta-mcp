# Copies the no-auth MCP URL. Never outputs the secret URL to the terminal.
$ErrorActionPreference = 'Stop'
$store = Join-Path (Join-Path $env:APPDATA 'LyftaMCP') 'owner-secrets.dpapi.clixml'
if (!(Test-Path $store)) {throw 'Owner credential backup missing'}
$entry = Import-Clixml -Path $store
if (-not ($entry.PSObject.Properties.Name -contains 'LinkSlug')) {throw 'Connector URL is not provisioned'}
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($entry.LinkSlug)
try {
  $slug = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $url = 'https://lyfta-personal-oauth.gjj7ogw34hqeaa0wlh0zfn.workers.dev/connect/' + $slug + '/mcp'
  Set-Clipboard -Value $url
  Write-Output 'Private MCP URL copied to clipboard. Select No authentication in ChatGPT.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Variable slug,url -ErrorAction SilentlyContinue
}
