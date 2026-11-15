# Read Windows DPAPI-protected secret backup belonging to the current user.
# Copies only the OAuth owner password to clipboard; does not print it.
$ErrorActionPreference = 'Stop'
$store = Join-Path (Join-Path $env:APPDATA 'LyftaMCP') 'owner-secrets.dpapi.clixml'
if (!(Test-Path $store)) { throw "No owner credentials found at $store" }
$entry = Import-Clixml -Path $store
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($entry.OwnerPassword)
try {
  $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  Set-Clipboard -Value $pass
  Write-Output 'Owner password copied to clipboard. Paste it only into your private OAuth consent page.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable pass -ErrorAction SilentlyContinue
}
