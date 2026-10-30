# pip0 の設計

この文書は、pip0 の構成、採用技術とその理由、機能ごとの決めごと、モジュール間の約束（関数と戻り値の形）をまとめたものです。前半（1〜4節）は学生向けの説明、後半（5節以降）はコードを変更・追加する人向けの約束です。

確認事項への回答（[CLAUDE_CODE_PROMPT.md](../CLAUDE_CODE_PROMPT.md) の末尾）に従い、対象は **Windows 11** です。

## 1. 全体の構成

pip0 は、次の3つのプログラムで動きます。

```text
┌────────────── Windows 11（1人のユーザーのサインイン中） ──────────────┐
│                                                                           │
│  pip0 本体（Python）  ── 標準入出力（JSON の1行ずつ）──  pip0 シェル（C#） │
│   ・監視、索引、解析、分類、検索、             ・常駐UI（ミニドック、デスク、 │
│     操作履歴、保管庫の状態管理                    赤い枠、確認画面、トレイ）   │
│   ・暗号化DB（SQLCipher）                       ・Cloud Files API（ゴースト）  │
│   ・判断の規則（rules.py、settings.py）         ・ごみ箱（IFileOperation）     │
│        ▲                                        ・前面ウィンドウ、ドラッグ、   │
│        │ 暗号化DB に記録                          マウス、セッションの監視     │
│        │                                                                  │
│  Native Messaging の受け口（Python、ブラウザーが起動）                     │
│        ▲ 標準入出力（ネットワークを使わない）                              │
│  ブラウザー拡張（Chrome／Edge 共通、Manifest V3）                          │
└───────────────────────────────────────────────────────────────────────────┘
```

- **pip0 本体（Python）**：判断と記録を受け持ちます。学生が読み、変更する中心です。`python -m pip0 serve` で起動し、pip0 シェルを子プロセスとして起動します。シェルが落ちても本体は動き続け、シェルを起動し直します。
- **pip0 シェル（C#）**：Windows の機能を使う部分です。画面の表示、Cloud Files API、ごみ箱、フックなど、Python から扱いにくい OS の機能をまとめています。本体から受けた指示を実行し、OS で起きたこと（前面ウィンドウの変化、ドラッグ、ゴーストが開かれたこと等）を本体へ知らせます。判断はしません。
- **ブラウザー拡張と受け口**：ダウンロードが完了したときに、ダウンロード URL、参照元 URL、ダウンロード開始時に表示していたタブを、受け口（`python -m pip0.native_host`）へ渡します。受け口は内容を検査して暗号化DB に記録するだけで、ファイル操作やコマンドの実行は受け付けません。

本体とシェルは同じ PC の中の親子のプロセスで、標準入出力（パイプ）でやり取りします。ネットワークは使いません。

## 2. 採用技術と理由

| 用途 | 採用したもの | 理由 |
| --- | --- | --- |
| 判断・記録の処理 | Python 3.13（3.11 以上） | 学生が授業で学んだ言語。OS に依存しない部分を、Windows 以外でも試験できる |
| OS 連携・常駐UI | C#（.NET 8、WPF、Windows Forms の通知領域アイコン） | Cloud Files API のコールバック、ごみ箱（IFileOperation）、低レベルのフック、透過ウィンドウを安定して扱える。Win32 API の宣言は CsWin32（Microsoft、MIT）で生成 |
| ゴースト（M4） | Cloud Files API（cldflt.sys、同期ルート） | 元のパス・名前のまま中身をディスクから外し、アプリが開くと OS が pip0 を呼んで中身を戻す、Windows の正式な仕組み。NTFS のみ |
| 暗号化DB | SQLCipher 4（`sqlcipher3` パッケージ） | SQLite 互換で、ページ単位に AES-256 で暗号化し、HMAC で改ざんを検出する。WAL も暗号化される |
| DB の鍵 | Windows の資格情報マネージャー（`keyring` 経由、DPAPI で保護） | 鍵をソースコードや DB の横の平文ファイルに置かない |
| ブラウザー連携 | Chrome／Edge の拡張機能（Manifest V3）と Native Messaging | ブラウザーが受け口を子プロセスとして起動し、標準入出力でやり取りする。ネットワークを経由しない |
| フォルダー監視 | watchdog（ReadDirectoryChangesW） | Windows の変更通知を Python で受け取れる |
| 解析 | Pillow（画像の色と形）、pypdf（PDF）、標準ライブラリ（zipfile と XML で Office 文書） | 端末内で動き、無料で、機械学習モデルを必要としない |
| 外部通信の禁止 | Python の監査フック（アプリ内）と、Windows Defender ファイアウォールの送信ブロック規則（OS） | 「通信するコードがない」ことと「OS で遮断する」ことを別々に確かめるため |

### 2-1. 機械学習モデルについて

初期コードでは、**機械学習モデルを使いません**。そのため、モデルの事前配置は不要です。M3 の「青いグラフ」は、Pillow で画像の色の割合と「グラフらしさ」（背景の割合、色数、軸の線）を計算して判定し、「先週の予算資料」は、文書から取り出した本文とタイトルに語が含まれるかで判定します。手掛かり語の解釈は、`rules.py` の辞書による簡単な方法で、形態素解析や意味のベクトルは使っていません。

この方法でできないこと（例：写真に写った物の認識、言い換えへの対応）は、端末内で動くモデル（CLIP 系の画像と言葉の対応付けモデル、日本語の文の埋め込みモデル等）を加える発展課題として扱います。追加する場合は、無料で使えるライセンス、再配布の条件、必要なメモリーと CPU／GPU、事前配置の手順を確かめ、通常運用中に自動でダウンロードしない作りにしてください。

## 3. 責務とファイルの対応

指示書2節の7つの責務と、コード上の場所の対応です。

| 責務 | Python（pip0/） | C#（shell/）・その他 |
| --- | --- | --- |
| ファイルの監視、索引作成、メタデータ管理 | `watcher.py`、`scanner.py`、`provenance.py`、`usage.py`、`database.py` | シェル：最近使ったファイル（Recent）の読み取り |
| ローカル解析、分類、検索順位の計算 | `analyse_text.py`、`analyse_image.py`、`sensitivity.py`、`analysis_queue.py`、`inflow.py`、`naming.py`、`desk.py`、`search.py` | ― |
| 移動、リネーム、退避、復元、ごみ箱への移動 | `fileops.py`、`safe_names.py`、`vault.py`、`evacuation.py`、`killswitch.py`、`trash.py` | シェル：ゴーストの作成・復元（Cloud Files API）、ごみ箱（IFileOperation） |
| 電源状態とアイドル状態による処理制御 | `throttle.py`（値は `platform_windows.py` が読む） | ― |
| 作業文脈の取得と常駐UI | `context.py`、`desk.py`、`hazard.py`、`ui.py` | シェル：前面ウィンドウの監視、ミニドック、デスク、赤い枠、確認画面、トレイ |
| OS固有のファイル提供機構、権限、ドラッグ操作等への連携 | `platform_windows.py`、`shell_link.py`（テスト用の代役は `platform_fake.py`） | シェル：同期ルート、ドラッグ検知、マウス、ファイルダイアログ、セッション |
| ブラウザー拡張と端末内連携 | `native_host.py`、`provenance.py` | `browser-extension/`、`native-host/`、`scripts/register-native-host.ps1` |
| 全体の進行 | `service.py`（常駐）、`cli.py`（コマンド）、`netguard.py`（外部通信の禁止） | `scripts/`（導入、ファイアウォール、復元コマンド、削除） |

## 4. 機能ごとの決めごと

### 4-1. 保存する場所

