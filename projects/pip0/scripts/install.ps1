<#
.SYNOPSIS
    pip0 を、今のユーザーのフォルダー（既定は %LOCALAPPDATA%\Programs\pip0）に導入します。管理者の権限は要りません。

.DESCRIPTION
    docs\design.md の 6-9 の配置で、次の順に行います。

      1. Windows 11（x64）であること、管理者として実行していないことを確かめる
      2. pip0 専用の Python（python.org の埋め込み用配布物）を用意する。
         -PythonEmbedZip で渡されたファイルか、python.org からダウンロードしたファイルの SHA-256 が、
         このスクリプトに固定した値と一致したときだけ展開する（一致しなければ、展開せずに止まる）
      3. runtime\python313._pth に「Lib\site-packages」と「..\app」を加え、「import site」を有効にする
      4. PC に別に入れた Python 3.13（py -3.13）の pip で、requirements-windows-cp313.txt のライブラリを
         runtime\Lib\site-packages に入れる（版とハッシュを固定し、ビルド済みの wheel だけを使う）
      5. pip0 本体（pip0\）を app\pip0\ に、pip0 シェル（scripts\build-shell.ps1 の出力）を shell\ に写す
      6. 受け口のファイルを native-host\ に、全復元・起動・遮断・自動起動・削除のスクリプトを scripts\ に写す
      7. 写した pip0 専用の Python で、ライブラリと pip0 本体を読み込めること、SQLCipher が使えることを確かめる
      8. 前の導入があれば新しいものと入れ替え、受け口を Chrome と Edge に登録する（scripts\register-native-host.ps1）

    準備は、導入先の隣の作業用フォルダー（例：pip0.new-20261030-090000）で行い、確かめた後で入れ替えます。
    途中で失敗したときは作業用フォルダーを消し、前の導入をそのまま残します。何度実行しても同じ配置になります。

    次のことはしません。
      - ファイアウォールの設定（必要なら、管理者として scripts\network-policy.ps1 -Apply を別に実行します）
      - データ（%LOCALAPPDATA%\pip0：暗号化DB、保管庫、制御ファイル、ログ）と、
        pip0 専用フォルダー（%USERPROFILE%\pip0）の変更・削除
      - pip0 の起動、自動起動の登録、pip0 フォルダーの登録（register-root）

    ネットワークを使うのは、導入のときの次の2つだけです（pip0 の通常の運用では使いません）。
      - Python の埋め込み用配布物のダウンロード（python.org。-PythonEmbedZip を渡したときは使いません）
      - ライブラリの wheel のダウンロード（pip が PyPI から）

.PARAMETER InstallDir
    導入先。既定は %LOCALAPPDATA%\Programs\pip0。中に自分のファイルを置かないでください（導入し直すと入れ替わります）。

.PARAMETER PythonEmbedZip
    手元にある python-3.13.17-embed-amd64.zip のパス。渡したときはダウンロードしません（SHA-256 は必ず確かめます）。

.PARAMETER ShellPublishDir
    pip0 シェルの出力のフォルダー（Pip0Shell.exe があるところ）。
    既定は shell\bin\publish\win-x64（scripts\build-shell.ps1 の出力先）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -PythonEmbedZip "$env:USERPROFILE\Downloads\python-3.13.17-embed-amd64.zip"
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\pip0",
    [string]$PythonEmbedZip = '',
    [string]$ShellPublishDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ----------------------------------------------------------------------
# 固定の値（Python の版を上げるときは、下の3つを一緒に直します。手順は docs\setup-windows.md）
# ----------------------------------------------------------------------

# pip0 専用の Python：python.org の埋め込み用配布物（Windows、x64）
# 2026-10-30 に https://www.python.org/ftp/python/ を確かめ、Windows 用の配布物がある 3.13 の最新版を選びました
# （3.13.18 はソースだけの公開で、埋め込み用配布物がありません）。
# 下のハッシュは、ダウンロードしたファイルの SHA-256 です。python.org の Sigstore の署名
# （署名者 thomas@python.org、発行者 https://accounts.google.com）を検証でき、
# 同じ場所の SBOM（python-3.13.17-embed-amd64.zip.spdx.json）の値とも一致しました。
$PythonVersion = '3.13.17'
$PythonEmbedSha256 = '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'
$PthFileName = 'python313._pth'

$PythonEmbedFileName = 'python-' + $PythonVersion + '-embed-amd64.zip'
$PythonEmbedUrl = 'https://www.python.org/ftp/python/' + $PythonVersion + '/' + $PythonEmbedFileName

# 導入先に置く印（導入し直すときと uninstall.ps1 が、pip0 の導入先であることを確かめるために読む）
$MarkerFileName = 'pip0-install.json'
# 導入先の一番上にあってよいもの（前の導入を消す前に、ほかのものが置かれていないかを確かめる）
$KnownTopLevelNames = @('runtime', 'app', 'shell', 'native-host', 'scripts', $MarkerFileName)
# 導入先の scripts\ に写すもの
$ScriptsToCopy = @('restore-all.cmd', 'start-pip0.cmd', 'network-policy.ps1', 'autostart.ps1', 'uninstall.ps1', 'register-native-host.ps1')
# 導入先の native-host\ に写すもの
$NativeHostFiles = @('pip0-native-host.bat', 'pip0.bridge.json.template')

