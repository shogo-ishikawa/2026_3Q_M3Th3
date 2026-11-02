<#
.SYNOPSIS
    pip0 のブラウザー連携の受け口（Native Messaging の pip0.bridge）を、Chrome と Edge に登録します。

.DESCRIPTION
    次の2つを行います。管理者の権限は要りません（今のユーザーの設定だけを変えます）。

      1. 導入先の native-host フォルダーに、受け口の設定ファイル pip0.bridge.json を書きます。
         ひな形は native-host\pip0.bridge.json.template です（UTF-8、BOM なしで書きます）。
      2. 次の2つのレジストリーキーの「既定」の値に、pip0.bridge.json の完全なパスを書きます。
           HKCU:\Software\Google\Chrome\NativeMessagingHosts\pip0.bridge
           HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\pip0.bridge

    -Unregister を付けると、上の2つのキーだけを消します。
    pip0.bridge.json と、ほかのレジストリーの設定は変えません。

.PARAMETER InstallDir
    pip0 の導入先です。既定は %LOCALAPPDATA%\Programs\pip0（docs\design.md 6-9 の配置）。

.PARAMETER Unregister
    登録を解除します（レジストリーの2つのキーを消すだけです）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-native-host.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-native-host.ps1 -Unregister
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\pip0",
    [switch]$Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 受け口の名前（拡張機能の lib\message.js の NATIVE_HOST_NAME と同じ）
$HostName = 'pip0.bridge'
$TemplateFileName = 'pip0.bridge.json.template'
$ManifestFileName = 'pip0.bridge.json'

