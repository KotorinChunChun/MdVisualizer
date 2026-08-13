[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'release-MarkdownViewer.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "MarkdownViewer-release-script-$PID"
$sourcePath = Join-Path $testRoot 'build\markdown-viewer.exe'

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $sourcePath) -Force | Out-Null
    [System.IO.File]::WriteAllText($sourcePath, 'new release executable')

    $scriptText = Get-Content -LiteralPath $scriptPath -Raw
    $null = [ScriptBlock]::Create($scriptText)
    foreach ($requiredSafetyText in @(
        "Get-AppxPackage -Name `$PackageIdentityName",
        'Get-MsixExecutableCandidates',
        "'takeown.exe'",
        "'icacls.exe'",
        'Set-Acl -LiteralPath $Target.Path',
        'MSIXの署名整合性は失われます'
    )) {
        if (-not $scriptText.Contains($requiredSafetyText)) {
            throw "MSIX強制置換の必須処理が見つかりません: $requiredSafetyText"
        }
    }

    $installedPackage = Get-AppxPackage -Name 'com.markdownviewer.viewer' -ErrorAction SilentlyContinue |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if ($installedPackage) {
        $beforeHash = (Get-FileHash -LiteralPath (Join-Path $installedPackage.InstallLocation 'markdown-viewer.exe') -Algorithm SHA256).Hash
        $whatIfOutput = (& $scriptPath -SkipBuild -BuiltExePath $sourcePath -WhatIf 6>&1 | Out-String)
        if (-not $whatIfOutput.Contains($installedPackage.PackageFullName)) {
            throw 'WhatIfで登録済みMSIXパッケージが自動検出されませんでした。'
        }
        if (-not $whatIfOutput.Contains('WhatIf のためMSIX内exeの差し替えを実行しませんでした')) {
            throw 'WhatIfでMSIX内exeの差し替えが抑止されませんでした。'
        }
        $afterHash = (Get-FileHash -LiteralPath (Join-Path $installedPackage.InstallLocation 'markdown-viewer.exe') -Algorithm SHA256).Hash
        if ($beforeHash -ne $afterHash) {
            throw 'WhatIf実行でMSIX内exeが変更されました。'
        }
    }

    $invalidWindowsAppsError = $null
    try {
        & $scriptPath `
            -SkipBuild `
            -BuiltExePath $sourcePath `
            -InstalledExePath (Join-Path $env:ProgramFiles 'WindowsApps\fake\markdown-viewer.exe')
    }
    catch {
        $invalidWindowsAppsError = $_.Exception.Message
    }
    if (
        -not $invalidWindowsAppsError -or
        -not $invalidWindowsAppsError.Contains('登録済み com.markdownviewer.viewer パッケージ')
    ) {
        throw '登録済みMSIX外のWindowsAppsパスが拒否されませんでした。'
    }

    Write-Host 'デバッグ用MSIX exe更新スクリプトの安全テストに成功しました。' -ForegroundColor Green
    Write-Host 'WindowsApps内の実ファイルは変更していません。' -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
