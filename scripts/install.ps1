<#
.SYNOPSIS
  Install dsh-feishu into the active DeepSeek Harness profile.

.DESCRIPTION
  Copies the package into the profile's node_modules (a real directory, not a
  junction, because a junctioned plugin resolves bare specifiers from its real
  path and would miss the SDK) and adds a managed entry to cordis.patch.yml.

  Also installs the companion skill into the user skills root, unless -NoSkill
  is passed.

  Run this from the plugin repository root:
    pwsh -File scripts/install.ps1

.PARAMETER ProfileDir
  The profile directory to install into. Defaults to DSH_PROFILE_DIR, then
  DSH_HOME/profiles/desktop.

.PARAMETER AgentsHome
  The agents home whose skills directory receives the companion skill. Defaults
  to the user profile directory.

.PARAMETER NoSkill
  Skip installing the companion skill.

.PARAMETER NoRestart
  Only print the restart reminder instead of emphasising it.
#>
[CmdletBinding()]
param(
  [string] $ProfileDir,
  [string] $AgentsHome = $env:USERPROFILE,
  [switch] $NoSkill,
  [switch] $NoRestart
)

$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$pluginName = 'dsh-feishu'
$marker = '# >>> dsh-feishu'

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
$skillTarget = Join-Path (Join-Path $AgentsHome '.agents\skills') 'feishu'

Write-Host 'dsh-feishu installer'
Write-Host ('  source : ' + $pluginRoot)
Write-Host ('  profile: ' + $ProfileDir)
Write-Host ''

if (-not (Test-Path -LiteralPath $ProfileDir)) {
  throw ('the profile directory does not exist: ' + $ProfileDir + ' (pass -ProfileDir to override)')
}

# --- 1. copy the package -------------------------------------------------
$resolvedTarget = $target
if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'node_modules'))) {
  New-Item -ItemType Directory -Force -Path (Join-Path $ProfileDir 'node_modules') | Out-Null
}

# Verify the destination is the intended path before removing anything there.
$expectedSuffix = Join-Path 'node_modules' $pluginName
if (-not $resolvedTarget.EndsWith($expectedSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw ('refusing to write to an unexpected path: ' + $resolvedTarget)
}
if (Test-Path -LiteralPath $resolvedTarget) {
  Write-Host ('  replacing ' + $resolvedTarget)
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
} else {
  Write-Host ('  creating  ' + $resolvedTarget)
}
New-Item -ItemType Directory -Force -Path $resolvedTarget | Out-Null

foreach ($item in @('package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'lib', 'skill', 'scripts', 'test')) {
  $source = Join-Path $pluginRoot $item
  if (-not (Test-Path -LiteralPath $source)) { continue }
  $destination = Join-Path $resolvedTarget $item
  if ((Get-Item -LiteralPath $source).PSIsContainer) {
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
  } else {
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}
Write-Host '  package copied'

# --- 2. patch cordis.patch.yml -------------------------------------------
if (-not (Test-Path -LiteralPath $patch)) {
  Write-Host ('  creating ' + $patch)
  Set-Content -LiteralPath $patch -Value '# Your patch layer for this dsh profile.' -Encoding UTF8
}

$patchText = Get-Content -LiteralPath $patch -Raw
if ($patchText -like ('*' + $marker + '*')) {
  Write-Host '  cordis.patch.yml already carries the dsh-feishu entry; left as it is'
} else {
  # Keep the concatenation in its own variable: inside @(), PowerShell's comma
  # binds tighter than +, which would split this line into two array elements.
  $header = $marker + ' (managed by the dsh-feishu settings page - do not edit by hand)'
  $block = @(
    '',
    $header,
    '- insert:',
    '    - id: feishu',
    '      name: dsh-feishu',
    '      config:',
    "        appId: ''            # your Feishu app id (cli_...)",
    '        # appSecretRef: FEISHU_APP_SECRET',
    '        # brand: feishu        # or lark',
    '        # defaultFolderToken: fldcn...',
    '# <<< dsh-feishu'
  ) -join [Environment]::NewLine
  Add-Content -LiteralPath $patch -Value $block -Encoding UTF8
  Write-Host '  added the dsh-feishu insert entry to cordis.patch.yml'
  Write-Host '  -> fill in config.appId (and set the app secret under the credential reference)'
}

# --- 3. companion skill ---------------------------------------------------
if (-not $NoSkill) {
  $skillSource = Join-Path $pluginRoot 'skill\SKILL.md'
  if (Test-Path -LiteralPath $skillSource) {
    New-Item -ItemType Directory -Force -Path $skillTarget | Out-Null
    Copy-Item -LiteralPath $skillSource -Destination (Join-Path $skillTarget 'SKILL.md') -Force
    Write-Host ('  skill installed at ' + $skillTarget)
  }
}

Write-Host ''
if ($NoRestart) {
  Write-Host 'Done. Restart DeepSeek Harness to load the host half.'
} else {
  Write-Host 'Done.'
  Write-Host ''
  Write-Host 'NEXT: restart DeepSeek Harness. The host half is a Node module cached in'
  Write-Host '      process, so it is only loaded at startup. Then run feishu_auth with'
  Write-Host '      action "status" to confirm the app credentials and authorize a user.'
}