# ----------------------------------------------------------------------
# 表示と小さな道具
# ----------------------------------------------------------------------

function Write-Step([string]$Message) {
    Write-Host $Message
}

function Write-Section([string]$Message) {
    Write-Host ''
    Write-Host ('== ' + $Message) -ForegroundColor Cyan
}

function Write-Caution([string]$Message) {
    Write-Host ('注意：' + $Message) -ForegroundColor Yellow
}

# 管理者として動いているか（調べられなければ $false）
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

# 相対パスを、今いるフォルダーを基準にした完全なパスにします（まだ存在しないパスでもよい）
function Resolve-FullPath([string]$Path) {
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $full = [System.IO.Path]::GetFullPath($full)
    $root = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $root.Length) {
        $full = $full.TrimEnd('\')
    }
    return $full
}

# Child が Parent と同じか、その中にあるとき $true（大文字と小文字、/ と \ は区別しない）
function Test-PathInside([string]$Child, [string]$Parent) {
    if ([string]::IsNullOrEmpty($Child) -or [string]::IsNullOrEmpty($Parent)) {
        return $false
    }
    $childWithSlash = $Child.Replace('/', '\').TrimEnd('\') + '\'
    $parentWithSlash = $Parent.Replace('/', '\').TrimEnd('\') + '\'
    return $childWithSlash.StartsWith($parentWithSlash, [System.StringComparison]::OrdinalIgnoreCase)
}

# JSON の項目を読みます（ない項目は $null）
function Get-JsonField($Object, [string]$Name) {
    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

# UTF-8（BOM なし）で書きます
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

# 引数1つを、Windows のコマンドラインの決まり（CommandLineToArgvW）に合わせて引用符で囲みます
function ConvertTo-WindowsArgument([string]$Value) {
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            # 引用符の前の \ は2倍にし、引用符そのものも \ で打ち消す
            [void]$builder.Append('\' * ($backslashes * 2 + 1))
            [void]$builder.Append('"')
        }
        else {
            [void]$builder.Append('\' * $backslashes)
            [void]$builder.Append($character)
        }
        $backslashes = 0
    }
    # 閉じる引用符の前の \ は2倍にする
    [void]$builder.Append('\' * ($backslashes * 2))
    [void]$builder.Append('"')
    return $builder.ToString()
}

# プログラムを起動して終わるまで待ち、終了コードと出力を返します（出力は画面に出さず、受け取るだけ）
function Invoke-Captured([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $FilePath
    $info.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $process = [System.Diagnostics.Process]::Start($info)
    try {
        # 出力が多いと止まらないように、2つの出力を同時に読む
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill() } catch { }
            throw ('時間内（' + $TimeoutSeconds + ' 秒）に終わりませんでした：' + $FilePath)
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            StdOut = $stdoutTask.Result
            StdErr = $stderrTask.Result
        }
    }
    finally {
        $process.Dispose()
    }
}

# プログラムを起動し、出力を画面に表示しながら待ち、終了コードを返します。
# Python には -X utf8 を付けて UTF-8 で出力させ、PowerShell も UTF-8 として読みます（日本語が化けないように）。
function Invoke-Live([string]$FilePath, [string[]]$Arguments) {
    # 標準エラー出力の行で止まらないようにする（Windows PowerShell 5.1 の対策。成否は終了コードで判断する）
    $ErrorActionPreference = 'Continue'
    $previousEncoding = $null
    try {
        $previousEncoding = [Console]::OutputEncoding
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    }
    catch {
        $previousEncoding = $null
    }
    try {
        $global:LASTEXITCODE = 0
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            # 標準エラー出力の行は ErrorRecord として届くため、その文だけを表示する
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $line = $_.Exception.Message
            }
            else {
                $line = [string]$_
            }
            Write-Host ('    ' + $line)
        }
        return $LASTEXITCODE
    }
    finally {
        if ($null -ne $previousEncoding) {
            try { [Console]::OutputEncoding = $previousEncoding } catch { }
        }
    }
}

# 中にあるリンク（再解析ポイント：シンボリックリンク、ジャンクション等）を探します。リンクの先へは進みません
function Find-ReparsePoints([string]$Path) {
    $pending = New-Object System.Collections.Stack
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $directory = [string]$pending.Pop()
        foreach ($entry in [System.IO.Directory]::GetFileSystemEntries($directory)) {
            $attributes = [System.IO.File]::GetAttributes($entry)
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                $entry
            }
            elseif (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
                $pending.Push($entry)
            }
        }
    }
}

# pip0 のデータらしいもの（暗号化DB の pip0.db*、保管庫の vault\items）を探します。リンクの先へは進みません
function Find-DataLikeEntries([string]$Path) {
    $pending = New-Object System.Collections.Stack
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $directory = [string]$pending.Pop()
        foreach ($entry in [System.IO.Directory]::GetFileSystemEntries($directory)) {
            $attributes = [System.IO.File]::GetAttributes($entry)
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                continue
            }
            $name = [System.IO.Path]::GetFileName($entry)
            if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
                if ($name -eq 'vault' -and [System.IO.Directory]::Exists([System.IO.Path]::Combine($entry, 'items'))) {
                    $entry
                }
                $pending.Push($entry)
            }
            elseif ($name -like 'pip0.db*') {
                $entry
            }
        }
    }
}

