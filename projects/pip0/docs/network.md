# pip0 の外部通信の禁止と、OS による遮断

この文書は、pip0 が「処理したデータを外部へ送らない」ことを、どのように作り、どのように確かめるかをまとめたものです。

指示書（[CLAUDE_CODE_PROMPT.md](../CLAUDE_CODE_PROMPT.md)）3-1 の「外部サーバーとの通信を物理的に遮断」は、次の2つとして扱います。

1. **pip0 に外部へ送るコードを持たせない**（アプリの設計とプロセスの中の禁止）
2. **OS の機能で、pip0 のプログラムの通信を遮断する**（Windows Defender ファイアウォールの規則）

2 はファイアウォールによる通信の制限で、ネットワークの機器を物理的に切り離すものではありません。また、1 と 2 の両方を満たしても、「絶対に漏洩しない」とは言えません（[4節](#4-規則の範囲止めるものと止めないもの) の「対象外」を参照）。

> **検証の状態（2026-10-30）**：この文書の手順は、Windows 11 の実機ではまだ確かめていません。確かめたのは、Linux 上での構文の確認と、Windows の機能を代役に置き換えた試験だけです（[7節](#7-この文書を書いた時点で確かめたこと)）。実機で確かめるまでは、「OS で遮断できた」と報告しないでください。

## 1. 2つの確認を分ける

「外部へ送るコードが見当たらない」ことと、「OS で通信を遮断できた」ことは、別々に確かめ、別々に報告します（指示書 3-1）。

| | 確認A：pip0 にデータを送るコードがない | 確認B：OS が pip0 の通信を遮断する |
| --- | --- | --- |
| 確かめること | pip0 本体・pip0 シェル・拡張機能に、外部へ送る処理がないこと | Windows が、pip0 の3つのプログラムの送信と受信を止めること |
| 方法 | コードの検査、自動テスト、プロセスの中の禁止（`pip0/netguard.py`） | ファイアウォールの規則（`scripts\network-policy.ps1`） |
| 「確かめた」と言える条件 | 検査とテストの結果を記録したとき | 実機で `-Apply` した後、`-Check` と `-Test` の結果を記録したとき |
| これだけでは分からないこと | 依存ライブラリの C の部分の動き、OS が実際に止めるか | DNS の問い合わせ、ほかのプロセス、ブラウザーの通信（4節） |

## 2. 確認A：pip0 にデータを送るコードがない

### 2-1. しくみ

| 部分 | 外部へ送らないための作り |
| --- | --- |
| pip0 本体（Python） | 外部へ送るライブラリ（`requests` 等）を使いません。起動時に `netguard.install()` が Python の監査フック（`sys.addaudithook`）を入れ、ソケットの接続・名前解決・送信と、許可していない外部コマンドの起動を止めます（[design.md](design.md) 6-6）。止めたときは `NetworkBlocked` を出し、記録します |
| 本体とシェルのやり取り | 親子のプロセスの標準入出力（匿名パイプ）だけです。ネットワーク、名前付きパイプ、ローカルのポートは使いません（[ipc-protocol.md](ipc-protocol.md)） |
| pip0 シェル（C#） | ネットワークを使うコード（`HttpClient`、`Socket` 等）がありません |
| ブラウザー拡張 | `fetch`、`XMLHttpRequest`、`WebSocket` 等を使わず、送り先は Native Messaging の受け口だけです。`manifest.json` の `connect-src 'none'` で、ブラウザーにも断らせています（[browser-extension/README.md](../browser-extension/README.md)） |
| 受け口（Native Messaging） | ブラウザーが起動し、標準入出力で1件を受け取って暗号化DB に記録するだけです |

**監査フックの限界**：Python の説明書にあるとおり、監査フックは「サンドボックス」には使えず、悪意のあるコードは外せます。また、ライブラリの C で書かれた部分が、Python を通さずに OS の通信の機能を呼ぶ場合は止められません。監査フックは、pip0 自身のコードの誤り（うっかり通信する処理を足す等）を見つけて止めるためのものです。そのため、OS の規則（確認B）を別に用意しています。

### 2-2. 確かめ方

リポジトリーのフォルダーで、次を実行します。

1. Python のコードに、通信のライブラリの読み込みがないこと。表示されてよいのは次の2つだけです：`netguard.py` が止めるために名前を書いている行（自己確認用）と、`provenance.py` の `from urllib.parse import urlsplit`（URL を文字列として分解するだけで、通信はしません。自動テスト `tests/test_safety_static.py` も、同じ決まりで確かめています）

   ```bash
   git grep -n -E "^\s*(import|from)\s+(socket|ssl|http|urllib|ftplib|smtplib|xmlrpc|requests|httpx|aiohttp|websocket)" -- projects/pip0/pip0
   ```

2. C# のコードに、通信の機能がないこと（何も表示されないこと）

   ```bash
   git grep -n -E "HttpClient|WebClient|WebRequest|TcpClient|UdpClient|WebSocket|NetworkStream|System\.Net\b|Dns\.|Socket" -- projects/pip0/shell
   ```

3. 拡張機能の自動テスト（`no-network.test.js` を含む。Node.js 22 以上）

   ```bash
   cd projects/pip0
   node --test browser-extension/tests
   ```

4. Windows の実機で、pip0 のプロセスの中の禁止が働くこと（[design.md](design.md) 6-8 の `check-network`）

   ```powershell
   & "$env:LOCALAPPDATA\Programs\pip0\runtime\python.exe" -I -m pip0 check-network
   ```

   `check-network` は、pip0 のプロセスの中の禁止を確かめるコマンドです。OS のファイアウォールは確かめません（確認B）。

`git grep` は、コミットされたファイルを調べます。コミット前のファイルも含めるときは、`git grep` の代わりに PowerShell の `Select-String` を使えます（例：`Get-ChildItem projects\pip0\shell -Recurse -Filter *.cs | Select-String -Pattern "HttpClient|Socket"`）。

## 3. 確認B：OS が pip0 の通信を遮断する

### 3-1. 作る規則

`scripts\network-policy.ps1 -Apply` は、Windows Defender ファイアウォールに、次の6つの規則（グループ「pip0」）を作ります。

| 対象のプログラム（導入先の中） | 役割 | 送信（Outbound） | 受信（Inbound） |
| --- | --- | --- | --- |
| `runtime\python.exe` | pip0 専用の Python（コマンド、ブラウザー拡張の受け口） | ブロック | ブロック |
| `runtime\pythonw.exe` | pip0 専用の Python（常駐処理。画面なし） | ブロック | ブロック |
| `shell\Pip0Shell.exe` | pip0 シェル（常駐UI、OS 連携） | ブロック | ブロック |

- どの規則も、すべてのプロトコル、すべての相手、すべてのプロファイル（ドメイン・プライベート・パブリック）が対象です。
- 規則の名前は `pip0-outbound-python-1a2b3c4d` のような形です。最後の8文字は導入先のパスから作るため、同じ PC のほかのユーザーの pip0 の規則と重なりません。
- **ほかのプログラムの規則と、既定の動作（プロファイルごとの受信・送信の既定）は変えません。**
- Windows のファイアウォールでは、明示したブロックの規則が、ぶつかる許可の規則より優先されます（Microsoft の説明による）。
- 規則はプログラムのパスで決まります。pip0 を同じ場所に導入し直しても、規則はそのまま効きます。導入先を変えた場合は、新しい導入先で `-Apply` をやり直してください。

### 3-2. 手順

**1. 適用する（管理者の PowerShell）**

スタート メニューで「PowerShell」を右クリックし、「管理者として実行」で開きます。`-InstallDir` には、pip0 を導入したユーザーの導入先を書きます（`install.ps1` の最後に、あなたのパスでこのコマンドが表示されます）。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\<名前>\AppData\Local\Programs\pip0\scripts\network-policy.ps1" -Apply -InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"
```

管理者として実行するとき、別の管理者のアカウントの名前とパスワードを入れた場合は、`$env:LOCALAPPDATA` がそのアカウントの場所になります。そのため、`-InstallDir` を省略しないでください。`-Apply` は、導入先に `runtime\python.exe` がなければ、規則を作らずに止まります。

**2. 状態を確かめる（`-Check`）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\network-policy.ps1" -Check
```

`-Check` は、次を表示します。管理者でなくても読める場合があります。読めない場合は、そう表示されるので、管理者の PowerShell で実行してください（そのときは `-InstallDir` を付けます）。

- 3つのプログラムのファイルがあるか
- 3つのプロファイルが有効か、それぞれの受信・送信の既定の動作、この PC の規則（ローカルの規則）が使われる設定か
- 使用中のネットワークが、どのプロファイルか
- 6つの規則が、**有効な設定（ActiveStore）** に入っているか。ActiveStore は、この PC の設定とグループ ポリシーを合わせた、実際に使われている設定です
- まとめ：すべてそろっていれば「有効な設定に入っています」、1つでも欠ければ「**適用されていません（または一部だけです）**」と、その理由

**3. 実際に接続を試す（`-Test`。通常の PowerShell）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\network-policy.ps1" -Test
```

- `runtime\python.exe` と `runtime\pythonw.exe` から、公開の IP アドレス（既定は `1.1.1.1`）の 443 番へ、TCP の接続を試みます（`python.exe -I -c` で `socket.create_connection` を短い時間切れで呼びます）。接続できたときは、データを送らずにすぐ閉じます。
- 比べるために、規則の対象外の PowerShell からも、同じ宛先へ接続を試みます。
- `-Test` を付けたときだけ、この接続を試みます（`-Apply` や `-Check` だけでは、外へ接続しません）。宛先を変えるときは `-TestAddress`（IP アドレス）、`-TestPort` を使います。
- 導入先は今のユーザーが書き換えられる場所なので、`-Test` は管理者の PowerShell では実行しません（規則はプログラムごとに効くため、結果は管理者かどうかによりません）。

**4. 規則を消す（管理者の PowerShell）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\<名前>\AppData\Local\Programs\pip0\scripts\network-policy.ps1" -Remove -InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"
```

消すのは、グループ「pip0」の規則のうち、この導入先の3つのプログラムのものだけです。ほかの規則は変えません。

### 3-3. 結果の読み方

`-Test` の結果は、次の3つのどれかです。

| 表示 | 意味 |
| --- | --- |
| `BLOCKED` | 2つの Python のどちらも、OS が接続を拒否しました（`WinError 10013`。ソケットの操作がアクセス許可で拒否されたときの番号で、ファイアウォールの規則が送信を止めたときに返ると考えています。実機では未確認） |
| `NOT BLOCKED` | pip0 の Python から外部へ接続できました。OS による遮断は効いていません |
| 判定できません | 時間切れ・接続先の拒否・ネットワーク未接続など、OS の規則が止めたとは確かめられない結果です。**遮断できたとは扱いません** |

`-Test` が確かめるのは、TCP の送信（1つの宛先）だけです。受信、UDP、ほかの宛先、`Pip0Shell.exe` の通信は試していません（規則があることを `-Check` で確かめます）。

`-Check` で規則がそろっているのに `-Test` が「判定できません」となる場合は、表示されたエラーの種類と番号を記録してください。BLOCKED と判断するのは `WinError 10013` だけにしているため、OS が別の形で止めた場合は「判定できません」になります（遮断できたと誤って表示しないための作りです）。

終了コード：`0` 処理が終わった（`-Check` は適用済み、`-Test` は BLOCKED）、`2` 確認・試験の結果が「適用されていない」「遮断されていない」「判定できない」、`1` エラー。

### 3-4. 記録すること

実機で確かめたときは、次を記録してください（検証の記録に貼れる形）。

- 日付、Windows のエディションとビルド（`winver` で表示）
- `-Check` の出力（全部）
- `-Test` の出力（全部）と、そのときのネットワーク（家、大学など）
- ほかのセキュリティ製品（ファイアウォール）を使っているか

`-Apply` をしていない、または `-Check` で「適用されていません」と出た場合は、「OS による遮断は未適用（未検証）」と書きます。

## 4. 規則の範囲（止めるものと、止めないもの）

| 経路 | OS の規則（確認B） | pip0 の中の禁止（確認A） | 説明 |
| --- | --- | --- | --- |
| 送信：3つのプログラム → 外部 | 止める | 止める（接続・送信の呼び出し） | |
| 受信：外部 → 3つのプログラム | 止める | ― | pip0 は待ち受けをしない設計です（本体とシェルは標準入出力） |
| DNS の名前解決 | **止めない** | 止める（`getaddrinfo` 等の呼び出し） | 下の 4-1 |
| 子プロセス | 3つのプログラムで動くものだけ止める | 許可していない外部コマンドの起動を止める | 下の 4-2 |
| ブラウザー（Chrome／Edge）の閲覧・ダウンロード | **止めない（意図的）** | ― | 下の 4-3 |
| 同じ PC の中の通信（ループバック、`127.0.0.1` 等） | 効くかどうか未確認 | 止める（宛先によらず接続の呼び出しを止める設計） | Windows のファイアウォールはループバックの通信を規則の対象にしない、とする情報があります。実機で確かめていません |
| pip0 以外のプロセス（Windows エラー報告、Microsoft Defender のクラウド保護、OneDrive、Windows Update 等） | **止めない** | ― | 下の 4-4 |
| 物理的な切断 | しない | しない | ファイアウォールは、OS の中で通信を通すか止めるかを決める仕組みです |

### 4-1. DNS

Windows では、プログラムが名前解決（名前から IP アドレスを調べること）を頼むと、**DNS Client サービス**（`svchost.exe` の中で動く Windows のサービス）が、代わりに DNS サーバーへ問い合わせます。この問い合わせは pip0 のプログラムが送るものではないため、プログラムごとの規則では止まりません。DNS の問い合わせの名前に、データを埋め込んで外へ出す経路もあり得ます。

そのため pip0 は、プロセスの中の禁止（netguard）で、名前解決の呼び出しそのもの（`socket.getaddrinfo` 等）を止めます。DNS Client サービスを止める・ほかのアプリの名前解決を変える、といった PC 全体の設定変更はしません。

### 4-2. 子プロセス

規則は、プログラムのファイル（パス）ごとに効きます。pip0 のプログラムが別のプログラムを起動すると、その子プロセスは、自分のファイルで判断されます。

- **ブラウザー拡張の受け口**：Chrome／Edge が `native-host\pip0-native-host.bat` を `cmd.exe` で起動し、その `cmd.exe` が `runtime\python.exe` を起動します。通信の処理をするのは `runtime\python.exe` なので、規則の対象です。`cmd.exe` 自体は通信しません（`cmd.exe` は規則の対象外です。ほかのアプリも使うプログラムなので、pip0 の規則には入れません）。
- **pip0 シェルが「開く」「場所を開く」で起動するもの**（既定のアプリ、エクスプローラー）：ユーザーの操作で、ユーザーのファイルを開くもので、pip0 ではないため対象外です。
- pip0 本体は、許可していない外部コマンドの起動を、プロセスの中の禁止で止めます。

### 4-3. ブラウザー

ブラウザーの Web 閲覧とダウンロードの通信は、意図して対象外です（指示書 3-1：ブラウザー本来の通信を止める意味ではない）。拡張機能はブラウザーの中で動くため、ファイアウォールでは、拡張機能の通信とブラウザーの通信を区別できません。拡張機能が外部へ送らないことは、確認A（コードの検査と自動テスト、`connect-src 'none'`）で確かめます。

### 4-4. Windows エラー報告と、ほかの OS の機能

pip0 のプログラムが異常終了すると、Windows エラー報告（WER）が、PC の診断データの設定に従って、クラッシュの情報を Microsoft へ送ることがあります。送るのは OS のプロセス（`WerFault.exe` 等）なので、pip0 の規則の対象外です。クラッシュの情報には、プロセスのメモリーの一部（処理中のファイル名や本文の断片）が含まれる可能性があります。

**任意の手作業：アプリごとの除外（自動では行いません）**

Windows の `WerAddExcludedApplication` で、アプリをエラー報告の対象から外せます。pip0 のスクリプトは、これを自動では行いません。行うかどうかは、PC の持ち主が決めます。

- 除外は、**実行ファイルの名前**（例：`Pip0Shell.exe`）で決まり、フォルダーでは区別されません。`python.exe` を除外すると、同じユーザーのほかの Python も、エラー報告の対象外になります。`Pip0Shell.exe` は pip0 だけの名前です。
- 今のユーザーだけを対象にした場合、設定は HKEY_CURRENT_USER に記録されます（Microsoft の説明による）。

通常の PowerShell で、次を実行します（`0` が表示されれば成功）。

```powershell
# WerAddExcludedApplication（wer.dll）を PowerShell から呼べるようにする
Add-Type -Namespace Pip0 -Name Wer -MemberDefinition @'
[DllImport("wer.dll", CharSet = CharSet.Unicode)]
public static extern int WerAddExcludedApplication(string exeName, bool allUsers);
[DllImport("wer.dll", CharSet = CharSet.Unicode)]
public static extern int WerRemoveExcludedApplication(string exeName, bool allUsers);
'@
# 今のユーザーだけ、pip0 シェルを除外する
[Pip0.Wer]::WerAddExcludedApplication('Pip0Shell.exe', $false)
# 元に戻すとき
# [Pip0.Wer]::WerRemoveExcludedApplication('Pip0Shell.exe', $false)
```

ほかにも、Microsoft Defender のクラウド保護（疑わしいファイルの送信）、OneDrive の同期、Windows Update など、OS やほかのアプリの機能は、pip0 の規則とは関係なく、それぞれの設定で通信します。pip0 が扱ったファイルも、それらの機能の対象になり得ます。これらの設定は、PC の持ち主が決めるもので、pip0 は変えません。

## 5. よくある状態と対処

| 状態 | 主な原因 | 対処 |
| --- | --- | --- |
| `-Check` で「この PC の設定にはあるが、有効な設定に入っていない」 | 大学・会社が管理する PC で、グループ ポリシーがこの PC の規則（ローカルの規則）を使わない設定にしている | PC の管理者に相談してください。pip0 はポリシーを変えません |
| `-Check` で「プロファイル … が無効です」 | そのプロファイルのファイアウォールが無効 | 有効にするかは、PC の持ち主・管理者が決めます（pip0 は変えません）。無効のプロファイルのネットワークでは、規則は使われません |
| 「ほかのファイアウォール製品が登録されています」 | ほかのセキュリティ製品が通信を管理している | その製品で、同じ3つのプログラムをブロックする設定が必要です（その製品の説明書を参照） |
| `-Apply` が「導入先が見つかりません」 | 管理者のアカウントの `%LOCALAPPDATA%` を見ている | `-InstallDir` に、pip0 を導入したユーザーの導入先を書きます |
| `-Test` が「判定できません」 | ネットワークにつながっていない、宛先までの途中の機器（大学のネットワーク等）が止めている | ネットワークにつないでから、もう一度試します。比較の接続（PowerShell から）の結果も見てください |
| `-Test` が `NOT BLOCKED` | 規則がない・無効、プロファイルが無効、ほかの製品が管理している | `-Check` の理由を見て直します |

## 6. 報告のしかた

- 確認A と確認B を、別々の行に書きます。
  - 確認A：日付、実行した検査とテスト、結果
  - 確認B：日付、`-Check` と `-Test` の結果。未適用・未実行なら「OS による遮断は未適用（未検証）」
- 「物理的に遮断した」「絶対に漏洩しない」とは書きません。4節の対象外のものがあることも、あわせて書きます。

## 7. この文書を書いた時点で確かめたこと

**確かめたこと（Linux 上。2026-10-30）**

- `network-policy.ps1` の構文（PowerShell の構文解析器）と、Windows PowerShell 5.1 で使えない書き方がないこと
- Windows のファイアウォールのコマンド（`Get-NetFirewallRule` 等）を代役に置き換えて：`-Apply` が6つのブロックの規則だけを作り、ほかの規則を変えないこと、もう一度実行しても6つのままのこと、管理者でなければ作らないこと、`-Remove` がこの導入先の規則だけを消すこと、`-Check` が「規則なし」「プロファイル無効」「グループ ポリシーでローカルの規則が使われない」「読めない」「規則が無効」をそれぞれ「適用されていません」と判断すること
- `-Test` の接続のコードを本物の Python で動かし、待ち受けているポートには「NOT BLOCKED」、閉じたポートには「判定できません」（BLOCKED にしない）と判断すること。終了コードの読み方（10013 だけを BLOCKED とすること）

**確かめていないこと（Windows 11 の実機が必要）**

- 実際の規則の作成・削除、ActiveStore とプロファイルの読み取り、管理者でない場合に読めるかどうか
- 規則があるときに、`-Test` で実際に `WinError 10013` が返り、BLOCKED と表示されること
- 受信・UDP・`Pip0Shell.exe` の通信が実際に止まること、ループバックの扱い
- DNS Client サービス経由の名前解決が規則で止まらないこと（説明は Microsoft の仕組みにもとづくもので、実機では未確認）
- `check-network`（pip0 本体のコマンド）と netguard の動作
- `WerAddExcludedApplication` の手順
- 大学・会社の管理下の PC での動作

## 参考資料

- Microsoft：Windows Firewall rules（規則の優先順位）　https://learn.microsoft.com/windows/security/operating-system-security/network-security/windows-firewall/rules
- Microsoft：New-NetFirewallRule　https://learn.microsoft.com/powershell/module/netsecurity/new-netfirewallrule
- Microsoft：Get-NetFirewallRule（PolicyStore と ActiveStore）　https://learn.microsoft.com/powershell/module/netsecurity/get-netfirewallrule
- Microsoft：Get-NetFirewallProfile　https://learn.microsoft.com/powershell/module/netsecurity/get-netfirewallprofile
- Microsoft：WerAddExcludedApplication function　https://learn.microsoft.com/windows/win32/api/werapi/nf-werapi-weraddexcludedapplication
- Python：sys.addaudithook　https://docs.python.org/3/library/sys.html#sys.addaudithook
- Python：Audit events table　https://docs.python.org/3/library/audit_events.html
- Chrome：Native messaging　https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
