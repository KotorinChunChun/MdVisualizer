#Requires -Version 7.0

# 旧名称との互換入口。開発用MSIX内exe差し替えの正規名へ転送する。
& (Join-Path $PSScriptRoot 'replace-MdVisualizer-installed-msix-executable.ps1') @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