| 場所（既定） | 中身 | 暗号化 |
| --- | --- | --- |
| `%LOCALAPPDATA%\pip0\pip0.db`（と `-wal`） | 索引、解析結果（本文の抜粋、色、グラフらしさ、機密の判定）、ファイルの由来、操作履歴、保管庫の項目 | SQLCipher（AES-256） |
| Windows の資格情報マネージャー（`pip0` / `database-key-v1`） | DB の鍵（64文字の16進数） | Windows が DPAPI で保護 |
| `%LOCALAPPDATA%\pip0\vault\items\<項目ID>\content` | 退避したファイルの本体 | **しない**（下の注を参照） |
| `%LOCALAPPDATA%\pip0\vault\items\<項目ID>\manifest.json` | 復元に必要な最小限の情報（元のパス、サイズ、更新日時、ハッシュ、状態） | **しない**（下の注を参照） |
| `%LOCALAPPDATA%\pip0\control\` | 自動処理の停止の印、全復元の依頼と進み具合（件数だけ）、常駐処理の状態（`service.status.json`。件数と機能の状態だけで、パスは書かない）、終了の依頼（`shutdown.request.json`） | しない（解析内容を含まない） |
| `%LOCALAPPDATA%\pip0\locks\service.lock` | 常駐処理と、保管庫・シェルを使うコマンドが、同時に2つ動かないための印（中身なし） | しない |
| `%LOCALAPPDATA%\pip0\logs\` | 動作の記録（エラーの種類と件数のみ。ファイル名・本文・URL は書かない） | しない（解析内容を含まない） |
| `%USERPROFILE%\pip0\` | pip0 専用フォルダー（M1 の仕分け先、M4 の同期ルート） | ユーザーのファイルそのもの |

注：保管庫の本体と manifest.json を暗号化しないのは、①元の場所でも暗号化されていなかったユーザーのファイルであり、②鍵をなくしたとき（Windows の再設定など）にファイルを取り出せなくなる危険を避けるためです。保管庫はユーザーのプロファイルの中（本人だけが読める場所）に置きます。DB の鍵を失っても、`python -m pip0 restore-all` は manifest.json から項目を読み直して復元できます。

### 4-2. 高負荷処理の条件（3-2）

- 高負荷処理：解析（本文の抽出、画像の色と形）、ハッシュの計算、保管庫へのコピー（M4 の退避）。
- 実行の条件：`GetSystemPowerStatus` の電源が「AC」で、**かつ** `GetLastInputInfo` によるセッション全体の無操作時間が 180 秒以上。`GetLastInputInfo` はキーボードとマウスの入力の時刻で、pip0 のウィンドウだけでなく、サインイン中のセッション全体の入力が対象です。
- どちらかの値を取得できないとき（電源が「不明」など）は、条件を満たさないものとして扱い、高負荷処理をしません（満たしたことにはしません）。
- 実行中は、区切り（1ファイルごと、ハッシュとコピーは 1MB ごと）で条件を確かめ直し、満たさなくなったら一時停止します。途中のファイルは結果を保存せずに順番待ちへ戻し、次に条件を満たしたときに、そのファイルの最初からやり直します。
- 高負荷処理と分けて、すぐに応答するもの：ダウンロード完了の確認、ミニドック、既存の索引からの候補表示（M2）、検索（M3、解析済みの情報だけを使う）、機密ドラッグの判定（M5、解析済みの情報と名前だけを使う）、ユーザーの復元操作、全復元。

### 4-3. M1 流入処理

- **完了の確認**：①拡張機能から「完了」の記録が届き、そのパスのファイルが報告どおりのサイズで存在し、ほかのプロセスが使っていないとき。②記録がないときは、`.crdownload` などの途中の名前でなく、サイズと更新日時が `DOWNLOAD_STABLE_SECONDS`（2秒）変わらず、ほかのプロセスが使っていないとき。どちらも満たさないファイルは、移動も改名もしません。
- **ミニドック**：完了を確認した直後から、画面の右下に3秒表示します。1つのダウンロードが1行です。
  - 複数のダウンロード：同時に表示するのは3行までで、それを超えた分は順番待ちにし、行が空いたときに3秒の表示を始めます。行ごとに3秒を数えます。
  - 操作中：マウスがミニドックの上にある間は、全行の残り時間を止めます。マウスが離れたら、残り時間が1秒未満の行は1秒にしてから数え直します。
  - 終了：行の時間が尽きたら、その行の提案を自動で実行して行を閉じます。ユーザーがボタンを押したら、その操作をすぐに実行して行を閉じます。行がなくなったらミニドックを閉じます。
- **仕分け先**：`rules.SORT_RULES` の規則ごとに点数を付け、`SORT_MIN_SCORE`（2点）以上で最高点の規則を提案します。ファイル名・文書のタイトル・ダウンロード開始時のページ題名に規則の語があれば +2、作業中のアプリのウィンドウタイトル（Slack の会話名など）に規則の文脈語があれば +2、拡張子が一致すれば +1。点数の根拠を、ミニドックと操作履歴に残します。
- **作業文脈の扱い**：ウィンドウタイトルはその場で使うだけで、DB には保存しません。操作履歴には「作業中のアプリ（Slack）の会話名に『予算』」のように、一致したアプリ名と規則の語だけを残します。
- **新しい名前（「日付_内容_送信元」）**
  - 対象：拡張子を除いた名前が `rules.MEANINGLESS_NAME_PATTERNS` に一致する、意味不明な名前だけ。意味のある名前は改名しません。
  - 日付：ダウンロード完了日（拡張機能の終了時刻、なければ pip0 が完了を確認した時刻）を、端末の現地時刻の `YYYY-MM-DD` にしたもの。
  - 内容：①Office 文書の `docProps/core.xml` のタイトル、PDF の文書情報のタイトル（3秒の間に読むのは `LIGHT_METADATA_MAX_BYTES` 以下のファイルだけ）、②解析済みなら解析で得たタイトル、③画像の解析結果（例：「青いグラフ」）。どれもなければ「解析待ち」とし、移動だけを先に行い、改名は解析の後に行います。解析しても分からなければ、送信元が分かる場合は「内容不明」、送信元も分からない場合は改名しません。
  - 送信元：ブラウザー拡張の記録（ダウンロード URL、なければ参照元 URL のホスト名）、それもなければ Windows が付ける `Zone.Identifier` の `HostUrl`／`ReferrerUrl`。`rules.SOURCE_RULES` に当てはまれば「Slack」などの名前、当てはまらなければホスト名の主要部分（例：`example.co.jp`）。記録がなければ「送信元不明」。ダウンロード開始時に表示していたタブは、送信元とは限らないため、送信元には使いません。
  - 禁止文字（`< > : " / \ | ? *` と制御文字）は全角の文字に置き換え、予約名（`CON` 等）と末尾の点・空白を避け、拡張子は元のまま残します。同じ名前があれば「 (2)」を付け、既存のファイルを上書きしません。
- **自動実行**：ミニドックの時間が尽きたとき、自動仕分け・自動改名が有効で、キルスイッチが押されていなければ、提案を実行します。仕分け先の候補がない行は、何もせずに閉じます。
- **画面を見せられないとき**：pip0 シェルが落ちて起動し直すまでの間に完了したダウンロードは、提案を待たせ（最大50件）、シェルが戻ってからミニドックに出します（見えないまま自動で実行しない）。画面なし（`serve --no-shell`、開発用）のときは、提案そのものをせず、索引と由来（送信元）だけを記録します。
- **pip0 が動いていなかった間のダウンロード**：その間に受け口が書いたブラウザー拡張の記録（24時間以内）は、起動の後に、提案もファイルの移動もせず、記録どおりの場所に同じ大きさのファイルがあるときだけ、索引と由来を記録します（時間がたっていて、ユーザーがもう使っているかもしれないため）。

### 4-4. M2 作業連動・浮上式デスク

