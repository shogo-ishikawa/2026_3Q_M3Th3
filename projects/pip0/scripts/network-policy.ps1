<#
.SYNOPSIS
    Windows Defender ファイアウォールで、pip0 の3つのプログラムの送信と受信をブロックする規則を、適用・削除・確認・試験します。

.DESCRIPTION
    対象は、pip0 の導入先（-InstallDir）にある次の3つのプログラムだけです。
        runtime\python.exe    pip0 専用の Python（コマンド、ブラウザー拡張の受け口）
        runtime\pythonw.exe   pip0 専用の Python（常駐処理。画面なし）
        shell\Pip0Shell.exe   pip0 シェル（常駐UI、OS 連携）
    それぞれに「送信（Outbound）をブロック」と「受信（Inbound）をブロック」の規則を作ります（合わせて6つ、グループ「pip0」）。
    ほかのプログラムの規則と、既定の動作（プロファイルごとの受信・送信の既定の許可／ブロック）は変えません。

      -Apply   規則を作ります（同じ導入先の規則があれば作り直します）。管理者が必要です。
      -Remove  グループ「pip0」の規則のうち、この導入先の3つのプログラムのものだけを消します。管理者が必要です。
      -Check   規則が有効な設定（ActiveStore）に入っているか、各プロファイル（ドメイン・プライベート・パブリック）が
               有効か、既定の動作を表示します。規則がなければ「適用されていません」と表示します。
      -Test    （指定したときだけ）runtime\python.exe と runtime\pythonw.exe から、公開の IP アドレスの 443 番へ
               TCP の接続を試み、BLOCKED（OS が拒否した）・NOT BLOCKED（接続できた）・判定できない、をそのまま表示します。
               比べるために、規則の対象外の PowerShell からも同じ接続を試します。接続できたときは、データを送らずにすぐ閉じます。
               導入先は今のユーザーが書き換えられる場所のため、-Test は管理者としては実行しません。

    規則の範囲（詳しくは docs\network.md）
      - 対象：上の3つのプログラムの、送信と受信（すべてのプロトコル、すべての相手、すべてのプロファイル）。
      - DNS：プログラムが名前解決を頼むと、Windows の DNS Client サービス（svchost.exe）が代わりに DNS サーバーへ
        問い合わせます。この問い合わせは、プログラムごとの規則の対象外です。pip0 は、プロセスの中の禁止（netguard）で、
        名前解決の呼び出しそのものを止めます。
      - 子プロセス：上の3つのプログラムで動くものだけが対象です。ブラウザーが起動する受け口（pip0-native-host.bat）は、
        cmd.exe が runtime\python.exe を起動するため対象になります（cmd.exe 自体は通信しません）。
      - ブラウザー（Chrome／Edge）自体の閲覧・ダウンロードの通信は、意図して対象外です。
      - OS のファイアウォールによる通信の制限であり、物理的な切断ではありません。
      - Windows エラー報告は、ほかのシステムのプロセスから、クラッシュの情報を送ることがあります。
        アプリごとの除外（WerAddExcludedApplication）は自動では行いません（手作業の手順は docs\network.md）。

.PARAMETER Apply
    規則を作ります（管理者が必要）。

.PARAMETER Remove
    この導入先の pip0 の規則を消します（管理者が必要）。グループ「pip0」以外の規則は消しません。

.PARAMETER Check
    規則とプロファイルの状態を表示します。

.PARAMETER Test
    実際に接続を試します（通常の PowerShell で実行します）。

.PARAMETER InstallDir
    pip0 の導入先。既定は %LOCALAPPDATA%\Programs\pip0。
    管理者として実行するとき、別のアカウントの権限を使った場合は、%LOCALAPPDATA% がそのアカウントの場所になるため、
    pip0 を導入したユーザーの導入先を必ず指定してください（install.ps1 の最後に、そのままのコマンドが表示されます）。

