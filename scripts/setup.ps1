# One-time setup on Windows: the game's Node packages, then H2O Lightning 4B on llama.cpp: a prebuilt llama.cpp for
# your GPU (CUDA for NVIDIA, Vulkan for AMD and Intel, else the CPU) and the GGUF (Q8_0 4.5 GB by default; set
# QUANT=Q4_K_M in config.env for 2.7 GB on a small GPU). Safe to run again. Needs Node.js 22+ and Python 3.10+.
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

# Python: the "py" launcher from python.org, else "python" (not the Microsoft Store placeholder, which only opens the Store)
function Find-Python {
  foreach ($candidate in @(@('py', '-3'), @('python'))) {
    if (Get-Command $candidate[0] -ErrorAction SilentlyContinue) {
      $rest = @($candidate | Select-Object -Skip 1)
      try {
        $ok = & $candidate[0] @rest -c 'import sys; print(int(sys.version_info >= (3, 10)))' 2>$null
        if ("$ok".Trim() -eq '1') { return , $candidate }
      } catch { }
    }
  }
  return $null
}

Say 'Checking the machine'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 22+ is needed: winget install OpenJS.NodeJS.LTS (then open a new terminal)' }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Fail "Node.js 22+ is needed, found $(node -v)" }
$py = Find-Python
if (-not $py) { Fail 'Python 3.10+ is needed: winget install Python.Python.3.12 (then open a new terminal)' }
$pyArgs = @($py | Select-Object -Skip 1)
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | ForEach-Object { "    GPU: $_" }
}

Say '1/2 Node packages'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }

Say '2/2 llama.cpp and the GGUF'
& $py[0] @pyArgs (Join-Path $Root 'scripts\llamacpp.py') setup
if ($LASTEXITCODE -ne 0) { Fail 'the llama.cpp setup failed (see above)' }

Say 'Ready. Start everything with: powershell -ExecutionPolicy Bypass -File scripts\run.ps1'
