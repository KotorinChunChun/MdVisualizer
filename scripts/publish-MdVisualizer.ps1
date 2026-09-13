#Requires -Version 7.0

# 旧名称との互換入口。新しい正規名へ引数をそのまま転送する。
& (Join-Path $PSScriptRoot 'publish-release-MdVisualizer-all.ps1') @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