.PARAMETER TestAddress
    -Test の接続先の IP アドレス（名前解決を使わないため、名前ではなく IP アドレス）。既定は 1.1.1.1。

.PARAMETER TestPort
    -Test の接続先のポート。既定は 443。

.PARAMETER TestTimeoutSeconds
    -Test の接続を待つ秒数。既定は 5。

.EXAMPLE
    # 管理者の PowerShell で、規則を作る
    powershell -NoProfile -ExecutionPolicy Bypass -File .\network-policy.ps1 -Apply -InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"

.EXAMPLE
    # 確認（管理者でなくても読める場合があります）
    powershell -NoProfile -ExecutionPolicy Bypass -File .\network-policy.ps1 -Check

.EXAMPLE
    # 通常の PowerShell で、実際に接続を試す
    powershell -NoProfile -ExecutionPolicy Bypass -File .\network-policy.ps1 -Test

.EXAMPLE
    # 管理者の PowerShell で、規則を消す
    powershell -NoProfile -ExecutionPolicy Bypass -File .\network-policy.ps1 -Remove -InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Remove,
    [switch]$Check,
    [switch]$Test,
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\pip0",
    [string]$TestAddress = '1.1.1.1',
    [ValidateRange(1, 65535)]
    [int]$TestPort = 443,
    [ValidateRange(1, 60)]
    [int]$TestTimeoutSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 規則のグループの名前（-Remove と uninstall.ps1 は、このグループの規則だけを扱う）
$RuleGroup = 'pip0'

# WinError 10013（WSAEACCES）：OS（Windows フィルタリング プラットフォーム）がソケットの接続を拒否したときの番号
$WinErrorAccessDenied = 10013

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

# 導入先のパスから、規則の名前に付ける短い印（SHA-256 の先頭8文字）を作ります。
# 同じ PC のほかのユーザーの pip0 の規則と、名前が重ならないようにするためです
function Get-PathTag([string]$Path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Path.ToLowerInvariant()))
    }
    finally {
        $sha.Dispose()
    }
    return ((@($bytes[0..3]) | ForEach-Object { $_.ToString('x2') }) -join '')
}

# ----------------------------------------------------------------------
# 規則の中身
# ----------------------------------------------------------------------

# 対象の3つのプログラム
function Get-Programs([string]$Root) {
    [pscustomobject]@{ Key = 'python'; File = 'python.exe'; Path = (Join-Path $Root 'runtime\python.exe'); Role = 'pip0 専用の Python（コマンド、ブラウザー拡張の受け口）' }
    [pscustomobject]@{ Key = 'pythonw'; File = 'pythonw.exe'; Path = (Join-Path $Root 'runtime\pythonw.exe'); Role = 'pip0 専用の Python（常駐処理）' }
    [pscustomobject]@{ Key = 'shell'; File = 'Pip0Shell.exe'; Path = (Join-Path $Root 'shell\Pip0Shell.exe'); Role = 'pip0 シェル（常駐UI、OS 連携）' }
}

# 作る規則（3つのプログラム × 送信・受信）
function Get-RuleSpecs([string]$Root) {
    $tag = Get-PathTag $Root
    foreach ($program in @(Get-Programs $Root)) {
        foreach ($direction in @('Outbound', 'Inbound')) {
            if ($direction -eq 'Outbound') {
                $label = '送信'
            }
            else {
                $label = '受信'
            }
            [pscustomobject]@{
                Name = 'pip0-' + $direction.ToLowerInvariant() + '-' + $program.Key + '-' + $tag
                DisplayName = 'pip0：' + $program.File + ' の' + $label + 'をブロック'
                Description = 'pip0（ファイル整理アシスタント）の ' + $program.Role + ' の' + $label + 'をブロックします。' +
                    'scripts\network-policy.ps1 -Apply が作成しました。消すときは -Remove を使います。'
                Direction = $direction
                DirectionLabel = $label
                Program = $program.Path
                File = $program.File
            }
        }
    }
}