- **取得する文脈**：前面のウィンドウのプロセス名、ウィンドウタイトル、ウィンドウの種類（ファイルダイアログかどうか）。シェルが `SetWinEventHook`（前面の切り替えとタイトルの変化）で受け取り、本体へ知らせます。画面の画像は取得しません。
- **対応アプリ**：Slack デスクトップアプリ（タイトルから会話名を読む）、Chrome／Edge（タイトルからページ題名を読む）、Word／Excel／PowerPoint ほか（タイトルから文書名を読む）。`rules.APP_RULES` に追加できます。
- **チャット相手**：Slack のタイトルが `rules.SLACK_TITLE_PATTERNS` のどれかに一致したときだけ、会話名（チャンネル名・相手）を読み取ります。一致しなければ「チャット相手：取得不可」と表示し、推測しません。Slack のタイトルの形は実機で確認していません。
- **順位の計算**（`desk.rank_files`）：文脈の語（会話名・ページ題名・文書名から取り出した語）ごとに、ファイル名・タイトルに含まれれば +3、本文（解析済み）に含まれれば +2。作業中のアプリと入手経路が同じ（Slack 使用中に、Slack から入手したファイル）なら +2。7日以内に使用・変更されていれば +1、30日以内なら +0.5。`DESK_MIN_SCORE` 以上の上位3件を表示し、3件未満ならその件数だけを表示します。
- **透過**：デスクの外周から `DESK_APPROACH_PX`（48px）以内にマウスが来たら、不透明度を 0.15 にして、クリックを下のウィンドウへ通します。デスクの左端には常に操作できる小さな「つまみ」があり、つまみにマウスを置くと（0.3秒）、デスクが不透明に戻って候補を選べる「操作モード」になります。マウスがデスクから 48px 以上離れると、操作モードは終わります。
- **シェイク**：デスクの表示中だけ、シェイク判定のためにマウスの位置を調べます（33ms ごと、100ms ごとにまとめて本体へ送る）。0.8秒の間に、40px 以上の左右の振りの折り返しが4回以上あれば、すぐに隠します。判定は本体の `desk.ShakeDetector` です。
- **再表示**：シェイクで隠した後は、作業文脈が変わり（別のアプリ、別の会話、別のページ）、かつ隠してから60秒たったときに再表示します。通知領域アイコンの「デスクを表示」では、すぐに再表示します。
- **ファイルダイアログ**：Windows のファイルダイアログはアプリの中に作られるため、ダイアログの中に UI を入れることはしません。前面のウィンドウが「開く／保存」のダイアログ（UI Automation でファイル名欄 AutomationId=1148 があるもの）のとき、ダイアログの上辺に合わせてデスクを表示し、候補を選ぶと、UI Automation の ValuePattern でダイアログのファイル名欄に完全なパスを入力します。「開く」ボタンはユーザーが押します。管理者として動くアプリのダイアログには、Windows の制限（UIPI）で入力できません。

### 4-5. M3 エピソード記憶検索

- 手掛かりの種類と照合先（すべて解析済み・記録済みの情報で、検索のときに重い解析はしません）

| 手掛かり | 例 | 照合先 | 一致の理由の例 |
| --- | --- | --- | --- |
| 時期 | 先週、昨日、3日前、先月、最近 | ダウンロード日時（拡張機能の記録）→ pip0 が流入を確認した日時 → 最終更新日時 の順 | 時期：ダウンロード日 2026-10-22（ブラウザー拡張の記録） |
| 入手経路 | Slackで貰った、メールで | ファイルの由来（拡張機能の記録、Zone.Identifier） | 入手経路：Slack（files.slack.com からのダウンロード） |
| 色 | 青い、赤 | 画像の色の解析（色付きの部分のうち、その色の割合） | 色：青系 62%（画像の色解析） |
| 見た目 | グラフ、写真、画像 | 画像のグラフらしさ、Office 文書のグラフの有無 | 見た目：グラフらしさ 0.82（軸の線、単色の領域、色数） |
| 文書の種類 | 資料、表、スライド、PDF | 拡張子 | 種類：文書（.docx） |
| 内容の語 | 予算 | タイトル、本文（解析済み）、ファイル名 | 内容：本文に「予算」 |

- すべての手掛かりに一致したファイルを「一致」として表示し、手掛かりごとに一致の理由を示します。
- 一致がないときは、手掛かりの一部に一致したファイルを「一部一致」として、一致しなかった手掛かりと理由（未解析、入手経路の記録なし等）とともに示します。
- **情報不足と該当なしの区別**：一致しなかった理由が「未解析」「入手経路の記録なし」のファイルがあるときは「情報不足」、すべての情報がそろっていて一致しないときは「該当なし」と表示します。由来の記録がないファイルを、Slack 等から入手したとは扱いません。
- 相対日時は端末の現地時刻で、週は月曜始まり（`WEEK_STARTS_ON`）です。

### 4-6. M4 シュレディンガー退避ストレージ

- **範囲**：`%USERPROFILE%\pip0`（pip0 専用フォルダー）の中のファイルだけ。この場所を Cloud Files API の同期ルートとして登録します。ほかの場所のファイル、NTFS 以外のドライブ、OneDrive 等の同期フォルダーの中は退避せず、理由を表示します。
- **「0バイト」の意味**：ディスク上に中身を置かない（ディスク上のサイズが 0、ファイルシステムの管理情報だけが残る）という意味です。エクスプローラーの「サイズ」欄と、アプリから見たファイルの大きさ（論理サイズ）は、元の値のままです。アイコンには、Windows が雲の状態アイコンを付けます。
- **開いたとき**：アプリがゴーストを開くと、Windows（cldflt.sys）が pip0 シェルを呼び、シェルが保管庫の内容のハッシュを確かめてから中身を渡します。アプリには、中身が戻った後のファイルが見えます。pip0 が起動していないときは、Windows が「クラウド ファイル プロバイダーが実行されていません」というエラーを出し、空の内容は渡しません。中身が戻ってから `RESTORE_AFTER_OPEN_SECONDS`（10秒）後に、通常のファイルへ戻します（項目は「復元済み」）。
- **長期間未読の判定**（`usage.judge_long_unread`）
  - 利用の記録：①ファイルの更新（最終更新日時）、②Windows の「最近使ったファイル」（Recent フォルダーのショートカット。シェルが読み取る）、③ゴーストが開かれた記録、④最終アクセス日時（その NTFS で更新が有効な場合だけ、弱い手掛かりとして）。
  - pip0 自身の読み取り（解析、ハッシュ、コピー）は、最終アクセス日時を更新しない開き方（`SetFileTime` に 0xFFFFFFFF を渡す）で行い、利用として記録しません。
  - 判定：pip0 の観測期間が `MIN_OBSERVED_DAYS`（90日）未満なら「判定不能」。②も④も使えない（Recent の記録が無効で、最終アクセス日時の更新も無効）なら「判定不能」。最後の利用から `UNREAD_DAYS`（90日）以上たっていれば「長期間未読」。「判定不能」のファイルは退避しません。
  - ほかに、`EVACUATE_MIN_SIZE_BYTES`（1MB）未満、ユーザーが「常にこのデバイス上に保持する」にしたもの、ほかのプロセスが使用中のもの、一時ファイルは退避しません。
- **空き容量**：保管庫が同じドライブにある場合、退避（保管庫へコピーしてからゴーストにする）しても、ドライブ全体の空き容量はほとんど変わりません。pip0 は容量が減ったとは表示しません。
- **応答時間**：ゴーストを開いてから使えるまでの時間は、ファイルの大きさ、ドライブ、ハッシュの確認によって変わります。実機で測っていないため、目標値（「ミリ秒で」）は保証値として扱いません。

### 4-7. M5 スマート・ハザードガード

- **機密の判定**（`sensitivity.overall`）
  - 機密：名前に `SENSITIVE_NAME_KEYWORDS` の語、`SENSITIVE_DIRS` の中、本文に `SENSITIVE_CONTENT_KEYWORDS` の語、Office の秘密度ラベル（`docProps/custom.xml` の `MSIP_Label_…_Name`）に `SENSITIVE_LABEL_KEYWORDS` の語、本文に検査用数字が正しい12桁の個人番号、Luhn 検査に合格するカード番号らしい数字。
  - 非機密：解析済みで、どの規則にも当てはまらないもの。
  - 未判定：まだ解析していない、解析に失敗した、解析できない形式のもの（名前の規則に当てはまれば機密）。未判定を非機密とは扱いません。
