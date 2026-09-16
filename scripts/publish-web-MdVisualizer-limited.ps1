[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Publish', 'Verify')]
    [string]$Mode = 'Plan',
    [string]$Version,
    [switch]$PublishConfirmed,
    [string]$PythonPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$versionPattern = '^v\d+\.\d+\.\d+(?:\.\d+)?$'
if ([string]::IsNullOrWhiteSpace($Version)) {
    Write-Host 'Versionの凡例: vで始まる3桁または4桁の数字を指定します。'
    Write-Host '入力例: v0.0.18 または v0.0.18.1（現在のbeta版: v0.0.18.1）'
    $Version = Read-Host 'Version'
}
if ($Version -notmatch $versionPattern) {
    throw "Versionの形式が不正です。v0.0.18 または v0.0.18.1 の形式で指定してください: $Version"
}

if ($Mode -eq 'Publish' -and -not $PublishConfirmed) {
    throw 'Publish は公開承認済みの場合だけ -PublishConfirmed を指定して実行してください。'
}

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $python = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $python) { throw 'Python が見つかりません。-PythonPath を指定してください。' }
    $PythonPath = $python.Source
}
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw '指定された Python 実行ファイルが見つかりません。'
}

$arguments = @('-X', 'utf8', '-B', (Join-Path $PSScriptRoot 'web_limited_publish.py'), '--mode', $Mode, '--version', $Version)
if ($PublishConfirmed) { $arguments += '--publish-confirmed' }
& $PythonPath @arguments
if ($LASTEXITCODE -ne 0) { throw "Web 限定公開処理が終了コード $LASTEXITCODE で失敗しました。" }