# このスクリプトが作ったフォルダーを消します。中にリンクがあれば、リンクの先を消さないように、何もせずに止めます
function Remove-Tree([string]$Path) {
    $links = @(Find-ReparsePoints $Path)
    if ($links.Count -gt 0) {
        throw ('中にリンク（再解析ポイント）があるため、消しませんでした：' + $links[0])
    }
    [System.IO.Directory]::Delete($Path, $true)
}

# フォルダーの名前を変えます。ほかのプログラムが一時的に使っていることがあるため、数回やり直します
function Move-DirectoryWithRetry([string]$From, [string]$To) {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            [System.IO.Directory]::Move($From, $To)
            return
        }
        catch {
            if ($attempt -eq 5) {
                throw
            }
            Start-Sleep -Seconds 1
        }
    }
}

# フォルダーの中身を写します。__pycache__ と .pyc（Python が自動で作るもの）は写しません
function Copy-Tree([string]$Source, [string]$Destination) {
    [void][System.IO.Directory]::CreateDirectory($Destination)
    foreach ($item in @(Get-ChildItem -LiteralPath $Source -Force)) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw ('写す元にリンク（再解析ポイント）があります。中身を確かめてください：' + $item.FullName)
        }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) {
            if ($item.Name -eq '__pycache__') {
                continue
            }
            Copy-Tree $item.FullName $target
        }
        else {
            if ($item.Extension -in @('.pyc', '.pyo')) {
                continue
            }
            Copy-Item -LiteralPath $item.FullName -Destination $target
        }
    }
}

# 導入先（Root）にある exe から動いているプロセスを返します（ほかのユーザーのプロセスは調べられないため含みません）
function Get-Pip0Processes([string]$Root) {
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
        $path = $null
        try {
            $path = $process.Path
        }
        catch {
            $path = $null
        }
        if ($path -and (Test-PathInside $path $Root)) {
            $process
        }
    }
}

# ----------------------------------------------------------------------
# 導入の各段階
# ----------------------------------------------------------------------

# 1. Windows 11（x64）で、64 ビットの PowerShell を、管理者ではなく実行しているか
function Assert-Environment {
    if ($env:OS -ne 'Windows_NT') {
        throw 'このスクリプトは Windows 11 専用です。'
    }
    if (-not [Environment]::Is64BitProcess) {
        throw '64 ビット版の PowerShell で実行してください（名前に「(x86)」が付かない「Windows PowerShell」）。'
    }
    if ([string]::IsNullOrEmpty($env:LOCALAPPDATA) -or [string]::IsNullOrEmpty($env:USERPROFILE)) {
        throw '環境変数 LOCALAPPDATA または USERPROFILE がありません。通常のサインインの PowerShell で実行してください。'
    }
    if (Test-IsElevated) {
        throw ('管理者として実行しないでください。pip0 は今のユーザーのフォルダーに入れるため、管理者の権限は要りません' +
            '（別の管理者のアカウントで実行すると、そのアカウントのフォルダーに入ってしまいます）。通常の PowerShell で実行し直してください。')
    }
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $build = 0
    [void][int]::TryParse([string]$os.BuildNumber, [ref]$build)
    # Windows 11 はビルド 22000 以上。ProductType 1 はクライアント版（サーバー版を除く）
    if ([int]$os.ProductType -ne 1 -or $build -lt 22000) {
        throw ('pip0 は Windows 11 用です。この PC は ' + $os.Caption + '（ビルド ' + $os.BuildNumber + '）です。')
    }
    $cpu = @(Get-CimInstance -ClassName Win32_Processor) | Select-Object -First 1
    # Architecture 9 は x64（Intel／AMD の 64 ビット）。Arm（12）は対象外
    if ($null -eq $cpu -or [int]$cpu.Architecture -ne 9) {
        throw 'pip0 は x64（64 ビットの Intel／AMD の CPU）の Windows 11 用です。この PC の CPU には対応していません。'
    }
    Write-Step ('Windows：' + $os.Caption + '（ビルド ' + $os.BuildNumber + '、x64）')
}

# リポジトリーの中の、写す元の場所を確かめます
function Get-SourceLayout {
    $root = Split-Path -Path $PSScriptRoot -Parent
    $layout = [ordered]@{
        Root = $root
        Package = Join-Path $root 'pip0'
        NativeHost = Join-Path $root 'native-host'
        Scripts = $PSScriptRoot
        Requirements = Join-Path $root 'requirements-windows-cp313.txt'
        Extension = Join-Path $root 'browser-extension'
    }
    $required = @(
        (Join-Path $layout.Package '__init__.py'),
        (Join-Path $layout.Package '__main__.py'),
        $layout.Requirements
    )
    foreach ($name in $NativeHostFiles) {
        $required += (Join-Path $layout.NativeHost $name)
    }
    foreach ($name in $ScriptsToCopy) {
        $required += (Join-Path $layout.Scripts $name)
    }
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw ('写す元のファイルが見つかりません：' + $path + '。リポジトリーの projects\pip0\scripts\install.ps1 を実行しているかを確かめてください。')
        }
    }
    return $layout
}