- **ドラッグの検知**：シェルが低レベルのマウスフック（`WH_MOUSE_LL`）で、左ボタンを押したまま一定距離動いたことを検知します。押した位置がエクスプローラー（デスクトップを含む）のウィンドウなら、シェルのオートメーション（`Shell.Application`）で、そのウィンドウで選ばれている項目をドラッグ中のファイルとします。pip0 のデスク・ミニドックからのドラッグは、シェル自身が知っています。それ以外のアプリ（メールの添付など）からのドラッグは、ファイルを特定できないため対象外です。
- **警告**：機密（赤い枠）または未判定（橙色の枠と「機密か未判定」の表示）のファイルを含むドラッグを検知した時点で、すべての画面の枠を光らせます。ただし、そのドラッグのファイルがすべて「消音中」の場合は、開始時には表示せず、消音されていない送り先アプリの上に来た時点で表示します。送り先が消音中のアプリの上にある間は表示しません。
- **続行の確認**：警告が `HAZARD_MIN_VISIBLE_SECONDS`（0.5秒）以上表示された後に、ドラッグ元と別のアプリ（pip0 以外）のウィンドウの上でボタンが離されたとき、「続行した」とみなします。送り先のアプリがドロップを受け入れたかどうかは、Windows から取得できないため確かめていません。
- **消音**：続行したファイル × そのアプリ（プロセス名）の組だけを、同じセッションの間は警告しません。別のファイルや別のアプリへの操作では警告します。
- **セッション**：pip0 の起動、または Windows のロック解除・スリープからの復帰で始まり、画面のロック、サインアウト、スリープ、pip0 の終了で終わります。消音の記録はメモリーだけに持ち、セッションの終わりで消えます（無期限にはしません）。
- 送信を止める機能（DLP）はありません。警告だけです。

### 4-8. 削除・退避・復元の区別

| 操作 | 意味 | 確認 | 実体 |
| --- | --- | --- | --- |
| 削除（`trash.py`） | ユーザーが選んだファイルを、Windows のごみ箱へ移す | 毎回、対象のファイル名と件数を示す確認画面で承認されたときだけ。キャンセル・画面を閉じたときは何もしない | ごみ箱に残る。ごみ箱を使えない場所では削除せず「拒否」として記録（通常削除・完全削除にはしない） |
| 退避（`vault.py`） | 長期間未読のファイルの中身を保管庫へ預け、元の場所にゴーストを残す | 自動（キルスイッチで停止できる） | 保管庫にハッシュを確かめたコピーがある。元の場所には同じ名前のゴースト |
| 復元（`vault.py`） | ゴーストを通常のファイルに戻す | 自動（開いたとき）、ユーザーの操作、全復元 | 保管庫の内容のハッシュを確かめてから戻す。保管庫の内容と manifest.json は消さない |

pip0 には、ごみ箱を空にする機能と、ユーザーのファイルを完全に削除する機能はありません。

### 4-9. キルスイッチ（1クリック全復元）

1. 通知領域アイコンの「全復元（自動処理を止める）」、または `scripts\restore-all.cmd`（UI が動かないとき）で始めます。
2. すぐに停止の印（`control\automation.stopped` と DB の設定）を書き、新しい自動仕分け・自動改名・自動退避を始めないようにします。
3. 実行中の処理は、次の区切りで止めます（保管庫へのコピーは 1MB ごと）。ゴーストにする前のものは中止し、原本はそのままです。
4. 退避中（ゴースト）のすべての項目を、1件ずつ復元します。進み具合（全体、成功、衝突、失敗、残り）を表示し、`control\restore_all.progress.json` に件数を書きます。中断や再起動の後に実行し直すと、残りから続けます。
5. 元の場所に別のファイルがある場合は上書きせず、横に「（pip0復元）」を付けた名前で戻して「衝突」とします。失敗した項目も、保管庫の内容と manifest.json は残します。
6. 自動処理は、ユーザーが「自動処理を再開」（確認あり）を選ぶまで止まったままです。
7. 戻すのは、pip0 が退避したファイルだけです。自動仕分け・自動改名は戻しません（操作履歴に残っています）。pip0 以外の変更や、バックアップ全体の復旧はしません。

## 5. 開発の約束

### 5-1. 書き方

- Python は 3.11 以上。関数と辞書を中心にし、クラスは状態を持つもの（OS 連携の代役、ミニドックやデスクの状態など）だけにします。
- コメント、docstring、画面の表示は日本語。英語を使う場合と、自分たちで付ける識別子は、イギリス式の綴り（analyse、colour、behaviour、sanitise、initialise、normalise、organise 等）にします。外部のライブラリや API の名前（Pillow の `convert`、Chrome の API 名など）は変えません。
- 予想される失敗（ファイルがない、使用中、権限がない等）は例外にせず、`{"ok": False, "reason": "日本語の理由"}` のような辞書で返します。プログラムの誤りは例外のままにします。
- ほかのモジュールは `settings` を直接 import せず、`config`（`config.load_config()` の辞書）を引数で受け取ります。規則は `rules` モジュールを引数（`rules`）で受け取ります（テストで差し替えられるようにするため）。
- OS の機能は、引数の `platform`（`WindowsPlatform` または `FakePlatform`）を通して使います。Windows 専用の API を直接呼ぶのは `platform_windows.py` だけです。
- DB への書き込みは、常駐処理ではメインのスレッドだけが行います。重い処理（解析、コピー）はワーカーのスレッドで、DB を使わない関数（引数でパスを受け取り、結果の辞書を返す）として書きます。例外は `vault.evacuate` で、状態が変わるたびに manifest.json と DB を書く（7-2）ため、ワーカーのスレッドで、そのスレッド専用の DB 接続（`database.open_database`）を使って動かします。
- 時刻は `time.time()` の秒数（REAL）で保存し、表示と期間の計算は `timeutil` で現地時刻に直します。関数は `now` を引数で受け取り、テストで時刻を決められるようにします。
- ログ（`logging`）には、ファイル名、パス、本文、URL、ウィンドウタイトルを書きません。書くのは処理の種類、件数、エラーの種類、項目 ID だけです。

### 5-2. テスト

- `tests/` に pytest のテストを置きます。テストは一時フォルダー（`tmp_path`）だけを使い、本物のデスクトップ・ダウンロード・ドキュメントを使いません。
- 共通の準備は `tests/conftest.py` の `env`（設定）、`platform`（代役の OS 連携。pip0 専用フォルダーは同期ルートとして登録済み）、`db`（メモリーの鍵で開いた暗号化DB）、`ui`（記録するだけの UI）です。
- 代役（`FakePlatform`）で確かめたことは、「Windows の実機で確かめたこと」とは別に記録します。

## 6. モジュールの約束（関数と戻り値）

ここに書いた名前と形は、ほかのモジュールから使われます。変える場合は、使っている側も合わせて直してください。`→` の右は戻り値です。

### 6-1. 基盤（作成済み）

