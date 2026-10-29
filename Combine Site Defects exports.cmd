<# : Site Defects - combine exports. Double-click to run. (These first lines start PowerShell on the rest of the file.)
@echo off
setlocal
set "SD_SCRIPT=%~f0"
set "SD_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText($env:SD_SCRIPT))"
echo.
pause
exit /b
#>

# ---------------------------------------------------------------------------------------------
# Site Defects - combine exports  (for app version 1.7.1 and later; tool version 1.7.4b)
#
# What it does:
#  1. Finds Site Defects export ZIPs: the ones dragged onto this file, otherwise every ZIP in the
#     folder this file is in, otherwise every ZIP in Downloads.
#  2. Unpacks them all into ONE folder per project (default C:\Inspections\<project> Inspection),
#     so photos from every export and every inspector end up in the same Photos\Unit\Component tree.
#     Files that are already there are skipped. Photos are never overwritten. A spreadsheet is
#     replaced only by a newer spreadsheet with the same name.
#  3. Keeps only the newest spreadsheet for each inspector (older copies are still inside the ZIPs).
#  4. Writes a receipt listing every photo now in the folder. Send it to each inspector and load it
#     in the app (Menu > Load PC receipt): the phone then clears only photos the PC really has.
#
# It only reads the ZIPs and writes into the destination folder. It never sends anything anywhere.
# ---------------------------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

Write-Host ''
Write-Host 'Site Defects - combine exports' -ForegroundColor Cyan
Write-Host '------------------------------'

# ---- 1. find the ZIPs ----
$zips = New-Object System.Collections.Generic.List[object]
$argText = [string]$env:SD_ARGS
foreach ($m in [regex]::Matches($argText, '"([^"]+)"|(\S+)')) {
  $a = $m.Groups[2].Value
  if ($m.Groups[1].Success) { $a = $m.Groups[1].Value }
  if (Test-Path -LiteralPath $a -PathType Container) { Get-ChildItem -LiteralPath $a -Filter *.zip -File | ForEach-Object { $zips.Add($_) } }
  elseif ($a -like '*.zip' -and (Test-Path -LiteralPath $a)) { $zips.Add((Get-Item -LiteralPath $a)) }
}
$from = 'the files you dropped'
if ($zips.Count -eq 0) {
  $from = Split-Path -Parent $env:SD_SCRIPT
  Get-ChildItem -LiteralPath $from -Filter *.zip -File | ForEach-Object { $zips.Add($_) }
}
if ($zips.Count -eq 0) {
  $from = Join-Path $env:USERPROFILE 'Downloads'
  if (Test-Path -LiteralPath $from) { Get-ChildItem -LiteralPath $from -Filter *.zip -File | ForEach-Object { $zips.Add($_) } }
}

# keep only Site Defects exports: every entry sits under one "<project> Inspection" folder
$found = New-Object System.Collections.Generic.List[object]
foreach ($z in $zips) {
  try {
    $arc = [IO.Compression.ZipFile]::OpenRead($z.FullName)
    try {
      $roots = @($arc.Entries | ForEach-Object { (($_.FullName -replace '\\', '/') -split '/')[0] } | Select-Object -Unique)
      if ($roots.Count -eq 1 -and $roots[0] -like '* Inspection') { $found.Add([pscustomobject]@{ Zip = $z; Root = $roots[0] }) }
    } finally { $arc.Dispose() }
  } catch { Write-Host ('  Skipped (not a readable ZIP): ' + $z.Name) -ForegroundColor Yellow }
}
if ($found.Count -eq 0) {
  Write-Host ('No Site Defects export ZIPs found in ' + $from + '.') -ForegroundColor Yellow
  Write-Host 'Put this file in the folder that holds the ZIPs (or drag the ZIPs onto it) and run it again.'
  return
}
$projects = @($found | ForEach-Object { $_.Root } | Select-Object -Unique)
Write-Host ('Found ' + $found.Count + ' export ZIP(s) in ' + $from + ':')
foreach ($f in $found) { Write-Host ('  ' + $f.Zip.Name) }
Write-Host ''

# ---- 2. destination ----
$base = 'C:\Inspections'
$ans = Read-Host ('Combine into ' + $base + ' ?  Press Enter for yes, or type another folder')
if ($ans -and $ans.Trim()) { $base = $ans.Trim().Trim('"') }
New-Item -ItemType Directory -Force -Path $base | Out-Null