# 登録先（今のユーザーだけ。HKCU の下だけを使います）
$RegistryTargets = @(
    @{ Browser = 'Chrome'; Key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" },
    @{ Browser = 'Edge'; Key = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" }
)

function Write-Step([string]$Message) {
    Write-Host $Message
}

function Write-Caution([string]$Message) {
    Write-Host ('注意：' + $Message) -ForegroundColor Yellow
}

# Windows で動いているか（レジストリーを使うため、Windows 専用です）
function Test-IsWindows {
    return ($env:OS -eq 'Windows_NT')
}

# 管理者として動いているか（必要ないため、知らせるだけです。調べられなければ $false）
function Test-IsElevated {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    catch {
        return $false
    }
}

# JSON の項目を読みます（ない項目は $null）
function Get-JsonField($Object, [string]$Name) {
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

# ひな形を探します：このスクリプトの隣の native-host、次に導入先の native-host
function Find-Template([string]$Root) {
    $scriptParent = Split-Path -Path $PSScriptRoot -Parent
    $candidates = @(
        (Join-Path (Join-Path $scriptParent 'native-host') $TemplateFileName),
        (Join-Path (Join-Path $Root 'native-host') $TemplateFileName)
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    throw ('受け口のひな形が見つかりません：' + ($candidates -join '、'))
}

# ひな形を読み、受け口の設定として正しいかを確かめて、本文と内容を返します
function Read-Template([string]$Path) {
    # ReadAllText は、先頭に BOM があれば取り除いて読みます
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    try {
        $data = $text | ConvertFrom-Json
    }
    catch {
        throw ('受け口のひな形が JSON として読めません：' + $Path)
    }

    $problems = @()
    if ((Get-JsonField $data 'name') -cne $HostName) {
        $problems += ('name が ' + $HostName + ' ではありません')
    }
    if ((Get-JsonField $data 'type') -cne 'stdio') {
        $problems += 'type が stdio ではありません'
    }
    $description = Get-JsonField $data 'description'
    if (-not ($description -is [string]) -or $description.Trim() -eq '') {
        $problems += 'description がありません'
    }
    $launcher = Get-JsonField $data 'path'
    if (-not ($launcher -is [string]) -or $launcher -eq '' -or $launcher.Contains('\') -or $launcher.Contains('/') -or $launcher.Contains(':')) {
        $problems += 'path は、設定ファイルと同じフォルダーにあるファイルの名前にしてください（例：pip0-native-host.bat）'
    }
    $origins = @(Get-JsonField $data 'allowed_origins')
    if ($origins.Count -eq 0 -or $null -eq $origins[0]) {
        $problems += 'allowed_origins がありません'
    }
    foreach ($origin in $origins) {
        if (($null -ne $origin) -and -not ([string]$origin -cmatch '^chrome-extension://[a-p]{32}/$')) {
            $problems += ('allowed_origins の形が違います：' + $origin)
        }
    }
    if ($problems.Count -gt 0) {
        throw ('受け口のひな形に問題があります（' + $Path + '）：' + ($problems -join '、'))
    }
    return @{ Text = $text; Launcher = $launcher; Origins = $origins }
}

# UTF-8（BOM なし）で書きます。ブラウザーは BOM 付きの設定ファイルを読めないことがあるためです
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

# レジストリーキーの「既定」の値を読みます（キーがなければ $null）
function Get-DefaultValue([string]$Key) {
    if (-not (Test-Path -LiteralPath $Key)) {
        return $null
    }
    return (Get-Item -LiteralPath $Key).GetValue('')
}

function Register-Bridge([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw ('pip0 の導入先のフォルダーがありません：' + $Root + '。-InstallDir で導入先を指定してください。')
    }
    $Root = (Resolve-Path -LiteralPath $Root).ProviderPath
    Write-Step ('pip0 の受け口（' + $HostName + '）を、Chrome と Edge に登録します。導入先：' + $Root)

    $templatePath = Find-Template $Root
    $template = Read-Template $templatePath

    # 1. 受け口の設定ファイルを書く
    $hostDir = Join-Path $Root 'native-host'
    if (-not (Test-Path -LiteralPath $hostDir -PathType Container)) {
        New-Item -ItemType Directory -Path $hostDir | Out-Null
    }
    $manifestPath = Join-Path $hostDir $ManifestFileName
    Write-Utf8NoBom $manifestPath $template.Text
    Write-Step ('受け口の設定ファイルを書きました：' + $manifestPath)
    Write-Step ('  接続を許可する拡張機能：' + ($template.Origins -join '、'))

    # 受け口を起動するファイルと、pip0 専用の Python があるかを確かめます（なくても登録は続けます）
    $launcherPath = Join-Path $hostDir $template.Launcher
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
        Write-Caution ('受け口を起動するファイルがありません：' + $launcherPath + '。pip0 の導入（scripts\install.ps1）が終わっているかを確かめてください。')
    }
    $pythonPath = Join-Path (Join-Path $Root 'runtime') 'python.exe'
    if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
        Write-Caution ('pip0 専用の Python がありません：' + $pythonPath + '。このままでは、拡張機能のアイコンに「!」が出ます。')
    }

    # 2. レジストリーに、設定ファイルの場所を書く
    foreach ($target in $RegistryTargets) {
        $previous = Get-DefaultValue $target.Key
        if (-not (Test-Path -LiteralPath $target.Key)) {
            # キーがなければ作ります（途中のキーもまとめて作ります）。既にあるキーは作り直しません
            New-Item -Path $target.Key -Force | Out-Null
        }
        Set-ItemProperty -LiteralPath $target.Key -Name '(default)' -Value $manifestPath
        Write-Step ($target.Browser + ' に登録しました：' + $target.Key)
        if (($null -ne $previous) -and ($previous -ne $manifestPath)) {
            Write-Caution ('前の登録（' + $previous + '）を置き換えました。')
        }
    }

    Write-Step ''
    Write-Step '登録が終わりました。次の手順で接続を確かめてください。'
    Write-Step '  1. Chrome（chrome://extensions）または Edge（edge://extensions）で、拡張機能「pip0 連携」を読み込む'
    Write-Step '  2. ツールバーの「pip0 連携」のアイコンを押す（受け口に接続できると、説明が「接続できました」に変わります）'
    Write-Step '  ブラウザーを開いたまま登録した場合も、そのまま使えます（ブラウザーは送るたびに登録を読みます）。'
}

function Unregister-Bridge {
    Write-Step ('pip0 の受け口（' + $HostName + '）の登録を解除します。')
    foreach ($target in $RegistryTargets) {
        if (Test-Path -LiteralPath $target.Key) {
            Remove-Item -LiteralPath $target.Key -Recurse
            Write-Step ($target.Browser + ' の登録を解除しました：' + $target.Key)
        }
        else {
            Write-Step ($target.Browser + ' には登録されていません（何もしません）：' + $target.Key)
        }
    }
    Write-Step '受け口の設定ファイル（pip0.bridge.json）は消していません。pip0 を削除するときに、導入先のフォルダーと一緒に消えます。'
}

try {
    if (-not (Test-IsWindows)) {
        throw 'このスクリプトは Windows 専用です（Chrome と Edge の登録にレジストリーを使うため）。'
    }
    if (Test-IsElevated) {
        Write-Caution '管理者として実行されています。このスクリプトに管理者の権限は要りません。別の管理者のアカウントで実行した場合は、そのアカウントに登録されます。'
    }
    if ($Unregister) {
        Unregister-Bridge
    }
    else {
        Register-Bridge $InstallDir
    }
    exit 0
}
catch {
    Write-Host ('エラー：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