- `config.load_config(overrides=None, read_user_file=True)` → 設定の辞書。パスは `Path`（未設定は `None`）。`DB_PATH`、`CONTROL_DIR`、`LOCK_DIR`、`LOG_DIR`、`VAULT_DIR` を含む。`CONFIG_ERRORS`（危険な場所の組み合わせの説明）、`CONFIG_WARNINGS`。
- `config.index_folders(config)` → `[(Path, location_kind), ...]`（`'downloads'`、`'pip0_root'`、`'extra'`）。`config.is_inside(child, parent)` → bool。
- `timeutil.now()`、`to_local(ts)`、`local_date_str(ts)`、`local_datetime_str(ts)`、`find_period(text, now_ts, week_starts_on=0, recent_days=14)` → `{"word", "start", "end", "label", "span"}` または `None`（`end` は含まない）。
- `keystore.MemoryKeystore`、`keystore.OsKeystore`、`keystore.get_or_create_key(keystore, db_exists)`、例外 `KeystoreUnavailable`、`KeyMissing`。
- `database.open_database(config, keystore=None)`、`open_encrypted(db_path, key_hex)` → 接続（`row["name"]` で列を読める、自動コミット）。`transaction(conn)`（まとめて書く）、`query_one`、`query_all`、`execute`（→ lastrowid）、`get_setting`、`set_setting`、`log_operation(conn, kind, *, actor, status, file_id=None, item_id=None, before_path=None, after_path=None, reasons=None, detail=None, at=None)`、`check_encryption(conn)`。例外 `EncryptionUnavailable`、`DatabaseKeyError`。テーブルは `database.SCHEMA` を参照。
- `ui.RecordingUi` / `ui.ShellUi(link)`：`show_mini_dock(dock)`、`close_mini_dock(dock_id, reason)`、`show_desk(desk)`、`hide_desk(reason)`、`show_hazard(hazard)`、`hide_hazard()`、`notify(title, message, level)`、`update_status(status)`、`set_cursor_stream(enabled)`。
- `safe_names.check_name(name)` → `(ok, 理由)`、`make_safe(name, max_len=200)`、`unique_name(folder, name, exists=os.path.exists)`、`split_ext(name)`、`clean_part(text)`。
- `fsutil.no_overwrite_rename(src, dst)`（移動先があれば `FileExistsError`、上書きしない）、`atomic_write_json(path, value)`、`atomic_write_bytes(path, data)`、`read_json(path)`、`fsync_file(f)`、`fsync_dir(path)`、`sha256_stream(f, chunk_size, should_continue)`、`sha256_file(path, chunk_size, should_continue, opener)`、例外 `Paused`（区切りで止めた）。
- `analysis_queue.enqueue(conn, kind, file_id, priority=0, now=None)`、`next_task(conn, kind=None)`、`mark(conn, task_id, state, error=None, now=None)`、`pending_count(conn, kind=None)`、`reset_running(conn, now=None)`。

### 6-2. OS 連携（`platform`）

`platform_windows.WindowsPlatform(link)` と `platform_fake.FakePlatform` は、次の同じ名前のメソッドを持ちます（`FakePlatform` には、テスト用の `simulate_*` もあります）。

| メソッド | 戻り値 |
| --- | --- |
| `get_idle_seconds()` | セッション全体の無操作の秒数。取得できなければ `None` |
| `get_power_source()` | `"ac"`、`"battery"`、`"unknown"` |
| `get_file_key(path)` | `"ボリューム番号:ファイル番号"`（`os.stat` の `st_dev:st_ino`）。なければ `None` |
| `get_local_state(path)` | `{"local", "placeholder", "pinned", "reparse", "attributes", "reason"}`。`local=False` はクラウドの未取得のプレースホルダーや pip0 のゴーストで、読んではいけない |
| `get_volume_info(path)` | `{"filesystem": "NTFS" 等, "drive_type": "fixed"/"removable"/"network"/"unknown", "reason"}` |
| `check_sync_folder(path)` | `{"inside": True/False/None, "provider", "reason"}`（`None` は判定できない）。pip0 自身の同期ルートの中は `provider="pip0"` |
| `access_time_reliable(path)` | 最終アクセス日時の更新が有効なら `True`、無効なら `False`、不明なら `None` |
| `read_zone_identifier(path)` | `Zone.Identifier` の文字列、なければ `None` |
| `open_for_copy(path)` | 他のプロセスの書き込み・削除を拒否し、最終アクセス日時を更新しない読み取り用のファイル（使用中なら `PermissionError`） |
| `open_for_analysis(path)` | 最終アクセス日時を更新しない読み取り用のファイル |
| `can_open_exclusively(path)` | ほかのプロセスが開いていなければ `True` |
| `known_downloads_dir()` | Windows の「ダウンロード」の場所（`Path`）、なければ `None` |
| `register_sync_root(path, display_name)` | `{"ok", "reason"}` |
| `is_sync_root_registered(path)` | `True`/`False`/`None` |
| `ghost_status(path)` | `{"exists", "is_ghost", "item_id", "dehydrated", "in_sync", "pinned", "reason"}` |
| `make_ghost(path, item_id, expected)` | `{"result": "ghosted"/"changed"/"locked"/"not_in_root"/"unavailable"/"error", "reason"}`。`expected` は `{"size", "mtime_ns", "file_key", "sha256"}` で、1つでも違えば `"changed"` |
| `restore_ghost(path, item_id)` | `{"result": "restored"/"already_regular"/"not_our_placeholder"/"missing"/"unavailable"/"error", "reason"}` |
| `confirm_and_recycle(request)` | 確認画面を出し、承認されたときだけごみ箱へ移す。`{"approved", "answer": "approve"/"cancel"/"closed"/"unavailable", "results": [{"path", "status": "recycled"/"refused"/"failed"/"not_attempted", "reason"}]}`。ごみ箱を使えない場合は `"refused"` で、削除しない |

### 6-3. ファイルの監視と索引

- `provenance.sanitise_url(url)` → `http(s)://ホスト[:ポート]/パス`（ユーザー情報、`?` 以降、`#` 以降を除く、最大2048文字）。`data:`、`blob:`、`filesystem:`、`javascript:`、`file:` は `"data:"` のようにスキームだけ。読めなければ `None`。
- `provenance.host_of(url)`、`registrable_domain(host, rules)`、`label_for_host(host, rules)` → `"Slack"` または `None`。
- `provenance.parse_zone_identifier(text)` → `{"zone_id", "host_url", "referrer_url"}`（URL は sanitise 済み）。
- `provenance.determine_source(download_event, zone, rules)` → `{"label", "kind": "browser_extension"/"zone_identifier"/None, "evidence", "host", "download_url", "referrer_url"}`。順序：拡張機能の記録（`final_url`→`url`→`referrer_url` のホスト）、次に Zone.Identifier（`host_url`→`referrer_url`）。`tab_url` は送信元に使わない。何もなければ `label=None`、`evidence="ダウンロードの記録なし"`。
- `provenance.store_download_event(conn, message, origin, received_at)` → id（`native_host.validate_message` 済みの辞書を受け取る）。
- `provenance.find_download_event(conn, path, size, now, window_seconds=600)` → 行の辞書または `None`（パスが一致し、状態が `pending`、サイズが一致または不明）。`mark_event_matched(conn, event_id, file_id)`、`expire_old_events(conn, now, max_age_seconds=86400)`。
- `provenance.record_provenance(conn, file_id, source, event=None, zone=None, now=None)`、`get_provenance(conn, file_id)` → 行の辞書または `None`。
- `scanner.should_skip(path, platform, config, rules)` → `(bool, 理由)`。`scanner.upsert_file(conn, platform, path, location_kind, now)` → `{"file_id", "is_new", "changed"}` または `None`（新しいファイルと変更されたファイルは解析の順番待ちに入れる）。`scanner.scan_folder(conn, platform, folder, location_kind, config, rules, now)`、`scanner.scan_all(conn, platform, config, rules, now)` → 件数の辞書。リンクとジャンクションはたどらず、データフォルダー・保管庫・クラウドの未取得のプレースホルダーは読まない。
- `watcher.FolderWatcher(folders, out_queue)`：`start()`、`stop()`。出力は `{"kind": "created"/"modified"/"moved"/"deleted", "path", "dest_path", "is_dir", "location_kind", "at"}`。
- `watcher.SelfChangeRegistry`：`expect(path, now, seconds=10)`、`is_expected(path, now)`（pip0 自身の移動・改名の通知を無視するため）。
- `watcher.DownloadTracker(config, rules, platform)`：`observe(event, now)`、`add_browser_event(row, now)`、`ready(now)` → `[{"path", "completed_at", "via": "browser_extension"/"stable_size", "download_event"}]`。
- `usage.record_usage(conn, file_id, kind, at, process_name=None, detail=None)`、`usage.last_use(conn, file_row)` → `{"at", "kind"}`、`usage.tracking_sources(platform, path, recent_items_enabled)` → `{"reliable", "sources", "reason"}`、`usage.judge_long_unread(conn, file_row, now, config, sources)` → `{"unread": True/False/None, "reason", "observed_days", "idle_days"}`、`usage.record_recent_items(conn, items, now)` → 件数。

