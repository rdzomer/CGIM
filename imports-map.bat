@echo off
setlocal EnableDelayedExpansion

REM === Caminho base ===
cd /d "%~dp0"
set "SRC_DIR=src"
set "OUT=imports-map.csv"
set "PSFILE=%TEMP%\gen_imports_map.ps1"

REM === Escreve um script PowerShell temporário (fica muito mais simples do que escapar tudo em linha) ===
> "%PSFILE%" echo $ErrorActionPreference = 'Stop'
>> "%PSFILE%" echo $services = @('atribuicoesService','analisePleitoService','historicoAnalisesService','historicoService','pautaService','ncmsService','adminPautasService','exportService','geminiService','authProfiles','pautaStore','pautaVersioningCompat','regraProcesso','relatorioExport','retificacaoHistoricoSync','usersService','usuariosService');
>> "%PSFILE%" echo $src = '%SRC_DIR%';
>> "%PSFILE%" echo if (-not (Test-Path $src)) { Write-Error "Diretório '$src' não encontrado. Ajuste a variável SRC_DIR no BAT."; exit 1 }
>> "%PSFILE%" echo $results = @();
>> "%PSFILE%" echo foreach ($s in $services) {
>> "%PSFILE%" echo ^    # Regex para: import ... from '.../service'
>> "%PSFILE%" echo ^    $pat1 = "from\s+['^""][^'^""]*/?$s['^""]";
>> "%PSFILE%" echo ^    # Regex para: import('.../service')
>> "%PSFILE%" echo ^    $pat2 = "import\(['^""][^'^""]*/?$s['^""]\)";
>> "%PSFILE%" echo ^    $hits  = Get-ChildItem -Recurse -Include *.ts,*.tsx -Path $src ^| Select-String -Pattern $pat1
>> "%PSFILE%" echo ^    $hits2 = Get-ChildItem -Recurse -Include *.ts,*.tsx -Path $src ^| Select-String -Pattern $pat2
>> "%PSFILE%" echo ^    $all = @($hits) + @($hits2)
>> "%PSFILE%" echo ^    if ($all) {
>> "%PSFILE%" echo ^        foreach ($h in $all) {
>> "%PSFILE%" echo ^            $results += [pscustomobject]@{
>> "%PSFILE%" echo ^                Service = $s
>> "%PSFILE%" echo ^                File    = $h.Path
>> "%PSFILE%" echo ^                Line    = $h.LineNumber
>> "%PSFILE%" echo ^                Match   = $h.Line.Trim()
>> "%PSFILE%" echo ^            }
>> "%PSFILE%" echo ^        }
>> "%PSFILE%" echo ^    } else {
>> "%PSFILE%" echo ^        $results += [pscustomobject]@{ Service = $s; File = '(no matches)'; Line = ''; Match = '' }
>> "%PSFILE%" echo ^    }
>> "%PSFILE%" echo }
>> "%PSFILE%" echo $results ^| Sort-Object Service,File ^| Export-Csv -NoTypeInformation '%OUT%'
>> "%PSFILE%" echo Write-Host 'Mapa gerado: %OUT%'

REM === Executa o PowerShell ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%"
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel gerar o mapa. Veja as mensagens acima.
) else (
  echo.
  echo [OK] Mapa gerado: %OUT%
  echo Abra o arquivo %OUT% no Excel.
)

endlocal
exit /b
