function Get-VersionLogDirectory {
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$Scenario,
        [string]$TargetVersion = $env:MDVISUALIZER_VERSION,
        [string]$OutputDirectory
    )
    if ([string]::IsNullOrWhiteSpace($TargetVersion)) {
        $packageJsonPath = Join-Path $ProjectRoot 'package.json'
        if (Test-Path -LiteralPath $packageJsonPath -PathType Leaf) {
            $packageVersion = (Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json).version
            if ($packageVersion -match '^(\d+\.\d+\.\d+(?:\.\d+)?)') {
                $TargetVersion = "v$($Matches[1])"
            }
        }
    }
    if ($TargetVersion -notmatch '^v?\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.-]+)?$') {
        throw '対象版を-TargetVersionまたはMDVISUALIZER_VERSIONで指定してください（例: v0.0.18）。package.jsonのversionも利用できます。'
    }
    if (-not $TargetVersion.StartsWith('v')) { $TargetVersion = 'v' + $TargetVersion }
    $base = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "dev/history/$TargetVersion/logs"))
    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $runName = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + $Scenario + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
        return Join-Path $base $runName
    }
    $resolved = [IO.Path]::GetFullPath($OutputDirectory)
    if (-not $resolved.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw '出力先は対象版のlogs配下の実行フォルダーにしてください。'
    }
    return $resolved
}
Export-ModuleMember -Function Get-VersionLogDirectory
