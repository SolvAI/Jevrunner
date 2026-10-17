# Stops H2O Lightning 4B on Windows (the launcher, llama-server and the shim), for example one kept with KEEP_H2O=1.
#   powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
$pattern = 'llamacpp\.py.*serve|h2o_lightning_llamacpp\.py|llama-server.*h2o-lightning-4b'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "Stopped $(@($procs).Count) process(es)."
