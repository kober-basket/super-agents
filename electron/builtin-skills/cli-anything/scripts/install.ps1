$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDir = Split-Path -Parent $scriptDir

$superAgentsHome = if ($env:SUPER_AGENTS_HOME) {
    $env:SUPER_AGENTS_HOME
} elseif ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE ".super-agents"
} else {
    throw "SUPER_AGENTS_HOME is not set and USERPROFILE is unavailable."
}

$destRoot = Join-Path $superAgentsHome "skills"
$destDir = Join-Path $destRoot "cli-anything"

New-Item -ItemType Directory -Path $destRoot -Force | Out-Null

if (Test-Path $destDir) {
    Write-Error "Refusing to overwrite existing skill: $destDir`nRemove it manually if you want to reinstall."
}

Copy-Item -Path $skillDir -Destination $destDir -Recurse

Write-Host "Installed Super Agents skill to: $destDir"
Write-Host "Restart Super Agents to pick up the new skill."
