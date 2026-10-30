# pip0 を Windows 11 で使う（導入・起動・権限・復元・削除）

この文書は、pip0 を Windows 11 の PC に導入して使うための手順です。学生と教員の両方に向けて書いています。教員向けの内容（配布物の版の更新）は [11節](#11-教員向け配布物の版を更新する) にまとめました。

> **実機での確認の状態（2026-10-30）**：この文書の手順は、**Windows 11 の実機ではまだ確かめていません**。確かめたのは、Linux 上でのスクリプトの構文と、Windows の機能を代役に置き換えた試験、pip0 シェルのビルドだけです（[12節](#12-確認の状態)）。スクリプトが呼ぶ pip0 本体のコマンド（`serve`、`restore-all`、`shutdown`、`register-root` 等。[design.md](design.md) 6-8）は作成済みで、Linux 上で代役の OS 連携を使って試験しています（Windows の実機では未確認）。実機で動かしたら、結果を記録してください。

## 1. 必要なもの

| もの | 使う場面 | 備考 |
| --- | --- | --- |
| Windows 11（x64） | pip0 を動かす PC | 64 ビットの Intel／AMD の CPU。Arm の PC と Windows 10 は対象外です。管理者の権限は要りません（ファイアウォールの規則を使う場合だけ必要） |
| Python 3.13（64 ビット） | **導入のときだけ**（ライブラリを入れる pip） | python.org の Windows 用インストーラーで入れ、`py` ランチャーで `py -3.13` が動くこと。pip0 自体は、導入先の専用の Python（埋め込み用配布物）で動きます |
| .NET 8 SDK | pip0 シェル（C#）をビルドするとき | .NET 8 以降の SDK。教員がビルドしたものを配る場合、学生には不要です（[11-3](#11-3-pip0-シェルをまとめてビルドして配る)） |
| Google Chrome または Microsoft Edge | ブラウザー拡張「pip0 連携」 | ダウンロードの入手経路の記録に使います |
| インターネット接続 | 導入のときだけ | python.org（埋め込み用配布物）、PyPI（ライブラリ）、NuGet（シェルのビルド）。pip0 の通常の運用では使いません |
| 空き容量 | 導入先 | プログラムのフォルダーは約 120 MB（試験の配置での概算）。ほかに、データ（暗号化DB、保管庫）の分が要ります |

## 2. モデルの事前配置

**不要です。** pip0 の初期コードは、機械学習モデルを使いません（[design.md](design.md) 2-1）。「青いグラフ」は Pillow で色の割合とグラフらしさを計算し、「先週の予算資料」は文書のタイトルと本文の語で判定します。そのため、モデルのファイルを事前に置く手順も、運用中にモデルをダウンロードする処理もありません。

モデルを使う発展課題に取り組む場合は、無料で使えるライセンス、再配布の条件、必要なメモリーと CPU／GPU、事前に置く手順を確かめ、通常の運用中に自動でダウンロードしない作りにしてください（指示書 3-1）。

## 3. 導入の手順

全体の流れは次のとおりです。

```text
1. リポジトリーを手元に置く
2. pip0 シェルをビルドする           scripts\build-shell.ps1
3. pip0 を導入する                    scripts\install.ps1（管理者の権限は不要）
4. ブラウザー拡張を読み込む           chrome://extensions / edge://extensions
5. （任意）通信の遮断を適用する       scripts\network-policy.ps1 -Apply（管理者）
6. pip0 を起動する                    scripts\start-pip0.cmd
7. pip0 フォルダーを登録する          python -m pip0 register-root
```

PowerShell のスクリプトは、どれも次の形で実行します。`-ExecutionPolicy Bypass` は、この1回の PowerShell にだけ効く指定で、PC の設定は変えません。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <スクリプトのパス> <引数>
```

### 3-1. リポジトリーを手元に置く

Git で取得するか、GitHub から ZIP でダウンロードして展開します。以下では、`projects\pip0` フォルダーで PowerShell を開いている前提で書きます（エクスプローラーでフォルダーを開き、アドレス欄に `powershell` と入力して Enter）。

ZIP で取得した場合、Windows がファイルに「インターネットから取得した」印を付けます。`.cmd` をダブルクリックしたときに警告が出ることがあります。ZIP を展開する前に、ZIP ファイルのプロパティで「許可する」にチェックを入れると、この印が付きません。

### 3-2. pip0 シェルをビルドする

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-shell.ps1
```

- 中で `dotnet publish shell\Pip0Shell.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true` を実行し、出力先のフォルダー（`shell\bin\publish\win-x64`）を表示します。`Pip0Shell.exe`（約 70 MB。.NET と WPF を含む）と、問題を調べるための `Pip0Shell.pdb` ができます。
- 初回は NuGet から部品をダウンロードするため、数分かかります。ビルドの間だけ、.NET SDK の利用状況の送信（テレメトリー）を止めます。
- できた `Pip0Shell.exe` には、コード署名がありません（[10節](#10-困ったとき) の「Pip0Shell.exe が止められる」）。

### 3-3. pip0 を導入する

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

**通常の PowerShell** で実行します（管理者として実行すると、スクリプトは止まります。管理者として実行すると、別のアカウントのフォルダーに入ってしまうことがあるためです）。

`install.ps1` は、次の順に行います。

1. Windows 11（x64）であること、管理者として実行していないこと、64 ビットの PowerShell であることを確かめる
2. pip0 専用の Python を用意する：python.org から **Python 3.13.17 の埋め込み用配布物**（`python-3.13.17-embed-amd64.zip`、約 11 MB）をダウンロードし、**スクリプトに固定した SHA-256 と一致するときだけ** 展開します。一致しなければ、展開せずに止まります
3. `runtime\python313._pth` に `Lib\site-packages` と `..\app` を加え、`import site` を有効にする（埋め込み用の Python が、ライブラリと pip0 本体を見つけられるようにするため）
4. PC の Python 3.13 の pip で、[requirements-windows-cp313.txt](../requirements-windows-cp313.txt) のライブラリ（版とハッシュを固定した10個）を `runtime\Lib\site-packages` に入れる。依存ライブラリを自動では足さず（`--no-deps`）、ハッシュが1つでも違えば止まります（`--require-hashes`）
5. pip0 本体（`pip0\`）、pip0 シェル、受け口のファイル、スクリプトを写す
6. 写した pip0 専用の Python で、pip0 本体とライブラリを読み込めること、SQLCipher が使えることを確かめる
7. 前の導入があれば新しいものと入れ替え、ブラウザー拡張の受け口を Chrome と Edge に登録する（`scripts\register-native-host.ps1`。今のユーザーのレジストリー HKCU だけ）
8. 次の手順を表示する

準備は、導入先の隣の作業用フォルダーで行い、確かめた後で入れ替えます。途中で失敗したときは、前の導入をそのまま残します。**データ（`%LOCALAPPDATA%\pip0`）と pip0 専用フォルダー（`%USERPROFILE%\pip0`）は、変更も削除もしません。** ファイアウォールの設定も変えません。

何度実行しても同じ配置になります。pip0 の更新（リポジトリーのコードを変えた後）も、同じコマンドで導入し直します。pip0 が動いている間は入れ替えられないため、先に pip0 を終了してください（[4節](#4-起動と停止)）。

**インターネットにつながらない PC では**：別の PC で `python-3.13.17-embed-amd64.zip` を python.org からダウンロードしておき、次のように渡します（SHA-256 は必ず確かめます）。ライブラリの wheel は pip がダウンロードするため、この場合もインターネット接続は必要です。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -PythonEmbedZip "D:\python-3.13.17-embed-amd64.zip"
```

主な引数：`-InstallDir`（導入先。既定は `%LOCALAPPDATA%\Programs\pip0`）、`-PythonEmbedZip`、`-ShellPublishDir`（ビルド済みのシェルのフォルダー）。

**導入後の配置**（[design.md](design.md) 6-9）

```text
%LOCALAPPDATA%\Programs\pip0\          ← プログラム（導入先）。導入し直すと入れ替わるため、自分のファイルを置かない
  runtime\python.exe, pythonw.exe       ← pip0 専用の Python 3.13.17（埋め込み用配布物）
  runtime\python313._pth                ← モジュールを探す場所の一覧（Lib\site-packages、..\app、import site）
  runtime\Lib\site-packages\            ← ライブラリ（requirements-windows-cp313.txt）
  app\pip0\                             ← pip0 本体（リポジトリーの pip0\ を写したもの）
  shell\Pip0Shell.exe                   ← pip0 シェル
  native-host\pip0-native-host.bat      ← ブラウザーが起動する受け口
  native-host\pip0.bridge.json          ← 受け口の設定（登録のときに書き出す）
  scripts\                              ← restore-all.cmd、start-pip0.cmd、network-policy.ps1、autostart.ps1、
                                           uninstall.ps1、register-native-host.ps1
  pip0-install.json                     ← pip0 の導入先であることを示す印（版、Python の版、導入の日時）
%LOCALAPPDATA%\pip0\                    ← データ（暗号化DB、保管庫、制御ファイル、ログ）。導入では作らない
%USERPROFILE%\pip0\                     ← pip0 専用フォルダー（M1 の仕分け先、M4 のゴーストの置き場所）
```

導入した後に設定を変えたいときは、導入先の `app\pip0\settings.py` ではなく、データのフォルダーの `config.json`（`%LOCALAPPDATA%\pip0\config.json`）に書きます（導入し直すと、導入先の中身は入れ替わるためです。書ける名前は `settings.py` の大文字の名前です）。文字コードは UTF-8 にします（メモ帳の「UTF-8」「UTF-8 (BOM 付き)」、PowerShell 5.1 の `Set-Content -Encoding UTF8` のどれでも読めます。BOM 付きの UTF-16 も読めます）。読めなかったときは `settings.py` の値で動き、`python -m pip0 status` に理由が出ます。

### 3-4. ブラウザー拡張を読み込む

1. Chrome は `chrome://extensions`、Edge は `edge://extensions` を開きます。
2. 「デベロッパー モード」（Edge は「開発者モード」）をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」（Edge は「展開して読み込みます」）を押し、リポジトリーの `projects\pip0\browser-extension` フォルダーを選びます（`install.ps1` の最後に、このフォルダーのパスが表示されます）。
4. ID が `jfaghnlhhcojgeodhjalkchddhphnmhi` であることを確かめます。
5. ツールバーの「pip0 連携」のアイコンを押し、受け口に接続できることを確かめます。

詳しくは [browser-extension/README.md](../browser-extension/README.md) を見てください。リポジトリーのフォルダーを移動・削除すると、拡張機能も読み込めなくなります。

### 3-5. （任意）OS のファイアウォールで pip0 の通信を遮断する

pip0 には外部へ送るコードがありません。それに加えて、OS でも pip0 の3つのプログラム（`runtime\python.exe`、`runtime\pythonw.exe`、`shell\Pip0Shell.exe`）の送信と受信をブロックする場合は、**管理者の PowerShell** で次を実行します（`install.ps1` の最後に、あなたのパスでこのコマンドが表示されます）。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\<名前>\AppData\Local\Programs\pip0\scripts\network-policy.ps1" -Apply -InstallDir "C:\Users\<名前>\AppData\Local\Programs\pip0"
```

確かめ方（`-Check`、通常の PowerShell での `-Test`）、範囲（DNS、子プロセス、ブラウザー等）、解除（`-Remove`）は [network.md](network.md) にあります。これは OS による通信の制限で、物理的な切断ではありません。

### 3-6. pip0 を起動する

導入先の `scripts\start-pip0.cmd` をダブルクリックします。画面のない Python（`runtime\pythonw.exe -I -m pip0 serve`）が起動し、それが pip0 シェルを起動します。通知領域（タスク バーの右）に pip0 のアイコンが出ます。

サインインのたびに自動で起動したい場合だけ、次を実行します（既定はオフ。今のユーザーの「スタートアップ」フォルダーにショートカットを置くだけです）。

```powershell
# オンにする
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\autostart.ps1" -Enable
# オフにする
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\autostart.ps1" -Disable
# 今の状態を見る
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\autostart.ps1"
```

Windows 11 の「設定」→「アプリ」→「スタートアップ」でも、オン／オフを切り替えられます。

### 3-7. pip0 フォルダーを登録する

pip0 専用フォルダー（`%USERPROFILE%\pip0`）を、Windows の Cloud Files API の「同期ルート」として登録します。M4（シュレディンガー退避ストレージ）で、このフォルダーの中のファイルだけを、元のパスのままゴーストにするためです（[design.md](design.md) 4-6）。

```powershell
& "$env:LOCALAPPDATA\Programs\pip0\runtime\python.exe" -I -m pip0 register-root
```

（コマンド プロンプトでは、先頭の `& ` を付けずに実行します。）登録すると、エクスプローラーで、このフォルダーのファイルに状態のアイコン（雲など）が付くことがあります。解除は `unregister-root` です（ゴーストが残っていないときだけ解除できます。アンインストールのときは `uninstall.ps1` が行います）。

## 4. 起動と停止

`python` は、導入先の `runtime\python.exe` のことです（例：`& "$env:LOCALAPPDATA\Programs\pip0\runtime\python.exe" -I -m pip0 status`）。

| したいこと | 方法 |
| --- | --- |
| 起動 | `scripts\start-pip0.cmd` をダブルクリック（自動起動をオンにした場合は、サインインのとき） |
| 終了 | 通知領域の pip0 のアイコンの「終了」。または `python -I -m pip0 shutdown` |
| 状態を見る | `python -I -m pip0 status`（自動処理の状態、高負荷の処理の条件、保管庫の件数、各機能の状態と、権限の不足） |
| 自動処理だけを止める | `python -I -m pip0 stop`（新しい自動仕分け・自動改名・自動退避を止めるだけ。復元はしない） |
| 止めた自動処理を再開する | 通知領域のアイコンの「自動処理を再開」。または `python -I -m pip0 resume`（確認あり） |
| 退避したファイルをすべて戻す | [7節](#7-キルスイッチ全復元) |

## 5. 権限（Windows での実際）

学生の原設計の4つの権限（ファイルへのアクセス、アクセシビリティ、画面情報の取得、ブラウザー拡張との連携）を、Windows 11 の実際の仕組みに当てはめると、次のようになります。

Windows には、macOS の「フルディスクアクセス」「アクセシビリティ」「画面収録」のような、デスクトップアプリごとに許可する画面がありません。pip0 は**サインインしたユーザーの権限**で動き（管理者の権限は使いません）、Windows がそのユーザーに許していることだけができます。許可の画面がない代わりに、下の表の「制限」があります。

### 5-1. ファイルへのアクセス

pip0 は、そのユーザーが NTFS のアクセス権で読み書きできる場所だけを扱えます。そのうえで、**実際に扱う場所は、設定（[settings.py](../pip0/settings.py)）で決めた次の場所だけ**です。

| 場所 | 既定 | pip0 がすること |
| --- | --- | --- |
| ダウンロード（`DOWNLOADS_DIR`） | Windows の「ダウンロード」 | 監視、索引、解析（読む）。M1：完了したファイルを pip0 専用フォルダーへ移動・改名する（書く）。ダウンロードの印（`Zone.Identifier`）を読む |
| pip0 専用フォルダー（`PIP0_ROOT`） | `%USERPROFILE%\pip0` | M1 の仕分け先（書く）。索引、解析（読む）。M4 の退避（ゴースト）と復元（書く） |
| 追加の索引の場所（`EXTRA_INDEX_DIRS`） | なし | 索引と解析だけ（読むだけ。移動・退避はしない） |
| 機密のフォルダー（`SENSITIVE_DIRS`） | なし | 中のファイルを機密として扱う判断にだけ使う |
| データ（`DATA_DIR`） | `%LOCALAPPDATA%\pip0` | 暗号化DB、保管庫、制御ファイル、ログ（書く） |
| 最近使ったファイル | `%APPDATA%\Microsoft\Windows\Recent` | pip0 シェルが読むだけ（M4 の利用の記録） |
| ごみ箱 | ― | 確認画面でユーザーが承認したファイルだけを移す（ごみ箱を空にする機能はない） |

**コントロールされたフォルダー アクセス**（Windows セキュリティのランサムウェア防止）が有効な PC では、保護されたフォルダーへの書き込みが、許可していないアプリから止められます。既定で保護されるのは、ドキュメント、ピクチャ、ビデオ、ミュージック、お気に入りなどです（Microsoft の説明による。ダウンロード、`%USERPROFILE%\pip0`、`%LOCALAPPDATA%\pip0` は既定の一覧に入っていません）。保護するフォルダーを自分で追加した場合や、pip0 の場所を保護されたフォルダーの中に設定した場合は、pip0 の移動・改名・退避・復元が止められることがあります（読むことは止められません）。

許可するときは、Windows セキュリティ →「ウイルスと脅威の防止」→「ランサムウェア防止の管理」→「コントロールされたフォルダー アクセスでアプリを許可する」→「許可されたアプリを追加」→「すべてのアプリを参照」で、導入先の次の3つを追加します（表示の名前は Windows の版で少し違います）。

- `runtime\pythonw.exe`（常駐処理）、`runtime\python.exe`（コマンド、全復元）、`shell\Pip0Shell.exe`（ゴーストの作成・復元、ごみ箱）

止められたとき、Windows は変更をブロックしたことを通知します（英語の表示では「Unauthorized changes blocked」）。pip0 は、その操作を成功として扱わず、「失敗」と理由（書き込みの権限がない等）を操作履歴と画面に残し、原本はそのままにします（設計の方針。実機では未確認）。

### 5-2. 「アクセシビリティ」（ほかのアプリの操作と文脈）

| 使う機能 | Windows の API | 許可の画面 | 制限 |
| --- | --- | --- | --- |
| 前面のアプリとウィンドウタイトルの変化（M2、M1 の文脈） | `SetWinEventHook`、`GetWindowText` | なし | タイトルに出ない情報（Slack の会話の相手がタイトルにない場合等）は取れない。取れないときは「取得不可」と表示し、推測しない |
| ドラッグの検知（M5）、マウスシェイク（M2） | 低レベルのマウスフック（`WH_MOUSE_LL`）、カーソル位置 | なし | 下の UIPI |
| エクスプローラーで選ばれているファイル（M5） | `Shell.Application`（オートメーション） | なし | エクスプローラー以外からのドラッグはファイルを特定できない |
| ファイルダイアログへのパスの入力（M2） | UI Automation（`ValuePattern`） | なし | 下の UIPI。ダイアログの中に UI は入れない |

**UIPI（ユーザー インターフェイスの特権の分離）**：管理者として動いているアプリ（整合性レベルが高いアプリ）のウィンドウには、通常の権限の pip0 から、UI Automation で入力したり、フックで操作を受け取ったりできない場合があります。pip0 を管理者として動かして回避することはしません。これらの機能は、権限を与えれば、すべてのアプリの中身を読めるというものではありません。

### 5-3. 画面の情報

- 読むのは、前面のアプリのプロセス名、ウィンドウタイトル、ウィンドウの種類だけです。その時点の文脈に使い、ウィンドウタイトルは DB に保存しません（[design.md](design.md) 4-3、4-4）。ブラウザー拡張が送るタブの題名と URL は、ダウンロードと結び付けるまで（最大24時間）だけ暗号化DB に置き、その後は消します。
- **画面の画像（スクリーンショット、録画）は取得しません。** そのため、Windows の画面の取り込みの機能や、その許可は使いません。
- ミニドック、浮上式デスク、赤い枠は、最前面の透過したウィンドウです。表示に許可は要りません。

### 5-4. ブラウザー拡張との連携

- ブラウザーと pip0 の受け口は、Native Messaging（標準入出力）でつながります。ネットワークは使いません。
- 受け口の登録は、今のユーザーのレジストリー（HKCU）の次の2か所だけです。管理者の権限は要りません（`scripts\register-native-host.ps1`。詳しくは [native-host/README.md](../native-host/README.md)）。
  - `HKCU\Software\Google\Chrome\NativeMessagingHosts\pip0.bridge`
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\pip0.bridge`
- 拡張機能の権限は `downloads`、`nativeMessaging`、`tabs`、`storage` の4つです（理由は [browser-extension/README.md](../browser-extension/README.md)）。シークレット ウィンドウでは動きません。
- 大学・会社が管理するブラウザーで、ポリシー `NativeMessagingUserLevelHosts` が無効にされていると、HKCU に登録した受け口は使われません（拡張機能のアイコンに「!」が出ます）。

### 5-5. 権限がない・失敗したときの表示

指示書5節のとおり、権限がない・取り消された・フックが外れた等で機能が動かないときは、その機能の状態と理由を表示し、失敗を「空のデータ」や「成功」として記録しません。ほかの機能は動き続けます（設計の方針。実機では未確認）。

- `python -I -m pip0 status` で、機能ごとの状態（動いている／動いていない、理由）を見られます。
- pip0 シェルは、機能ごとの状態を本体へ知らせます（[ipc-protocol.md](ipc-protocol.md) の `feature.status`）。

| 機能の名前（`feature.status`） | 内容 | 動かないときの主な原因と復帰 |
| --- | --- | --- |
| `foreground_hook` | 前面のウィンドウの監視 | 起動の失敗。pip0 を起動し直す |
| `mouse_hook` | ドラッグの検知 | フックが外れた（Windows が応答の遅いフックを外すことがある）。pip0 を起動し直す |
| `cursor_sampler` | シェイクのためのカーソル位置 | デスクの表示中だけ動く |
| `uia` | ファイルダイアログへの入力 | 相手が管理者のアプリ（UIPI）。そのダイアログには入力できない |
| `explorer_selection` | エクスプローラーの選択項目 | エクスプローラーが応答しない |
| `cloud_files` | ゴーストの作成・復元 | 同期ルートの未登録（[3-7](#3-7-pip0-フォルダーを登録する)）、NTFS 以外のドライブ、コントロールされたフォルダー アクセス |
| `recycle_bin` | ごみ箱への移動 | ごみ箱を使えない場所（その場合は削除しない） |
| `recent_items` | 最近使ったファイルの記録 | Windows の設定で「最近使ったファイル」が無効（M4 の判定は「判定不能」になる） |
| `session_events` | 画面のロック・スリープ等の知らせ | 起動の失敗。pip0 を起動し直す |

## 6. 高負荷の処理の条件（電源接続中 かつ 3分間無操作）

画像の解析、本文の取り出し、ハッシュの計算、保管庫へのコピー（M4 の退避）は、次の**両方**を満たすときだけ動きます（指示書 3-2、[design.md](design.md) 4-2）。

- 電源：Windows の電源の状態（`GetSystemPowerStatus`）が「AC（電源接続中）」
- 無操作：サインイン中のセッション全体で、キーボードとマウスの入力が 180 秒以上ない（`GetLastInputInfo`）。pip0 のウィンドウだけが操作されていない状態とは区別します

どちらかの値を読めないとき（電源が「不明」など）は、条件を満たさないものとして扱い、高負荷の処理をしません。実行中は区切り（1ファイルごと、ハッシュとコピーは 1MB ごと）で確かめ直し、操作を再開したり電源を外したりすると、その区切りで一時停止します。次に条件を満たしたとき、そのファイルの最初からやり直します。

ダウンロード完了の確認、ミニドック、検索、復元などは、この条件と関係なく、いつでも動きます（解析済みの情報だけを使います）。

**試し方**：電源につないだまま、3分以上キーボードとマウスに触れずに待ちます。その前と後に `python -I -m pip0 status` を実行し、解析の順番待ちの件数などを比べます。`status` を実行するためのキー入力も「操作」なので、実行した直後の表示は、条件を満たしていない状態になります（それが正しい動きです）。電源を外した場合も、同じように比べます。条件の秒数は `settings.py` の `HEAVY_IDLE_SECONDS` ですが、変えると仕様（3分）から外れます。

## 7. キルスイッチ（全復元）

退避したファイルをすべて元の場所に戻す操作です（[design.md](design.md) 4-9）。

- **ふだん**：通知領域の pip0 のアイコンの「全復元（自動処理を止める）」
- **画面が動かないとき**：導入先の `scripts\restore-all.cmd` をダブルクリック（`%LOCALAPPDATA%\Programs\pip0\runtime\python.exe -I -m pip0 restore-all` を実行し、終わった後もウィンドウを閉じずに待ちます）

すること：

1. すぐに停止の印を書き、新しい自動仕分け・自動改名・自動退避を始めないようにします。
2. 実行中の処理は、次の区切りで止めます（ゴーストにする前のものは中止し、原本はそのまま）。
3. 退避中のすべての項目を、1件ずつ元の場所に戻します。進み具合（全体、成功、衝突、失敗、残り）を表示します。中断や再起動の後に実行し直すと、残りから続けます。
4. 元の場所に別のファイルがあるときは上書きせず、横に「（pip0復元）」を付けた名前で戻し、「衝突」とします。失敗した項目も、保管庫の内容と `manifest.json` は消しません。
5. 自動処理は、ユーザーが「自動処理を再開」を選ぶまで止まったままです。

戻すのは、pip0 が退避したファイルだけです。自動仕分け・自動改名は戻しません（操作履歴に残っています）。pip0 以外が行った変更や、バックアップ全体の復旧はしません。

pip0 が動いていないときにゴーストを開くと、Windows が「クラウド ファイル プロバイダーが実行されていません」というエラーを出します（空の内容は渡しません）。pip0 を起動するか、全復元を実行してください。

## 8. 鍵をなくしたとき

暗号化DB の鍵は、Windows の資格情報マネージャーに保存されています（「Windows 資格情報」→「汎用資格情報」の `pip0`、ユーザー名 `database-key-v1`）。次のような場合に、鍵を読めなくなることがあります。

- Windows を入れ直した、ユーザーのプロファイルを作り直した
- 管理者がユーザーのパスワードをリセットした（Windows が鍵の保護に使う DPAPI の情報が使えなくなることがある）
- 資格情報マネージャーで `pip0` を消した

鍵がないと、暗号化DB（索引、解析結果、ファイルの由来、操作履歴）は読めません。pip0 は、DB があるのに鍵がないとき、勝手に新しい鍵を作りません（新しい鍵では古い DB を読めないため）。**保管庫は暗号化していないため、退避したファイルは鍵がなくても戻せます**（[design.md](design.md) 4-1）。次の順に対処します。

1. **退避したファイルを戻す**：`scripts\restore-all.cmd` を実行します。全復元は、保管庫の `manifest.json` を読み直して復元します。
2. **pip0 を終了する**（通知領域のアイコンの「終了」）。
3. **古い DB を別の名前にする**（消さない）：`%LOCALAPPDATA%\pip0` の `pip0.db`、`pip0.db-wal`、`pip0.db-shm` を、例えば `pip0.db.lost-20261030` のように名前を変えます（`-wal`、`-shm` がない場合もあります）。
4. **pip0 を起動する**：新しい鍵と新しい DB が作られ、保管庫の `manifest.json` から項目を読み直します（起動時の点検。[design.md](design.md) 7-4）。
5. **失われるものを知っておく**：古い DB の索引と解析結果（条件を満たす時間に作り直されます）、ブラウザー拡張の記録によるファイルの由来（古いファイルは「Slackで貰った」等で探せなくなります）、操作履歴、利用の記録（M4 の観測期間が 0 からになり、90日間は自動退避しません）。

古い DB は、鍵がない限り読めません。必要なければ、後で消して構いません。

## 9. アンインストール

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\pip0\scripts\uninstall.ps1"
```

**通常の PowerShell** で実行します。確認（y/N）の後、次の順に行います。

1. pip0 に終了を依頼する（`python -m pip0 shutdown`）
2. 全復元（`python -m pip0 restore-all`）
3. 保管庫の `manifest.json` を1件ずつ読み、**元の場所に戻っていない項目が1つでもあれば止まる**（残っている項目を表示し、何も消しません。設定で保管庫の場所を変えた場合は、既定の場所 `%LOCALAPPDATA%\pip0\vault` も調べます。DB の鍵がなくても読めます）
4. pip0 フォルダーの登録を解除する（`python -m pip0 unregister-root`）
5. ブラウザー拡張の受け口の登録を解除する（`register-native-host.ps1 -Unregister`）
6. 自動起動のショートカットを消す
7. ファイアウォールの規則が残っていれば、消し方を表示する（管理者が必要なため、ここでは消しません。[network.md](network.md) の `-Remove`）
8. プログラムのフォルダー（`%LOCALAPPDATA%\Programs\pip0`）だけを消す

「ゴーストが見つからない」項目（元の場所のゴーストが消された・移動された。中身は保管庫だけにある）があると止まります。中身を保管庫の `content` から取り出した後で続ける場合は、`-AcceptMissingGhosts` を付けて実行します（保管庫は消しません）。

**消さないもの**（最後に場所を表示します）：

- データのフォルダー `%LOCALAPPDATA%\pip0`（暗号化DB、保管庫、制御ファイル、ログ）
- DB の鍵（資格情報マネージャーの `pip0`）
- pip0 専用フォルダー `%USERPROFILE%\pip0`（あなたのファイルです）
- ブラウザーに読み込んだ拡張機能（`chrome://extensions`、`edge://extensions` で削除します）
- 手作業で設定したもの（コントロールされたフォルダー アクセスの許可、[network.md](network.md) の WER の除外）

これらを手で消すときは、**自分のファイルがすべて元の場所にあることを確かめてから**、データのフォルダーを消し、最後に資格情報マネージャーで `pip0` を削除します。鍵を消すと、暗号化DB は二度と読めません。もう一度導入する予定があれば、残しておくと索引と操作履歴を引き継げます。

## 10. 困ったとき

| 状態 | 主な原因 | 対処 |
| --- | --- | --- |
| スクリプトが「このシステムではスクリプトの実行が無効」で動かない | PowerShell の実行ポリシー | この文書の `powershell -NoProfile -ExecutionPolicy Bypass -File …` の形で実行する |
| `install.ps1`：「Python のランチャー（py）が見つかりません」「py -3.13 で起動できません」 | Python 3.13（64 ビット）が入っていない | python.org から Python 3.13 の Windows 用（64 ビット）を入れ、PowerShell を開き直す |
| `install.ps1`：「SHA-256 が … 一致しない」 | ダウンロードが壊れた、別の版のファイル | もう一度実行する。`-PythonEmbedZip` には `python-3.13.17-embed-amd64.zip` だけを渡す |
| `install.ps1`：pip が「DO NOT MATCH THE HASHES」で止まる | 途中の機器・社内の配布元が、別のファイルを返している | 別のネットワークで実行する。一覧（requirements-windows-cp313.txt）のハッシュは書き換えない |
| `install.ps1`：「pip0 シェル（Pip0Shell.exe）が見つかりません」 | シェルをビルドしていない | `build-shell.ps1` を実行するか、`-ShellPublishDir` でビルド済みのフォルダーを指定する |
| `install.ps1`：「pip0 が動いています」「前の導入の名前を変えられません」 | pip0、ブラウザー（受け口）、導入先を開いているエクスプローラー・コマンド プロンプトが、ファイルを使っている | pip0 を終了し、ブラウザーとそれらのウィンドウを閉じてから、もう一度実行する |
| Pip0Shell.exe が止められる、「Windows によって PC が保護されました」 | 自分でビルドした exe にコード署名がない。スマート アプリ コントロールが有効な PC では、署名のないアプリが止められることがある | 設定を変えるかどうかは、PC の持ち主が判断する（pip0 は変えない）。教員がビルドした同じものを使う場合も同じ |
| 起動しても通知領域にアイコンが出ない | 起動時のエラー（画面のない Python なので、表示されない） | コマンド プロンプトで `"%LOCALAPPDATA%\Programs\pip0\runtime\python.exe" -I -m pip0 serve` を実行し、エラーを読む。`status` も見る |
| 拡張機能のアイコンに「!」 | 受け口の未登録、ID の違い、導入先の不足、ポリシー | [native-host/README.md](../native-host/README.md) の「よくあるエラー」。管理下のブラウザーは 5-4 |
| ゴーストを開くと「クラウド ファイル プロバイダーが実行されていません」 | pip0 が動いていない | pip0 を起動する。または全復元（7節） |
| 「承認されていない変更がブロックされました」の通知 | コントロールされたフォルダー アクセス | 5-1 の手順で、pip0 の3つのプログラムを許可する |
| `uninstall.ps1` が「元の場所に戻っていない項目があります」で止まる | 全復元が終わっていない、ゴーストが見つからない | `restore-all.cmd` をもう一度実行する（続きから戻す）。`python -I -m pip0 vault list` で確かめる。ゴーストが見つからない項目は、中身を保管庫から取り出した後、`-AcceptMissingGhosts` |
| `restore-all.cmd` の日本語が化ける | コンソールのフォントが日本語に対応していない | 表示だけの問題で、処理は動きます。Windows ターミナルで開くと読めることがあります |
| ファイアウォールの規則が「適用されていません」 | 管理者で実行していない、導入先の指定違い、グループ ポリシー | [network.md](network.md) の5節 |

## 11. 教員向け：配布物の版を更新する

### 11-1. pip0 専用の Python（埋め込み用配布物）

`install.ps1` は、Python の版と SHA-256 を固定しています（`$PythonVersion`、`$PythonEmbedSha256`）。2026-10-30 の時点で、Windows 用の配布物がある 3.13 の最新版は 3.13.17 です（3.13.18 はソースだけの公開で、埋め込み用配布物がありません）。版を上げるときは、次の順に行います。

1. https://www.python.org/ftp/python/ で、`python-3.13.x-embed-amd64.zip` がある版を探す
2. その zip と、同じ場所の `.sigstore` をダウンロードし、Sigstore の署名を検証する（3.13 の署名者は `thomas@python.org`、発行者は `https://accounts.google.com`。python.org の「Sigstore Information」https://www.python.org/downloads/metadata/sigstore/ で確かめる）

   ```bash
   python -m pip install sigstore
   python -m sigstore verify identity --bundle python-3.13.x-embed-amd64.zip.sigstore --cert-identity thomas@python.org --cert-oidc-issuer https://accounts.google.com python-3.13.x-embed-amd64.zip
   ```

3. SHA-256 を計算する（Windows：`Get-FileHash -Algorithm SHA256 <zip>`、Linux：`sha256sum <zip>`）
4. `install.ps1` の `$PythonVersion` と `$PythonEmbedSha256` を直し、この文書と [network.md](network.md) の版の表記も直す

3.14 などに上げる場合は、`._pth` の名前（`python314._pth`）、ライブラリの wheel（`cp314`）、[requirements-windows-cp313.txt](../requirements-windows-cp313.txt) の作り直し、[design.md](design.md) の記述も変わります。

### 11-2. ライブラリの一覧

[requirements-windows-cp313.txt](../requirements-windows-cp313.txt) の先頭に、作り方と確かめ方を書いています。`pip download --platform win_amd64` は、`sys_platform` の条件を実行している OS で判断するため、Windows 用の依存（`pywin32-ctypes`）は、各 wheel の `Requires-Dist` を Windows の条件で確かめて足しています。

### 11-3. pip0 シェルをまとめてビルドして配る

`Pip0Shell.csproj` は Windows 以外からもビルドできるため、教員が `build-shell.ps1`（PowerShell 7 なら Linux・macOS でも動きます）でビルドし、`shell\bin\publish\win-x64` フォルダーを配れます。学生は、受け取ったフォルダーを `-ShellPublishDir` で渡して導入します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ShellPublishDir "D:\配布\pip0-shell"
```

## 12. 確認の状態

**Linux 上で確かめたこと（2026-10-30）**

- すべての `.ps1` の構文（PowerShell の構文解析器）と、Windows PowerShell 5.1 で使えない書き方・BOM のないファイルがないこと
- 埋め込み用配布物（3.13.17）の SHA-256、Sigstore の署名の検証、SBOM の値との一致。`python313._pth` の書き換えの結果
- [requirements-windows-cp313.txt](../requirements-windows-cp313.txt)：`pip download --require-hashes` でのダウンロードし直し、Windows の条件での依存の確認、ハッシュを1文字変えると止まること。`install.ps1` と同じ引数の `pip install --target` で10個が入ること
- `install.ps1` の関数：展開、`._pth`、ライブラリ、写す処理（`__pycache__` を除く、リンクがあれば止まる）、入れ替えと失敗したときの戻し、前の導入の片付け、導入先とデータの重なりの確認
- `uninstall.ps1` の関数：保管庫の状態の分け方（戻っていない項目・読めない manifest.json・知らない状態で止まる）、プログラムのフォルダーを消す前の確認（印、データの場所、リンク）
- `network-policy.ps1`、`autostart.ps1` の関数（Windows のコマンドは代役。[network.md](network.md) の7節）
- `build-shell.ps1` で、Linux から `Pip0Shell.exe`（PE32+、GUI、x86-64）を実際にビルドできること、古い出力を消すこと、ビルドの失敗を知らせること
- `restore-all.cmd`、`start-pip0.cmd` の形（UTF-8・BOM なし・CRLF、`chcp 65001` より前は ASCII、表示の文に特殊文字がない）。cmd.exe では動かしていません

**Windows 11 の実機で確かめていないこと（すべて）**

- `install.ps1`、`uninstall.ps1`、`autostart.ps1`、`network-policy.ps1` の実行、`build-shell.ps1` の Windows での実行
- `restore-all.cmd`、`start-pip0.cmd` の実行（`chcp 65001` での日本語の表示を含む）
- 埋め込み用の Python が `..\app` の pip0 とライブラリを読み込めること、SQLCipher と資格情報マネージャーが使えること
- 拡張機能の読み込みと受け口への接続、Cloud Files の同期ルートの登録、ゴーストと復元、ごみ箱
- 5節の権限と制限（コントロールされたフォルダー アクセス、UIPI、管理下のブラウザーのポリシー）、機能ごとの状態の表示
- 6節の高負荷の処理の条件、7節の全復元、8節の鍵をなくしたときの手順、9節のアンインストール

## 出典と利用条件

| もの | 入手元 | 利用条件 |
| --- | --- | --- |
| Python 3.13.17 埋め込み用配布物 | https://www.python.org/ftp/python/3.13.17/ | Python Software Foundation License（同梱の `LICENSE.txt`。OpenSSL、SQLite、libffi 等の利用条件も含む） |
| ライブラリ（sqlcipher3、keyring、watchdog、pillow、pypdf と、その依存） | PyPI | 各ライブラリのライセンス（[requirements-windows-cp313.txt](../requirements-windows-cp313.txt) に記載） |
| .NET 8 の実行環境、WPF、Windows フォーム（`Pip0Shell.exe` に含まれる） | Microsoft（NuGet） | MIT |
| CsWin32（ビルドのときだけ使う） | Microsoft（NuGet） | MIT |

参考にした公式資料：

- Python：Using Python on Windows（埋め込み用配布物と `._pth`）　https://docs.python.org/3/using/windows.html
- Microsoft：Protect important folders with controlled folder access　https://learn.microsoft.com/defender-endpoint/controlled-folders
- Microsoft：Customize controlled folder access（アプリの許可）　https://learn.microsoft.com/defender-endpoint/customize-controlled-folders
- Chrome：Native messaging　https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Chrome Enterprise：NativeMessagingUserLevelHosts　https://chromeenterprise.google/policies/#NativeMessagingUserLevelHosts
- Microsoft：Build a Cloud Sync Engine that Supports Placeholder Files　https://learn.microsoft.com/windows/win32/cfapi/build-a-cloud-file-sync-engine
