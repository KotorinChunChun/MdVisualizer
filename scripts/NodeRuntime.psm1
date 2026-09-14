Set-StrictMode -Version Latest

function Get-MdVisualizerNodeRuntime {
    param(
        [Parameter(Mandatory)][string]$ProjectRoot
    )

    $candidateRoots = [Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($env:MDVISUALIZER_NODE_ROOT)) {
        $candidateRoots.Add($env:MDVISUALIZER_NODE_ROOT)
    }
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot '.tools') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { $candidateRoots.Add($_.FullName) }
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $candidateRoots.Add((Join-Path $env:USERPROFILE 'scoop\apps\nodejs-lts\current'))
        $candidateRoots.Add((Join-Path $env:USERPROFILE 'scoop\apps\nodejs\current'))
    }
    $candidateRoots.Add('C:\Program Files\nodejs')

    $nodeCommand = Get-Command 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nodeCommand) {
        $candidateRoots.Add((Split-Path -Parent $nodeCommand.Source))
    }

    foreach ($candidateRoot in $candidateRoots) {
        if ([string]::IsNullOrWhiteSpace($candidateRoot)) { continue }
        $root = [IO.Path]::GetFullPath($candidateRoot)
        $node = Join-Path $root 'node.exe'
        $npmCli = Join-Path $root 'node_modules\npm\bin\npm-cli.js'
        if ((Test-Path -LiteralPath $node -PathType Leaf) -and (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
            $cargoCandidates = @(
                [pscustomobject]@{ Bin = (Join-Path $env:CARGO_HOME 'bin'); CargoHome = $env:CARGO_HOME; RustupHome = $env:RUSTUP_HOME },
                [pscustomobject]@{ Bin = (Join-Path $env:USERPROFILE '.cargo\bin'); CargoHome = (Join-Path $env:USERPROFILE '.cargo'); RustupHome = (Join-Path $env:USERPROFILE '.rustup') },
                [pscustomobject]@{ Bin = (Join-Path $env:USERPROFILE 'scoop\apps\rustup-msvc\current\.cargo\bin'); CargoHome = (Join-Path $env:USERPROFILE 'scoop\apps\rustup-msvc\current\.cargo'); RustupHome = (Join-Path $env:USERPROFILE 'scoop\apps\rustup-msvc\current\.rustup') }
            )
            $cargoRuntime = $cargoCandidates | Where-Object {
                -not [string]::IsNullOrWhiteSpace($_.Bin) -and (Test-Path -LiteralPath (Join-Path $_.Bin 'cargo.exe') -PathType Leaf)
            } | Select-Object -First 1
            return [pscustomobject]@{
                NodeExecutable = $node
                NpmCli = $npmCli
                NodeRoot = $root
                CargoBin = if ($cargoRuntime) { $cargoRuntime.Bin } else { $null }
                CargoHome = if ($cargoRuntime) { $cargoRuntime.CargoHome } else { $null }
                RustupHome = if ($cargoRuntime) { $cargoRuntime.RustupHome } else { $null }
            }
        }
    }

    throw 'Node.js と npm が見つかりません。Node.jsをインストールするか、MDVISUALIZER_NODE_ROOT に node.exe と node_modules\\npm を含むフォルダーを指定してください。'
}

function Invoke-MdVisualizerNpm {
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $runtime = Get-MdVisualizerNodeRuntime -ProjectRoot $ProjectRoot
    $previousPath = $env:Path
    $previousCargoHome = $env:CARGO_HOME
    $previousRustupHome = $env:RUSTUP_HOME
    $pathEntries = @($runtime.NodeRoot)
    if ($runtime.CargoBin) {
        $pathEntries += $runtime.CargoBin
        $env:CARGO_HOME = $runtime.CargoHome
        $env:RUSTUP_HOME = $runtime.RustupHome
    }
    $env:Path = "$(($pathEntries -join ';'));$previousPath"
    try {
        & $runtime.NodeExecutable $runtime.NpmCli @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($Arguments -join ' ') が終了コード $LASTEXITCODE で失敗しました。"
        }
    }
    finally {
        $env:Path = $previousPath
        $env:CARGO_HOME = $previousCargoHome
        $env:RUSTUP_HOME = $previousRustupHome
    }
}

Export-ModuleMember -Function Get-MdVisualizerNodeRuntime, Invoke-MdVisualizerNpm
