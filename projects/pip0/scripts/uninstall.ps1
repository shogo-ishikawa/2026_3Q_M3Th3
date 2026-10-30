<#
.SYNOPSIS
    pip0 のプログラムを削除します。退避したファイルがすべて元の場所に戻っていることを確かめてからだけ消します。

.DESCRIPTION
    次の順に行います。途中で問題があれば、そこで止まり、それまでに消したものはありません（1〜4 は何も消しません）。

      1. pip0 に終了を依頼する（python -m pip0 shutdown）。pip0 のプロセスが終わるのを待つ
      2. 全復元（python -m pip0 restore-all）：自動処理を止め、保管庫に退避したファイルを元の場所に戻す
      3. 保管庫の manifest.json を1件ずつ読み、元の場所に戻っていない項目が1つでもあれば止まる
         （残っている項目を表示し、何も消しません）
      4. pip0 フォルダーの登録（Cloud Files の同期ルート）を解除する（python -m pip0 unregister-root）
      5. ブラウザー拡張の受け口の登録を解除する（register-native-host.ps1 -Unregister）
      6. 自動起動のショートカットを消す（autostart.ps1 -Disable）
      7. ファイアウォールの規則（グループ「pip0」）が残っていれば、消し方を表示する（管理者が必要なため、ここでは消しません）
      8. プログラムのフォルダー（-InstallDir）だけを消す（pip0 が置いたもの以外が一番上にあれば、消さずに止まる）

    次のものは消しません。場所と、手で消す手順を最後に表示します。
      - データのフォルダー（DATA_DIR。既定は %LOCALAPPDATA%\pip0）：暗号化DB、保管庫、制御ファイル、ログ
      - 保管庫（VAULT_DIR。既定は DATA_DIR\vault）：退避したファイルの本体と manifest.json
      - DB の鍵（Windows の資格情報マネージャーの「pip0」）
      - pip0 専用フォルダー（PIP0_ROOT。既定は %USERPROFILE%\pip0）：あなたのファイルです
      - ブラウザーに読み込んだ拡張機能（ブラウザーの拡張機能のページで削除します）

    管理者の権限は要りません（管理者としては実行しないでください）。

.PARAMETER InstallDir
    pip0 の導入先。既定は %LOCALAPPDATA%\Programs\pip0。

.PARAMETER AcceptMissingGhosts
    「ゴーストが見つからない」項目（元の場所のゴーストが消された・移動された。中身は保管庫だけにある）があっても、
    続けます。保管庫は消さないため、中身は後で手で取り出せます。先に取り出してから使ってください。
    ほかの「戻っていない」項目（元の場所にゴーストがある等）があるときは、この指定があっても止まります。

.PARAMETER Yes
    始める前の確認（y/N）を省きます。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\uninstall.ps1"
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\pip0",
    [switch]$AcceptMissingGhosts,
    [switch]$Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MarkerFileName = 'pip0-install.json'
# 導入先の一番上にあってよいもの（install.ps1 と同じ）。ほかのものがあれば、プログラムのフォルダーを消さずに止まる
$KnownTopLevelNames = @('runtime', 'app', 'shell', 'native-host', 'scripts', $MarkerFileName)

# 保管庫の項目の状態（docs\design.md の 6-5 と 7 節）
# 元の場所に戻っている
$RestoredStates = @('restored', 'restored_conflict', 'restored_local_newer')
# 退避が終わる前に止まった・失敗した（原本は元の場所のまま）
$NotEvacuatedStates = @('copying', 'copied', 'cancelled', 'failed')
# 元の場所にゴーストがある（または、なっている途中）。pip0 がないと開けないため、必ず止まる
$GhostStates = @('evacuated', 'ghosting', 'restoring')
# ゴーストが見つからない（中身は保管庫だけ）。-AcceptMissingGhosts のときだけ続ける
$MissingStates = @('ghost_missing')

