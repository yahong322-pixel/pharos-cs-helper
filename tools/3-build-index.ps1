$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$flat = Get-Content (Join-Path $dir 'menus_flat.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$map = @{}
foreach ($m in $flat) { $map[[string]$m.id] = $m }

$pages = New-Object System.Collections.ArrayList
$skipped = 0

function Clean-Html([string]$h) {
    # drop comments, script/style blocks
    $h = [regex]::Replace($h, '(?s)<!--.*?-->', '')
    $h = [regex]::Replace($h, '(?s)<(script|style)\b.*?</\1>', '')
    # normalise image sources BEFORE stripping attributes
    $h = $h -replace 'https://stg\.upharos\.com/assets/manual/', 'https://www.upharos.com/assets/manual/'
    $h = $h -replace 'https://stg\.stella-erp\.com/assets/manual/', 'https://www.upharos.com/assets/manual/'
    $h = $h -replace 'src="/api/admin/images/', 'src="https://help.upharos.com/api/admin/images/'
    # strip every attribute except src/alt on img and href on a
    $h = [regex]::Replace($h, '<(?!/)([a-zA-Z0-9]+)((?:\s+[^<>]*)?)/?>', {
        param($m)
        $tag = $m.Groups[1].Value.ToLower()
        $attrs = $m.Groups[2].Value
        $keep = ''
        if ($tag -eq 'img') {
            $s = [regex]::Match($attrs, 'src\s*=\s*"([^"]*)"')
            if ($s.Success) { $keep = ' src="' + $s.Groups[1].Value + '"' }
            $a = [regex]::Match($attrs, 'alt\s*=\s*"([^"]*)"')
            if ($a.Success) { $keep += ' alt="' + $a.Groups[1].Value + '"' }
            return '<img' + $keep + '>'
        }
        if ($tag -eq 'a') {
            $s = [regex]::Match($attrs, 'href\s*=\s*"([^"]*)"')
            if ($s.Success) { $keep = ' href="' + $s.Groups[1].Value + '"' }
            return '<a' + $keep + '>'
        }
        return '<' + $tag + '>'
    })
    # collapse tags we do not render
    $h = $h -replace '</?(span|font|u|div)>', ''
    $h = $h -replace '<(/?)b>', '<$1strong>'
    $h = $h -replace '<(/?)i>', '<$1em>'
    # tidy empties and whitespace
    $h = [regex]::Replace($h, '<p>\s*(<br>)?\s*</p>', '')
    $h = [regex]::Replace($h, '\s{2,}', ' ')
    return $h.Trim()
}

function To-Text([string]$h) {
    $t = $h
    $t = [regex]::Replace($t, '<img[^>]*>', ' ')
    $t = [regex]::Replace($t, '</?(p|br|li|tr|h1|h2|h3|h4|h5|div|table)[^>]*>', "`n")
    $t = [regex]::Replace($t, '<[^>]+>', '')
    $t = [System.Net.WebUtility]::HtmlDecode($t)
    $t = $t -replace "`r", ''
    $t = [regex]::Replace($t, '[ \t]{2,}', ' ')
    $t = [regex]::Replace($t, "\n{2,}", "`n")
    return $t.Trim()
}

foreach ($f in Get-ChildItem (Join-Path $dir 'content') -Filter *.json) {
    $id = $f.BaseName
    $raw = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $html = $raw.contentHtml
    if (-not $html) { $skipped++; continue }
    $clean = Clean-Html $html
    $text = To-Text $clean
    if ($text.Length -lt 30) { $skipped++; continue }
    $meta = $map[$id]
    $imgs = @([regex]::Matches($clean, '<img src="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
    [void]$pages.Add([pscustomobject]@{
        id    = [int]$id
        title = $meta.title
        path  = $meta.path
        html  = $clean
        text  = $text
        imgs  = $imgs.Count
    })
}

$sorted = $pages | Sort-Object path
$json = $sorted | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText((Join-Path $dir '../data/manual.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "pages=$($sorted.Count) skipped=$skipped"
Write-Output ("manual.json = {0:N0} KB" -f ((Get-Item (Join-Path $dir '../data/manual.json')).Length / 1KB))
Write-Output ("text total = {0:N0} KB" -f ((($sorted | ForEach-Object { $_.text.Length }) | Measure-Object -Sum).Sum / 1KB))
Write-Output "--- sample ---"
$s = $sorted[20]
Write-Output "PATH: $($s.path)"
Write-Output "TEXT: $($s.text.Substring(0, [Math]::Min(400, $s.text.Length)))"