### 6-4. 解析

- `analyse_text.light_metadata(path, platform, config, rules)` → `{"status": "done"/"skipped"/"failed", "title", "kind", "source": "office_core"/"pdf_info"/None, "reason"}`（3秒の間に使う軽い読み取り）。
- `analyse_text.extract_text(path, platform, config, rules)` → `{"status": "done"/"unsupported"/"failed", "kind", "title", "text", "has_chart", "labels", "error"}`。
- `analyse_image.COLOUR_NAMES`、`analyse_image.analyse_image(path, platform, config)` → `{"status", "width", "height", "colours": {色: 色付き部分に占める割合}, "colourful_ratio", "background_ratio", "palette_size", "chart_score", "chart_evidence": [文字列], "visual_kind": "chart"/"photo"/"other", "error"}`。
- `sensitivity.overall(path, analysis, config, rules)` → `{"level": "sensitive"/"not_sensitive"/"unknown", "reasons": [文字列]}`。`analysis` は analysis テーブルの行（辞書）か `None`。`sensitivity.judge_name`、`judge_content`、`is_valid_my_number`、`luhn_ok`。
- `analysis_queue.analyse_file(path, platform, config, rules, should_continue)` → 結果の辞書（DB を使わない。中断したら `{"status": "paused"}`、ゴースト等で読めないものは `{"status": "skipped", "reason"}`）、`analysis_queue.store_result(conn, file_id, path, result, config, rules, now)`（analysis の行を書き、`sensitivity.overall` で機密の判定も書く。`paused` と `skipped` は書かない）。順番待ちの出し入れ（`enqueue` 等）は 6-1 を参照。
- `throttle.check(platform, config, now=None)` → `{"allowed", "power", "idle_seconds", "reason"}`。`throttle.HeavyGate(platform, config, clock=time.time)`：`may_run()`、`should_continue()`、`state`。

### 6-5. 機能

- `naming.is_meaningless(stem, rules)` → `(bool, 一致した規則)`、`naming.build_name(date_str, content, source_label, ext)` → 文字列、`naming.propose_name(original_name, light_meta, source, completed_at, analysis, config, rules)` → `{"rename", "new_name", "status": "ready"/"needs_analysis"/"keep", "parts": {"date", "content", "source"}, "evidence": {"date", "content", "source"}, "reason"}`。
- `safe_names.check_name(name)` → `(ok, 理由)`、`safe_names.make_safe(name, max_len=200)`、`safe_names.unique_name(folder, name, exists=os.path.exists)`、`safe_names.split_ext(name)`。
- `fileops.move_and_rename(conn, platform, src, dest_dir, new_name, *, kind, actor, reasons, config, registry=None, file_id=None, now=None)` → `{"ok", "status": "done"/"failed"/"skipped", "path", "reason"}`（上書きしない、同じドライブの中だけ、使用中なら移動しない）。
- `trash.prepare_deletion(conn, paths, config, platform)` → 依頼の辞書 `{"request_id", "items", "count", "total_bytes", "problems"}`。`trash.delete_with_confirmation(conn, platform, request, *, actor="user", now=None)` → `{"approved", "answer", "results", "summary"}`。
- `vault`：状態は `copying`、`copied`、`ghosting`、`evacuated`、`restoring`、`restored`、`restored_conflict`、`restored_local_newer`、`ghost_missing`、`cancelled`、`failed`。`vault.evacuate(conn, platform, path, config, *, reasons, should_continue, actor="auto", now=None)` → `{"ok", "item_id", "state", "reason"}`、`vault.restore(conn, platform, item_id, config, *, actor, now=None)` → `{"ok", "state", "path", "reason"}`、`vault.recover_incomplete(conn, platform, config, now=None)`、`vault.read_manifest(config, item_id)`、`vault.list_items(conn, states=None)`、`vault.sync_from_manifests(conn, config)`（DB を作り直したとき、manifest.json から項目を読み直す）。
- `evacuation.check_location(platform, path, config)` → `{"ok", "reason"}`、`evacuation.find_candidates(conn, platform, now, config, rules, recent_items_enabled)` → `[{"file_id", "path", "reasons"}]`、`evacuation.explain(...)`。
- `killswitch.engage(conn, config, reason, actor="user", now=None)`、`is_engaged(conn, config)`、`resume(conn, config, confirmed, actor="user", now=None)`、`restore_all(conn, platform, config, progress=None, should_stop=None, now=None)` → 件数の辞書、`request_restore_all(config)`、`take_restore_request(config)`、`read_progress(config)`。`conn` が `None` でも、停止の印（ファイル）だけは書ける。
- `inflow.score_rules(texts, context, ext, rules)`、`inflow.build_proposal(conn, platform, path, download_event, context, config, rules, now)` → 提案の辞書、`inflow.execute_proposal(conn, platform, proposal, decision, config, rules, registry, now, alternative_index=None)`、`inflow.MiniDock(config)`：`add`、`interaction`、`user_action`、`tick` → 動作のリスト（`{"do": "show", "dock"}`、`{"do": "close", "dock_id", "reason"}`、`{"do": "execute", "proposal_id", "decision", "alternative_index"}`）、`inflow.apply_deferred_renames(conn, platform, config, rules, registry, now)`。
- `context.parse_foreground(event, rules)` → 文脈の辞書（`app`、`category`、`process`、`window_title`、`page_title`、`conversation`、`conversation_kind`、`workspace`、`partner_status`、`partner_reason`、`keywords`、`is_file_dialog`、`dialog_hwnd`、`at`）、`context.extract_keywords(text, rules)`、`context.summary_label(context)`。
- `desk.rank_files(conn, context, now, config, rules, limit=3)` → `[{"file_id", "path", "name", "status", "score", "reasons"}]`、`desk.DeskController(config)`：`on_context`、`on_shake`、`on_show_request` → 動作のリスト、`desk.ShakeDetector(config)`：`feed(samples)` → bool。
- `search.parse_query(text, now, config, rules)`、`search.search(conn, text, now, config, rules, limit=None)` → `{"query", "status": "found"/"no_match"/"insufficient_info"/"empty_query", "results", "partial_results", "notes"}`。
- `hazard.evaluate_items(conn, paths, config, rules)` → `{"level": "sensitive"/"unknown"/"none", "items", "message"}`、`hazard.HazardSession(config)`：`start_drag`、`target_changed`、`end_drag`、`end_session`、`muted_pairs`。

### 6-6. 連携と進行

- `netguard.install(allowed_executables=())`：監査フックで、ソケットの接続・名前解決・HTTP 等と、許可していない外部コマンドの起動を止める（`NetworkBlocked` を出す）。`netguard.is_installed()`、`netguard.blocked_attempts()`。
- `shell_link.ShellLink(command, on_event)`：`start()`、`stop()`、`request(type, payload, timeout)`（→ 応答の `payload`、失敗は `ShellError`）、`send_event(type, payload)`、`is_alive()`。
- `native_host.read_message(stream)`、`write_message(stream, obj)`、`validate_message(message)` → `(整えた辞書 または None, エラーのリスト)`、`native_host.main(argv)`。
- `service.run(config, rules, platform, ui, conn, link=None, keystore=None)`：常駐のメインループ（終了の依頼まで戻らない。→ `{"ok", "reason"}`）。テストでは `service.Service(config, rules, platform, ui, conn, link=None, clock=time.time, start_threads=True, keystore=None)` の `start()`、`step(now)`、`handle_event(event, now)`、`handle_file_event(event, now)`、`shutdown()` を直接呼ぶ。`cli.main(argv=None, keystore=None, platform=None, out=None)`：コマンド。
- 通信の形は [ipc-protocol.md](ipc-protocol.md) を参照。

