<#
.SYNOPSIS
    pip0 シェル（C#）を、Windows 11（x64）用の1つの exe にビルドし、出力先のフォルダーを表示します。

.DESCRIPTION
    shell\Pip0Shell.csproj を、次のコマンドでビルド（dotnet publish）します。

        dotnet publish shell\Pip0Shell.csproj -c Release -r win-x64 --self-contained true
            -p:PublishSingleFile=true -o shell\bin\publish\win-x64

      -c Release                   ：配布用の設定でビルドする
      -r win-x64                   ：Windows（x64）用にする
      --self-contained true        ：.NET の実行環境ごと出力する（使う PC に .NET を入れなくてよい）
      -p:PublishSingleFile=true    ：Pip0Shell.exe の1つのファイルにまとめる（Pip0Shell.pdb はデバッグ用の情報）
      -o shell\bin\publish\win-x64 ：出力先。scripts\install.ps1 の -ShellPublishDir の既定値と同じ

    - ビルドには .NET 8 SDK（またはそれ以降の SDK）が必要です。初回は NuGet から部品（CsWin32、Windows 用の
      .NET の実行環境）をダウンロードします。これは開発のときの取得で、pip0 の通常の運用では通信しません。
    - 出力先のフォルダー（shell\bin\publish\win-x64）は、古い exe が残らないように、ビルドの前に消して作り直します。
      消すのはこのフォルダーだけです（shell\bin は Git の管理外のビルドの出力です）。
    - このビルド（dotnet のコマンド）の間だけ、.NET SDK の利用状況の送信（テレメトリー）を止めます。
    - csproj が EnableWindowsTargeting を有効にしているため、Windows 以外の PowerShell 7 からもビルドできます。
    - できた exe には、コード署名がありません（docs\setup-windows.md の「困ったとき」を参照）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-shell.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host $Message
}

# インストールされている .NET SDK の、いちばん新しい主版（8 など）を返します。なければ 0
function Get-LatestSdkMajor([string]$Dotnet) {
    # 標準エラー出力の行で止まらないようにする（Windows PowerShell 5.1 の対策）
    $ErrorActionPreference = 'Continue'
    $latest = 0
    $lines = @(& $Dotnet --list-sdks 2>$null)
    foreach ($line in $lines) {
        if ([string]$line -match '^(\d+)\.') {
            $major = [int]$Matches[1]
            if ($major -gt $latest) {
                $latest = $major
            }
        }
    }
    return $latest
}

$savedTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
$savedNoLogo = $env:DOTNET_NOLOGO

try {
    $root = Split-Path -Path $PSScriptRoot -Parent
    $shellDir = Join-Path $root 'shell'
    $project = Join-Path $shellDir 'Pip0Shell.csproj'
    $binDir = Join-Path $shellDir 'bin'
    $outputDir = Join-Path (Join-Path $binDir 'publish') 'win-x64'

    if (-not (Test-Path -LiteralPath $project -PathType Leaf)) {
        throw ('pip0 シェルのプロジェクトが見つかりません：' + $project)
    }
    $dotnetCommand = Get-Command -Name 'dotnet' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $dotnetCommand) {
        throw ('dotnet が見つかりません。.NET 8 SDK を入れてください（https://dotnet.microsoft.com/download/dotnet/8.0）。' +
            '入れた後は、PowerShell を開き直してください。')
    }
    $dotnet = $dotnetCommand.Path

    # dotnet の利用状況の送信を、このビルドの間だけ止める（終わったら元に戻す）
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_NOLOGO = '1'

    $sdkMajor = Get-LatestSdkMajor $dotnet
    if ($sdkMajor -lt 8) {
        throw ('.NET 8 以降の SDK が見つかりません（dotnet --list-sdks）。.NET 8 SDK を入れてください（https://dotnet.microsoft.com/download/dotnet/8.0）。')
    }
    Write-Step ('.NET SDK：' + $sdkMajor + '.x（' + $dotnet + '）')

    # 古い出力を消す（出力先が shell\bin の中であることを確かめてから）
    if (Test-Path -LiteralPath $outputDir) {
        $fullOutput = [System.IO.Path]::GetFullPath($outputDir)
        $fullBin = [System.IO.Path]::GetFullPath($binDir).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $fullOutput.StartsWith($fullBin, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw ('出力先が shell\bin の中ではないため、消しません：' + $fullOutput)
        }
        Remove-Item -LiteralPath $outputDir -Recurse -Force
        Write-Step ('前の出力を消しました：' + $outputDir)
    }

    $arguments = @(
        'publish', $project,
        '-c', 'Release',
        '-r', 'win-x64',
        '--self-contained', 'true',
        '-p:PublishSingleFile=true',
        '-o', $outputDir,
        '--nologo'
    )
    Write-Step ('実行：dotnet ' + ($arguments -join ' '))
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    & $dotnet @arguments
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($exitCode -ne 0) {
        throw ('ビルドに失敗しました（dotnet の終了コード ' + $exitCode + '）。上のエラーを確かめてください。')
    }

    $exe = Join-Path $outputDir 'Pip0Shell.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        throw ('ビルドは終わりましたが、Pip0Shell.exe が見つかりません：' + $exe)
    }

    Write-Host ''
    Write-Host 'pip0 シェルをビルドしました。' -ForegroundColor Green
    Write-Step ('出力先のフォルダー：' + $outputDir)
    foreach ($file in @(Get-ChildItem -LiteralPath $outputDir -File | Sort-Object Name)) {
        Write-Step ('  ' + $file.Name + '（' + [math]::Round($file.Length / 1MB, 1) + ' MB）')
    }
    Write-Step ''
    Write-Step '次は scripts\install.ps1 で導入します（このフォルダーの中身が、導入先の shell\ に写されます）。'
    exit 0
}
catch {
    Write-Host ('エラー：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
finally {
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = $savedTelemetry
    $env:DOTNET_NOLOGO = $savedNoLogo
}
