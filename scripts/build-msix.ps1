#Requires -Version 7.0

# 旧名称との互換入口。MSIX生成の正規補助名へ転送する。
& (Join-Path $PSScriptRoot 'package-MdVisualizer-msix.ps1') @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
