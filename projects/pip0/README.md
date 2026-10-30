# pip0（ピップゼロ）：デバイス内のファイル整理アシスタント

pip0 は、学生のグループが設計したファイル整理アシスタントです。パソコンの中で常に動き、**ファイルの流入**（ダウンロード）、**いまの作業文脈**（使っているアプリやチャットの相手）、**人のあいまいな記憶**（「先週の予算資料」など）を手掛かりに、ファイルの整理と再発見を手伝います。ファイルを削除するときは、必ずユーザーに許可を求めます。

このフォルダーには、グループワークで引き継いで開発するための **Windows 11 用の初期コード** があります。

> **現在の状態**：初期コードを実装しました。Python の処理は自動テストで、C# の pip0 シェルはビルドと処理の確認で、ブラウザー拡張はテストと Linux の Chromium での通しの確認で確かめました。**Windows 11 の実機では、まだ一度も動かしていません**（作業した環境が Linux のため）。ゴースト（M4）、ごみ箱、画面の表示、フックなど、Windows の機能を使う部分は実機での確認が必要です。機能ごとの状態は [docs/status.md](docs/status.md)、確かめた内容は [docs/verification.md](docs/verification.md) にまとめています。

## 1. pip0 の機能（学生の設計）

| 機能 | 内容 | 主なファイル |
| --- | --- | --- |
| M1 流入処理 | ダウンロードの完了を確かめた直後から3秒間、画面の右下に「ミニドック」を出し、作業文脈に合った仕分け先を提案して自動で整理します。意味の分からない名前（`IMG_0042.png` など）は「日付_内容_送信元」の形に自動で改名します（学生の呼称で「リバース翻訳」） | `inflow.py`、`naming.py`、`watcher.py` |
| M2 作業連動・浮上式デスク | 前面のアプリや Slack の会話相手から、関連する上位3つのファイルを画面の端（またはファイルを開く画面の上）に出します。マウスが近づくと透け、マウスを左右に振ると消えます | `context.py`、`desk.py` |
| M3 エピソード記憶検索 | 「青いグラフ」「Slackで貰った」「先週の予算資料」のように、見た目・入手経路・時期・内容の手掛かりで探し、一致した理由を示します | `search.py` |
| M4 シュレディンガー退避ストレージ | 長く使っていないファイルの中身を保管庫へ預け、元の場所には「ゴースト」を残します。ゴーストを普通のアプリで開くと、中身が自動で戻ります（Windows の Cloud Files API） | `vault.py`、`evacuation.py`、`usage.py` |
| M5 スマート・ハザードガード | 機密のファイルをドラッグすると、画面の枠を赤く光らせて警告します。警告の後も続けた場合は、同じファイルを同じアプリへ送るときだけ、そのセッションの間は警告を止めます | `hazard.py`、`sensitivity.py` |

あわせて、指示書の基本仕様も実装しています。

- **端末の中だけで処理**：解析結果と索引は暗号化DB（SQLCipher）に保存し、鍵は Windows の資格情報マネージャーに置きます。外部のサーバーや AI には何も送りません（[docs/network.md](docs/network.md)）。
- **重い処理の条件**：画像の解析や本文の取り出し、ハッシュの計算は、「電源に接続中」かつ「Windows 全体で3分間操作がない」ときだけ行います（`throttle.py`）。
- **1クリック全復元（キルスイッチ）**：自動処理をすぐに止め、退避したファイルを元の場所へ戻します（`killswitch.py`）。画面が動かないときは `scripts\restore-all.cmd` を使います。

## 2. 全体の構成

```text
ブラウザー拡張（Chrome／Edge）──Native Messaging──▶ 受け口（native_host.py）──▶ 暗号化DB
                                                                                ▲
pip0 本体（Python、pip0\）  ◀──標準入出力（JSON の1行ずつ）──▶  pip0 シェル（C#、shell\）
 判断と記録：監視、索引、解析、仕分け、             Windows の機能：ミニドック、デスク、赤い枠、
 検索、保管庫の状態、操作履歴                       確認画面、通知領域、Cloud Files API、ごみ箱、
                                                    前面ウィンドウ・ドラッグ・マウスの監視
```

- **判断はすべて Python**（学生が読み、変更する部分）、**Windows の機能は C# のシェル**が受け持ちます。シェルは本体の指示を実行し、OS で起きたことを本体へ知らせるだけで、判断はしません。
- 詳しくは [docs/design.md](docs/design.md)（設計と決めごと）と [docs/ipc-protocol.md](docs/ipc-protocol.md)（本体とシェルの通信）を見てください。

## 3. 試し方

### 3-1. Windows 以外でも試せること（デモとテスト）