$StateLabels = @{
    'evacuated' = '退避中（元の場所にゴースト）'
    'ghosting' = 'ゴーストにする途中'
    'restoring' = '復元の途中'
    'ghost_missing' = 'ゴーストが見つからない（中身は保管庫だけ）'
}

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
            [void]$builder.Append('\' * ($backslashes * 2 + 1))
            [void]$builder.Append('"')
        }
        else {
            [void]$builder.Append('\' * $backslashes)
            [void]$builder.Append($character)
        }
        $backslashes = 0
    }
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
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill() } catch { }
            throw ('時間内（' + $TimeoutSeconds + ' 秒）に終わりませんでした：' + $FilePath)
        }
        $process.WaitForExit()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $stdoutTask.Result; StdErr = $stderrTask.Result }
    }
    finally {
        $process.Dispose()
    }
}

# プログラムを起動し、出力を画面に表示しながら待ち、終了コードを返します（Python は -X utf8 で UTF-8 にそろえる）
function Invoke-Live([string]$FilePath, [string[]]$Arguments) {
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

# 導入先の exe から動いているプロセスが終わるのを待ちます。終わらなければ $false
function Wait-Pip0Exit([string]$Root, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        $running = @(Get-Pip0Processes $Root)
        if ($running.Count -eq 0) {
            return $true
        }
        if ((Get-Date) -gt $deadline) {
            Write-Caution ('まだ動いている pip0 のプロセス：' + (($running | ForEach-Object { $_.ProcessName + '.exe（' + $_.Id + '）' }) -join '、'))
            return $false
        }
        Start-Sleep -Seconds 1
    }
}