# 導入先の状態：'missing'（ない）、'empty'（空のフォルダー）、'pip0'（pip0 の導入先）、'other'（ほかのもの）
function Get-InstallDirState([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) {
        return 'missing'
    }
    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
        return 'other'
    }
    if (Test-Path -LiteralPath (Join-Path $Dir $MarkerFileName) -PathType Leaf) {
        return 'pip0'
    }
    if (@(Get-ChildItem -LiteralPath $Dir -Force).Count -eq 0) {
        return 'empty'
    }
    return 'other'
}

# pip0 シェル（build-shell.ps1 の出力）の場所。
# 指定がなければ、build-shell.ps1 の出力先、次に shell\README.md の手作業のコマンド（-o publish）の出力先を探します
function Find-ShellPublish([string]$Given, [string]$Root) {
    if ($Given) {
        $candidates = @(Resolve-FullPath $Given)
    }
    else {
        $candidates = @((Join-Path $Root 'shell\bin\publish\win-x64'), (Join-Path $Root 'shell\publish'))
    }
    foreach ($dir in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $dir 'Pip0Shell.exe') -PathType Leaf) {
            return $dir
        }
    }
    throw ('pip0 シェル（Pip0Shell.exe）が見つかりません（探した場所：' + ($candidates -join '、') + '）。' +
        '先に scripts\build-shell.ps1 でビルドするか、-ShellPublishDir でビルド済みのフォルダーを指定してください。')
}

# ライブラリを入れるための Python 3.13（64 ビット、pip 付き）を、Python のランチャー（py）で探します
function Find-HostPython {
    $launcher = Get-Command -Name 'py' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $launcher) {
        throw ('Python のランチャー（py）が見つかりません。python.org から Python 3.13（64 ビット）を入れてください。' +
            'この Python は、ライブラリを入れるときだけ使います（pip0 は導入先の専用の Python で動きます）。')
    }
    $code = @(
        'import json, struct, sys',
        'try:',
        '    import pip',
        '    pip_version = pip.__version__',
        'except Exception:',
        '    pip_version = None',
        'print(json.dumps({''version'': list(sys.version_info[:3]), ''bits'': struct.calcsize(''P'') * 8, ''pip'': pip_version}))'
    ) -join "`n"
    $result = Invoke-Captured $launcher.Path @('-3.13', '-I', '-c', $code) 120
    if ($result.ExitCode -ne 0) {
        throw ('py -3.13 で Python 3.13 を起動できませんでした。python.org から Python 3.13（64 ビット）を入れてください。' +
            '詳しい理由：' + ($result.StdErr + $result.StdOut).Trim())
    }
    $info = $result.StdOut | ConvertFrom-Json
    $version = @($info.version)
    if ($version[0] -ne 3 -or $version[1] -ne 13) {
        throw ('py -3.13 が Python ' + ($version -join '.') + ' を起動しました。Python 3.13 を入れてください。')
    }
    if ($info.bits -ne 64) {
        throw 'py -3.13 の Python が 32 ビット版です。64 ビット版の Python 3.13 を入れてください。'
    }
    if ($null -eq $info.pip) {
        throw 'py -3.13 の Python に pip がありません。「py -3.13 -m ensurepip」で pip を入れてから、もう一度実行してください。'
    }
    Write-Step ('ライブラリを入れる Python：' + ($version -join '.') + '（pip ' + $info.pip + '）')
    return $launcher.Path
}

# ファイルをダウンロードします（導入のときだけ使う通信）
function Save-Download([string]$Url, [string]$Path) {
    # Windows PowerShell 5.1 は、進み具合の表示があると大幅に遅くなるため、表示を止める
    $ProgressPreference = 'SilentlyContinue'
    # Windows PowerShell 5.1 で TLS 1.2 を使えるようにする（今の PowerShell のプロセスの中だけの設定）
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
}

# 2. 埋め込み用配布物を用意し、SHA-256 を確かめます。一致しなければ止まります
function Get-PythonEmbedZip([string]$GivenPath, [string]$WorkDir) {
    if ($GivenPath) {
        $path = Resolve-FullPath $GivenPath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw ('-PythonEmbedZip のファイルが見つかりません：' + $path)
        }
        Write-Step ('手元の埋め込み用配布物を使います：' + $path)
    }
    else {
        $path = Join-Path $WorkDir $PythonEmbedFileName
        Write-Step ('python.org から Python ' + $PythonVersion + ' の埋め込み用配布物（約 11 MB）をダウンロードします：' + $PythonEmbedUrl)
        Save-Download $PythonEmbedUrl $path
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $PythonEmbedSha256) {
        throw ('埋め込み用配布物の SHA-256 が、このスクリプトに固定した値と一致しないため、展開せずに止めました。' +
            '受け付けるのは ' + $PythonEmbedFileName + ' だけです。期待する値：' + $PythonEmbedSha256 + '、このファイル：' + $actual)
    }
    Write-Step ('SHA-256 が固定の値と一致しました：' + $actual)
    return $path
}

