#Requires -Version 7.0

# 旧名称との互換入口。App Installer生成の正規補助名へ転送する。
& (Join-Path $PSScriptRoot 'package-MdVisualizer-appinstaller.ps1') @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