### 6-7. Native Messaging の受け口が作る辞書

`native_host.validate_message(message)` は、ブラウザーから届いた JSON（[ipc-protocol.md](ipc-protocol.md) の5節）を検査し、次の形に整えます（URL は `provenance.sanitise_url` 済み、時刻は秒数）。`provenance.store_download_event` はこの形を受け取ります。

```python
{
    "type": "download_completed",
    "browser": "chrome",            # 拡張機能の自己申告（"chrome" / "edge" / "chromium" / None）
    "download": {
        "id": 42, "filename": "C:\\Users\\u\\Downloads\\report.pdf",
        "url": "https://files.slack.com/files-pri/T0/F0/report.pdf", "final_url": "...", "referrer_url": "...",
        "mime": "application/pdf", "started_at": 1793245920.0, "ended_at": 1793245924.5,
        "file_size": 123456, "danger": "safe",
    },
    "page": {"tab_url": "https://app.slack.com/client/T0/C0", "tab_title": "...", "captured_at": 1793245920.01},
}
```

### 6-8. コマンド（`python -m pip0 <コマンド>`）

| コマンド | すること |
| --- | --- |
| `serve` | 常駐処理を始める（pip0 シェルを子プロセスで起動）。`--no-shell` でシェルなし（開発用） |
| `status` | 自動処理の状態、高負荷処理の条件、保管庫の件数、各機能の状態（権限の不足を含む）を表示 |
| `stop` | キルスイッチの「停止」だけを行う（新しい自動処理を止める。復元はしない） |
| `restore-all` | キルスイッチ（停止して、退避したファイルをすべて復元）。常駐処理が動いていれば依頼を渡して進み具合を表示し、動いていなければ自分でシェル（`--headless`）を起動して復元する |
| `resume` | 止めた自動処理を再開する（確認あり） |
| `search "<言葉>"` | エピソード記憶検索 |
| `delete <パス>...` | ごみ箱へ移動する（シェルの確認画面で承認したときだけ） |
| `vault list` / `vault restore <項目ID>` | 保管庫の一覧／1件の復元 |
| `demo [--dir <空のフォルダー>]` | ダミーデータを作り、代役の OS 連携で、検索の3例などを試す（Windows 以外でも動く） |
| `register-root` / `unregister-root` | pip0 専用フォルダーを同期ルートとして登録／解除（解除は、ゴーストが残っていないときだけ） |
| `check-encryption` | DB の暗号化の状態を確かめる |
| `check-network` | pip0 のプロセスの中で、外部通信の禁止（監査フック）が働くかを確かめる（OS のファイアウォールの確認は `scripts\network-policy.ps1 -Check`） |
| `shutdown` | 常駐処理に終了を依頼する |

- 終了コード：0 成功、1 失敗・断った・期待と違う結果、2 使い方の誤り・この PC では使えない操作（Windows 以外での `serve`、`delete` など）。
- `restore-all` が 0 を返すのは、すべての項目を戻せたとき（衝突で横に戻したもの、開いた後に変更されていたものを含む）だけです。見つからない・失敗・残りがあれば 1 を返します。
- `delete`、`vault restore`、`register-root`、`unregister-root` は、常駐処理（またはほかの pip0 のコマンド）が動いている間は実行を断ります（pip0 シェルは1つしか動かせず、保管庫を2つのプロセスで同時に扱わないため。`locks\service.lock` で確かめる）。`restore-all` は、常駐処理が動いていれば依頼のファイルを渡して進み具合を表示し、動いていなければ自分で行います。
- `check-network` は、コマンド自身のプロセスに監査フックを入れて確かめます（常駐処理のプロセスの状態ではありません）。

### 6-10. 実装で決まった細部（各担当の報告から）

6-1〜6-6 の約束に加えて、実装のときに次のことを決めました。呼ぶ側はこれに合わせてください。

- **platform**：`WindowsPlatform(link, pip0_root=None)`、`set_pip0_root(path)`、`unregister_sync_root(path)` → `{"ok", "reason"}`。`register_sync_root` は `cf.register_root` と `cf.connect` を続けて送り、両方成功したときだけ `ok`（何度呼んでもよい。`init` の後と、シェルを起動し直すたびに呼ぶ）。`is_sync_root_registered` はシェルを通さず `CfGetSyncRootInfoByPath` で調べる。`open_for_copy`／`open_for_analysis` は `SetFileTime` のために `FILE_WRITE_ATTRIBUTES` も求め、断られたら読み取りだけで開き直す（その場合は最終アクセス日時が更新されうる）。`make_ghost`／`restore_ghost` が時間切れになった後は、シェルが動いている間、その場所の `ghost_status` が `is_ghost: None`（不明）になる。シェルにつながらないときの `confirm_and_recycle` は `answer: "unavailable"` で、何も削除しない。
- **shell_link**：`ShellUnavailable` と `ShellTimeout` は `ShellError` の一種。`start()` は失敗しても例外を出さず `{"ok", "reason"}` を返す。`stop()` は `{"stopped", "returncode", "method"}`。`counters()`。シェルが終わると、本体の中で `{"type": "shell.exited", "payload": {"returncode", "requested_stop"}}` が届く（読み取りのスレッドから。`on_event` の中では順番待ちに入れるだけにする）。`netguard.install([SHELL_EXE])` の後でないと起動できない。
- **netguard**：`self_check()` → `{"ok", "reason", "checks": [{"name", "blocked", "detail"}]}`。許可した実行ファイルは絶対パスで、リストで渡す。
- **provenance**：`determine_source`、`record_provenance` は download_events の行（平らな辞書）を受け取る。`parse_zone_identifier(None)` も辞書を返す。`expire_old_events` は期限切れにした件数を返す。
- **scanner／watcher**：`scan_folder` は `{"ok", "reason", "seen", "new", "changed", "skipped", "missing", "errors"}`、`scan_all` はそれに `folders` を加える。改名の追跡は、ファイル番号に加えて大きさと更新日時が同じときだけ。pip0 のゴーストの行は `missing` ではなく `ghost`。`FolderWatcher.start()` は `{"ok", "reason", "watching"}`。`DownloadTracker` はダウンロードフォルダーの中だけを見て、拡張機能の記録を最大 `DOWNLOAD_BROWSER_WAIT_SECONDS`（30秒）待つ。
- **usage**：`last_use(conn, file_row, kinds=None)`。`record_usage` は追加した行の id、pip0 自身の読み取りなら `None`。
- **analysis**：`sensitivity.overall` は、解析済みでも本文・タイトル・ラベルを読めなかったもの（画像、スキャンした PDF など）を `unknown` にする（中身を調べていないものを非機密としない）。`throttle.check` は `checked_at` も返す。`HeavyGate` には `history`、`refresh()`、`stop_requested()` もある。`analyse_file` は、途中でファイルが変わったときなども `skipped` を返す。`store_result` は機密の判定 `{"level", "reasons"}` を返す。
- **fileops／trash**：`move_and_rename` は `new_name=None`（名前は変えずに移動）を受け付け、`actor="auto"` は停止の印があるときは断る。`prepare_deletion` の `problems` は、問題のある項目（辞書）のリスト。削除できるものがなく確認画面を出さなかったときの `answer` は `None`。確認画面の文には、ファイル名を書かない（名前と件数は画面が `items` から一覧にする）。
- **vault／evacuation／killswitch**：`evacuate(..., rules=None)` と `check_location(platform, path, config, rules=None)`（大きさ0、ハードリンクが複数あるもの、使用中のものも断る）。`restore` の結果に `already`。`vault.cancel`、`vault.record_moved`（`cf.notify_rename` のとき）、`claim_path`／`release_path`／`is_busy`（同じパスを同時に扱わない）。`engage` → `{"ok", "marker", "database", "reason"}`。`request_restore_all` は停止の印もすぐに書く。全復元が終わっていない間は `resume` を断る。
- **context**：`parse_foreground` の結果には、`document_name`（Office・メモ帳の文書名）、`dialog_rect`、`inaccessible` もある。知らないアプリは `app` が `None`、`category` が `"other"`。`carry_over(previous, current)` は、ファイルダイアログ（題名に文脈がない）に、同じアプリの直前の文脈を引き継ぐ。`partner_label(context)`。
- **desk**：`DeskController.tick(now)`（隠している間に文脈が変わり、待ち時間が過ぎたら再表示）、`on_show_request(now, ranked=None)`。文脈の区別には、プロセス・会話・ページ題名・文書名・ファイルダイアログかどうかを使う。pip0 自身のウィンドウは文脈として扱わない。`rank_files` は、使用・変更の日時を1回の問い合わせでまとめて読む（`usage.last_use` と同じ決まり）。
- **search**：結果の各項目は `{"file_id", "path", "name", "status", "reasons", "unmatched": [{"cue", "reason", "missing_info"}], "matched_count", "cue_count"}`。「情報不足」（`missing_info`）は、その種類のファイルに普通はある情報（画像の色・形の解析、文書の本文、Office のグラフの有無、入手経路の記録）がないとき。
- **hazard**：各項目に `file_id` もある。`end_session` は `unlock`、`resume` でもセッションの区切りとする（終わりの知らせを取りこぼしても、消音を持ち越さない）。
- **demo_data**：`run_demo(target_dir=None, now=None, rules=None, protected=None)` → 報告の辞書、`report_lines(report)` → 表示する行。一時フォルダーの中に、メモリーの DB と代役の OS 連携だけで動く（本物のフォルダーと DB には触れない）。
- **service（常駐処理）**：全復元は、メインのスレッドで1件ずつ行います（その間、シェルからの知らせは順番待ちになり、全復元が終わってから処理します）。自動退避の候補探しの1回目は、起動の `600` 秒後（`FIRST_EVACUATION_CHECK_SECONDS`）で、その後は `EVACUATE_CHECK_HOURS` ごとです。候補を探す直前に、pip0 専用フォルダーのファイルの最終アクセス日時を利用の記録に加えます（読んだだけのファイルを、長期間未読としないため）。状態（`ui.status`）は、変わったときと、最短 2 秒ごとに送り、`service.status.json` には最短 5 秒ごとに書きます。
- **inflow／naming**：提案の状態に `needs_analysis`（名前が解析待ち。仕分け先があれば先に移動する）。`MiniDock` の動作に `{"do": "open", "proposal_id", "path"}` があり、`payload(now)` で今の表示内容を返す。`execute_proposal` → `{"ok", "status", "path", "state", "reason"}`。`load_proposal(conn, proposal_id)` で DB から提案を読み直せる。`apply_deferred_renames` は件数の辞書を返す。

