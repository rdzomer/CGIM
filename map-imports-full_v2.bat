@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=."
set "OUT1=imports-map-full.csv"
set "OUT2=services-barrel-usage.txt"
set "OUT3=services-reexports.txt"
set "PS=%TEMP%\_imports_full_scan_v2.ps1"

> "%PS%" echo $ErrorActionPreference = 'Stop'
>>"%PS%" echo $root = Resolve-Path '%ROOT%'
>>"%PS%" echo $services = @('atribuicoesService','analisePleitoService','historicoAnalisesService','historicoService','pautaService','ncmsService','adminPautasService','exportService','geminiService','authProfiles','pautaStore','pautaVersioningCompat','regraProcesso','relatorioExport','retificacaoHistoricoSync','usersService','usuariosService')
>>"%PS%" echo $includeExt = @('*.ts','*.tsx')
>>"%PS%" echo $files = Get-ChildItem -Path $root -Recurse -File -Include $includeExt ^| Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo)\\' }
>>"%PS%" echo $rows = @()
>>"%PS%" echo foreach ($s in $services) {
>>"%PS%" echo ^  $esc = [regex]::Escape($s)
>>"%PS%" echo ^  $patFrom   = "from\s+['""]([^'""]*/|@/services/|[^'""]*/services/)?$esc(['""]|\.ts['""]|\.tsx['""])"
>>"%PS%" echo ^  $patDynImp = "import\(['""]([^'""]*/|@/services/|[^'""]*/services/)?$esc(['""]|\.ts['""]|\.tsx['""])\)"
>>"%PS%" echo ^  $patReq    = "require\(['""]([^'""]*/|@/services/|[^'""]*/services/)?$esc(['""]|\.ts['""]|\.tsx['""])\)"
>>"%PS%" echo ^  $hits1 = $files ^| Select-String -Pattern $patFrom
>>"%PS%" echo ^  $hits2 = $files ^| Select-String -Pattern $patDynImp
>>"%PS%" echo ^  $hits3 = $files ^| Select-String -Pattern $patReq
>>"%PS%" echo ^  $all = @($hits1)+@($hits2)+@($hits3)
>>"%PS%" echo ^  if ($all.Count -gt 0) {
>>"%PS%" echo ^    foreach ($h in $all) {
>>"%PS%" echo ^      $rows += [pscustomobject]@{ Service=$s; File=$h.Path; Line=$h.LineNumber; Match=$h.Line.Trim() }
>>"%PS%" echo ^    }
>>"%PS%" echo ^  } else {
>>"%PS%" echo ^    $rows += [pscustomobject]@{ Service=$s; File='(no matches)'; Line=''; Match='' }
>>"%PS%" echo ^  }
>>"%PS%" echo }
>>"%PS%" echo $rows ^| Sort-Object Service,File,Line ^| Export-Csv -NoTypeInformation '%OUT1%'
>>"%PS%" echo ""
>>"%PS%" echo "# Imports do barrel de services (from '.../services')" ^| Out-File -Encoding utf8 '%OUT2%'
>>"%PS%" echo $files ^| Select-String -Pattern "from\s+['""][^'""]*/services['""]" ^| ForEach-Object { "$($_.Path):$($_.LineNumber)  $($_.Line.Trim())" } ^| Out-File -Append -Encoding utf8 '%OUT2%'
>>"%PS%" echo ""
>>"%PS%" echo "# Reexports em src/services (ex.: export { X } from './foo')" ^| Out-File -Encoding utf8 '%OUT3%'
>>"%PS%" echo $svcDir = Join-Path $root 'src\services'
>>"%PS%" echo if (Test-Path $svcDir) {
>>"%PS%" echo ^  Get-ChildItem -Path $svcDir -File -Include $includeExt ^| Select-String -Pattern "export\s+.*\s+from\s+['""]\./" ^| ForEach-Object { "$($_.Path):$($_.LineNumber)  $($_.Line.Trim())" } ^| Out-File -Append -Encoding utf8 '%OUT3%'
>>"%PS%" echo } else { "# pasta src/services não encontrada" ^| Out-File -Append -Encoding utf8 '%OUT3%' }

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS%"
if errorlevel 1 (
  echo [ERRO] Falhou o mapeamento. Verifique mensagens acima.
) else (
  echo [OK] Gerado: %OUT1%
  echo [OK] Gerado: %OUT2%
  echo [OK] Gerado: %OUT3%
)
endlocal
exit /b
