# Package the CEP extension into a signed .zxp for distribution (sale-ready).
#
# Uses Adobe's free ZXPSignCmd. Produces a self-signed, timestamped .zxp — the
# standard indie distribution format (Gumroad / aescripts / direct). Buyers install
# with a free ZXP installer (Anastasiy's Extension Manager, ZXP Installer).
#
#   .\package.ps1                    # build build\AE-Text-Animator_<version>.zxp
#   .\package.ps1 -Version 1.0.0     # override version (also stamps the manifest)
#
# The timestamp (-tsa) matters for a paid product: without it the signature stops
# validating when the cert expires. A self-signed cert is fine to sell; buy a real
# code-signing cert only to drop the "unverified publisher" note at install.

param(
  [string]$Version,
  [string]$ZXP  = "C:\tools\ZXPSignCmd.exe",
  [string]$CertPassword = "aeta-dev",
  [string]$Tsa  = "http://timestamp.digicert.com",
  # Bundle .debug so the panel can be inspected with remote devtools. TEST BUILDS
  # ONLY -- it opens a localhost port in the user's After Effects. Output is named
  # -debug.zxp so it can't be mistaken for a release.
  [switch]$IncludeDebug
)

$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$build = Join-Path $root "build"
$stage = Join-Path $build "staging"
$cert  = Join-Path $build "cert.p12"

if (-not (Test-Path $ZXP)) { throw "ZXPSignCmd not found at $ZXP. Pass -ZXP <path>." }

# Version: manifest is source of truth unless overridden.
$manifestPath = Join-Path $root "CSXS\manifest.xml"
[xml]$manifest = Get-Content $manifestPath
if ($Version) {
  $manifest.ExtensionManifest.ExtensionBundleVersion = $Version
  $manifest.ExtensionManifest.ExtensionList.Extension.Version = $Version
  $manifest.Save($manifestPath)
} else {
  $Version = $manifest.ExtensionManifest.ExtensionBundleVersion
}
Write-Output "Packaging version $Version"

# Clean staging: ship only the runtime files (no .git/.claude/.debug/docs/scripts).
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($item in 'CSXS','client','host') {
  Copy-Item -Path (Join-Path $root $item) -Destination $stage -Recurse -Force
}
if ($IncludeDebug) {
  Copy-Item -Path (Join-Path $root ".debug") -Destination $stage -Force
  Write-Warning "TEST BUILD: bundling .debug (remote devtools port). Do not ship this file."
}

# Self-signed cert (generate once; reuse so the publisher identity stays stable).
if (-not (Test-Path $cert)) {
  Write-Output "Generating self-signed certificate..."
  & $ZXP -selfSignedCert US WA "Kyle Sullivan Design" "Kyle Sullivan" $CertPassword $cert -validityDays 3650
  if ($LASTEXITCODE -ne 0) { throw "Certificate generation failed." }
}

# Sign.
$suffix = if ($IncludeDebug) { "-debug" } else { "" }
$out = Join-Path $build "AE-Text-Animator_$Version$suffix.zxp"
if (Test-Path $out) { Remove-Item $out -Force }
Write-Output "Signing -> $out"
& $ZXP -sign $stage $out $cert $CertPassword -tsa $Tsa
if ($LASTEXITCODE -ne 0) { throw "Signing failed (exit $LASTEXITCODE)." }

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Output "Done: $out ($size KB)"