### 6-9. 導入後の配置（`scripts\install.ps1`）

```text
%LOCALAPPDATA%\Programs\pip0\        ← プログラム（INSTALL_DIR）
  runtime\python.exe, pythonw.exe     ← pip0 専用の Python（埋め込み用配布物）。ファイアウォールの規則の対象
  runtime\Lib\site-packages\          ← requirements.txt のライブラリ
  app\pip0\                           ← pip0 本体（このリポジトリの pip0\ をコピー）
  shell\Pip0Shell.exe                 ← pip0 シェル（dotnet publish の出力）
  native-host\pip0-native-host.bat, pip0.bridge.json
  scripts\restore-all.cmd ほか
%LOCALAPPDATA%\pip0\                  ← データ（DATA_DIR）。暗号化DB、保管庫、制御ファイル、ログ
%USERPROFILE%\pip0\                   ← pip0 専用フォルダー（PIP0_ROOT）
```

`serve` は、`settings.SHELL_EXE`（None なら、pip0 本体の2つ上のフォルダーの `shell\Pip0Shell.exe`）を起動します。

## 7. 保管庫の形式と状態遷移

### 7-1. 形式

```text
vault\
  README.txt                    ← 保管庫の説明（手作業で取り出す方法）
  items\
    <項目ID（32桁の16進数）>\
      content                   ← 退避したファイルの本体（元の内容そのまま）
      content.partial           ← コピー途中のもの（完成すると content に名前を変える）
      manifest.json             ← 復元に必要な情報
```

`manifest.json` の項目：`format`（1）、`item_id`、`state`、`original_path`、`current_path`、`file_key`、`size`、`mtime_ns`、`sha256`、`created_at`、`updated_at`、`restored_path`、`history`（`{"state", "at", "note"}` のリスト）。書き込みは、一時ファイルに書いて `fsync` してから `os.replace` で置き換えます。pip0 シェルは、ゴーストが開かれたとき、`content` と `manifest.json` の `sha256` を照合してから中身を渡します。

### 7-2. 退避の手順（`vault.evacuate`）

1. `copying`：項目を作り、manifest.json と DB に書く。
2. 原本を `open_for_copy`（他プロセスの書き込みを拒否）で開き、`content.partial` へ 1MB ずつコピーしながら SHA-256 を計算する。区切りごとに `should_continue()` を確かめ、偽なら中止する（状態は `failed`、理由「一時停止」、原本はそのまま）。
3. コピー後に原本のサイズと更新日時が変わっていないことを確かめ、`content.partial` を読み直してハッシュが一致することを確かめてから `content` に名前を変える。→ `copied`（ハッシュを manifest.json と DB に書く）。容量不足などの失敗は `failed`（原本はそのまま）。
4. `ghosting`：manifest.json と DB に書いてから、`platform.make_ghost(パス, 項目ID, {"size", "mtime_ns", "file_key", "sha256"})` を呼ぶ。シェルは、原本を排他的に開き、サイズ・更新日時・ファイル番号（必要ならハッシュも）が一致することを確かめてから、プレースホルダーに変換して中身を外す。
5. `"ghosted"` で、`ghost_status` が自分の項目のゴーストだと確かめられたら `evacuated`。`"changed"`・`"locked"` などは `failed`（原本はそのまま、後でやり直せる）。

### 7-3. 復元の手順（`vault.restore`）

| 元の場所の状態 | すること | 結果の状態 |
| --- | --- | --- |
| 自分の項目のゴースト | `restore_ghost`（中身がなければ保管庫から戻す）→ ハッシュを確かめる | 一致：`restored`、不一致（開いた後に編集された）：`restored_local_newer` |
| 通常のファイルで、ハッシュが一致 | 何もしない（すでに戻っている） | `restored` |
| 通常の別のファイル | 横に「元の名前 (pip0復元).拡張子」で保管庫からコピーし、ハッシュと更新日時を確かめる | `restored_conflict` |
| ファイルがない（ゴーストが消された・移動された） | 勝手に作り直さない。保管庫に残す | `ghost_missing` |
| シェルが動いていない等 | 何もしない（状態を戻す） | `evacuated` のまま（失敗として記録） |

どの場合も、保管庫の `content` と `manifest.json` は消しません。同じ復元を何度実行しても、結果は同じです。

### 7-4. 起動時の点検（`vault.recover_incomplete`）

- `copying` → 中断されたので `failed`（原本はそのまま）。
- `ghosting` → `ghost_status` を見て、ゴーストになっていれば `evacuated`、通常のファイルなら `copied`、なければ `ghost_missing`。
- `restoring` → 復元をやり直す。
- DB にない manifest.json があれば、DB に読み込む（`sync_from_manifests`）。
