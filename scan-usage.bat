@echo off
setlocal EnableDelayedExpansion

REM ===== Config =====
set SRC=src
set OUTDIR=scan-usage
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

REM limpar antigos
> "%OUTDIR%\services-usage.csv" echo Service,File,Line,Match
> "%OUTDIR%\imports-map-full.csv" echo Importer,Line,Raw
> "%OUTDIR%\pages-usage.csv" echo Page,File,Line,Match
> "%OUTDIR%\services-reexports.txt" echo # Reexports em src\services (ex.: export ^{ X ^} from './foo')
> "%OUTDIR%\services-barrel-usage.txt" echo # Imports do barrel de services (from '..\services')

REM ===== Lista de services (ajuste se tiver outros) =====
set SERVICES=adminPautasService analisePleitoService atribuicoesService authProfiles exportService geminiService historicoAnalisesService historicoService ncmsService pautaService pautaStore pautaVersioningCompat regraProcesso relatorioExport retificacaoHistoricoSync usersService usuariosService

REM ===== 1) Onde cada service é importado =====
for %%S in (%SERVICES%) do (
  for /f "delims=" %%F in ('dir /b /s "%SRC%\*.ts" "%SRC%\*.tsx"') do (
    REM Procurar por "/services/%%S"
    for /f "usebackq delims=:" %%A in (`findstr /n /i /c:"/services/%%S" "%%~F"`) do (
      set LN=%%A
      set LINE=!LN::="!
      echo %%S,"%%~F","!LINE!","/services/%%S" >> "%OUTDIR%\services-usage.csv"
    )
  )
)

REM ===== 2) Mapa amplo de imports (quem importa o quê) =====
for /f "delims=" %%F in ('dir /b /s "%SRC%\*.ts" "%SRC%\*.tsx"') do (
  for /f "usebackq delims=" %%L in (`findstr /n /r /c:"^[[:space:]]*import .* from .*$" "%%~F"`) do (
    set LN=%%L
    set FILE=%%~F
    echo "!FILE!","!LN!" >> "%OUTDIR%\imports-map-full.csv"
  )
)

REM ===== 3) Reexports e barrel (apenas para conferência) =====
for /f "delims=" %%F in ('dir /b /s "%SRC%\services\*.ts" "%SRC%\services\*.tsx" 2^>nul') do (
  for /f "usebackq delims=" %%L in (`findstr /n /r /c:"^[[:space:]]*export[[:space:]]*{.*}[[:space:]]*from[[:space:]]*['""]\./.*['""]" "%%~F"`) do (
    echo %%F: %%L>> "%OUTDIR%\services-reexports.txt"
  )
)
for /f "delims=" %%F in ('dir /b /s "%SRC%\*.ts" "%SRC%\*.tsx"') do (
  for /f "usebackq delims=" %%L in (`findstr /n /i /c:"from '..\services" "%%~F"`) do (
    echo %%F: %%L>> "%OUTDIR%\services-barrel-usage.txt"
  )
)

REM ===== 4) Onde cada page é referenciada (por nome do componente e pelo nome do arquivo) =====
for /f "delims=" %%P in ('dir /b /s "%SRC%\pages\*.tsx"') do (
  set PBASE=%%~nP
  REM Procurar pelo nome do componente (%%~nP) em todo o projeto, exceto nele próprio
  for /f "usebackq delims=:" %%A in (`findstr /n /i /s /c:"%%~nP" "%SRC%\*.ts" "%SRC%\*.tsx" ^| findstr /i /v "pages\\%%~nP.tsx"`) do (
    set LN=%%A
    set LINE=!LN::="!
    echo %%~nP,"%%~dpnP.tsx","!LINE!","%%~nP" >> "%OUTDIR%\pages-usage.csv"
  )
  REM Procurar também por "pages/Arquivo"
  for /f "usebackq delims=:" %%A in (`findstr /n /i /s /c:"pages/%%~nP" "%SRC%\*.ts" "%SRC%\*.tsx" ^| findstr /i /v "pages\\%%~nP.tsx"`) do (
    set LN=%%A
    set LINE=!LN::="!
    echo %%~nP,"%%~dpnP.tsx","!LINE!","pages/%%~nP" >> "%OUTDIR%\pages-usage.csv"
  )
)

echo.
echo [OK] Relatorios gerados em "%OUTDIR%".
echo - Abra: services-usage.csv, pages-usage.csv, imports-map-full.csv
echo.

endlocal