# このスクリプトと同じフォルダー、なければ導入先の scripts にあるスクリプトの場所
function Find-SiblingScript([string]$Name, [string]$Root) {
    foreach ($candidate in @((Join-Path $PSScriptRoot $Name), (Join-Path (Join-Path $Root 'scripts') $Name))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    return $null
}

# ----------------------------------------------------------------------
# 各段階
# ----------------------------------------------------------------------

# pip0 の設定から、データの場所を読みます（pip0 専用の Python で config.load_config() を使う）
function Get-Pip0Locations([string]$Python) {
    $code = @(
        'import json',
        'from pip0 import config, keystore',
        'loaded = config.load_config()',
        'result = {}',
        'for key in (''DATA_DIR'', ''VAULT_DIR'', ''PIP0_ROOT'', ''DOWNLOADS_DIR'', ''DB_PATH''):',
        '    value = loaded.get(key)',
        '    result[key] = None if value is None else str(value)',
        'result[''KEY_SERVICE''] = keystore.SERVICE_NAME',
        'result[''KEY_NAME''] = keystore.KEY_NAME',
        'print(json.dumps(result, ensure_ascii=True))'
    ) -join "`n"
    $result = Invoke-Captured $Python @('-I', '-X', 'utf8', '-c', $code) 60
    if ($result.ExitCode -ne 0) {
        throw ('pip0 の設定を読めませんでした（終了コード ' + $result.ExitCode + '）：' + ($result.StdErr + $result.StdOut).Trim() +
            '。pip0 のプログラムが壊れている可能性があります。scripts\install.ps1 で導入し直してから、もう一度実行してください。何も消していません。')
    }
    $info = $result.StdOut | ConvertFrom-Json
    foreach ($key in @('DATA_DIR', 'VAULT_DIR', 'PIP0_ROOT')) {
        if ([string]::IsNullOrEmpty((Get-JsonField $info $key))) {
            throw ('pip0 の設定の ' + $key + ' が空です。何も消していません。')
        }
    }
    return $info
}

# 保管庫の manifest.json を1件ずつ読みます（DB の鍵がなくても読めます）。
# pip0 本体（vault.py の is_valid_item_id と sync_from_manifests、cli.py の read_vault_manifests）と同じく、
# 名前が項目ID（32桁の16進数の小文字）のフォルダーだけを項目として扱います。
# manifest.json も中身（content、content.partial）もないフォルダーは、最初の manifest.json を書く前に
# 止まった項目で、戻すものがないため数えません
function Get-VaultItems([string]$VaultDir) {
    $itemsDir = Join-Path $VaultDir 'items'
    if (-not (Test-Path -LiteralPath $itemsDir -PathType Container)) {
        return
    }
    foreach ($directory in @(Get-ChildItem -LiteralPath $itemsDir -Directory -Force)) {
        if ($directory.Name -cnotmatch '^[0-9a-f]{32}$') {
            continue  # 項目ではないもの（pip0 本体も触れない）
        }
        $names = @(Get-ChildItem -LiteralPath $directory.FullName -Force | ForEach-Object { $_.Name })
        if (($names -notcontains 'manifest.json') -and ($names -notcontains 'content') -and ($names -notcontains 'content.partial')) {
            continue  # 記録も中身もない項目のフォルダー（戻すものがない）
        }
        $manifest = Join-Path $directory.FullName 'manifest.json'
        $state = $null
        $originalPath = $null
        $problem = $null
        if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
            $problem = 'manifest.json がありません'
        }
        else {
            try {
                $data = [System.IO.File]::ReadAllText($manifest, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
                $state = [string](Get-JsonField $data 'state')
                $originalPath = [string](Get-JsonField $data 'original_path')
            }
            catch {
                $problem = 'manifest.json を読めません'
            }
        }
        [pscustomobject]@{
            ItemId = $directory.Name
            State = $state
            OriginalPath = $originalPath
            ContentPath = (Join-Path $directory.FullName 'content')
            Problem = $problem
        }
    }
}

# 項目を「戻っている／退避していない／止まる理由」に分けます（保管庫の場所は複数でもよい）
function Get-VaultSummary([string[]]$VaultDirs) {
    $items = @()
    foreach ($vaultDir in $VaultDirs) {
        $items += @(Get-VaultItems $vaultDir)
    }
    $blocking = @()
    $missing = @()
    $restored = 0
    $notEvacuated = 0
    foreach ($item in $items) {
        if ($null -ne $item.Problem) {
            $blocking += $item
        }
        elseif ($RestoredStates -contains $item.State) {
            $restored++
        }
        elseif ($NotEvacuatedStates -contains $item.State) {
            $notEvacuated++
        }
        elseif ($MissingStates -contains $item.State) {
            $missing += $item
        }
        else {
            # ゴーストがある・途中の状態、または知らない状態
            $blocking += $item
        }
    }
    return [pscustomobject]@{
        Total = $items.Count
        Restored = $restored
        NotEvacuated = $notEvacuated
        Blocking = $blocking
        Missing = $missing
    }
}

function Write-VaultItem($Item) {
    if ($null -ne $Item.Problem) {
        $label = '状態を読めない（' + $Item.Problem + '）'
    }
    elseif ($StateLabels.ContainsKey($Item.State)) {
        $label = $StateLabels[$Item.State] + '［' + $Item.State + '］'
    }
    else {
        $label = '知らない状態［' + $Item.State + '］'
    }
    Write-Step ('  - ' + $label)
    Write-Step ('      元の場所：' + $Item.OriginalPath)
    Write-Step ('      保管庫の中身：' + $Item.ContentPath + '（項目ID ' + $Item.ItemId + '）')
}

# ファイアウォールの規則（グループ「pip0」）が残っているかを調べ、消し方を表示します（消しません）
function Show-FirewallAdvice([string]$Root) {
    $count = $null
    try {
        $count = @(Get-NetFirewallRule -Group 'pip0' -ErrorAction Stop).Count
    }
    catch {
        if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
            $count = 0
        }
        else {
            $count = $null
        }
    }
    $policyScript = Join-Path $PSScriptRoot 'network-policy.ps1'
    if (Test-PathInside $policyScript $Root) {
        $policyCommand = 'リポジトリーの projects\pip0\scripts\network-policy.ps1 -Remove -InstallDir "' + $Root + '"'
    }
    else {
        $policyCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $policyScript + '" -Remove -InstallDir "' + $Root + '"'
    }
    if ($count -eq 0) {
        Write-Step 'ファイアウォールの規則（グループ「pip0」）はありません。'
        return
    }
    if ($null -eq $count) {
        Write-Step 'ファイアウォールの規則を読めませんでした（読むには管理者の権限が要る場合があります）。'
        Write-Step '-Apply で規則を作った場合は、次のどちらかで消してください（管理者の PowerShell）。'
    }
    else {
        Write-Caution ('ファイアウォールの規則（グループ「pip0」）が ' + $count + ' 個あります。ここでは消しません（管理者の権限が必要なため）。')
        Write-Step '規則は pip0 の3つのプログラムだけが対象なので、残してもほかのアプリには影響しません。消すときは、管理者の PowerShell で次のどちらかを実行してください。'
    }
    Write-Step ('  ' + $policyCommand)
    Write-Step '  または（この PC のすべての pip0 の規則を消します）：Remove-NetFirewallRule -Group pip0'
}

