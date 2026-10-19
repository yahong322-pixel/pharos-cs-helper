# depth 2 이상(실제 도움말 쪽)인 메뉴 id 목록을 뽑는다.
$dir = $PSScriptRoot
$flat = Get-Content (Join-Path $dir 'menus_flat.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ids = $flat | Where-Object { $_.depth -ge 2 } | ForEach-Object { $_.id }
[System.IO.File]::WriteAllLines((Join-Path $dir 'leaf_ids.txt'), [string[]]$ids)
Write-Output "wrote $($ids.Count) ids"