# 3. 展開して、python313._pth を書き換えます
function Expand-PythonRuntime([string]$Zip, [string]$RuntimeDir) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $RuntimeDir)
    foreach ($name in @('python.exe', 'pythonw.exe', $PthFileName)) {
        if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir $name) -PathType Leaf)) {
            throw ('埋め込み用配布物に ' + $name + ' がありません。')
        }
    }
    Write-Step ('展開しました：' + $RuntimeDir)
}

# python313._pth（埋め込み用の Python が、モジュールを探す場所の一覧）に、
# ライブラリの場所（Lib\site-packages）と pip0 本体の場所（..\app）を加え、import site を有効にします
function Update-PthFile([string]$RuntimeDir) {
    $path = Join-Path $RuntimeDir $PthFileName
    $lines = @([System.IO.File]::ReadAllLines($path))
    $updated = New-Object System.Collections.Generic.List[string]
    $addedPaths = $false
    $enabledSite = $false
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '#import site') {
            $updated.Add('import site')
            $enabledSite = $true
            continue
        }
        $updated.Add($line)
        if ($trimmed -eq '.' -and -not $addedPaths) {
            $updated.Add('Lib\site-packages')
            $updated.Add('..\app')
            $addedPaths = $true
        }
    }
    if (-not ($addedPaths -and $enabledSite)) {
        throw ($PthFileName + ' の形が想定と違うため、書き換えませんでした：' + ($lines -join ' | '))
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($path, $updated.ToArray(), $encoding)
    Write-Step ($PthFileName + ' に Lib\site-packages と ..\app を加え、import site を有効にしました。')
}

# 4. ライブラリを入れます（版とハッシュを固定。依存は自動で足さない。ビルド済みの wheel だけ）
function Install-Libraries([string]$Launcher, [string]$SitePackages, [string]$Requirements) {
    [void][System.IO.Directory]::CreateDirectory($SitePackages)
    # --platform 等の4つは、ライブラリを入れる Python の種類によらず、
    # Windows・CPython 3.13・64 ビット用の wheel を選ぶための指定です（--target と一緒に使えます）
    $pipArguments = @(
        '-3.13', '-I', '-X', 'utf8', '-m', 'pip', 'install',
        '--disable-pip-version-check', '--progress-bar', 'off',
        '--no-deps', '--only-binary=:all:', '--require-hashes',
        '--platform', 'win_amd64', '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
        '--target', $SitePackages,
        '-r', $Requirements
    )
    Write-Step 'py -3.13 -m pip install --no-deps --only-binary=:all: --require-hashes --target runtime\Lib\site-packages -r requirements-windows-cp313.txt'
    $exitCode = Invoke-Live $Launcher $pipArguments
    if ($exitCode -ne 0) {
        throw ('ライブラリを入れられませんでした（pip の終了コード ' + $exitCode + '）。上の pip の表示を確かめてください。' +
            'ハッシュが一致しないと表示された場合は、ダウンロードしたファイルが一覧と違います。')
    }
    # pip の --target は、ライブラリのコマンド（keyring.exe、watchmedo.exe）を bin に置きます。
    # これらはライブラリを入れた別の Python で動くもので、pip0 は使わないため消します（ファイアウォールの規則の対象外の exe を残さないため）
    foreach ($name in @('bin', 'Scripts')) {
        $commandsDir = Join-Path $SitePackages $name
        if (Test-Path -LiteralPath $commandsDir -PathType Container) {
            Remove-Tree $commandsDir
        }
    }
}

# 導入先の印を書きます
function Write-InstallMarker([string]$Dir, [string]$Pip0Version) {
    $marker = [ordered]@{
        product = 'pip0'
        version = $Pip0Version
        python = $PythonVersion
        python_embed_sha256 = $PythonEmbedSha256
        installed_at = (Get-Date).ToString('o')
        layout = 'docs/design.md 6-9'
        note = 'scripts\install.ps1 が作成。導入し直すときと uninstall.ps1 が、pip0 の導入先であることを確かめるために読みます。'
    }
    Write-Utf8NoBom (Join-Path $Dir $MarkerFileName) (($marker | ConvertTo-Json) + "`r`n")
}

