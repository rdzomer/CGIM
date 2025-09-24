# map-pages-usage-ultra.ps1
$ErrorActionPreference = 'Stop'
$root = Resolve-Path '.'

# Onde estão as pages?
$pagesDir = Join-Path $root 'src\pages'
if (-not (Test-Path $pagesDir)) { Write-Host "Diretório 'src/pages' não encontrado." -ForegroundColor Yellow; exit 1 }

# Todos arquivos TS/TSX para vasculhar (repo inteiro, exceto node_modules/.git)
$all = Get-ChildItem -Path $root -Recurse -File -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.git)\\' }

$pages = Get-ChildItem -Path $pagesDir -Recurse -File -Filter *.tsx
if (-not $pages) { Write-Host "Nenhuma page .tsx encontrada em src/pages." -ForegroundColor Yellow; exit 0 }

Write-Host ("Pages encontradas: {0}" -f $pages.Count)

$rows = New-Object System.Collections.Generic.List[object]

foreach ($pg in $pages) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($pg.Name) # ex.: VisualizarPautaPage
  $stemEsc = [regex]::Escape($name)
  $relPath = $pg.FullName.Substring($root.Path.Length+1)

  # Padrões: import, import dinâmico/lazy, JSX (<Name .../>), rotas (element={<Name .../>})
  $patImport1 = "from\s+['""][^'""]*/pages/[^'""]*$stemEsc(['""])"
  $patImport2 = "import\(['""][^'""]*/pages/[^'""]*$stemEsc(['""])\)"
  $patLazy    = "React\.lazy\(\s*\(\)\s*=>\s*import\(['""][^'""]*/pages/[^'""]*$stemEsc(['""])\)\s*\)"
  $patJSX     = "<\s*$stemEsc(\s|/|>)"
  $patRouteEl = "element=\{<\s*$stemEsc(\s|/|>)"

  $hits = @()
  $hits += $all | Select-String -Pattern $patImport1
  $hits += $all | Select-String -Pattern $patImport2
  $hits += $all | Select-String -Pattern $patLazy
  $hits += $all | Select-String -Pattern $patJSX
  $hits += $all | Select-String -Pattern $patRouteEl

  if ($hits.Count -gt 0) {
    foreach ($h in ($hits | Sort-Object Path,LineNumber)) {
      $rows.Add([pscustomobject]@{
        Page    = $name
        PageFile= $relPath
        RefFile = $h.Path
        Line    = $h.LineNumber
        Match   = $h.Line.Trim()
      })
    }
  } else {
    $rows.Add([pscustomobject]@{ Page=$name; PageFile=$relPath; RefFile='(no matches)'; Line=''; Match='' })
  }
}

$OUT = 'pages-usage.csv'
$rows | Export-Csv -NoTypeInformation $OUT -Encoding UTF8
Write-Host "Gerado $OUT" -ForegroundColor Green
