#Requires -Version 7
<#
.SYNOPSIS
  Builds the Microsoft Store flavor of Volt and packs it as an MSIX.

.DESCRIPTION
  1. Builds the "store" flavor (unless -SkipBuild / -ExePath):
       VITE_VOLT_DISTRIBUTION=msstore      -> frontend self-updater inert
       --features store                    -> MSIX startup task + toast AUMID
       --config src-tauri/tauri.store.conf.json -> no updater artifacts,
                                              empty updater endpoints
       --no-bundle                         -> only volt.exe, no NSIS/MSI
     through scripts/build.ps1 (same .env loading as the regular build).
  2. Stages a layout in <OutDir>/layout: volt.exe (+ any DLL next to it),
     packaging/msix/Assets, AppxManifest.xml rendered from
     packaging/msix/AppxManifest.template.xml + msix.config.json.
  3. Packs with `winapp pack` or `makeappx pack` (+ makepri for resources.pri),
     whichever is available (-Packer to force one).
  4. Optionally signs with a test certificate you created yourself (-CertPath)
     for LOCAL SIDELOAD ONLY. This script never creates, imports or installs a
     certificate and never installs the package.

  The unsigned .msix is what you upload to Partner Center: the Store re-signs it.
  The regular NSIS/MSI + updater + winget channel is untouched.

.EXAMPLE
  # Store upload candidate (unsigned)
  pwsh -File scripts/package-msix.ps1

.EXAMPLE
  # Local sideload test with your own self-signed certificate
  & ./scripts/package-msix.ps1 -CertPath C:\certs\volt-test.pfx -CertPassword (Read-Host -AsSecureString)