# 7. 準備した pip0 専用の Python で、ライブラリと pip0 本体を読み込めるかを確かめ、pip0 の設定の場所を読みます
function Test-StagedRuntime([string]$RuntimeDir) {
    $python = Join-Path $RuntimeDir 'python.exe'
    $code = @(
        'import json, sys',
        'result = {''python'': sys.version.split()[0], ''errors'': []}',
        'try:',
        '    import pip0',
        '    from pip0 import config',
        '    loaded = config.load_config()',
        '    for key in (''DATA_DIR'', ''VAULT_DIR'', ''PIP0_ROOT'', ''DOWNLOADS_DIR'', ''SHELL_EXE''):',
        '        value = loaded.get(key)',
        '        result[key] = None if value is None else str(value)',
        '    result[''config_errors''] = [str(text) for text in (loaded.get(''CONFIG_ERRORS'') or [])]',
        '    result[''pip0_version''] = getattr(pip0, ''__version__'', None)',
        'except Exception as error:',
        '    result[''errors''].append(''pip0: '' + type(error).__name__ + '': '' + str(error))',
        'for name in (''sqlcipher3.dbapi2'', ''keyring'', ''win32ctypes.pywin32.win32cred'', ''watchdog.observers'', ''PIL.Image'', ''pypdf''):',
        '    try:',
        '        __import__(name)',
        '    except Exception as error:',
        '        result[''errors''].append(name + '': '' + type(error).__name__ + '': '' + str(error))',
        'try:',
        '    from sqlcipher3 import dbapi2',
        '    connection = dbapi2.connect('':memory:'')',
        '    result[''cipher_version''] = connection.execute(''PRAGMA cipher_version'').fetchone()[0]',
        '    connection.close()',
        'except Exception as error:',
        '    result[''errors''].append(''SQLCipher: '' + type(error).__name__ + '': '' + str(error))',
        'try:',
        '    import keyring',
        '    backend = keyring.get_keyring()',
        '    result[''keyring_backend''] = type(backend).__module__ + ''.'' + type(backend).__name__',
        'except Exception as error:',
        '    result[''errors''].append(''keyring: '' + type(error).__name__ + '': '' + str(error))',
        'print(json.dumps(result, ensure_ascii=True))'
    ) -join "`n"
    $result = Invoke-Captured $python @('-I', '-X', 'utf8', '-c', $code) 120
    if ($result.ExitCode -ne 0) {
        throw ('pip0 専用の Python を起動できませんでした（終了コード ' + $result.ExitCode + '）：' + ($result.StdErr + $result.StdOut).Trim())
    }
    $info = $result.StdOut | ConvertFrom-Json
    $errors = @(Get-JsonField $info 'errors')
    if ($errors.Count -gt 0) {
        throw ('pip0 専用の Python で、次のものを読み込めませんでした：' + ($errors -join '、'))
    }
    Write-Step ('pip0 専用の Python ' + (Get-JsonField $info 'python') + ' で、pip0 ' + (Get-JsonField $info 'pip0_version') +
        ' とライブラリを読み込めました（SQLCipher ' + (Get-JsonField $info 'cipher_version') + '）。')
    $backend = Get-JsonField $info 'keyring_backend'
    if ($backend -ne 'keyring.backends.Windows.WinVaultKeyring') {
        Write-Caution ('鍵の保存先が Windows の資格情報マネージャーではありません（' + $backend + '）。pip0 は、この保存先には DB の鍵を保存しません。' +
            'keyring の設定（%LOCALAPPDATA%\Python Keyring\keyringrc.cfg や環境変数 PYTHON_KEYRING_BACKEND）を確かめてください。')
    }
    foreach ($text in @(Get-JsonField $info 'config_errors')) {
        Write-Caution ('pip0 の設定：' + $text)
    }
    return $info
}

# 導入先が、pip0 のデータ・監視するフォルダーと重ならないことを確かめます（導入し直すと導入先は入れ替わるため）
function Assert-NoOverlap([string]$Dir, $Info) {
    foreach ($key in @('DATA_DIR', 'VAULT_DIR', 'PIP0_ROOT', 'DOWNLOADS_DIR')) {
        $value = Get-JsonField $Info $key
        if ([string]::IsNullOrEmpty($value)) {
            continue
        }
        if ((Test-PathInside $value $Dir) -or (Test-PathInside $Dir $value)) {
            throw ('導入先（' + $Dir + '）と pip0 の ' + $key + '（' + $value + '）が重なっています。導入先を別の場所にしてください。')
        }
    }
}

# 8. 準備したフォルダーと、前の導入を入れ替えます
function Switch-Installation([string]$Stage, [string]$Target, [string]$Stamp) {
    $parent = Split-Path -Path $Target -Parent
    $leaf = Split-Path -Path $Target -Leaf
    $old = $null
    if (Test-Path -LiteralPath $Target) {
        $old = Join-Path $parent ($leaf + '.old-' + $Stamp)
        try {
            Move-DirectoryWithRetry $Target $old
        }
        catch {
            throw ('前の導入（' + $Target + '）の名前を変えられませんでした。pip0、ブラウザー、導入先を開いているエクスプローラーや' +
                'コマンド プロンプトを閉じてから、もう一度実行してください。前の導入はそのままです。詳しい理由：' + $_.Exception.Message)
        }
    }
    try {
        Move-DirectoryWithRetry $Stage $Target
    }
    catch {
        $reason = $_.Exception.Message
        if ($null -ne $old) {
            try {
                Move-DirectoryWithRetry $old $Target
            }
            catch {
                throw ('新しい導入を置けず、前の導入を元の名前に戻すこともできませんでした。前の導入は ' + $old +
                    ' にあります。フォルダーの名前を ' + $leaf + ' に戻してください。詳しい理由：' + $reason)
            }
        }
        throw ('新しい導入を ' + $Target + ' に置けませんでした。前の導入はそのままです。詳しい理由：' + $reason)
    }
    if ($null -ne $old) {
        Remove-OldInstallation $old
    }
}

