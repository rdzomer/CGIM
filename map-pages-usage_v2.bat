@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PAGES_DIR=src\pages"
set "OUT=pages-usage.csv"
set "PS=%TEMP%\_pages_usage_v2.ps1"

> "%PS%" echo $ErrorActionPreference = 'Stop'
>>"%PS%" echo $root = Resolve-Path '.'
>>"%PS%" echo $pagesDir = Join-Path $root '%PAGES_DIR%'
>>"%PS%" echo if (-not (Test-Path $pagesDir)) { Write-Error "Diretório de pages não encontrado: %PAGES_DIR%"; exit 1 }
>>"%PS%" echo $includeExt = @('*.ts','*.tsx')
>>"%PS%" echo $all = Get-ChildItem -Path $root -Recurse -File -Include $includeExt ^| Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo)\\' }
>>"%PS%" echo $pages = Get-ChildItem -Path $pagesDir -Recurse -File -Filter *.tsx
>>"%PS%" echo $rows = @()
>>"%PS%" echo foreach ($pg in $pages) {
>>"%PS%" echo ^  $name = [System.IO.Path]::GetFileNameWithoutExtension($pg.Name)   # ex.: AnalisePleitoPage
>>"%PS%" echo ^  $stemEsc = [regex]::Escape($name)
>>"%PS%" echo ^  $relPath = $pg.FullName.Substring($root.Path.Length+1)
>>"%PS%" echo ^  $patImport1 = "from\s+['""][^'""]*/pages/[^'""]*$stemEsc(['""])"
>>"%PS%" echo ^  $patImport2 = "import\(['""][^'""]*/pages/[^'""]*$stemEsc(['""])\)"
>>"%PS%" echo ^  $patLazy    = "React\.lazy\(\s*\(\)\s*=>\s*import\(['""][^'""]*/pages/[^'""]*$stemEsc(['""])\)\s*\)"
>>"%PS%" echo ^  $patJSX     = "<\s*$stemEsc(\s|/|>)"
>>"%PS%" echo ^  $patRouteEl = "element=\{<\s*$stemEsc(\s|/|>)"
>>"%PS%" echo ^  $hits = @()
>>"%PS%" echo ^  $hits += $all ^| Select-String -Pattern $patImport1
>>"%PS%" echo ^  $hits += $all ^| Select-String -Pattern $patImport2
>>"%PS%" echo ^  $hits += $all ^| Select-String -Pattern $patLazy
>>"%PS%" echo ^  $hits += $all ^| Select-String -Pattern $patJSX
>>"%PS%" echo ^  $hits += $all ^| Select-String -Pattern $patRouteEl
>>"%PS%" echo ^  if ($hits.Count -gt 0) {
>>"%PS%" echo ^    foreach ($h in $hits ^| Sort-Object Path,LineNumber) {
>>"%PS%" echo ^      $rows += [pscustomobject]@{ Page=$name; PageFile=$relPath; RefFile=$h.Path; Line=$h.LineNumber; Match=$h.Line.Trim() }
>>"%PS%" echo ^    }
>>"%PS%" echo ^  } else {
>>"%PS%" echo ^    $rows += [pscustomobject]@{ Page=$name; PageFile=$relPath; RefFile='(no matches)'; Line=''; Match='' }
>>"%PS%" echo ^  }
>>"%PS%" echo }
>>"%PS%" echo $rows ^| Export-Csv -NoTypeInformation '%OUT%'

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS%"
if errorlevel 1 (
  echo [ERRO] Falhou a varredura de pages.
) else (
  echo [OK] Gerado: %OUT%
)
endlocal
exit /b