# プログラムのフォルダーを消します。データ・保管庫・pip0 専用フォルダーが中にないこと、
# pip0 が置いたもの以外が一番上にないこと、リンクがないことを確かめてから
function Remove-ProgramFolder([string]$Root, $Locations, [string]$Stamp) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $MarkerFileName) -PathType Leaf)) {
        throw ('pip0 の導入先の印（' + $MarkerFileName + '）がないため、消しません：' + $Root)
    }
    $protected = @(
        (Get-JsonField $Locations 'DATA_DIR'),
        (Get-JsonField $Locations 'VAULT_DIR'),
        (Get-JsonField $Locations 'PIP0_ROOT'),
        (Get-JsonField $Locations 'DOWNLOADS_DIR'),
        $env:USERPROFILE,
        $env:LOCALAPPDATA,
        $env:APPDATA
    )
    foreach ($path in $protected) {
        if ([string]::IsNullOrEmpty($path)) {
            continue
        }
        if (Test-PathInside $path $Root) {
            throw ('導入先の中に、消してはいけない場所（' + $path + '）が含まれているため、消しません：' + $Root)
        }
    }
    # 自分で置いたファイル等があれば、消さずに止まる（install.ps1 が前の導入を消すときと同じ決まり）
    $unknown = @(Get-ChildItem -LiteralPath $Root -Force | Where-Object { $KnownTopLevelNames -notcontains $_.Name })
    if ($unknown.Count -gt 0) {
        throw ('導入先に、pip0 が置いたもの以外（' + (($unknown | ForEach-Object { $_.Name }) -join '、') + '）があるため、消しません：' + $Root +
            '。自分のファイルなら別の場所へ移してから、もう一度実行してください。ここまでの手順（全復元、登録の解除）は終わっています。')
    }
    $links = @(Find-ReparsePoints $Root)
    if ($links.Count -gt 0) {
        throw ('導入先の中にリンク（再解析ポイント）があるため、消しません：' + $links[0] + '。中身を確かめてから、手で消してください。')
    }
    $dataLike = @(Find-DataLikeEntries $Root)
    if ($dataLike.Count -gt 0) {
        throw ('導入先の中に、pip0 のデータらしいもの（' + $dataLike[0] + '）があるため、消しません。中身を確かめてから、手で消してください。')
    }

    # このスクリプトやコマンドの「今いるフォルダー」が導入先の中だと消せないため、外へ移る
    Set-Location -LiteralPath $env:USERPROFILE
    [Environment]::CurrentDirectory = $env:USERPROFILE

    # 先に名前を変える：使用中のファイルがあれば、ここで失敗し、何も消えない
    $removing = Join-Path (Split-Path -Path $Root -Parent) ((Split-Path -Path $Root -Leaf) + '.removing-' + $Stamp)
    $moved = $false
    for ($attempt = 1; $attempt -le 5 -and -not $moved; $attempt++) {
        try {
            [System.IO.Directory]::Move($Root, $removing)
            $moved = $true
        }
        catch {
            if ($attempt -eq 5) {
                throw ('プログラムのフォルダーを消せませんでした（使用中のファイルがあります）：' + $Root +
                    '。pip0 から開いたアプリ、ブラウザー、導入先を開いているエクスプローラーやコマンド プロンプトを閉じてから、もう一度実行してください。' +
                    'ここまでの手順（全復元、登録の解除）は終わっています。')
            }
            Start-Sleep -Seconds 1
        }
    }
    try {
        # 読み取り専用のファイルがあると消せないため、印を外す（中にリンクがないことは上で確かめた）
        foreach ($file in @(Get-ChildItem -LiteralPath $removing -Recurse -Force -File)) {
            if ($file.IsReadOnly) {
                $file.IsReadOnly = $false
            }
        }
        [System.IO.Directory]::Delete($removing, $true)
    }
    catch {
        throw ('プログラムのフォルダーの一部を消せませんでした：' + $removing + '（プログラムだけで、データは入っていません）。手で消してください。理由：' + $_.Exception.Message)
    }
}

