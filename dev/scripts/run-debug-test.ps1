# =============================================================================
#  動作テスト用起動スクリプト (run-test.ps1)
#  - 処理内容: samples/sample.md を引数に指定して Tauri アプリを開発モード起動
#  - 使い方: pwsh c:\develop\MarkdownViewer\dev\scripts\run-test.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'

# スクリプトの存在するディレクトリ（dev/scripts/）から2階層上をプロジェクトルートとする
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\")
Push-Location $ProjectRoot

$SampleFile = Join-Path $ProjectRoot "samples\sample.md"

if (-not (Test-Path $SampleFile)) {
    Write-Error "テスト用Markdownファイルが見つかりません: $SampleFile"
    exit 1
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " MarkdownViewer テスト起動スクリプト" -ForegroundColor Cyan
Write-Host " 対象ファイル: $SampleFile" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

npm run tauri -- dev -- -- "$SampleFile"