pip0 の判断の処理（仕分け、改名、検索、機密の判定、退避と復元の手順、全復元）は、Windows の機能の代わりに「代役」（`platform_fake.py`）を使って、Linux や macOS でも試せます。Python 3.11 以上が必要です。

```bash
cd projects/pip0
python -m pip install -r requirements.txt -r requirements-dev.txt
```

ダミーのファイルを作って、検索の3例、M1 の改名の提案、M5 の機密の判定を試します（本物のデスクトップやダウンロードには触れません）。

```bash
python -m pip0 demo
```

自動テストを動かします。

```bash
python -m pytest
```

- デモで作るダミーのファイルと、期待する検索結果は [docs/test-data.md](docs/test-data.md) にあります。
- 代役で確かめたことは、Windows で確かめたことにはなりません。代役は Windows の動きをまねるだけです。

### 3-2. Windows 11 で動かす

導入、起動、権限、ブラウザー拡張の接続、停止、復元、アンインストールの手順は [docs/setup-windows.md](docs/setup-windows.md) にまとめています。おおまかな流れは次のとおりです。

1. pip0 シェルをビルドする（`scripts\build-shell.ps1`、.NET 8 SDK が必要）
2. pip0 を導入する（`scripts\install.ps1`、管理者の権限は不要）
3. Chrome または Edge に拡張機能を読み込む（[browser-extension/README.md](browser-extension/README.md)）
4. （任意）OS のファイアウォールで pip0 の通信を遮断する（`scripts\network-policy.ps1 -Apply`、管理者）
5. pip0 を起動する（`scripts\start-pip0.cmd`）

機械学習モデルは使わないため、モデルの事前配置は不要です（[docs/design.md](docs/design.md) 2-1）。

## 4. コードの地図

