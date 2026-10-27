#Requires -Version 7
<#
.SYNOPSIS
  Generates the MSIX visual assets (tiles, Store logo, taskbar icons) for Volt
  from the existing app icon, with no extra dependency (System.Drawing only).

.DESCRIPTION
  Source: src-tauri/icons/icon.png (512x512, transparent). The opaque bounding
  box of the logo is detected, then the logo is re-centred on a transparent
  canvas with a per-asset fill ratio (Microsoft tile guidance: the logo
  should use ~60% of a square tile, ~85-90% of an app-list/taskbar icon).

  Output (default packaging/msix/Assets):
    - unqualified files at scale-100 (what the manifest references),
    - .scale-200 / .scale-400 variants,
    - Square44x44Logo.targetsize-N(.altform-unplated) for the taskbar/Start.
  The qualified variants are only picked up through resources.pri, which
  scripts/package-msix.ps1 generates (makepri or winapp). Without a PRI the
  unqualified files are used and everything stays valid.

  Replace any generated file with a hand-made design at the same name/size
  whenever you like: the packaging script only regenerates with -Force.

.EXAMPLE
  pwsh -File scripts/generate-msix-assets.ps1
  pwsh -File scripts/generate-msix-assets.ps1 -Force
#>
[CmdletBinding()]
param(
    [string]$Source,
    [string]$OutDir,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $Source) { $Source = Join-Path $RepoRoot 'src-tauri/icons/icon.png' }
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'packaging/msix/Assets' }

if (-not (Test-Path $Source)) { throw "Source icon not found: $Source" }
if ((Test-Path $OutDir) -and -not $Force -and (Get-ChildItem $OutDir -Filter *.png -ErrorAction SilentlyContinue)) {
    Write-Host "MSIX assets already present in $OutDir (use -Force to regenerate)."
    return
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new((Resolve-Path $Source).Path)
try {
    # ── Opaque bounding box of the logo ──────────────────────────────────
    $rect = [System.Drawing.Rectangle]::new(0, 0, $src.Width, $src.Height)
    $data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bytes = [byte[]]::new($data.Stride * $src.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $stride = $data.Stride
    $src.UnlockBits($data)

    $minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $src.Height; $y++) {
        $row = $y * $stride
        for ($x = 0; $x -lt $src.Width; $x++) {
            if ($bytes[$row + $x * 4 + 3] -gt 16) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt 0) { throw "Source icon is fully transparent: $Source" }
    $bbox = [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
    Write-Host "Logo bounding box in source: $($bbox.Width)x$($bbox.Height) at ($minX,$minY)"

    function Save-Asset([string]$Name, [int]$Width, [int]$Height, [double]$Fill) {
        $bmp = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            # Fit the logo box inside (Fill * min(Width, Height)) keeping its aspect ratio.
            $target = $Fill * [Math]::Min($Width, $Height)
            $scale = [Math]::Min($target / $bbox.Width, $target / $bbox.Height)
            $w = [int][Math]::Round($bbox.Width * $scale)
            $h = [int][Math]::Round($bbox.Height * $scale)
            $dest = [System.Drawing.Rectangle]::new([int](($Width - $w) / 2), [int](($Height - $h) / 2), $w, $h)
            $attrs = [System.Drawing.Imaging.ImageAttributes]::new()
            $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY) # no edge halo
            $g.DrawImage($src, $dest, $bbox.X, $bbox.Y, $bbox.Width, $bbox.Height,
                [System.Drawing.GraphicsUnit]::Pixel, $attrs)
            $attrs.Dispose()
        } finally { $g.Dispose() }
        $path = Join-Path $OutDir $Name
        $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Host ("  {0,-52} {1}x{2}" -f $Name, $Width, $Height)
    }

    # name, base width, base height, fill ratio, scales
    $assets = @(
        @{ Name = 'Square44x44Logo';   W = 44;  H = 44;  Fill = 0.86; Scales = @(100, 200, 400) },
        @{ Name = 'Square150x150Logo'; W = 150; H = 150; Fill = 0.60; Scales = @(100, 200) },
        @{ Name = 'Wide310x150Logo';   W = 310; H = 150; Fill = 0.60; Scales = @(100, 200) },
        @{ Name = 'SmallTile';         W = 71;  H = 71;  Fill = 0.62; Scales = @(100, 200) },
        @{ Name = 'LargeTile';         W = 310; H = 310; Fill = 0.55; Scales = @(100, 200) },
        @{ Name = 'StoreLogo';         W = 50;  H = 50;  Fill = 0.86; Scales = @(100, 200, 400) },
        @{ Name = 'SplashScreen';      W = 620; H = 300; Fill = 0.50; Scales = @(100, 200) }
    )

    Write-Host "Writing MSIX assets to $OutDir"
    foreach ($a in $assets) {
        foreach ($s in $a.Scales) {
            $w = [int]($a.W * $s / 100); $h = [int]($a.H * $s / 100)
            $name = if ($s -eq 100) { "$($a.Name).png" } else { "$($a.Name).scale-$s.png" }
            Save-Asset $name $w $h $a.Fill
        }
    }
    # Taskbar / Start / Alt-Tab icons (unplated = no accent-colour backplate).
    foreach ($size in 16, 24, 32, 48, 256) {
        Save-Asset "Square44x44Logo.targetsize-$size.png" $size $size 0.92
        Save-Asset "Square44x44Logo.targetsize-${size}_altform-unplated.png" $size $size 0.92
    }
} finally {
    $src.Dispose()
}
Write-Host 'Done.'
