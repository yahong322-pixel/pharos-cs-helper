$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$menus = Get-Content (Join-Path $dir 'menus.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$flat = New-Object System.Collections.ArrayList

function Walk($node, $path) {
    $newPath = if ($path) { "$path > $($node.title)" } else { $node.title }
    [void]$flat.Add([pscustomobject]@{
        id = $node.id
        title = $node.title
        path = $newPath
        depth = $node.depth
        active = $node.isActive
    })
    foreach ($c in $node.children) { Walk $c $newPath }
}

foreach ($root in $menus) { Walk $root $null }

Write-Output "TOTAL NODES: $($flat.Count)"
$flat | ConvertTo-Json -Depth 4 | Out-File (Join-Path $dir 'menus_flat.json') -Encoding utf8
$flat | Where-Object { $_.depth -ge 2 } | Measure-Object | ForEach-Object { Write-Output "LEAF(depth>=2): $($_.Count)" }