`pip0\` の Python のファイルを、指示書2節の7つの責務に分けています。どのファイルも、先頭に役割の説明があります。

| 責務 | ファイル |
| --- | --- |
| 設定と規則（★変更しやすい） | `settings.py`（設定値）、`rules.py`（仕分けの規則、手掛かり語、機密の規則などの辞書）、`config.py`（設定の読み込みと場所の決定） |
| ファイルの監視、索引作成、メタデータ管理 | `watcher.py`（変更の監視、ダウンロード完了の確認）、`scanner.py`（索引）、`provenance.py`（入手経路）、`usage.py`（利用の記録）、`database.py`（暗号化DB）、`keystore.py`（DB の鍵） |
| ローカル解析、分類、検索順位の計算 | `analyse_text.py`（本文とタイトル）、`analyse_image.py`（色とグラフらしさ）、`sensitivity.py`（機密の判定）、`analysis_queue.py`（解析の順番待ち）、`inflow.py`・`naming.py`（M1）、`desk.py`（M2）、`search.py`（M3）、`hazard.py`（M5） |
| 移動、リネーム、退避、復元、ごみ箱への移動 | `fileops.py`（移動・改名）、`safe_names.py`（Windows で使える名前）、`fsutil.py`（上書きしない改名など）、`vault.py`（退避と復元）、`evacuation.py`（退避してよいかの判断）、`killswitch.py`（全復元）、`trash.py`（ごみ箱） |
| 電源状態とアイドル状態による処理制御 | `throttle.py` |
| 作業文脈の取得と常駐UI | `context.py`（作業文脈）、`ui.py`（表示の指示）、C# の `shell\Ui\`・`shell\Context\` |
| OS 固有のファイル提供機構、権限、ドラッグ操作等への連携 | `platform_windows.py`（Windows の機能）、`platform_fake.py`（テスト用の代役）、`shell_link.py`（シェルとの通信）、C# の `shell\CloudFiles\`・`shell\Trash\`・`shell\Input\` |
| ブラウザー拡張と端末内連携 | `native_host.py`（受け口）、`browser-extension\`、`native-host\` |
| 全体の進行 | `service.py`（常駐処理）、`cli.py`（コマンド、`python -m pip0 <コマンド>`）、`netguard.py`（外部通信の禁止）、`demo_data.py`（ダミーデータ） |

そのほかのフォルダー：

| フォルダー | 内容 |
| --- | --- |
| `tests\` | 自動テスト（pytest）。代役の OS 連携と一時フォルダーだけを使います |
| `shell\` | pip0 シェル（C#、.NET 8、WPF）。説明は [shell/README.md](shell/README.md) |
| `browser-extension\` | Chrome／Edge 共通の拡張機能。説明は [browser-extension/README.md](browser-extension/README.md) |
| `native-host\` | ブラウザーが受け口を起動するための設定。説明は [native-host/README.md](native-host/README.md) |
| `scripts\` | 導入、ファイアウォール、全復元、起動、アンインストールのスクリプト（Windows） |
| `docs\` | 設計、通信の取り決め、導入の手順、外部通信、ダミーデータ、実装状況、確認の記録 |

## 5. 学生が変更しやすい箇所

コードの中で「★」の付いた場所が、変えて試しやすいところです。

| 変えたいこと | 場所 | 改善の種類 |
| --- | --- | --- |
| 仕分け先と、その手掛かりの語 | `rules.py` の `SORT_RULES` | データ（規則） |
| 「意味の分からない名前」の見分け方 | `rules.py` の `MEANINGLESS_NAME_PATTERNS` | データ（規則） |
| 送信元の名前（例：files.slack.com → Slack） | `rules.py` の `SOURCE_RULES` | データ（規則） |
| Slack のウィンドウタイトルの読み方 | `rules.py` の `SLACK_TITLE_PATTERNS` | データ（規則）。実機のタイトルを見て直す |
| 検索の手掛かり語（色、グラフ、資料、入手経路） | `rules.py` の `COLOUR_WORDS`、`VISUAL_KIND_WORDS`、`DOC_KIND_WORDS`、`SOURCE_WORDS` | データ（辞書） |
| 機密とみなす語やラベル | `rules.py` の `SENSITIVE_NAME_KEYWORDS` ほか | データ（規則） |
| ミニドックの秒数、デスクの件数・透け方、シェイクの感度、退避までの日数 | `settings.py` | 設定値 |
| 新しい名前の組み立て方 | `naming.py` の `propose_name` | Python の処理 |
| 仕分け先の点数の付け方 | `inflow.py` の `score_rules` | Python の処理 |
| デスクに出す順位の計算 | `desk.py` の `rank_files` | Python の処理 |
| 検索の手掛かりの照合と、理由の文 | `search.py` | Python の処理 |
| 「長期間未読」の判定 | `usage.py` の `judge_long_unread` | Python の処理 |
| ダミーデータと期待する結果 | `demo_data.py`、[docs/test-data.md](docs/test-data.md) | データ |

- **データ（規則・辞書・設定値）の改善**は、処理を変えずに動きを変えます。変えたら `python -m pip0 demo` と `python -m pytest` で、前と同じ条件の結果と比べてください。
- **Python の処理の改善**は、同じ入力に対して毎回同じように結果が変わるので、テストを加えて確かめられます。
- pip0 は生成AIを使いません。AI に修正を頼むときは、変えたいファイルと関数の名前、守ってほしい約束（次の6節）、確かめる方法（テストを加えること）を伝えてください。たとえば「`pip0/rules.py` の `SORT_RULES` に『就職活動』の規則を加え、`tests/test_inflow.py` に、その規則で仕分けられることを確かめるテストを加えてください。外部への通信やファイルの完全削除は加えないでください」のように頼みます。
- 設定値は、`settings.py` を直接変えるほか、導入後はデータフォルダーの `config.json` で変えられます（[docs/design.md](docs/design.md) 6-1）。

## 6. 安全のための約束

変更するときも、次の約束を守ってください。`tests/test_safety_static.py` などのテストが、一部を自動で確かめます。

- **完全な削除をしない**：pip0 がファイルを消すのは、ユーザーが確認画面で承認したときに、Windows のごみ箱へ移すときだけです。ごみ箱を使えない場所では削除しません。ごみ箱を空にする機能はありません。
- **上書きしない**：移動・改名・復元で、既存のファイルを上書きしません。同じ名前があれば「 (2)」などを付けます。
- **保管庫を消さない**：退避したファイルの本体（`vault\items\<項目ID>\content`）と復元の情報（`manifest.json`）は、自動で消しません。
- **外部と通信しない**：pip0 本体、シェル、拡張機能は、処理したデータを外へ送りません。拡張機能と本体のやり取りは、同じ PC の中の Native Messaging だけです。
- **画面を記録しない**：作業文脈（ウィンドウタイトル等）は、その場で使うだけで保存しません。スクリーンショットは撮りません。ブラウザー拡張が送る「ダウンロード開始時に前面だったタブ」の題名と URL は、ダウンロードのファイルと結び付けるまで（最大24時間）だけ暗号化DB に置き、結び付けたら消します。結び付かなかった記録は、24時間で行ごと消します。ダウンロードフォルダーの外へ保存したものは、記録しません。
- **テストで本物のフォルダーを使わない**：テストとデモは、一時フォルダーとダミーのファイルだけを使います。
- **秘密情報と個人情報を登録しない**：APIキー、パスワード、学籍番号、氏名をコードやデータに入れません。

## 7. 制約と注意

- 対象は **Windows 11（x64）** です。macOS と Windows 10 は対象外です。
- **Windows 11 の実機では確かめていません**。実機で動かしたら、[docs/status.md](docs/status.md) と [docs/verification.md](docs/verification.md) を更新してください。
- **M4 のゴーストは、pip0 専用フォルダー（`%USERPROFILE%\pip0`）の中だけ**です。ほかの場所、OneDrive などの同期フォルダー、NTFS 以外のドライブ（exFAT の USB メモリなど）のファイルは退避せず、理由を表示します。「0バイト」はディスク上の大きさのことで、エクスプローラーの「サイズ」欄は元の値のままです。保管庫が同じドライブにあると、退避しても空き容量はほとんど増えません。
- **検索と分類は、機械学習を使わない簡単な方法**です。「青いグラフ」は画像の色の割合と形の特徴、「予算資料」は本文とタイトルの語で判定します。写真に写った物の認識や、言い換えには対応していません。
- Slack のチャット相手は、ウィンドウタイトルが `rules.py` の形に合うときだけ読み取ります（形は実機で未確認）。読めないときは「取得不可」と表示します。
- ドラッグの検知は、エクスプローラー（デスクトップを含む）と pip0 のデスクから始まるドラッグだけです。メールの添付などからのドラッグは対象外です。M5 は警告だけで、送信を止める機能はありません。
- ファイルを開く画面への表示は、画面の上辺に合わせてデスクを出し、候補を選ぶとファイル名の欄にパスを入れる方式です。画面の中に部品を入れることはしません。
- ミニドックとデスクの「開く」ボタンで開くのは、文書・画像・音声・動画・zip の決まった種類だけです（`.exe`、`.py`、マクロ付きの Office ファイルなど、プログラムが動く種類は開かず、エクスプローラーで場所を開くよう案内します。一覧は `shell/Ui/OpenableFile.cs`）。
- ミニドック、デスク、警告の枠は、画面共有や録画に映らないように設定しています（Windows 10 2004 以降の機能。実機では未確認）。

## 8. 文書

| 文書 | 内容 |
| --- | --- |
| [CLAUDE_CODE_PROMPT.md](CLAUDE_CODE_PROMPT.md) | この初期コードの作成指示（仕様）と、作業開始時に確認した事項への回答 |
| [docs/design.md](docs/design.md) | 構成、採用技術と理由、機能ごとの決めごと、モジュールの約束、保管庫の形式 |
| [docs/ipc-protocol.md](docs/ipc-protocol.md) | 本体とシェル、拡張機能と受け口のやり取りの形 |
| [docs/setup-windows.md](docs/setup-windows.md) | Windows 11 での導入、起動、権限、復元、アンインストール |
| [docs/network.md](docs/network.md) | 外部通信の禁止（コードの確認と、OS による遮断の確認） |
| [docs/test-data.md](docs/test-data.md) | ダミーデータと、検索の3例の期待する結果 |
| [docs/status.md](docs/status.md) | 機能ごとの実装状況と確認の状況 |
| [docs/verification.md](docs/verification.md) | 実際に行った確認と結果、未確認の事項 |

## 9. データと出典

- 規則、辞書、ダミーデータは、この教材のために作ったものです。外部のデータセットや、ほかの作品のコードは使っていません。ダミーのファイルは `demo_data.py` がその場で作ります。
- 使っているライブラリと利用条件：

| 名前 | 用途 | ライセンス |
| --- | --- | --- |
| sqlcipher3（SQLCipher 4 を含む） | 暗号化DB | zlib（SQLCipher は BSD 形式） |
| keyring（Windows では pywin32-ctypes） | DB の鍵を OS の鍵保管機構に保存 | MIT（pywin32-ctypes は BSD-3-Clause） |
| watchdog | フォルダーの監視 | Apache-2.0 |
| Pillow | 画像の解析 | MIT-CMU（HPND） |
| pypdf | PDF の解析 | BSD-3-Clause |
| pytest | テスト（開発のときだけ） | MIT |
| .NET 8、WPF、Windows フォーム | pip0 シェル | MIT |
| CsWin32 | pip0 シェルのビルド（Win32 API の宣言の生成） | MIT |
| Python 埋め込み用配布物 3.13.17 | Windows での pip0 専用の Python | Python Software Foundation License |

- Windows、Chrome、Edge、Slack の機能の使い方は、各社の公式資料に従いました（資料の一覧は [docs/design.md](docs/design.md)、[docs/setup-windows.md](docs/setup-windows.md)、[docs/network.md](docs/network.md)）。