.EXAMPLE
  # Re-pack an already built exe / validate the pipeline without building
  pwsh -File scripts/package-msix.ps1 -SkipBuild
  pwsh -File scripts/package-msix.ps1 -ExePath path\to\volt.exe -RenderOnly
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$OutDir,
    # Use an existing executable instead of building (dry runs / CI artifacts).
    [string]$ExePath,
    [switch]$SkipBuild,
    # 4-part version override (e.g. 0.4.0.0). Default: msix.config.json "version"
    # or package.json version + ".0".
    [string]$Version,
    [ValidateSet('auto', 'winapp', 'makeappx')]
    [string]$Packer = 'auto',
    # Stage + render + validate the manifest only; do not pack.
    [switch]$RenderOnly,
    # Optional: .pfx for local sideload testing. Never used for Store uploads.
    [string]$CertPath,
    [SecureString]$CertPassword,
    # Regenerate packaging/msix/Assets from src-tauri/icons/icon.png.
    [switch]$RegenerateAssets
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$MsixDir = Join-Path $RepoRoot 'packaging/msix'
if (-not $ConfigPath) { $ConfigPath = Join-Path $MsixDir 'msix.config.json' }
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'target/msix' }
$OutDir = [System.IO.Path]::GetFullPath($OutDir, $RepoRoot).TrimEnd('\', '/')
$layout = [System.IO.Path]::GetFullPath((Join-Path $OutDir 'layout'))
# Rebuilds own only the layout child of the explicitly chosen output directory.
# Check absolute paths and existing ancestors before any recursive deletion:
# a junction must never redirect cleanup into another directory.
if ($OutDir -eq [System.IO.Path]::GetPathRoot($OutDir).TrimEnd('\', '/') -or
    $OutDir -eq $RepoRoot -or
    $RepoRoot.StartsWith("$OutDir\", [System.StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetDirectoryName($layout) -ne $OutDir) {
    throw "Unsafe MSIX output directory: $OutDir"
}
$ancestor = $layout
while ($ancestor) {
    if (Test-Path -LiteralPath $ancestor) {
        $item = Get-Item -LiteralPath $ancestor -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "MSIX output path crosses a junction or symbolic link: $ancestor"
        }
    }
    $ancestor = [System.IO.Path]::GetDirectoryName($ancestor)
}
$TemplatePath = Join-Path $MsixDir 'AppxManifest.template.xml'
$AssetsDir = Join-Path $MsixDir 'Assets'
$StoreConfig = Join-Path $RepoRoot 'src-tauri/tauri.store.conf.json'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

# ── Tool discovery ────────────────────────────────────────────────────────────
function Find-SdkTool([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path $kits) {
        $hit = Get-ChildItem $kits -Directory |
            Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
            Sort-Object { [version]$_.Name } -Descending |
            ForEach-Object { Join-Path $_.FullName "x64\$Name" } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    Write-Host "  > $(Split-Path $Exe -Leaf) $($Arguments -join ' ')" -ForegroundColor DarkGray
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path $Exe -Leaf) failed with exit code $LASTEXITCODE" }
}

# ── Config + version ──────────────────────────────────────────────────────────
Write-Step 'Reading configuration'
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
foreach ($key in 'identityName', 'publisher', 'publisherDisplayName', 'displayName', 'description', 'architecture', 'executable', 'minWindowsVersion', 'maxVersionTested') {
    if ([string]::IsNullOrWhiteSpace($config.$key)) { throw "msix.config.json: '$key' is missing or empty" }
}
if ($config.identityName -notmatch '^[A-Za-z0-9.\-]{3,50}$') {
    throw "msix.config.json: identityName '$($config.identityName)' must be 3-50 chars of [A-Za-z0-9.-]"
}
if ($config.publisher -notmatch '^CN=') {
    throw "msix.config.json: publisher must be a distinguished name starting with 'CN=' (copy it from Partner Center)"
}
if ($config.architecture -ne 'x64') {
    throw 'Only x64 MSIX builds are supported by this script.'
}
if ($config.executable -notmatch '^[A-Za-z0-9_.-]+\.exe$') {
    throw 'msix.config.json: executable must be a bare .exe filename, without directory components.'
}
foreach ($key in 'minWindowsVersion', 'maxVersionTested') {
    if ($config.$key -notmatch '^\d+\.\d+\.\d+\.\d+$' -or
        ($config.$key.Split('.') | Where-Object { [decimal]$_ -gt 65535 })) {
        throw "msix.config.json: '$key' must contain four integers from 0 to 65535."
    }
}
if ([version]$config.minWindowsVersion -gt [version]$config.maxVersionTested) {
    throw 'msix.config.json: minWindowsVersion exceeds maxVersionTested.'
}

if (-not $Version) {
    if ($config.version -and $config.version -ne 'auto') {
        $Version = $config.version
    } else {
        $pkgVersion = (Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json).version
        $core = ($pkgVersion -split '[-+]')[0]
        if ($core -ne $pkgVersion) {
            Write-Warning "package.json version '$pkgVersion' has a pre-release/build suffix; MSIX uses '$core.0'."
        }
        $Version = "$core.0"
    }
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Invalid MSIX version '$Version' (expected a.b.c.d)" }
if ($Version.Split('.') | Where-Object { [decimal]$_ -gt 65535 }) {
    throw "Invalid MSIX version '$Version': each component must be at most 65535."
}
if ($Version -notmatch '\.0$') {
    Write-Warning "Version ${Version}: the Microsoft Store requires the 4th part to be 0. Fine for local tests only."
}

$isPlaceholder = $config.identityName -match 'LocalTest|PLACEHOLDER' -or $config.publisher -match 'LOCAL-TEST|PLACEHOLDER'
Write-Host "  Identity : $($config.identityName)"
Write-Host "  Publisher: $($config.publisher)"
Write-Host "  Version  : $Version ($($config.architecture))"
if ($isPlaceholder) {
    Write-Warning 'msix.config.json still holds LOCAL TEST identity values: this package cannot be uploaded to Partner Center. Paste the Partner Center values first (docs/build-release/MICROSOFT_STORE.md).'
}

# ── Build ─────────────────────────────────────────────────────────────────────
function Get-ReleaseDirectory {
    $cargoRoot = Join-Path $RepoRoot 'src-tauri'
    $targetDir = if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
        Join-Path $cargoRoot 'target'
    } else {
        # Tauri runs Cargo from src-tauri; match its base for relative paths.
        [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR, $cargoRoot)
    }
    Join-Path $targetDir 'release'
}
if ($ExePath) {
    $exe = (Resolve-Path $ExePath).Path
    Write-Warning 'Using an explicit executable: its store feature, updater configuration and release profile are NOT verified by this script.'
} else {
    if (-not $SkipBuild) {
        Write-Step 'Building the store flavor (tauri build --no-bundle --features store)'
        $previous = $env:VITE_VOLT_DISTRIBUTION
        $env:VITE_VOLT_DISTRIBUTION = 'msstore'
        try {
            & (Join-Path $PSScriptRoot 'build.ps1') -Store --no-bundle --features store --config $StoreConfig
            if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
        } finally {
            $env:VITE_VOLT_DISTRIBUTION = $previous
        }
    } else {
        Write-Warning 'Reusing an existing executable: rebuild without -SkipBuild before Store submission to ensure the store flavor is current.'
    }
    # build.ps1 also loads .env, which may set CARGO_TARGET_DIR. Resolve after
    # the build so staging uses the same target directory as Cargo.
    $releaseDir = Get-ReleaseDirectory
    $exe = Join-Path $releaseDir $config.executable
}
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Executable not found: $exe (build first or pass -ExePath)" }
if ($exe.StartsWith("$layout\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The source executable is inside the layout that will be rebuilt. Move it outside the output layout first.'
}

# ── Assets ────────────────────────────────────────────────────────────────────
if ($RegenerateAssets -or -not (Test-Path (Join-Path $AssetsDir 'Square44x44Logo.png'))) {
    Write-Step 'Generating MSIX assets'
    & (Join-Path $PSScriptRoot 'generate-msix-assets.ps1') -OutDir $AssetsDir -Force
}

# ── Layout ────────────────────────────────────────────────────────────────────
Write-Step "Staging layout in $OutDir"
if (Test-Path -LiteralPath $layout) { Remove-Item -LiteralPath $layout -Recurse -Force }
New-Item -ItemType Directory -Force -Path $layout | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $layout $config.executable)
# Runtime DLLs dropped next to the exe by the build. The default fastembed/ort
# prebuilt ONNX Runtime is linked statically; custom dynamic builds may need
# DLLs here. Tauri links its VC runtime and WebView2Loader statically; the ONNX
# C++ STL imports are provided by the manifest's desktop VCLibs dependency. Only for our own
# build output: an -ExePath may live in a folder full of unrelated DLLs.
$dlls = if ($ExePath) { @() } else { Get-ChildItem $releaseDir -Filter *.dll -File -ErrorAction SilentlyContinue }
foreach ($dll in $dlls) {
    Write-Host "  + $($dll.Name)"
    Copy-Item -LiteralPath $dll.FullName -Destination $layout
}
Copy-Item -LiteralPath $AssetsDir -Destination (Join-Path $layout 'Assets') -Recurse

# ── Manifest ──────────────────────────────────────────────────────────────────
Write-Step 'Rendering AppxManifest.xml'
function ConvertTo-XmlText([string]$Value) { [System.Security.SecurityElement]::Escape($Value) }
$tokens = [ordered]@{
    IDENTITY_NAME          = $config.identityName
    PUBLISHER              = $config.publisher
    PUBLISHER_DISPLAY_NAME = $config.publisherDisplayName
    DISPLAY_NAME           = $config.displayName
    DESCRIPTION            = $config.description
    VERSION                = $Version
    ARCH                   = $config.architecture
    EXECUTABLE             = $config.executable
    MIN_VERSION            = $config.minWindowsVersion
    MAX_VERSION_TESTED     = $config.maxVersionTested
}
$manifest = Get-Content $TemplatePath -Raw
foreach ($entry in $tokens.GetEnumerator()) {
    $manifest = $manifest.Replace("{{$($entry.Key)}}", (ConvertTo-XmlText $entry.Value))
}
$left = [regex]::Matches($manifest, '\{\{[A-Z_]+\}\}') | ForEach-Object Value | Sort-Object -Unique
if ($left) { throw "Unresolved manifest tokens: $($left -join ', ')" }
try { [xml]$manifest | Out-Null } catch { throw "Rendered manifest is not well-formed XML: $($_.Exception.Message)" }
$manifestPath = Join-Path $layout 'AppxManifest.xml'
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

# Every asset referenced by the manifest must exist in the layout.
$missing = [regex]::Matches($manifest, 'Assets\\[A-Za-z0-9_.\-]+\.png') | ForEach-Object Value | Sort-Object -Unique |
    Where-Object { -not (Test-Path (Join-Path $layout $_)) }
if ($missing) { throw "Assets referenced by the manifest are missing: $($missing -join ', ')" }
Write-Host "  OK: $manifestPath"

if ($RenderOnly) {
    Write-Host "`nRender-only run: layout ready in $layout (not packed)." -ForegroundColor Green
    return
}

# ── Pack ──────────────────────────────────────────────────────────────────────
$msixName = "Volt_$($Version)_$($config.architecture).msix"
$msixPath = Join-Path $OutDir $msixName
if (Test-Path -LiteralPath $msixPath) { Remove-Item -LiteralPath $msixPath -Force }

$winapp = Get-Command winapp -ErrorAction SilentlyContinue
$makeappx = Find-SdkTool 'makeappx.exe'
$tool = switch ($Packer) {
    'winapp' { if ($winapp) { 'winapp' } else { $null } }
    'makeappx' { if ($makeappx) { 'makeappx' } else { $null } }
    default { if ($winapp) { 'winapp' } elseif ($makeappx) { 'makeappx' } else { $null } }
}
if (-not $tool) {
    throw @"
No MSIX packer found (requested: $Packer). Install ONE of:
  - Windows App Development CLI : winget install Microsoft.winappcli --source winget
  - Windows SDK (makeappx/makepri/signtool): https://developer.microsoft.com/windows/downloads/windows-sdk/
Then re-run with -SkipBuild to reuse the build.
"@
}

$plainPassword = $null
if ($CertPath) {
    $CertPath = (Resolve-Path $CertPath).Path
    if ($CertPassword) { $plainPassword = ConvertFrom-SecureString $CertPassword -AsPlainText }
    Write-Warning 'Signing with a test certificate: LOCAL SIDELOAD ONLY. Upload the unsigned package to the Store.'
}

if ($tool -eq 'winapp') {
    Write-Step "Packing with winapp ($($winapp.Source))"
    $packArgs = @('pack', $layout, '--manifest', $manifestPath, '--output', $msixPath, '--executable', $config.executable)
    if ($CertPath) {
        $packArgs += @('--cert', $CertPath)
        if ($plainPassword) { $packArgs += @('--cert-password', $plainPassword) }
    } else {
        $packArgs += '--no-sign'
    }
    $shown = $packArgs -join ' '
    if ($plainPassword) { $shown = $shown.Replace($plainPassword, '***') } # never echo the password
    Write-Host "  > winapp $shown" -ForegroundColor DarkGray
    & $winapp.Source @packArgs
    if ($LASTEXITCODE -ne 0) { throw "winapp pack failed with exit code $LASTEXITCODE" }
} else {
    Write-Step "Packing with makeappx ($makeappx)"
    $makepri = Find-SdkTool 'makepri.exe'
    if ($makepri) {
        # resources.pri lets Windows pick the .scale-*/.targetsize-* assets.
        $priDir = Join-Path $OutDir 'pri'
        New-Item -ItemType Directory -Force -Path $priDir | Out-Null
        $priConfig = Join-Path $priDir 'priconfig.xml'
        Invoke-Native $makepri @('createconfig', '/cf', $priConfig, '/dq', 'en-US_fr-FR', '/pv', '10.0.0', '/o')
        # Drop the <packaging> section: it splits resources into resource packs,
        # which only make sense for .msixbundle uploads.
        [xml]$pc = Get-Content $priConfig -Raw
        $packaging = $pc.SelectSingleNode('//packaging')
        if ($packaging) { [void]$packaging.ParentNode.RemoveChild($packaging); $pc.Save($priConfig) }
        Invoke-Native $makepri @('new', '/pr', $layout, '/cf', $priConfig, '/mn', $manifestPath, '/of', (Join-Path $layout 'resources.pri'), '/o')
    } else {
        Write-Warning 'makepri.exe not found: packing without resources.pri (scaled/targetsize assets ignored, base assets used).'
    }
    Invoke-Native $makeappx @('pack', '/d', $layout, '/p', $msixPath, '/o')

    if ($CertPath) {
        $signtool = Find-SdkTool 'signtool.exe'
        if (-not $signtool) { throw 'signtool.exe not found (Windows SDK) - cannot sign the test package.' }
        $signArgs = @('sign', '/fd', 'SHA256', '/f', $CertPath)
        if ($plainPassword) { $signArgs += @('/p', $plainPassword) }
        $signArgs += $msixPath
        Write-Host "  > signtool sign /fd SHA256 /f $CertPath $(if ($plainPassword) { '/p ***' }) $msixPath" -ForegroundColor DarkGray
        & $signtool @signArgs
        if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE (the certificate subject must equal the manifest Publisher '$($config.publisher)')" }
    }
}
$plainPassword = $null

if (-not (Test-Path $msixPath)) { throw "Packer reported success but $msixPath was not produced." }
$size = '{0:N1} MB' -f ((Get-Item $msixPath).Length / 1MB)
Write-Host "`nMSIX ready: $msixPath ($size)" -ForegroundColor Green
if ($CertPath) {
    Write-Host 'Signed with your test certificate - see scripts/msix-local-test.md to install it locally.'
} else {
    if ($isPlaceholder) {
        Write-Host 'Unsigned LOCAL TEST package - replace the identity from Partner Center before Store submission.'
    } elseif ($ExePath -or $SkipBuild) {
        Write-Host 'Unsigned package - rebuild the store flavor before submission; the reused executable has not been verified.'
    } else {
        Write-Host 'Unsigned Store candidate - complete local testing and certification checks before upload to Partner Center.'
    }
}
