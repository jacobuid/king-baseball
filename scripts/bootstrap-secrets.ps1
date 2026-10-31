param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$File = '.env.bootstrap'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $File)) { throw 'Copy .env.bootstrap.example to .env.bootstrap and fill it first.' }
$values = @{}
Get-Content -LiteralPath $File | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) { $parts = $line.Split('=', 2); $values[$parts[0]] = $parts[1] }
}
$secretNames = @('CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLERK_SECRET_KEY','CLERK_PUBLISHABLE_KEY','B2_BOOTSTRAP_KEY_ID','B2_BOOTSTRAP_APPLICATION_KEY','PULUMI_ACCESS_TOKEN')
$tempFile = New-TemporaryFile
try {
  $secretNames | ForEach-Object { if (-not $values[$_]) { throw "Missing value: $_" }; Add-Content -LiteralPath $tempFile -Value "$_=$($values[$_])" }
  gh secret set --repo $Repo --env-file $tempFile
} finally { Remove-Item -LiteralPath $tempFile -Force }
if (-not $values['VITE_CLERK_PUBLISHABLE_KEY']) { throw 'Missing value: VITE_CLERK_PUBLISHABLE_KEY' }
gh variable set VITE_CLERK_PUBLISHABLE_KEY --repo $Repo --body $values['VITE_CLERK_PUBLISHABLE_KEY']
if ($values['VITE_API_URL']) { gh variable set VITE_API_URL --repo $Repo --body $values['VITE_API_URL'] }
Write-Host "Bootstrap credentials installed for $Repo"
