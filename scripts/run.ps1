# Starts everything on Windows: H2O Lightning 4B on llama.cpp (unless it is already up), then the game at
# http://localhost:5175. Ctrl-C stops the game and the model this script started ($env:KEEP_H2O = '1' keeps the model).
# With DECIDE_URL set in config.env (another System One endpoint), only the game starts.
#   powershell -ExecutionPolicy Bypass -File scripts\run.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

# config.env (KEY=VALUE lines) into this process's environment, for the game's server and the model's launcher
$configFile = Join-Path $Root 'config.env'
if (Test-Path $configFile) {
  foreach ($line in Get-Content $configFile) {
    $line = $line.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $key, $value = $line.Split('=', 2)
      $key = $key.Trim() -replace '^export\s+', ''
      if (-not [Environment]::GetEnvironmentVariable($key)) {
        [Environment]::SetEnvironmentVariable($key, $value.Trim().Trim('"').Trim("'"))
      }
    }
  }
}
if (-not (Test-Path (Join-Path $Root 'node_modules'))) { Fail 'run scripts\setup.ps1 first' }
$port = if ($env:H2O_PORT) { $env:H2O_PORT } else { '8741' }
$gamePort = if ($env:GAME_PORT) { $env:GAME_PORT } else { '5175' }
$home_ = if ($env:JEVRUNNER_HOME) { $env:JEVRUNNER_HOME } else { Join-Path $HOME '.jevrunner' }
$logs = Join-Path $home_ 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Test-H2O {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/health").StatusCode -eq 200 }
  catch { return $false }
}
function Find-Python {
  foreach ($candidate in @(@('py', '-3'), @('python'))) {
    if (Get-Command $candidate[0] -ErrorAction SilentlyContinue) { return , $candidate }
  }
  return $null
}

$serve = $null
try {
  if ($env:DECIDE_URL) {
    Say "Using the model at $env:DECIDE_URL"
  } elseif (Test-H2O) {
    Say "H2O is already running on :$port"
  } else {
    $py = Find-Python
    if (-not $py) { Fail 'Python 3.10+ is needed' }
    $log = Join-Path $logs 'h2o.log'
    Say 'Starting H2O Lightning 4B on llama.cpp (about a minute)'
    Say "Its log: $log"
    $arguments = @($py | Select-Object -Skip 1) + @("`"$(Join-Path $Root 'scripts\llamacpp.py')`"", 'serve')
    $serve = Start-Process -FilePath $py[0] -ArgumentList $arguments -NoNewWindow -PassThru `
      -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    $started = Get-Date
    while (-not (Select-String -Path $log -Pattern 'ready on' -Quiet -ErrorAction SilentlyContinue)) {
      if ($serve.HasExited) {
        Get-Content $log -Tail 20 -ErrorAction SilentlyContinue
        Get-Content "$log.err" -Tail 20 -ErrorAction SilentlyContinue
        Fail 'H2O stopped while starting (the end of its log is above; see Troubleshooting in the README)'
      }
      Write-Host -NoNewline ("`r    waiting for H2O... {0:N0}s " -f ((Get-Date) - $started).TotalSeconds)
      Start-Sleep -Seconds 2
    }
    Write-Host ''
    Say "H2O is ready on :$port"
  }
  $label = if ($env:MODEL_LABEL) { $env:MODEL_LABEL } else { 'H2O' }
  Say "The game: http://localhost:$gamePort (press LET $label RUN)"
  npm run dev
} finally {
  if ($serve -and -not $serve.HasExited -and $env:KEEP_H2O -ne '1') {
    Say 'Stopping H2O'
    taskkill /PID $serve.Id /T /F | Out-Null  # the launcher and its llama-server and shim
  }
}