# グループ「pip0」の規則を読みます（ない場合は空。読めない場合はエラー）
function Get-Pip0GroupRules([string]$Store) {
    try {
        return @(Get-NetFirewallRule -PolicyStore $Store -Group $RuleGroup -ErrorAction Stop)
    }
    catch {
        if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
            return @()
        }
        throw
    }
}

# グループ「pip0」の規則と、その対象のプログラムを、表示しやすい形にします
function Get-RuleDetails([string]$Store) {
    foreach ($rule in @(Get-Pip0GroupRules $Store)) {
        $program = $null
        try {
            $filter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
            $program = [Environment]::ExpandEnvironmentVariables([string]$filter.Program)
        }
        catch {
            $program = $null
        }
        [pscustomobject]@{
            Rule = $rule
            Name = [string]$rule.Name
            DisplayName = [string]$rule.DisplayName
            Direction = [string]$rule.Direction
            Action = [string]$rule.Action
            Enabled = [string]$rule.Enabled
            Profile = [string]$rule.Profile
            Program = $program
            Status = [string]$rule.PrimaryStatus
        }
    }
}

function Test-RuleMatches($Detail, $Spec) {
    if ($null -eq $Detail.Program) {
        return $false
    }
    return (($Detail.Program -eq $Spec.Program) -and ($Detail.Direction -eq $Spec.Direction))
}

# この導入先の3つのプログラムに対する、グループ「pip0」の規則を消し、消した数を返します
function Remove-OurRules([string]$Root) {
    $programs = @(Get-Programs $Root | ForEach-Object { $_.Path })
    $count = 0
    foreach ($detail in @(Get-RuleDetails 'PersistentStore')) {
        if ($null -ne $detail.Program -and ($programs -contains $detail.Program)) {
            $detail.Rule | Remove-NetFirewallRule
            Write-Step ('  消しました：' + $detail.DisplayName + '（' + $detail.Program + '）')
            $count++
        }
    }
    return $count
}

# ----------------------------------------------------------------------
# -Apply / -Remove / -Check / -Test
# ----------------------------------------------------------------------