function Write-DataLocations($Locations, $Summary) {
    $dataDir = Get-JsonField $Locations 'DATA_DIR'
    $vaultDir = Get-JsonField $Locations 'VAULT_DIR'
    $pip0Root = Get-JsonField $Locations 'PIP0_ROOT'
    Write-Host ''
    Write-Step '次のものは消していません（pip0 はデータを自動では消しません）。'
    Write-Step ('  データのフォルダー（暗号化DB、制御ファイル、ログ）：' + $dataDir)
    Write-Step ('  保管庫（退避したファイルの本体と manifest.json）  ：' + $vaultDir)
    Write-Step ('    記録 ' + $Summary.Total + ' 件：元の場所に戻ったもの ' + $Summary.Restored + ' 件、退避の前に止まったもの（原本は元の場所） ' +
        $Summary.NotEvacuated + ' 件、ゴーストが見つからないもの ' + @($Summary.Missing).Count + ' 件')
    Write-Step ('  DB の鍵：Windows の資格情報マネージャー →「Windows 資格情報」→「汎用資格情報」の「' +
        (Get-JsonField $Locations 'KEY_SERVICE') + '」（ユーザー名 ' + (Get-JsonField $Locations 'KEY_NAME') + '）')
    Write-Step ('  pip0 専用フォルダー（あなたのファイル）：' + $pip0Root)
    Write-Step '  ブラウザーの拡張機能「pip0 連携」：chrome://extensions または edge://extensions で削除します'
    Write-Host ''
    Write-Step '手で消すときの順番（必要な場合だけ。消したものは元に戻せません）'
    Write-Step '  1. 自分のファイルがすべて元の場所にあることを確かめる（「ゴーストが見つからない」ものは、保管庫の content から取り出す。'
    Write-Step ('     取り出し方は ' + (Join-Path $vaultDir 'README.txt') + '）')
    Write-Step ('  2. エクスプローラーで、データのフォルダー（' + $dataDir + '）を消す（保管庫も中にあります）')
    Write-Step '  3. 資格情報マネージャーで「pip0」を削除する（鍵を消すと、暗号化DB は二度と読めません）'
    Write-Step 'もう一度 pip0 を導入する場合は、2 と 3 をせずに残しておけば、索引や操作履歴を引き継げます。'
    Write-Step '全復元で「自動処理の停止」が記録されています。もう一度導入したときは、自動処理は止まったままです（python -m pip0 resume で再開）。'
}

# ----------------------------------------------------------------------
# 本体
# ----------------------------------------------------------------------

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

