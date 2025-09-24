# map-imports-ultra.ps1
$ErrorActionPreference = 'Stop'
$root = Resolve-Path '.'

# Services alvo (adicione/remova aqui se quiser)
$services = @(
  'atribuicoesService','analisePleitoService','historicoAnalisesService','historicoService',
  'pautaService','ncmsService','adminPautasService','exportService','geminiService',
  'authProfiles','pautaStore','pautaVersioningCompat','regraProcesso','relatorioExport',
  'retificacaoHistoricoSync','usersService','usuariosService'
)

# Coleta todos .ts/.tsx fora de node_modules/.git (não excluo mais nada pra não perder arquivo)
$files = Get-ChildItem -Path $root -Recurse -File -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.git)\\' }

if (-not $files) { Write-Host "Nenhum .ts/.tsx encontrado." -ForegroundColor Yellow; exit 0 }
Write-Host ("Arquivos analisados: {0}" -f $files.Count)

$rows = New-Object System.Collections.Generic.List[object]

foreach ($s in $services) {
  # Padrões (captura imports com caminho relativo, '@/services', e '/services/')
  $esc = [regex]::Escape($s)
  $patFrom   = "from\s+['""]([^'""]*/|@/services/|[^'""]*/services/)?$esc(['""]|\.ts['""]|\.tsx['""])"
  $patDynImp = "import\(['""]([^'""]*/|@/services/|[^'""]*/services/)?$esc(['""]|\.ts['""]|\.tsx['""])\)"
  $patReq    = "require\(['""]([^'""]*/|@/services/|[^'""]*/services/)?$esc(['""]|\.ts['""]|\.tsx['""])\)"

  $hits1 = $files | Select-String -Pattern $patFrom
  $hits2 = $files | Select-String -Pattern $patDynImp
  $hits3 = $files | Select-String -Pattern $patReq
  $all = @($hits1)+@($hits2)+@($hits3)

  if ($all.Count -gt 0) {
    foreach ($h in $all) {
      $rows.Add([pscustomobject]@{
        Service = $s
        File    = $h.Path
        Line    = $h.LineNumber
        Match   = $h.Line.Trim()
      })
    }
  } else {
    $rows.Add([pscustomobject]@{ Service=$s; File='(no matches)'; Line=''; Match='' })
  }
}

$OUT1 = 'imports-map-full.csv'
$rows | Sort-Object Service,File,Line | Export-Csv -NoTypeInformation $OUT1 -Encoding UTF8
Write-Host "Gerado $OUT1" -ForegroundColor Green

# Extras úteis
$OUT2 = 'services-barrel-usage.txt'
$barrel = $files | Select-String -Pattern "from\s+['""][^'""]*/services['""]"
"# Imports do barrel de services (from '.../services')" | Out-File -Encoding UTF8 $OUT2
$barrel | ForEach-Object { "$($_.Path):$($_.LineNumber)  $($_.Line.Trim())" } | Out-File -Append -Encoding UTF8 $OUT2
Write-Host "Gerado $OUT2" -ForegroundColor Green

$OUT3 = 'services-reexports.txt'
$svcDir = Join-Path $root 'src\services'
"# Reexports em src/services (ex.: export { X } from './foo')" | Out-File -Encoding UTF8 $OUT3
if (Test-Path $svcDir) {
  Get-ChildItem -Path $svcDir -File -Include *.ts,*.tsx |
    Select-String -Pattern "export\s+.*\s+from\s+['""]\./" |
    ForEach-Object { "$($_.Path):$($_.LineNumber)  $($_.Line.Trim())" } |
    Out-File -Append -Encoding UTF8 $OUT3
} else {
  "Pasta src/services não encontrada." | Out-File -Append -Encoding UTF8 $OUT3
}
Write-Host "Gerado $OUT3" -ForegroundColor Green
