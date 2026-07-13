# Dev install (Windows)

Load the unsigned extension into After Effects for development.

## 1. Allow unsigned CEP extensions

Set `PlayerDebugMode = 1` for the CSXS versions AE uses (10/11/12 cover recent AE).
Run in an admin PowerShell (or use `reg add`):

```powershell
foreach ($n in 10,11,12) {
  New-Item -Path "HKCU:\Software\Adobe\CSXS.$n" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$n" -Name PlayerDebugMode -Value 1 -Type String
}
```

## 2. Put the extension where AE looks for it

Copy or symlink this project folder into the per-user CEP extensions folder:

```
%APPDATA%\Adobe\CEP\extensions\com.kylesullivan.aetextanimator
```

Symlink (admin PowerShell) so edits are live:

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:APPDATA\Adobe\CEP\extensions\com.kylesullivan.aetextanimator" `
  -Target "C:\General\Claude Code Projects\AE Text Animator"
```

## 3. Open it

Restart After Effects → **Window → Extensions → AE Text Animator**.

- The panel header should read `engine ready — AE <version>` (confirms the
  ExtendScript engine loaded).
- Make a comp, add a text layer, select it, click **Animate in**.

## 4. Debug the panel

The `.debug` file exposes port **8088**. Open Chrome at
`http://localhost:8088` to inspect the panel (console, DOM) while AE runs.

## Notes

- Distribution later: sign into a `.zxp` with `ZXPSignCmd` and ship an installer
  (ZXP is required for machines without PlayerDebugMode).
- The `ScriptPath` in `CSXS/manifest.xml` auto-loads `host/textanimator.jsx` into
  AE's ExtendScript engine when the panel opens, exposing `TA_animate` / `TA_ping`.