try {
    Write-Step 'pip0 のアンインストール（プログラムの削除）'
    if ($env:OS -ne 'Windows_NT') {
        throw 'このスクリプトは Windows 専用です。'
    }
    if (Test-IsElevated) {
        throw '管理者としては実行しないでください（pip0 は今のユーザーのフォルダーに入っています）。通常の PowerShell で実行し直してください。'
    }
    $InstallDir = Resolve-FullPath $InstallDir
    if ([string]::IsNullOrEmpty((Split-Path -Path $InstallDir -Parent))) {
        throw ('ドライブの一番上（' + $InstallDir + '）は、pip0 の導入先として扱いません。')
    }
    if (-not (Test-Path -LiteralPath $InstallDir -PathType Container)) {
        throw ('pip0 の導入先が見つかりません：' + $InstallDir + '。-InstallDir で導入先を指定してください。')
    }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $MarkerFileName) -PathType Leaf)) {
        throw ('pip0 の導入先の印（' + $MarkerFileName + '）がありません：' + $InstallDir + '。pip0 の導入先ではない可能性があるため、何もしません。')
    }
    $python = Join-Path $InstallDir 'runtime\python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw ('pip0 専用の Python がありません：' + $python + '。退避したファイルの復元と登録の解除に必要なため、' +
            'scripts\install.ps1 で導入し直してから、もう一度実行してください。何も消していません。')
    }
    $locations = Get-Pip0Locations $python

    Write-Step ('  導入先（消すもの）：' + $InstallDir)
    Write-Step ('  データ（消さないもの）：' + (Get-JsonField $locations 'DATA_DIR'))
    Write-Step '退避したファイルを元の場所に戻し、すべて戻ったことを確かめてから、プログラムだけを消します。'
    if (-not $Yes) {
        $answer = Read-Host '始めますか？ [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Write-Step '中止しました。何も変えていません。'
            exit 1
        }
    }

    Write-Section '1/8 pip0 に終了を依頼します'
    $code = Invoke-Live $python @('-I', '-X', 'utf8', '-m', 'pip0', 'shutdown')
    if ($code -ne 0) {
        Write-Step ('  （終了コード ' + $code + '。pip0 が動いていなかった場合も、こうなることがあります）')
    }
    if (-not (Wait-Pip0Exit $InstallDir 30)) {
        throw 'pip0 が終了しませんでした。通知領域の pip0 のアイコンから終了してから、もう一度実行してください。何も消していません。'
    }

    Write-Section '2/8 全復元：自動処理を止め、退避したファイルを元の場所に戻します'
    $restoreCode = Invoke-Live $python @('-I', '-X', 'utf8', '-m', 'pip0', 'restore-all')
    Write-Step ('  （全復元の終了コード ' + $restoreCode + '）')
    if (-not (Wait-Pip0Exit $InstallDir 60)) {
        throw '全復元のために起動した pip0 のプロセスが終わりませんでした。しばらく待ってから、もう一度実行してください。何も消していません。'
    }

    Write-Section '3/8 保管庫を確かめます（manifest.json を1件ずつ読みます）'
    $vaultDir = [string](Get-JsonField $locations 'VAULT_DIR')
    $vaultDirs = @($vaultDir)
    # 設定で保管庫の場所を変えた場合に備えて、既定の場所も調べる
    $defaultVault = Join-Path $env:LOCALAPPDATA 'pip0\vault'
    if (-not ((Test-PathInside $defaultVault $vaultDir) -and (Test-PathInside $vaultDir $defaultVault))) {
        $vaultDirs += $defaultVault
    }
    $summary = Get-VaultSummary $vaultDirs
    Write-Step ('  保管庫：' + ($vaultDirs -join '、'))
    Write-Step ('  記録 ' + $summary.Total + ' 件：元の場所に戻ったもの ' + $summary.Restored + ' 件、退避の前に止まったもの ' + $summary.NotEvacuated +
        ' 件、戻っていないもの ' + @($summary.Blocking).Count + ' 件、ゴーストが見つからないもの ' + @($summary.Missing).Count + ' 件')
    $stopHere = $false
    if (@($summary.Blocking).Count -gt 0) {
        Write-Host '元の場所に戻っていない項目があります。' -ForegroundColor Red
        foreach ($item in @($summary.Blocking)) {
            Write-VaultItem $item
        }
        $stopHere = $true
    }
    if (@($summary.Missing).Count -gt 0) {
        Write-Caution '元の場所のゴーストが見つからない項目があります（消された・移動された）。中身は保管庫の content だけにあります。'
        foreach ($item in @($summary.Missing)) {
            Write-VaultItem $item
        }
        if (-not $AcceptMissingGhosts) {
            Write-Step '  中身を取り出してから続ける場合は、-AcceptMissingGhosts を付けて実行し直してください（保管庫は消しません）。'
            $stopHere = $true
        }
    }
    if ($stopHere) {
        Write-Host ''
        Write-Host 'アンインストールを止めました。プログラム、登録、データは消していません（全復元で、自動処理は止まっています）。' -ForegroundColor Red
        Write-Step '  - 全復元をもう一度試す：scripts\restore-all.cmd をダブルクリック（続きから復元します）'
        Write-Step ('  - 保管庫の一覧：& "' + $python + '" -I -m pip0 vault list')
        Write-Step ('  - 手で取り出す方法：' + (Join-Path $vaultDir 'README.txt'))
        exit 1
    }
    Write-Step '  元の場所に戻っていない項目はありません。'

    Write-Section '4/8 pip0 フォルダーの登録（同期ルート）を解除します'
    $code = Invoke-Live $python @('-I', '-X', 'utf8', '-m', 'pip0', 'unregister-root')
    if ($code -ne 0) {
        throw ('pip0 フォルダーの登録を解除できませんでした（終了コード ' + $code + '。理由は上の表示）。プログラムは消していません。' +
            '全復元は終わっています。原因を取り除いてから、もう一度実行してください。')
    }
    [void](Wait-Pip0Exit $InstallDir 30)

    Write-Section '5/8 ブラウザー拡張の受け口の登録を解除します'
    $registerScript = Find-SiblingScript 'register-native-host.ps1' $InstallDir
    $hostOk = $false
    if ($null -ne $registerScript) {
        $global:LASTEXITCODE = 0
        & $registerScript -InstallDir $InstallDir -Unregister
        $hostOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $hostOk) {
        Write-Caution '受け口の登録を解除できませんでした。手で解除するには、次の2つを実行してください（コマンド プロンプト）。'
        Write-Step '  reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\pip0.bridge" /f'
        Write-Step '  reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\pip0.bridge" /f'
    }

    Write-Section '6/8 自動起動のショートカットを消します'
    $autostartScript = Find-SiblingScript 'autostart.ps1' $InstallDir
    $autostartOk = $false
    if ($null -ne $autostartScript) {
        $global:LASTEXITCODE = 0
        & $autostartScript -Disable -InstallDir $InstallDir
        $autostartOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $autostartOk) {
        Write-Caution ('自動起動の解除で問題がありました（上の表示）。スタートアップ フォルダー（' +
            [Environment]::GetFolderPath('Startup') + '）の pip0.lnk を確かめてください。')
    }

    Write-Section '7/8 ファイアウォールの規則を確かめます（消しません）'
    Show-FirewallAdvice $InstallDir

    Write-Section '8/8 プログラムのフォルダーを消します'
    Remove-ProgramFolder $InstallDir $locations $stamp
    Write-Step ('消しました：' + $InstallDir)

    Write-Host ''
    Write-Host 'pip0 のプログラムを削除しました。' -ForegroundColor Green
    Write-DataLocations $locations $summary
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('エラー：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
