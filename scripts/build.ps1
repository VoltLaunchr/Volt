param(
    [switch]$Store,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TauriArgs
)

# Load .env file into the current process environment before running tauri build
$envFile = Join-Path $PSScriptRoot '..' '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#\s][^=]*)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
        }
    }
}

# A store build must keep its distribution owner even when .env contains a
# value for the direct channel. Apply this override after loading .env.
$previousDistribution = $env:VITE_VOLT_DISTRIBUTION
try {
    if ($Store) { $env:VITE_VOLT_DISTRIBUTION = 'msstore' }
    corepack pnpm exec tauri build @TauriArgs
} finally {
    if ($Store) { $env:VITE_VOLT_DISTRIBUTION = $previousDistribution }
}