function Invoke-Apply([string]$Root) {
    Write-Section 'pip0 の通信をブロックする規則を作ります（-Apply）'
    if (-not (Test-IsElevated)) {
        throw '-Apply には管理者の権限が必要です。「管理者として実行」で PowerShell を開いてから実行してください。'
    }
    $python = Join-Path $Root 'runtime\python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw ('pip0 の導入先が見つかりません（' + $python + ' がありません）。-InstallDir で、pip0 を導入したユーザーの導入先を指定してください' +
            '（例：-InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"）。規則は作っていません。')
    }
    foreach ($program in @(Get-Programs $Root)) {
        if (-not (Test-Path -LiteralPath $program.Path -PathType Leaf)) {
            Write-Caution ($program.File + ' がまだありません（' + $program.Path + '）。規則は作りますが、pip0 の導入を確かめてください。')
        }
    }
    $removed = Remove-OurRules $Root
    if ($removed -gt 0) {
        Write-Step ('前の規則を ' + $removed + ' 個消しました（作り直します）。')
    }
    foreach ($spec in @(Get-RuleSpecs $Root)) {
        $sameName = @(Get-NetFirewallRule -Name $spec.Name -ErrorAction SilentlyContinue)
        if ($sameName.Count -gt 0) {
            if ([string]$sameName[0].Group -ne $RuleGroup) {
                throw ('同じ名前（' + $spec.Name + '）の、グループ「pip0」ではない規則があります。何も変えずに止めます。')
            }
            $sameName[0] | Remove-NetFirewallRule
        }
        New-NetFirewallRule -Name $spec.Name -DisplayName $spec.DisplayName -Description $spec.Description -Group $RuleGroup `
            -Direction $spec.Direction -Action Block -Program $spec.Program -Profile Any -Enabled True | Out-Null
        Write-Step ('  作りました：' + $spec.DisplayName + '（' + $spec.Program + '）')
    }
    Write-Step 'ほかのプログラムの規則と、既定の動作は変えていません。'
}

function Invoke-Remove([string]$Root) {
    Write-Section 'pip0 の規則を消します（-Remove）'
    if (-not (Test-IsElevated)) {
        throw '-Remove には管理者の権限が必要です。「管理者として実行」で PowerShell を開いてから実行してください。'
    }
    $count = Remove-OurRules $Root
    if ($count -eq 0) {
        Write-Step ('この導入先（' + $Root + '）の pip0 の規則はありませんでした。')
    }
    else {
        Write-Step ('この導入先の pip0 の規則を ' + $count + ' 個消しました。グループ「pip0」以外の規則は変えていません。')
    }
    $others = @(Get-RuleDetails 'PersistentStore')
    if ($others.Count -gt 0) {
        Write-Step 'グループ「pip0」に、ほかの導入先の規則が残っています（消していません）。'
        foreach ($other in $others) {
            Write-Step ('  ' + $other.DisplayName + '：' + $other.Program)
        }
        Write-Step 'それらを消すには、その導入先を -InstallDir で指定して -Remove を実行してください。'
    }
}

function Write-ScopeNote {
    Write-Step ''
    Write-Step 'この規則の範囲（詳しくは docs\network.md）'
    Write-Step '  - 対象：pip0 の3つのプログラムの送信と受信。ほかのプログラムと、既定の動作は変えていません。'
    Write-Step '  - 対象外：DNS Client サービス（svchost.exe）が代わりに行う名前解決、ブラウザー自体の通信、'
    Write-Step '            pip0 以外のプロセス（Windows エラー報告など）。'
    Write-Step '  - OS のファイアウォールによる通信の制限であり、物理的な切断ではありません。'
}

# 状態を表示し、6つの規則が有効な設定に入っていて、3つのプロファイルが有効なら $true を返します
function Invoke-Check([string]$Root) {
    Write-Section 'OS のファイアウォール（Windows Defender ファイアウォール）の状態（-Check）'
    Write-Step ('導入先：' + $Root + '（実行しているアカウント：' + [Environment]::UserName + '）')
    $reasons = New-Object System.Collections.Generic.List[string]

    Write-Step ''
    Write-Step '対象のプログラム'
    foreach ($program in @(Get-Programs $Root)) {
        if (Test-Path -LiteralPath $program.Path -PathType Leaf) {
            $state = 'あり'
        }
        else {
            $state = 'なし'
        }
        Write-Step ('  ' + $program.File + '：' + $state + '（' + $program.Path + '）')
    }

    Write-Step ''
    Write-Step 'プロファイル（有効な設定）'
    try {
        foreach ($firewallProfile in @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)) {
            $profileName = [string]$firewallProfile.Name
            $enabled = [string]$firewallProfile.Enabled
            if ($enabled -eq 'True') {
                $enabledLabel = '有効'
            }
            elseif ($enabled -eq 'False') {
                $enabledLabel = '無効'
                $reasons.Add('プロファイル「' + $profileName + '」が無効です（そのネットワークでは、規則は使われません）')
            }
            else {
                $enabledLabel = '不明（' + $enabled + '）'
                $reasons.Add('プロファイル「' + $profileName + '」が有効かどうかを確かめられません')
            }
            $localRules = [string]$firewallProfile.AllowLocalFirewallRules
            if ($localRules -eq 'False') {
                $reasons.Add('プロファイル「' + $profileName + '」で、グループ ポリシーがこの PC の規則（ローカルの規則）を使わない設定です')
            }
            Write-Step ('  ' + $profileName + '：' + $enabledLabel + '、受信の既定 ' + [string]$firewallProfile.DefaultInboundAction +
                '、送信の既定 ' + [string]$firewallProfile.DefaultOutboundAction + '、ローカルの規則 ' + $localRules)
        }
    }
    catch {
        $reasons.Add('プロファイルを読めませんでした（' + $_.Exception.Message + '）')
    }

    try {
        foreach ($connection in @(Get-NetConnectionProfile -ErrorAction Stop)) {
            Write-Step ('  使用中のネットワーク：' + $connection.Name + '（' + $connection.InterfaceAlias + '）→ ' + [string]$connection.NetworkCategory)
        }
    }
    catch {
        Write-Step '  使用中のネットワークのプロファイルは読めませんでした。'
    }

    try {
        # Windows セキュリティに登録された、Microsoft 以外のファイアウォール製品
        $products = @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName 'FirewallProduct' -ErrorAction Stop |
            Where-Object { [string]$_.displayName -notmatch 'Windows|Microsoft' })
        if ($products.Count -gt 0) {
            $names = ($products | ForEach-Object { [string]$_.displayName }) -join '、'
            Write-Caution ('ほかのファイアウォール製品が登録されています（' + $names + '）。その製品が通信を管理している場合、' +
                'Windows Defender ファイアウォールの規則は使われないことがあります。')
        }
    }
    catch {
        # 調べられない環境では、何も表示しない
    }

    Write-Step ''
    Write-Step ('規則（グループ「' + $RuleGroup + '」）')
    $active = @()
    $persistent = @()
    $readable = $true
    try {
        $active = @(Get-RuleDetails 'ActiveStore')
        $persistent = @(Get-RuleDetails 'PersistentStore')
    }
    catch {
        $readable = $false
        $reasons.Add('規則を読めませんでした（' + $_.Exception.Message + '）。管理者として -Check を実行してください')
    }
    if ($readable) {
        foreach ($spec in @(Get-RuleSpecs $Root)) {
            $found = @($active | Where-Object { Test-RuleMatches $_ $spec })
            if ($found.Count -eq 0) {
                $local = @($persistent | Where-Object { Test-RuleMatches $_ $spec })
                if ($local.Count -gt 0) {
                    $state = 'この PC の設定にはあるが、有効な設定に入っていない（グループ ポリシーの可能性）'
                }
                else {
                    $state = 'なし'
                }
                $reasons.Add($spec.File + ' の' + $spec.DirectionLabel + 'をブロックする規則が、有効な設定にありません')
            }
            else {
                $good = @($found | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' -and $_.Profile -eq 'Any' })
                if ($good.Count -gt 0) {
                    $state = 'あり（有効、ブロック、すべてのプロファイル。状態 ' + $good[0].Status + '）'
                }
                else {
                    $first = $found[0]
                    $state = 'あり（ただし 有効=' + $first.Enabled + '、動作=' + $first.Action + '、プロファイル=' + $first.Profile + '）'
                    $reasons.Add($spec.File + ' の' + $spec.DirectionLabel + 'の規則が、有効なブロックの規則になっていません')
                }
            }
            Write-Step ('  ' + $spec.DisplayName + '：' + $state)
        }
        $programPaths = @(Get-Programs $Root | ForEach-Object { $_.Path })
        $others = @($active | Where-Object { $null -eq $_.Program -or ($programPaths -notcontains $_.Program) })
        foreach ($other in $others) {
            Write-Step ('  （ほかの導入先の規則）' + $other.DisplayName + '：' + $other.Program)
        }
    }

    Write-Step ''
    if ($reasons.Count -eq 0) {
        Write-Host '結果：pip0 の3つのプログラムの送信と受信をブロックする規則が、有効な設定に入っています。' -ForegroundColor Green
        Write-Step '実際に遮断できるかは、通常の PowerShell で -Test を実行して確かめてください。'
    }
    else {
        Write-Host '結果：OS による pip0 の通信の遮断は、適用されていません（または一部だけです）。' -ForegroundColor Yellow
        foreach ($reason in $reasons) {
            Write-Step ('  - ' + $reason)
        }
    }
    Write-ScopeNote
    return ($reasons.Count -eq 0)
}

# 比べるための接続：規則の対象外の PowerShell から、同じ宛先に TCP で接続してみます
function Test-ControlConnection([string]$Address, [int]$Port, [int]$TimeoutSeconds) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($Address, $Port)
        if ($task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))) {
            return [pscustomobject]@{ Connected = $true; Label = '接続できました（この PC は、この宛先へ接続できる状態です）' }
        }
        return [pscustomobject]@{ Connected = $false; Label = '時間切れ（ネットワークか宛先に問題がある可能性があります）' }
    }
    catch {
        $inner = $_.Exception
        while ($null -ne $inner.InnerException) {
            $inner = $inner.InnerException
        }
        return [pscustomobject]@{ Connected = $false; Label = '接続できませんでした（' + $inner.Message + '）' }
    }
    finally {
        $client.Close()
    }
}

# pip0 の Python から接続を試します。終了コード：0 接続できた、10 OS が拒否（WinError 10013）、11 時間切れ、12 ほかのエラー
function Invoke-Probe([string]$Exe, [string]$Address, [int]$Port, [int]$TimeoutSeconds) {
    $code = @(
        'import socket, sys',
        'address, port, timeout = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])',
        'try:',
        '    connection = socket.create_connection((address, port), timeout=timeout)',
        'except OSError as error:',
        '    code = getattr(error, ''winerror'', None)',
        '    print(type(error).__name__, code)',
        ('    if code == ' + $WinErrorAccessDenied + ':'),
        '        sys.exit(10)',
        '    if isinstance(error, TimeoutError):',
        '        sys.exit(11)',
        '    sys.exit(12)',
        'connection.close()',
        'print(''connected'')',
        'sys.exit(0)'
    ) -join "`n"
    $arguments = @('-I', '-c', $code, $Address, [string]$Port, [string]$TimeoutSeconds)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Exe
    $info.Arguments = (@($arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($info)
    try {
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(($TimeoutSeconds + 20) * 1000)) {
            try { $process.Kill() } catch { }
            return [pscustomobject]@{ Verdict = 'UNKNOWN'; Label = '判定できません（Python が時間内に終わりませんでした）' }
        }
        $process.WaitForExit()
        $exitCode = $process.ExitCode
        $detail = ($stdoutTask.Result + ' ' + $stderrTask.Result).Trim()
    }
    finally {
        $process.Dispose()
    }
    if ($exitCode -eq 0) {
        return [pscustomobject]@{ Verdict = 'NOT BLOCKED'; Label = 'NOT BLOCKED：接続できました（遮断されていません）' }
    }
    if ($exitCode -eq 10) {
        return [pscustomobject]@{ Verdict = 'BLOCKED'; Label = ('BLOCKED：OS が接続を拒否しました（WinError ' + $WinErrorAccessDenied + '）') }
    }
    if ($exitCode -eq 11) {
        return [pscustomobject]@{ Verdict = 'UNKNOWN'; Label = '判定できません：時間切れ（OS の規則による拒否とは確かめられません）' }
    }
    return [pscustomobject]@{ Verdict = 'UNKNOWN'; Label = ('判定できません：接続できませんでした（' + $detail + '）') }
}

# 実際に接続を試し、両方の Python が BLOCKED なら $true を返します
function Invoke-Test([string]$Root, [string]$Address, [int]$Port, [int]$TimeoutSeconds) {
    Write-Section '実際に接続を試します（-Test）'
    if (Test-IsElevated) {
        throw ('-Test は管理者としては実行しません（導入先の python.exe は今のユーザーが書き換えられる場所にあるため、管理者の権限で動かしません）。' +
            '通常の PowerShell で実行してください。規則はプログラムごとに効くため、結果は管理者かどうかによりません。')
    }
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsed)) {
        throw '-TestAddress には、名前ではなく IP アドレスを指定してください（名前解決を使わずに試すため）。'
    }
    Write-Step ('宛先：' + $Address + ' の ' + $Port + ' 番（TCP の送信）。接続できたときは、データを送らずにすぐ閉じます。')
    $control = Test-ControlConnection $Address $Port $TimeoutSeconds
    Write-Step ('  比較：PowerShell（規則の対象外）から：' + $control.Label)

    $verdicts = @()
    foreach ($file in @('python.exe', 'pythonw.exe')) {
        $exe = Join-Path $Root ('runtime\' + $file)
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
            Write-Step ('  ' + $file + '：判定できません（' + $exe + ' がありません）')
            $verdicts += 'UNKNOWN'
            continue
        }
        $result = Invoke-Probe $exe $Address $Port $TimeoutSeconds
        Write-Step ('  ' + $file + '：' + $result.Label)
        $verdicts += $result.Verdict
    }

    Write-Step ''
    $allBlocked = (@($verdicts | Where-Object { $_ -ne 'BLOCKED' }).Count -eq 0)
    if ($verdicts -contains 'NOT BLOCKED') {
        Write-Host '結果：NOT BLOCKED。pip0 の Python から外部へ接続できました。OS による遮断は効いていません（-Check で規則を確かめてください）。' -ForegroundColor Red
    }
    elseif ($allBlocked) {
        Write-Host '結果：BLOCKED。OS が pip0 の Python（python.exe、pythonw.exe）の送信を拒否しました。' -ForegroundColor Green
        if (-not $control.Connected) {
            Write-Caution '比較の接続もできなかったため、この PC のネットワーク自体にも問題がある可能性があります。'
        }
    }
    else {
        Write-Host '結果：判定できません。OS の規則が拒否したことは確かめられませんでした（遮断できたとは扱いません）。' -ForegroundColor Yellow
        if (-not $control.Connected) {
            Write-Step 'PowerShell からも接続できなかったため、ネットワークにつないでから、もう一度試してください。'
        }
    }
    Write-Step ('この試験で確かめたのは、TCP の送信（' + $Address + ':' + $Port + '）だけです。受信、UDP、ほかの宛先、Pip0Shell.exe は')
    Write-Step '試していません（規則があることは -Check で確かめます）。'
    return $allBlocked
}