# 前の導入を消します。pip0 が置くもの以外が一番上にあれば、消さずに知らせます
function Remove-OldInstallation([string]$Old) {
    $unknown = @(Get-ChildItem -LiteralPath $Old -Force | Where-Object { $KnownTopLevelNames -notcontains $_.Name })
    if ($unknown.Count -gt 0) {
        Write-Caution ('前の導入に、pip0 が置いたもの以外（' + (($unknown | ForEach-Object { $_.Name }) -join '、') +
            '）があったため、前の導入を消さずに残しました：' + $Old + '。中身を確かめてから、手で消してください。')
        return
    }
    $dataLike = @(Find-DataLikeEntries $Old)
    if ($dataLike.Count -gt 0) {
        Write-Caution ('前の導入の中に、pip0 のデータらしいもの（' + $dataLike[0] + '）があったため、前の導入を消さずに残しました：' +
            $Old + '。中身を確かめてから、手で消してください。')
        return
    }
    try {
        Remove-Tree $Old
        Write-Step '前の導入（プログラムのフォルダー）を消しました。データ（DATA_DIR）は変えていません。'
    }
    catch {
        Write-Caution ('前の導入を消せませんでした：' + $Old + '（データは入っていません。後で手で消してください）。理由：' + $_.Exception.Message)
    }
}

