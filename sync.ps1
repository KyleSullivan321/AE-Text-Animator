# Re-copy the extension into AE's CEP extensions folder (dev install without a symlink).
$src  = $PSScriptRoot
$dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.kylesullivan.aetextanimator"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($item in 'CSXS','client','host','.debug') {
  $p = Join-Path $src $item
  if (Test-Path $p) {
    Remove-Item (Join-Path $dest $item) -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path $p -Destination $dest -Recurse -Force
  }
}
Write-Output "Synced -> $dest"
