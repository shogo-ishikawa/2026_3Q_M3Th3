<#
.SYNOPSIS
    サインインしたときに pip0 を自動で起動するかどうかを、今のユーザーだけについて切り替えます（使う場合だけ。既定はオフ）。

.DESCRIPTION
    今のユーザーの「スタートアップ」フォルダー（%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup）に、
    ショートカット pip0.lnk を置く・消すだけです。
    ショートカットは、導入先の runtime\pythonw.exe を「-I -m pip0 serve」で起動します（画面のない Python）。

    次のものは使いません：すべてのユーザーのスタートアップ、レジストリーの Run キー、タスク スケジューラー、管理者の権限。

    -Enable   ショートカットを置きます（すでにあれば、作り直します）。
    -Disable  ショートカットを消します（pip0 が置いたものでなければ、消しません）。
    どちらも付けないときは、今の状態を表示します。

    Windows 11 の「設定」→「アプリ」→「スタートアップ」でも、この項目のオン／オフを切り替えられます。
    そこでオフにした場合は、ショートカットがあっても起動しません。

.PARAMETER Enable
    自動起動をオンにします。

.PARAMETER Disable
    自動起動をオフにします。

.PARAMETER InstallDir
    pip0 の導入先。既定は %LOCALAPPDATA%\Programs\pip0（-Enable のときに使います）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\autostart.ps1" -Enable

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\autostart.ps1" -Disable
#>
[CmdletBinding()]
param(
    [switch]$Enable,
    [switch]$Disable,
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\pip0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ShortcutName = 'pip0.lnk'
$ServeArguments = '-I -m pip0 serve'

function Write-Step([string]$Message) {
    Write-Host $Message
}

function Resolve-FullPath([string]$Path) {
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $full = [System.IO.Path]::GetFullPath($full)
    $root = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $root.Length) {
        $full = $full.TrimEnd('\')
    }
    return $full
}

# 今のユーザーのスタートアップ フォルダーにある、pip0 のショートカットの場所
function Get-ShortcutPath {
    $startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    if ([string]::IsNullOrEmpty($startup)) {
        throw 'スタートアップ フォルダーの場所を読めませんでした。'
    }
    return (Join-Path $startup $ShortcutName)
}

# ショートカットの中身（起動するプログラムと引数）を読みます
function Read-Shortcut([string]$Path) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    return [pscustomobject]@{ Target = [string]$link.TargetPath; Arguments = [string]$link.Arguments }
}

# pip0 が置いたショートカットか（pip0 専用の Python で「-m pip0 serve」を起動するもの）
function Test-IsPip0Shortcut($Shortcut) {
    $isPythonw = $Shortcut.Target.EndsWith('\runtime\pythonw.exe', [System.StringComparison]::OrdinalIgnoreCase)
    return ($isPythonw -and $Shortcut.Arguments.Contains('-m pip0 serve'))
}

function Enable-Autostart([string]$Root, [string]$Path) {
    $pythonw = Join-Path $Root 'runtime\pythonw.exe'
    if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) {
        throw ('pip0 が導入されていません（' + $pythonw + ' がありません）。先に scripts\install.ps1 で導入してください。')
    }
    if (Test-Path -LiteralPath $Path) {
        $existing = Read-Shortcut $Path
        if (-not (Test-IsPip0Shortcut $existing)) {
            throw ('スタートアップに、pip0 が置いたものではない ' + $ShortcutName + ' があります（' + $existing.Target + '）。変えずに止めます。')
        }
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $pythonw
    $link.Arguments = $ServeArguments
    $link.WorkingDirectory = $Root
    $link.Description = 'pip0（ファイル整理アシスタント）を起動します。scripts\autostart.ps1 -Enable が作成しました。'
    $shellExe = Join-Path $Root 'shell\Pip0Shell.exe'
    if (Test-Path -LiteralPath $shellExe -PathType Leaf) {
        $link.IconLocation = $shellExe + ',0'
    }
    $link.Save()
    Write-Step ('自動起動をオンにしました：' + $Path)
    Write-Step ('  起動するもの：' + $pythonw + ' ' + $ServeArguments)
    Write-Step '次にサインインしたときから、pip0 が自動で起動します。オフにするには -Disable を付けて実行します。'
}

function Disable-Autostart([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Step ('自動起動は登録されていません（何もしません）：' + $Path)
        return
    }
    $existing = Read-Shortcut $Path
    if (-not (Test-IsPip0Shortcut $existing)) {
        throw ('スタートアップの ' + $ShortcutName + ' は、pip0 が置いたものではありません（' + $existing.Target + '）。消さずに止めます。')
    }
    Remove-Item -LiteralPath $Path
    Write-Step ('自動起動をオフにしました（ショートカットを消しました）：' + $Path)
    Write-Step '動いている pip0 は止めていません。止めるには、通知領域の pip0 のアイコンから終了してください。'
}

function Show-Status([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Step ('自動起動：オフ（' + $Path + ' はありません）')
    }
    else {
        $existing = Read-Shortcut $Path
        if (Test-IsPip0Shortcut $existing) {
            Write-Step ('自動起動：オン（' + $existing.Target + ' ' + $existing.Arguments + '）')
            Write-Step '  「設定」→「アプリ」→「スタートアップ」でオフにしている場合は、起動しません。'
        }
        else {
            Write-Step ('自動起動：pip0 が置いたものではない ' + $ShortcutName + ' があります（' + $existing.Target + '）')
        }
    }
    Write-Step '切り替えるには -Enable（オン）または -Disable（オフ）を付けて実行します。'
}

try {
    if ($env:OS -ne 'Windows_NT') {
        throw 'このスクリプトは Windows 専用です。'
    }
    if ($Enable -and $Disable) {
        throw '-Enable と -Disable は、同時には使えません。'
    }
    $shortcutPath = Get-ShortcutPath
    if ($Enable) {
        Enable-Autostart (Resolve-FullPath $InstallDir) $shortcutPath
    }
    elseif ($Disable) {
        Disable-Autostart $shortcutPath
    }
    else {
        Show-Status $shortcutPath
    }
    exit 0
}
catch {
    Write-Host ('エラー：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
