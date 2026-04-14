# Termina solo processi node.exe legati a questa cartella progetto (sblocca spesso .next su Windows).
$ErrorActionPreference = "SilentlyContinue"
$projectRoot = Split-Path $PSScriptRoot -Parent
$needle = [regex]::Escape($projectRoot)

foreach ($p in Get-CimInstance Win32_Process -Filter "Name = 'node.exe'") {
  $cmd = $p.CommandLine
  if ($null -eq $cmd) { continue }
  if ($cmd -match $needle) {
    Stop-Process -Id $p.ProcessId -Force
    Write-Host "  Chiuso Node PID $($p.ProcessId) (progetto: $projectRoot)"
  }
}