# ---- spreadsheets open in Excel can't be replaced: ask for them to be closed first ----
function Test-Locked([string]$path) {
  try { $fs = [IO.File]::Open($path, 'Open', 'ReadWrite', 'None'); $fs.Close(); return $false } catch { return $true }
}
function Get-OpenSheets {
  $open = New-Object System.Collections.Generic.List[string]
  foreach ($root in $projects) {
    $dir = Join-Path $base $root
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($x in @(Get-ChildItem -LiteralPath $dir -Filter '*.xlsx' -File -ErrorAction SilentlyContinue)) {
      if ($x.Name -like '~$*') { continue }   # Excel's own lock file, not a spreadsheet
      if (Test-Locked $x.FullName) { $open.Add($x.FullName) }
    }
  }
  return ,$open
}
$skipSheets = $false
while ($true) {
  $open = Get-OpenSheets
  if ($open.Count -eq 0) { break }
  Write-Host ''
  Write-Host 'These spreadsheets are open (probably in Excel), so they cannot be updated:' -ForegroundColor Yellow
  $open | ForEach-Object { Write-Host ('  ' + $_) }
  $a = Read-Host 'Close them, then press Enter to continue  (or type S to carry on and leave the spreadsheets as they are)'
  if ($a -and $a.Trim().ToUpper() -eq 'S') { $skipSheets = $true; break }
}
$sheetNotes = New-Object System.Collections.Generic.List[string]

$added = 0; $same = 0
$conflicts = New-Object System.Collections.Generic.List[string]
$failed = New-Object System.Collections.Generic.List[string]
foreach ($f in ($found | Sort-Object { $_.Zip.Name })) {
  Write-Host ('Unpacking ' + $f.Zip.Name + ' ...')
  $arc = [IO.Compression.ZipFile]::OpenRead($f.Zip.FullName)
  try {
    foreach ($e in $arc.Entries) {
      $rel = $e.FullName -replace '\\', '/'
      if ($rel.EndsWith('/')) { continue }
      if (@($rel -split '/' | Where-Object { $_ -eq '..' -or $_ -eq '' }).Count) { $failed.Add($rel + ' (unsafe name, skipped)'); continue }
      try {
        $dest = Join-Path $base ($rel -replace '/', '\')
        $isSheet = ($rel -split '/').Count -eq 2 -and $rel -like '*.xlsx'
        if ((Test-Path -LiteralPath $dest) -and $isSheet) {
          # same spreadsheet name (one per inspector per day): keep whichever was exported last
          $old = Get-Item -LiteralPath $dest
          if ($old.Length -eq $e.Length -or $e.LastWriteTime.DateTime -le $old.LastWriteTime) { $same++; continue }
          if ($skipSheets) { $sheetNotes.Add('Not updated (left open): ' + $rel); continue }
          # unpack beside it first, then swap, so the old spreadsheet is never half-written
          $tmp = $dest + '.new'
          try {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $tmp, $true)
            Move-Item -LiteralPath $tmp -Destination $dest -Force
            $added++
          } catch {
            if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
            $sheetNotes.Add('Could not update (is it open in Excel?): ' + $rel)
          }
          continue
        }
        if (Test-Path -LiteralPath $dest) {
          if ((Get-Item -LiteralPath $dest).Length -eq $e.Length) { $same++; continue }
          # same name but a different file: keep both, never overwrite
          $dir = Split-Path -Parent $dest
          $bn = [IO.Path]::GetFileNameWithoutExtension($dest); $ext = [IO.Path]::GetExtension($dest)
          $k = 2; $skip = $false
          while ($true) {
            $cand = Join-Path $dir ('{0} ({1}){2}' -f $bn, $k, $ext)
            if (-not (Test-Path -LiteralPath $cand)) { $dest = $cand; break }
            if ((Get-Item -LiteralPath $cand).Length -eq $e.Length) { $skip = $true; break }
            $k++
          }
          if ($skip) { $same++; continue }
          $conflicts.Add($rel + '  ->  ' + (Split-Path -Leaf $dest))
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $false)
        if ((Get-Item -LiteralPath $dest).Length -ne $e.Length) { throw 'size check failed' }
        $added++
      } catch { $failed.Add($rel + ' (' + $_.Exception.Message + ')') }
    }
  } finally { $arc.Dispose() }
}

