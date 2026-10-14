<#
.SYNOPSIS
  Uninstall dsh-feishu from the active DeepSeek Harness profile.

.DESCRIPTION
  Removes the package directory, the managed block in cordis.patch.yml, and the
  companion skill. The stored user grant is left alone; pass -PurgeCredential to
  name the credential file so it can be edited, since the harness owns it.

.PARAMETER ProfileDir
  The profile directory to uninstall from. Defaults to DSH_PROFILE_DIR, then
  DSH_HOME/profiles/desktop.

.PARAMETER AgentsHome
  The agents home whose skills directory held the companion skill.

.PARAMETER NoSkill
  Leave the companion skill in place.
#>
[CmdletBinding()]
param(
  [string] $ProfileDir,
  [string] $AgentsHome = $env:USERPROFILE,
  [switch] $NoSkill
)

$ErrorActionPreference = 'Stop'

$pluginName = 'dsh-feishu'
$marker = '# >>> dsh-feishu'
$endMarker = '# <<< dsh-feishu'

if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
  if (-not [string]::IsNullOrWhiteSpace($env:DSH_PROFILE_DIR)) {
    $ProfileDir = $env:DSH_PROFILE_DIR
  } elseif (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    $ProfileDir = Join-Path $env:DSH_HOME 'profiles\desktop'
  } else {
    $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
  }
}

$target = Join-Path $ProfileDir ('node_modules\' + $pluginName)
$patch = Join-Path $ProfileDir 'cordis.patch.yml'

Write-Host 'dsh-feishu uninstaller'

# --- 1. remove the package ------------------------------------------------
if (Test-Path -LiteralPath $target) {
  $expectedSuffix = Join-Path 'node_modules' $pluginName
  if (-not $target.EndsWith($expectedSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw ('refusing to remove an unexpected path: ' + $target)
  }
  Write-Host ('  removing ' + $target)
  Remove-Item -LiteralPath $target -Recurse -Force
} else {
  Write-Host '  package directory not present'
}

# --- 2. strip the managed block ------------------------------------------
if (Test-Path -LiteralPath $patch) {
  $lines = Get-Content -LiteralPath $patch
  $kept = New-Object System.Collections.Generic.List[string]
  $skipping = $false
  $removed = 0
  foreach ($line in $lines) {
    if ($line -like ($marker + '*')) { $skipping = $true; $removed++ ; continue }
    if ($skipping) {
      if ($line -like ($endMarker + '*')) { $skipping = $false }
      $removed++
      continue
    }
    $kept.Add($line)
  }
  if ($removed -gt 0) {
    while ($kept.Count -gt 0 -and [string]::IsNullOrWhiteSpace($kept[$kept.Count - 1])) {
      $kept.RemoveAt($kept.Count - 1)
    }
    Set-Content -LiteralPath $patch -Value $kept -Encoding UTF8
    Write-Host ('  removed ' + $removed + ' line(s) from cordis.patch.yml')
  } else {
    Write-Host '  cordis.patch.yml has no managed dsh-feishu block'
  }
}

# --- 3. remove the skill --------------------------------------------------
if (-not $NoSkill) {
  $skillDir = Join-Path (Join-Path $AgentsHome '.agents\skills') 'feishu'
  if (Test-Path -LiteralPath $skillDir) {
    Write-Host ('  removing skill ' + $skillDir)
    Remove-Item -LiteralPath $skillDir -Recurse -Force
  }
}

Write-Host ''
Write-Host 'Done. Restart DeepSeek Harness to unload the plugin.'
Write-Host 'The stored Feishu user grant (the credential record dsh-feishu/user-token)'
Write-Host 'was left in place; use feishu_auth with action "logout" before uninstalling'
Write-Host 'if you want it gone.'