# 受け口を Chrome と Edge に登録します（導入先に写した register-native-host.ps1 を使う）
function Register-NativeHost([string]$Dir) {
    $script = Join-Path $Dir 'scripts\register-native-host.ps1'
    $global:LASTEXITCODE = 0
    & $script -InstallDir $Dir
    if ($LASTEXITCODE -ne 0) {
        Write-Caution ('ブラウザー拡張の受け口を登録できませんでした。上の表示を確かめ、次のコマンドで登録し直してください：' +
            'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $script + '"')
        return $false
    }
    return $true
}

function Write-NextSteps([string]$Dir, [string]$ExtensionDir, $Info) {
    $python = Join-Path $Dir 'runtime\python.exe'
    $dataDir = Get-JsonField $Info 'DATA_DIR'
    $pip0Root = Get-JsonField $Info 'PIP0_ROOT'
    Write-Host ''
    Write-Host '導入が終わりました。' -ForegroundColor Green
    Write-Step ('  プログラム：' + $Dir)
    Write-Step ('  データ    ：' + $dataDir + '（導入では作成・変更していません）')
    Write-Step '  ファイアウォールの設定は変えていません。'
    Write-Host ''
    Write-Step '次の手順（詳しくは docs\setup-windows.md）'
    Write-Step '  1. ブラウザー拡張を読み込む'
    Write-Step '       chrome://extensions または edge://extensions で「デベロッパー モード（開発者モード）」をオンにし、'
    Write-Step '       「パッケージ化されていない拡張機能を読み込む（展開して読み込みます）」で、次のフォルダーを選びます。'
    Write-Step ('       ' + $ExtensionDir)
    Write-Step '  2. （任意）OS のファイアウォールで、pip0 の通信を遮断する'
    Write-Step '       「管理者として実行」で PowerShell を開き、次を実行します（確かめ方は docs\network.md）。'
    Write-Step ('       powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Dir 'scripts\network-policy.ps1') + '" -Apply -InstallDir "' + $Dir + '"')
    Write-Step '  3. pip0 を起動する（次のファイルをダブルクリック）'
    Write-Step ('       ' + (Join-Path $Dir 'scripts\start-pip0.cmd'))
    Write-Step ('  4. pip0 フォルダー（' + $pip0Root + '）を登録する（PowerShell で）')
    Write-Step ('       & "' + $python + '" -I -m pip0 register-root')
    Write-Host ''
    Write-Step ('  サインイン時の自動起動（任意）：powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Dir 'scripts\autostart.ps1') + '" -Enable')
    Write-Step ('  全復元（画面が動かないとき）　：' + (Join-Path $Dir 'scripts\restore-all.cmd') + ' をダブルクリック')
}

# ----------------------------------------------------------------------
# 本体
# ----------------------------------------------------------------------

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = $null
$workDir = $null
$switched = $false

try {
    Write-Step 'pip0 を導入します（管理者の権限は使いません）。'
    Assert-Environment

    $InstallDir = Resolve-FullPath $InstallDir
    $layout = Get-SourceLayout
    Write-Step ('導入先：' + $InstallDir)

    # 導入先の確認：pip0 の導入先・空のフォルダー・まだないフォルダーだけを使う
    if ([string]::IsNullOrEmpty((Split-Path -Path $InstallDir -Parent))) {
        throw ('ドライブの一番上（' + $InstallDir + '）には導入できません。')
    }
    if ((Test-PathInside $layout.Root $InstallDir) -or (Test-PathInside $InstallDir $layout.Root)) {
        throw ('導入先（' + $InstallDir + '）とリポジトリー（' + $layout.Root + '）が重なっています。導入先を別の場所にしてください。')
    }
    $state = Get-InstallDirState $InstallDir
    if ($state -eq 'other') {
        throw ('導入先に、pip0 の導入ではないものがあります：' + $InstallDir + '。別の導入先を -InstallDir で指定してください（このフォルダーは変えていません）。')
    }
    if ($state -eq 'pip0') {
        Write-Step '前の導入があります。新しいものを準備してから入れ替えます。'
        $running = @(Get-Pip0Processes $InstallDir)
        if ($running.Count -gt 0) {
            throw ('pip0 が動いています（' + (($running | ForEach-Object { $_.ProcessName + '.exe' }) -join '、') + '）。' +
                '通知領域の pip0 のアイコンから終了するか、「& "' + (Join-Path $InstallDir 'runtime\python.exe') + '" -I -m pip0 shutdown」で終了してから、もう一度実行してください。')
        }
    }

    $shellDir = Find-ShellPublish $ShellPublishDir $layout.Root
    $launcher = Find-HostPython
    $pip0Version = '不明'
    $initText = [System.IO.File]::ReadAllText((Join-Path $layout.Package '__init__.py'), [System.Text.Encoding]::UTF8)
    if ($initText -match '__version__\s*=\s*"([^"]+)"') {
        $pip0Version = $Matches[1]
    }

    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ('pip0-install-' + $stamp)
    [void][System.IO.Directory]::CreateDirectory($workDir)

    Write-Section '1/5 pip0 専用の Python を用意します'
    $zip = Get-PythonEmbedZip $PythonEmbedZip $workDir
    $parent = Split-Path -Path $InstallDir -Parent
    [void][System.IO.Directory]::CreateDirectory($parent)
    $stage = Join-Path $parent ((Split-Path -Path $InstallDir -Leaf) + '.new-' + $stamp)
    [void][System.IO.Directory]::CreateDirectory($stage)
    $runtimeDir = Join-Path $stage 'runtime'
    Expand-PythonRuntime $zip $runtimeDir
    Update-PthFile $runtimeDir

    Write-Section '2/5 ライブラリを入れます（版とハッシュを固定）'
    Install-Libraries $launcher (Join-Path $runtimeDir 'Lib\site-packages') $layout.Requirements

    Write-Section '3/5 pip0 本体、pip0 シェル、受け口、スクリプトを写します'
    Copy-Tree $layout.Package (Join-Path $stage 'app\pip0')
    Write-Step ('pip0 本体 → app\pip0（' + $pip0Version + '）')
    Copy-Tree $shellDir (Join-Path $stage 'shell')
    Write-Step ('pip0 シェル → shell（元：' + $shellDir + '）')
    $hostDir = Join-Path $stage 'native-host'
    [void][System.IO.Directory]::CreateDirectory($hostDir)
    foreach ($name in $NativeHostFiles) {
        Copy-Item -LiteralPath (Join-Path $layout.NativeHost $name) -Destination (Join-Path $hostDir $name)
    }
    Write-Step ('受け口 → native-host（' + ($NativeHostFiles -join '、') + '）')
    $scriptsDir = Join-Path $stage 'scripts'
    [void][System.IO.Directory]::CreateDirectory($scriptsDir)
    foreach ($name in $ScriptsToCopy) {
        Copy-Item -LiteralPath (Join-Path $layout.Scripts $name) -Destination (Join-Path $scriptsDir $name)
    }
    Write-Step ('スクリプト → scripts（' + ($ScriptsToCopy -join '、') + '）')
    Write-InstallMarker $stage $pip0Version

    Write-Section '4/5 準備した pip0 専用の Python を確かめます'
    $info = Test-StagedRuntime $runtimeDir
    Assert-NoOverlap $InstallDir $info

    Write-Section '5/5 導入先に置き、ブラウザー拡張の受け口を登録します'
    Switch-Installation $stage $InstallDir $stamp
    $stage = $null
    $switched = $true
    Write-Step ('導入先に置きました：' + $InstallDir)
    [void](Register-NativeHost $InstallDir)

    Write-NextSteps $InstallDir $layout.Extension $info
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('エラー：' + $_.Exception.Message) -ForegroundColor Red
    if ($switched) {
        Write-Host '新しい導入は置き終わっています。上のエラーの内容を確かめてください。データ（DATA_DIR）は変えていません。'
    }
    else {
        Write-Host '導入を中止しました。前の導入（あれば）とデータ（DATA_DIR）は変えていません。'
    }
    exit 1
}
finally {
    # 作業用のフォルダーを片付ける（失敗したときの準備中のフォルダーと、ダウンロードしたファイル）
    if ($null -ne $stage -and (Test-Path -LiteralPath $stage)) {
        try {
            Remove-Tree $stage
        }
        catch {
            Write-Caution ('準備中のフォルダーを消せませんでした：' + $stage + '（後で手で消してください）')
        }
    }
    if ($null -ne $workDir -and (Test-Path -LiteralPath $workDir)) {
        try {
            Remove-Tree $workDir
        }
        catch {
            Write-Caution ('一時フォルダーを消せませんでした：' + $workDir)
        }
    }
}