# ---- 3 + 4. per project: newest spreadsheet per inspector, and a receipt ----
$utf8 = New-Object System.Text.UTF8Encoding($false)
function J([string]$t) { return '"' + ($t -replace '\\', '\\' -replace '"', '\"') + '"' }
$receipts = New-Object System.Collections.Generic.List[string]
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($root in $projects) {
  $dir = Join-Path $base $root
  Write-Host ''
  Write-Host ($root + '  ->  ' + $dir) -ForegroundColor Cyan

  $groups = @{}
  foreach ($x in @(Get-ChildItem -LiteralPath $dir -Filter '*Defects*.xlsx' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '~$*' })) {
    # new names: "267180.00 2026-10-29 JJM Defects.xlsx"; older: "24-118_Defects_JM_20261029-113000.xlsx"
    $m = [regex]::Match($x.Name, '^.+ \d{4}-\d{2}-\d{2} ([A-Za-z0-9]+) Defects(?: \(\d+\))?\.xlsx$')
    if (-not $m.Success) { $m = [regex]::Match($x.Name, '_Defects_(?:([A-Za-z0-9]+)_)?\d{8}-\d{4,6}(?: \(\d+\))?\.xlsx$') }
    if (-not $m.Success) { continue }
    $who = $m.Groups[1].Value.ToUpper()
    if (-not $groups.ContainsKey($who)) { $groups[$who] = New-Object System.Collections.Generic.List[object] }
    $groups[$who].Add([pscustomobject]@{ File = $x; Key = $x.LastWriteTime.Ticks })   # file time = when it was exported
  }
  foreach ($who in $groups.Keys) {
    $list = @($groups[$who] | Sort-Object Key -Descending)
    $gone = 0
    for ($i = 1; $i -lt $list.Count; $i++) {
      try { Remove-Item -LiteralPath $list[$i].File.FullName -ErrorAction Stop; $gone++ }
      catch { $sheetNotes.Add('Older spreadsheet not removed (is it open in Excel?): ' + $list[$i].File.Name) }
    }
    $label = 'Spreadsheet'
    if ($who) { $label = 'Spreadsheet (' + $who + ')' }
    $note = ''
    if ($gone) { $note = '   (' + $gone + ' older removed)' }
    Write-Host ('  ' + $label + ': ' + $list[0].File.Name + $note)
  }

  $photoDir = Join-Path $dir 'Photos'
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{"type":"site-defects-receipt","version":1,"root":' + (J $root) + ',"created":' + (J (Get-Date -Format 's')) + ',"computer":' + (J $env:COMPUTERNAME) + ',"files":[')
  $n = 0
  if (Test-Path -LiteralPath $photoDir) {
    $cut = (Get-Item -LiteralPath $dir).FullName.TrimEnd('\').Length + 1
    foreach ($p in Get-ChildItem -LiteralPath $photoDir -Recurse -File) {
      if ($n) { [void]$sb.Append(',') }
      [void]$sb.Append('{"p":' + (J ($p.FullName.Substring($cut).Replace('\', '/'))) + ',"s":' + $p.Length + '}')
      $n++
    }
  }
  [void]$sb.Append(']}')
  $rdir = Join-Path $dir 'Receipts'
  New-Item -ItemType Directory -Force -Path $rdir | Out-Null
  Get-ChildItem -LiteralPath $rdir -Filter '* receipt *.json' -File | Remove-Item
  $rname = ($root -replace ' Inspection$', '') + ' receipt ' + $stamp + '.json'
  $rpath = Join-Path $rdir $rname
  [IO.File]::WriteAllText($rpath, $sb.ToString(), $utf8)
  $receipts.Add($rpath)
  Write-Host ('  Photos in the folder: ' + $n)
  Write-Host ('  Receipt: ' + $rpath)
}

Write-Host ''
Write-Host ('Done. ' + $added + ' new file(s) added, ' + $same + ' already there.') -ForegroundColor Green
if ($conflicts.Count) {
  Write-Host ('' + $conflicts.Count + ' file(s) had the same name as a different file already there. Both were kept:') -ForegroundColor Yellow
  $conflicts | ForEach-Object { Write-Host ('  ' + $_) }
}
if ($sheetNotes.Count) {
  Write-Host 'Spreadsheets (photos and the receipt are not affected; close Excel and run the tool again to finish these):' -ForegroundColor Yellow
  $sheetNotes | ForEach-Object { Write-Host ('  ' + $_) }
}
if ($failed.Count) {
  Write-Host ('' + $failed.Count + ' file(s) could not be unpacked. They are NOT in the receipt, so the phones keep them:') -ForegroundColor Red
  $failed | ForEach-Object { Write-Host ('  ' + $_) }
}
Write-Host ''
Write-Host 'Next: send the receipt file to each inspector (email, Teams or AirDrop).'
Write-Host 'On the iPhone, save it to Files, then in the app: Menu > Load PC receipt.'
if ($receipts.Count) { Start-Process explorer.exe -ArgumentList ('/select,"' + $receipts[0] + '"') }