function Write-Usage {
    Write-Step '使い方（どれか1つ以上を指定します）'
    Write-Step '  -Apply   規則を作る（管理者）'
    Write-Step '  -Remove  この導入先の pip0 の規則を消す（管理者）'
    Write-Step '  -Check   規則とプロファイルの状態を表示する'
    Write-Step '  -Test    実際に接続を試す（通常の PowerShell）'
    Write-Step '  -InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"  導入先（管理者として実行するときは必ず指定）'
    Write-Step '詳しくは docs\network.md を見てください。'
}

# ----------------------------------------------------------------------
# 本体
# ----------------------------------------------------------------------

try {
    if ($env:OS -ne 'Windows_NT') {
        throw 'このスクリプトは Windows 専用です（Windows Defender ファイアウォールを使うため）。'
    }
    if ($Apply -and $Remove) {
        throw '-Apply と -Remove は、同時には使えません。'
    }
    if (-not ($Apply -or $Remove -or $Check -or $Test)) {
        Write-Usage
        exit 1
    }
    $root = Resolve-FullPath $InstallDir
    if (Test-IsElevated) {
        Write-Caution ('管理者として実行しています（アカウント：' + [Environment]::UserName + '）。導入先：' + $root +
            '。pip0 を導入したユーザーと違うアカウントなら、-InstallDir でそのユーザーの導入先を指定してください。')
    }

    $exitCode = 0
    if ($Apply) {
        Invoke-Apply $root
    }
    if ($Remove) {
        Invoke-Remove $root
    }
    if ($Apply -or $Check) {
        if (-not (Invoke-Check $root)) {
            $exitCode = 2
        }
    }
    if ($Test) {
        if (-not (Invoke-Test $root $TestAddress $TestPort $TestTimeoutSeconds)) {
            $exitCode = 2
        }
    }
    exit $exitCode
}
catch {
    Write-Host ('エラー：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
