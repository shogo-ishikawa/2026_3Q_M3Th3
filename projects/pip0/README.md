# pip0（ピップゼロ）：デバイス内のファイル整理アシスタント

pip0 は、学生のグループが設計したファイル整理アシスタントです。パソコンの中で常に動き、**ファイルの流入**（ダウンロード）、**いまの作業文脈**（使っているアプリやチャットの相手）、**人のあいまいな記憶**（「先週の予算資料」など）を手掛かりに、ファイルの整理と再発見を手伝います。ファイルを削除するときは、必ずユーザーに許可を求めます。

このフォルダーには、グループワークで引き継いで開発するための **Windows 11 用の初期コード** があります。

> **現在の状態**：初期コードを実装しました。Python の処理は自動テストで、C# の pip0 シェルはビルドと処理の確認で、ブラウザー拡張はテストと Linux の Chromium での通しの確認で確かめました。**Windows 11 の実機では、まだ一度も動かしていません**（作業した環境が Linux のため）。ゴースト（M4）、ごみ箱、画面の表示、フックなど、Windows の機能を使う部分は実機での確認が必要です。機能ごとの状態は [docs/status.md](docs/status.md)、確かめた内容は [docs/verification.md](docs/verification.md) にまとめています。

## 1. pip0 の機能（学生の設計）

| 機能 | 内容 | 主なファイル |
| --- | --- | --- |
| M1 流入処理 | ダウンロードの完了を確かめた直後から3秒間、画面の右下に「ミニドック」を出し、作業文脈に合った仕分け先を提案して自動で整理します。意味の分からない名前（`IMG_0042.png` など）は「日付_内容_送信元」の形に自動で改名します（学生の呼称で「リバース翻訳」）。画面を見られない間（画面のロック中など）は、自動で動かさずに待たせます | `inflow.py`、`naming.py`、`watcher.py` |
| M2 作業連動・浮上式デスク | 前面のアプリや Slack の会話相手から、関連する上位3つのファイルを画面の端（またはファイルを開く画面の上）に出します。マウスが近づくと透け、マウスを左右に振ると消えます | `context.py`、`desk.py` |
| M3 エピソード記憶検索 | 「青いグラフ」「Slackで貰った」「先週の予算資料」のように、見た目・入手経路・時期・内容の手掛かりで探し、一致した理由を示します | `search.py` |
| M4 シュレディンガー退避ストレージ | 長く使っていないファイルの中身を保管庫へ預け、元の場所には「ゴースト」を残します。ゴーストを普通のアプリで開くと、中身が自動で戻ります（Windows の Cloud Files API） | `vault.py`、`evacuation.py`、`usage.py` |
| M5 スマート・ハザードガード | 機密のファイルをドラッグすると、画面の枠を赤く光らせて警告します。警告の後も続けた場合は、同じファイルを同じアプリへ送るときだけ、そのセッションの間は警告を止めます | `hazard.py`、`sensitivity.py` |

あわせて、指示書の基本仕様も実装しています。

- **端末の中だけで処理**：解析結果と索引は暗号化DB（SQLCipher）に保存し、鍵は Windows の資格情報マネージャーに置きます。外部のサーバーや AI には何も送りません（[docs/network.md](docs/network.md)）。
- **重い処理の条件**：画像の解析、本文の取り出し、解析と退避のためのハッシュの計算、保管庫へのコピーは、「電源に接続中」かつ「Windows 全体で3分間操作がない」ときだけ行います（`throttle.py`）。復元のときのハッシュの確認と、ゴーストを開いたときの確認は、この条件と関係なく、すぐに行います。
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

| 部品 | 言語・場所 | 役割 |
| --- | --- | --- |
| pip0 本体 | Python、`pip0\` | 判断と記録のすべて（監視、索引、解析、仕分け・改名の提案、検索、機密の判定、保管庫の状態、全復元）。学生が読み、変更する中心 |
| pip0 シェル | C#、`shell\` | Windows の機能（ミニドック・デスク・赤い枠・確認画面・通知領域の表示、ゴースト、ごみ箱、前面ウィンドウ・ドラッグ・マウスの監視）。本体の指示を実行し、OS で起きたことを知らせるだけで、判断はしない |
| ブラウザー拡張 | JavaScript、`browser-extension\` | ダウンロードが終わったときに、ダウンロード元の URL などを、この PC の受け口へ渡す |
| 受け口 | Python（`pip0\native_host.py`）、`native-host\` | 拡張機能からの記録を検査し、暗号化DB に書く。ファイル操作やコマンドは受け付けない |
| スクリプト | PowerShell・cmd、`scripts\` | 導入、起動、全復元、ファイアウォールの規則、アンインストール |

- **判断はすべて Python**（学生が読み、変更する部分）、**Windows の機能は C# のシェル**が受け持ちます。シェルは本体の指示を実行し、OS で起きたことを本体へ知らせるだけで、判断はしません。
- 詳しくは [docs/design.md](docs/design.md)（設計と決めごと）と [docs/ipc-protocol.md](docs/ipc-protocol.md)（本体とシェルの通信）を見てください。

## 3. 試し方

### 3-1. Windows 以外でも試せること（デモとテスト）

pip0 の判断の処理（仕分け、改名、検索、機密の判定、退避と復元の手順、全復元）は、Windows の機能の代わりに「代役」（`platform_fake.py`）を使って、Windows 以外でも試せます。

- Python は 3.11 以上が必要です。確かめたのは、Linux の Python 3.11・3.12・3.13 だけです。3.13 をすすめます（Windows への導入で使う版と同じです）。
- 3.14 以降は確かめていません。3.15 では、暗号化DB のライブラリ sqlcipher3（0.6.4）に、ビルド済みの部品（wheel）がありません。pip がソースからビルドしようとするため、C のコンパイラーなどがない PC では入りません。
- macOS と、Windows の普通の Python では、まだ動かしていません。Windows の Python では、今は自動テストの一部が動きません（下の注意）。

**準備**：先に `python3 --version`（Windows は `py -3.13 --version`）で、3.11 以上の Python があるかを確かめます（古ければ python.org から入れます）。ライブラリは、このフォルダーの中に作る仮想環境（`.venv`）に入れます。`.venv` は Git に登録されません。PC の Python に直接入れようとすると、Linux や macOS では「externally-managed-environment」というエラーで止まることがあります。

macOS・Linux（ターミナル）：

```bash
cd projects/pip0
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-dev.txt
```

Windows（コマンド プロンプト。この手順は、まだ Windows で確かめていません）：

```bat
cd projects\pip0
py -3.13 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt -r requirements-dev.txt
```

仮想環境に入ると、`python` は仮想環境の Python になります。ターミナルを開き直したときは、`projects/pip0` で `source .venv/bin/activate`（Windows は `.venv\Scripts\activate.bat`）をもう一度実行します。この節のコマンドは、どれも `projects/pip0` で実行します。

**デモ**：ダミーのファイルを作って試します（本物のデスクトップやダウンロードには触れません）。

```bash
python -m pip0 demo
```

- 検索の3例、「ほかにも試せる検索」（「赤いグラフ」「先月の予算」など）、M5 の機密の判定は、期待する結果（[docs/test-data.md](docs/test-data.md)）と比べて、1つずつ ✓ か ✗ を付けます。最後の「結果：すべて期待どおりです」は、この比べた結果です。日付で答えが変わる検索があるため、期待する結果は、動かした日時から計算します。
- M1 の改名の提案は、表示するだけで、期待とは比べません（最後の「結果：…」にも含まれません）。期待する名前は [docs/test-data.md](docs/test-data.md) の8節にあるので、目で比べます。
- M1 の仕分け先、M2（デスク）、M4（退避）、ミニドックの時間は、デモには出ません。自動テストか、関数を直接呼んで確かめます（5-4）。
- 空のフォルダーを指定すると、作ったダミーのファイルを後で見られます（例：`python -m pip0 demo --dir ~/pip0-demo`。Windows では `--dir C:\pip0-demo`）。リポジトリーの外の場所にしてください（中に作ると、ダミーのファイルを Git に登録してしまうおそれがあります）。

**自動テスト**：

```bash
python -m pytest
```

Linux の Python 3.11・3.12・3.13 で、すべて成功することを確かめています（件数は [docs/verification.md](docs/verification.md) の5節）。

> **Windows の Python での注意**：今の自動テストは、Windows の Python では最後まで動きません。`tests/test_base.py`、`tests/test_demo_data.py`、`tests/test_desk.py`、`tests/test_search.py` が、タイムゾーンを切り替えるために、Windows にない `time.tzset` を使っているためです（Linux で `time.tzset` をなくしてまねたところ、168 件がエラーか失敗になりました）。直すまでは、自動テストを Linux で動かしてください（macOS と、Windows の WSL では確かめていません）。ほかのテストのファイルも、Windows では動かしていません。

- 代役で確かめたことは、Windows で確かめたことにはなりません。代役は Windows の動きをまねるだけです。
- 常駐処理（`serve`）、ごみ箱への削除（`delete`）、ゴーストの復元など、Windows の機能が要るコマンドは、Windows 以外では理由を表示して終わります（終了コード 2）。
- `python -m pip0 search "青いグラフ"` のように、pip0 の暗号化DB を使うコマンドも、Windows 以外では使えません（DB は常駐処理 `serve` が作るため、「暗号化DB はまだありません」などと表示して終わります）。デモが検索する言葉は決まっていて、今は自分の言葉で検索を試す方法がありません。

### 3-2. Windows 11 で動かす

導入、起動、権限、ブラウザー拡張の接続、停止、復元、アンインストールの手順は [docs/setup-windows.md](docs/setup-windows.md) にまとめています。おおまかな流れは次のとおりです。

1. pip0 シェルをビルドする（`scripts\build-shell.ps1`、.NET 8 SDK が必要）
2. pip0 を導入する（`scripts\install.ps1`、管理者の権限は不要）
3. Chrome または Edge に拡張機能を読み込む（[browser-extension/README.md](browser-extension/README.md)）
4. （任意）OS のファイアウォールで pip0 の通信を遮断する（`scripts\network-policy.ps1 -Apply`、管理者）
5. pip0 を起動する（`scripts\start-pip0.cmd`）。起動すると、pip0 専用フォルダー（`%USERPROFILE%\pip0`）が、M4 のための同期ルートとして自動で登録されます（できたかは `status` で確かめます。[docs/setup-windows.md](docs/setup-windows.md) の 3-7）

機械学習モデルは使わないため、モデルの事前配置は不要です（[docs/design.md](docs/design.md) 2-1）。

## 4. コードの地図

`pip0\` の Python のファイルを、指示書2節の7つの責務に分けています。どのファイルも、先頭に役割の説明があります。

| 責務 | ファイル |
| --- | --- |
| 設定と規則（★変更しやすい） | `settings.py`（設定値）、`rules.py`（仕分けの規則、手掛かり語、機密の規則などの辞書）、`config.py`（設定の読み込みと場所の決定） |
| ファイルの監視、索引作成、メタデータ管理 | `watcher.py`（変更の監視、ダウンロード完了の確認）、`scanner.py`（索引）、`provenance.py`（入手経路）、`usage.py`（利用の記録）、`database.py`（暗号化DB）、`keystore.py`（DB の鍵） |
| ローカル解析、分類、検索順位の計算 | `analyse_text.py`（本文とタイトル）、`analyse_image.py`（色とグラフらしさ）、`sensitivity.py`（機密の判定）、`analysis_queue.py`（解析の順番待ち）、`inflow.py`・`naming.py`（M1）、`desk.py`（M2）、`search.py`（M3）、`timeutil.py`（現地時刻と、「先週」「今年度」などの時期の言葉。M3 とデモで使う）、`hazard.py`（M5） |
| 移動、リネーム、退避、復元、ごみ箱への移動 | `fileops.py`（移動・改名）、`safe_names.py`（Windows で使える名前）、`fsutil.py`（上書きしない改名など）、`vault.py`（退避と復元）、`evacuation.py`（退避してよいかの判断）、`killswitch.py`（全復元）、`trash.py`（ごみ箱） |
| 電源状態とアイドル状態による処理制御 | `throttle.py` |
| 作業文脈の取得と常駐UI | `context.py`（作業文脈）、`ui.py`（表示の指示）、C# の `shell\Ui\`・`shell\Context\` |
| OS 固有のファイル提供機構、権限、ドラッグ操作等への連携 | `platform_windows.py`（Windows の機能）、`platform_fake.py`（テスト用の代役）、`shell_link.py`（シェルとの通信）、C# の `shell\CloudFiles\`・`shell\Trash\`・`shell\Input\` |
| ブラウザー拡張と端末内連携 | `native_host.py`（受け口）、`browser-extension\`、`native-host\` |
| 全体の進行 | `service.py`（常駐処理）、`cli.py`（コマンド、`python -m pip0 <コマンド>`。入口は `__main__.py`）、`netguard.py`（外部通信の禁止）、`demo_data.py`（ダミーデータ） |

このフォルダー（`projects\pip0`）の一番上のファイル：

| ファイル | 内容 |
| --- | --- |
| `pyproject.toml` | 必要な Python の版（3.11 以上）と、pytest の設定（`tests\` のテストを探し、このフォルダーから `pip0` を読み込む） |
| `requirements.txt` | pip0 が使うライブラリと版（Windows 以外でデモとテストを動かすとき。3-1） |
| `requirements-dev.txt` | テストのためのライブラリ（pytest） |
| `requirements-windows-cp313.txt` | Windows に導入するときのライブラリ（版とハッシュを固定。`scripts\install.ps1` が使う） |
| `CLAUDE_CODE_PROMPT.md` | この初期コードの作成指示（仕様）と、確認した事項への回答 |

そのほかのフォルダー：

| フォルダー | 内容 |
| --- | --- |
| `tests\` | 自動テスト（pytest）。代役の OS 連携と一時フォルダーだけを使います |
| `shell\` | pip0 シェル（C#、.NET 8、WPF）。説明は [shell/README.md](shell/README.md) |
| `browser-extension\` | Chrome／Edge 共通の拡張機能。説明は [browser-extension/README.md](browser-extension/README.md) |
| `native-host\` | ブラウザーが受け口を起動するための設定。説明は [native-host/README.md](native-host/README.md) |
| `scripts\` | 導入、ファイアウォール、全復元、起動、アンインストールのスクリプト（Windows） |
| `docs\` | 設計、通信の取り決め、導入の手順、外部通信、ダミーデータ、実装状況、確認の記録 |

### 4-1. どこから読むか

初めて読むときは、次の順がおすすめです。

1. この README の1〜3節を読み、`python -m pip0 demo` を動かして、表示を見る
2. [docs/test-data.md](docs/test-data.md)：デモのダミーのファイルと、期待する結果
3. `pip0/settings.py`（設定値）と `pip0/rules.py`（規則と辞書）：★の値を変えて、デモの結果がどう変わるかを見る（デモに出るのは、検索・機密の判定・改名の提案に関係する値だけです。ほかの値の確かめ方は 5-4）
4. 機能ごとの入口の関数

   | 機能 | 入口 |
   | --- | --- |
   | M1 | `inflow.py` の `build_proposal`（提案を作る）と `MiniDock`（3秒の表示）、`naming.py` の `propose_name`（新しい名前） |
   | M2 | `context.py` の `parse_foreground`（作業文脈）、`desk.py` の `rank_files`（上位3件） |
   | M3 | `search.py` の `search`（`parse_query` で手掛かりに分け、`check_cue` で照合する） |
   | M4 | `usage.py` の `judge_long_unread`（長期間未読）、`evacuation.py` の `find_candidates`、`vault.py` の `evacuate` と `restore` |
   | M5 | `sensitivity.py` の `overall`（機密の判定）、`hazard.py` の `evaluate_items` と `HazardSession`（警告と消音） |

5. 同じ名前のテスト（`tests/test_search.py` など）：関数に何を渡すと、何が返るかの例になっています
6. 全体のつながり：`service.py`（常駐処理のメインループ）と [docs/design.md](docs/design.md)

## 5. 変えて試す（学生が変更しやすい箇所）

コードの中で「★」の付いた場所が、変えて試しやすいところです。

### 5-1. 改善の種類を分ける

pip0 の改善は、次の3種類に分けて考えます。種類によって、変えるものと確かめ方が違います。

| 改善の種類 | 変えるもの | 変わること | 確かめ方 |
| --- | --- | --- | --- |
| データ・設定値の改善 | `settings.py` の値、`rules.py` の規則と辞書、ダミーデータ（Windows に導入した後の `config.json` は 5-2） | 処理の手順は同じで、使う値だけが変わる | `python -m pip0 demo` と `python -m pytest` で、変える前と同じ条件の結果と比べる（デモに出ない値もある。5-4。初期値を確かめるテストは、値を変えると失敗する。5-2） |
| Python の処理の改善 | `search.py`、`inflow.py`、`naming.py` などの関数 | 同じ入力に対する結果の出し方が変わる | 変えた動きを確かめるテストを `tests/` に加える（変える前のコードでは失敗するテストにする） |
| AI への指示の改善 | 無料の AI（生成AI）にコードの修正を頼むときの、頼み方の文 | pip0 の動きは、それだけでは変わらない | AI が作った変更を、上の2つと同じ方法で確かめる |

pip0 は、動いている間に生成AIを使いません（ファイルの中身や画面の情報を AI に送らない設計です）。そのため、「AI への指示（プロンプト）を変えて、pip0 の判定を良くする」という改善はありません。AI への指示を工夫するのは、コードの修正を AI に頼むときです（5-5）。

### 5-2. 設定値を変える（`settings.py` と `config.json`）

- `pip0/settings.py` の大文字の名前が、設定の初期値です。デモと自動テストは、この値を使います（`config.json` は読みません）。変えたら `python -m pip0 demo` と `python -m pytest` で確かめます。
- 仕様で決まっている値があります。`MINI_DOCK_SECONDS`（3秒）、`DESK_MAX_ITEMS`（上位3件）、`HEAVY_IDLE_SECONDS`（180秒＝3分間無操作）を変えると、仕様から外れます。保管庫を pip0 専用フォルダーの中に置くなど、危険な場所の組み合わせにすると、pip0 は起動しません。
- **値を変えると失敗するテストがあります。** いくつかのテストは、仕様の値や初期値（`MINI_DOCK_SECONDS` の3秒、`HEAVY_IDLE_SECONDS` の180秒、`UNREAD_DAYS` の90日など）を前提にしています。たとえば `MINI_DOCK_SECONDS` を 5.0 にすると、`tests/test_inflow.py` と `tests/test_service.py` の 30 件が、`assert 5.0 == 3.0` のような表示で失敗します（デモの表示は変わりません）。失敗の表示を読み、古い値を確かめているだけなら、変更の一部として、そのテストの期待する値も直します（仕様の値を変えたときは、仕様から外れることも書き残します）。古い値と関係のない失敗は、変更で壊れたところです。
- Windows に導入した後は、導入先の `settings.py` ではなく、データのフォルダーの `config.json`（`%LOCALAPPDATA%\pip0\config.json`）に、変えたい名前と値だけを書きます（導入し直すと、導入先の中身は入れ替わるためです）。pip0 を起動し直すと効きます。効いたかは、pip0 の動きと、導入先の Python での `-I -m pip0 status` で確かめます（[docs/setup-windows.md](docs/setup-windows.md) の4節。デモと自動テストには表れません）。

  ```json
  {
    "AUTO_EVACUATE_ENABLED": false,
    "RECENT_DAYS": 7
  }
  ```

- `config.json` に書けるのは、`settings.py` にある大文字の名前だけです（ほかの名前は使わず、`status` に注意が出ます）。文字コードは UTF-8 です（BOM があってもよい。詳しくは [docs/setup-windows.md](docs/setup-windows.md) の 3-3、[docs/design.md](docs/design.md) 6-1）。
- Windows 以外では、`python -m pip0 --data-dir <フォルダー> status` で、そのフォルダーの `config.json` の名前と形の誤りだけを確かめられます（値の効き目は見えません）。

### 5-3. ダミーデータ（サンプルのファイル）を変える

- リポジトリーには、サンプルの画像や文書を置いていません。`python -m pip0 demo` のたびに、`pip0/demo_data.py` の `demo_files()` が、空のフォルダーの中にダミーのファイルを作ります。
- ファイルを足す・変えるときは、期待する結果（`expected_results()`、「ほかにも試せる検索」は `other_expected_results()`）も直します。`tests/test_demo_data.py` にも、ファイルの一覧と件数（10件のそれぞれの機密の判定、「記録がないファイルが 6 件」、索引と解析の 10 件など）が書いてあるので、合わせて直します。
- 確かめるときは、`python -m pytest -q tests/test_demo_data.py` を、ファイル全体で実行します（デモは、動かした日の日付で1回だけ試しますが、このテストは月の初め・月の終わり・年の初めなど、いくつかの日付で試します）。
- 検索の結果は `SEARCH_MAX_RESULTS`（10件）で切られます。ファイルが10件を超えると、日付によっては「先月の予算」の一部一致から予算の文書が外れ、テストが失敗します。10件までにするか、`demo_data.py` の `demo_config_overrides` で `SEARCH_MAX_RESULTS` を増やします。
- 日付で答えが変わる検索の期待は、決まった日付で書かず、動かした日時（`manifest["now"]`）から計算します（[docs/test-data.md](docs/test-data.md) の9節）。
- 学生の氏名・学籍番号などの個人情報や、本物の個人番号・カード番号は、ダミーデータにも入れません。

### 5-4. 変えたいことと場所

| 変えたいこと | 場所 | 改善の種類 |
| --- | --- | --- |
| 仕分け先と、その手掛かりの語 | `rules.py` の `SORT_RULES` | データ（規則） |
| 「意味の分からない名前」の見分け方 | `rules.py` の `MEANINGLESS_NAME_PATTERNS` | データ（規則） |
| 送信元の名前（例：files.slack.com → Slack） | `rules.py` の `SOURCE_RULES` | データ（規則） |
| Slack のウィンドウタイトルの読み方 | `rules.py` の `SLACK_TITLE_PATTERNS` | データ（規則）。実機のタイトルを見て直す |
| 検索の手掛かり語（色、グラフ、資料、入手経路） | `rules.py` の `COLOUR_WORDS`、`VISUAL_KIND_WORDS`、`DOC_KIND_WORDS`、`SOURCE_WORDS` | データ（辞書） |
| デスクの文脈の語から除く語（アプリの名前、the・and などの英語の機能語） | `rules.py` の `CONTEXT_STOP_WORDS` | データ（辞書） |
| ひらがなを含んでも1つの語として残す語（「打ち合わせ」など） | `context.py` の `KEEP_WHOLE_WORDS` | データ（辞書） |
| 機密とみなす語やラベル | `rules.py` の `SENSITIVE_NAME_KEYWORDS`、`SENSITIVE_CONTENT_KEYWORDS`、`SENSITIVE_LABEL_KEYWORDS` ほか | データ（規則）。語を外すと、すぐに効きます。中身の語を加えると、タイトル・ラベル・保存した本文の先頭では、すぐに効きます。ほかの解析済みの文書は、解析し直すまで「未判定」になります（解析し直しを自動で始める処理は、まだ常駐処理に組み込んでいません） |
| ミニドックの秒数、デスクの件数・透け方、シェイクの感度、退避までの日数、PDF を読むページ数（`PDF_MAX_PAGES`。増やすと機密の判定の範囲が広がり、解析に時間がかかる） | `settings.py` | 設定値 |
| 年度の始まりの月（「今年度」「昨年度」の範囲） | `settings.py` の `FISCAL_YEAR_START_MONTH` | 設定値 |
| 時期の言葉（「先週」「今年度」など）と、その範囲の決め方 | `timeutil.py` の `FIXED_WORDS`（言葉の一覧）と `find_period`（範囲の計算） | データ（一覧）／Python の処理 |
| デスクが本文を調べる文字数と、1回に読む本文の数 | `desk.py` の `TEXT_CHECK_CHARS`、`TEXT_LOADS_PER_RANKING` | 設定値（コードの中の値） |
| 機密の判定のために読む場所と量 | `analyse_text.py` の `EXTRA_PARTS`（読む部品）、`CHECK_MAX_CHARS`（読む文字数の目安）、`EXCEL_NUMBER_MIN_DIGITS`（調べる数値の桁数） | データ（一覧）／設定値（コードの中の値） |
| 全復元のコマンドが、進み具合の変わらないまま待つ秒数 | `cli.py` の `RESTORE_QUIET_SECONDS` | 設定値（コードの中の値） |
| 新しい名前の組み立て方 | `naming.py` の `propose_name` | Python の処理 |
| 仕分け先の点数の付け方 | `inflow.py` の `score_rules` | Python の処理 |
| デスクに出す順位の計算 | `desk.py` の `rank_files` | Python の処理 |
| 語の分け方（文脈の語と検索の言葉） | `context.py` の `split_words` | Python の処理 |
| 検索の手掛かりの照合と、理由の文 | `search.py` | Python の処理 |
| 「長期間未読」の判定 | `usage.py` の `judge_long_unread` | Python の処理 |
| ダミーデータと期待する結果 | `demo_data.py`、[docs/test-data.md](docs/test-data.md) | データ |

**変えた結果の見え方**：デモの表示が変わるのは、デモの検索の言葉（[docs/test-data.md](docs/test-data.md) の5節と7節）、機密の判定、改名の提案に関係する値だけです（例：`COLOUR_WORDS` などの検索の辞書、`SOURCE_RULES`、`COLOUR_MIN_SHARE`・`CHART_MIN_SCORE`・`WEEK_STARTS_ON`、`SENSITIVE_NAME_KEYWORDS` などの機密の規則、`MEANINGLESS_NAME_PATTERNS`、`CONTENT_MAX_CHARS`）。改名の提案は表示だけで、期待とは比べません（3-1）。次の値は、デモには出ません。`tests/` の同じ名前のテストか、関数を直接呼んで確かめます。

- 仕分け（`SORT_RULES`、`SORT_MIN_SCORE`）
- M2 の文脈とデスク（`CONTEXT_STOP_WORDS`、`APP_RULES`、`SLACK_TITLE_PATTERNS`、`KEEP_WHOLE_WORDS`、デスクとシェイクの値）
- M4 の退避（`UNREAD_DAYS` など）、ミニドックの時間（`MINI_DOCK_SECONDS` など）
- `SENSITIVE_DIRS`（デモは、作ったフォルダーの中だけを使うため、この設定を使いません）

たとえば仕分けの規則は、`projects/pip0` で Python を起動して、`inflow.score_rules` を直接呼ぶと試せます。

```python
from pip0 import inflow, rules

texts = {"name": "2026年度_予算案.xlsx", "title": None, "page_title": None}
for item in inflow.score_rules(texts, None, ".xlsx", rules):
    print(item["rule"], item["score"], item["reasons"])
```

今の規則では、最初の行が `予算・会計 3 ['ファイル名に「予算」（+2）', '拡張子が .xlsx（+1）']` になります（点数が `SORT_MIN_SCORE`（2）以上で一番高い規則が、仕分け先の提案になります）。`SORT_RULES` を変えたら、Python を起動し直して、同じように試します。

### 5-5. AI に修正を頼むとき（AI への指示の改善）

無料の AI にコードの修正を頼むときは、次のことを指示に入れると、確かめやすい変更が返ってきます。

- 変えたいファイルと関数（または設定値・規則）の名前と、改善の種類（5-1 のどれか）
- 守ってほしい約束（次の6節。特に、外部への通信とファイルの完全削除を加えないこと）
- 確かめる方法：変えた動きを確かめるテストを `tests/` に加えること、`python -m pip0 demo` と `python -m pytest` を実行すること
- 関係のないファイルは変えないこと、確かめられなかったことは、そう書くこと

たとえば「`pip0/rules.py` の `SORT_RULES` に『就職活動』の規則を加え（データの改善）、`tests/test_inflow.py` に、その規則で仕分けられることを確かめるテストを加えてください。外部への通信やファイルの完全削除は加えないでください」のように頼みます。AI の答えは、そのまま信じず、テストとデモで確かめてください。

## 6. 安全のための約束

変更するときも、次の約束を守ってください。`tests/test_safety_static.py` などのテストが、一部を自動で確かめます。

- **完全な削除をしない**：pip0 がファイルを消すのは、ユーザーが確認画面で承認したときに、Windows のごみ箱へ移すときだけです。ごみ箱を使えない場所では削除しません。ごみ箱を空にする機能はありません。
- **上書きしない**：移動・改名・復元で、既存のファイルを上書きしません。同じ名前があれば「 (2)」などを付けます。
- **保管庫を消さない**：退避したファイルの本体（`vault\items\<項目ID>\content`）と復元の情報（`manifest.json`）は、自動で消しません。
- **外部と通信しない**：pip0 本体、シェル、拡張機能は、処理したデータを外へ送りません。拡張機能と本体のやり取りは、同じ PC の中の Native Messaging だけです。
- **画面を記録しない**：作業文脈（ウィンドウタイトル等）は、その場で使うだけで保存しません。スクリーンショットは撮りません。ブラウザー拡張が送る「ダウンロード開始時に前面だったタブ」の題名と URL は、ダウンロードのファイルと結び付けるまでだけ暗号化DB に置き、結び付けたら消します。結び付かなかった記録は、pip0 が動いている間は、受け取ってから約24時間で行ごと消します（1時間ごとに見直すため、遅いと約25時間）。pip0 が止まっている間も、ブラウザーは受け口を起動して記録を書きます。その記録は、次に pip0 を起動するまで残ります（起動したときに、24時間を過ぎたものを消します）。ダウンロードフォルダーの外へ保存したものは、記録しません。
- **テストで本物のフォルダーを使わない**：テストとデモは、一時フォルダーとダミーのファイルだけを使います。
- **秘密情報と個人情報を登録しない**：APIキー、パスワード、学籍番号、氏名をコードやデータに入れません。

## 7. 制約と注意

- 対象は **Windows 11（x64）** です。macOS と Windows 10 は対象外です。
- **Windows 11 の実機では確かめていません**。実機で動かしたら、[docs/status.md](docs/status.md) と [docs/verification.md](docs/verification.md) を更新してください。
- **M4 のゴーストは、pip0 専用フォルダー（`%USERPROFILE%\pip0`）の中だけ**です。ほかの場所、OneDrive などの同期フォルダー、NTFS 以外のドライブ（exFAT の USB メモリなど）のファイルは退避せず、理由を表示します。「0バイト」はディスク上の大きさのことで、エクスプローラーの「サイズ」欄は元の値のままです。保管庫が同じドライブにあると、退避しても空き容量はほとんど増えません。
- M1 が自動で仕分け・改名するのは、ダウンロードフォルダーの**直下**に保存されたダウンロードだけです（ブラウザー拡張の記録があれば、その場所のファイルも）。zip の「すべて展開」でできたフォルダーや、コピーしたフォルダーの中身は動かしません。改名するのは、`download (3)`、`IMG_0001` のような機械が付けた名前だけです。拡張子のないファイルには、拡張子を付けません。
- M1 は、画面を見られない間（pip0 シェルが動いていない、画面のロック中・スリープ中）に完了したダウンロードを、自動で仕分け・改名しません。見られるようになってから、ミニドックに出します。pip0 シェルが落ちている間にロックを解除したときは、待たせたままになることがあります（状態の画面の理由に従い、いったんロックして解除します）。
- **検索と分類は、機械学習を使わない簡単な方法**です。「青いグラフ」は画像の色の割合と形の特徴、「予算資料」は本文とタイトルの語で判定します。写真に写った物の認識や、言い換えには対応していません。語は、空白・記号・文字の種類・ひらがなの所で分けるだけです（形態素解析はしないので、「年度予算」のような漢字の複合語や、`BudgetPlan` のような大文字で区切った名前は分けません）。
- **M5 の機密の判定のうち、中身の判定は、解析で読んだ文字だけ**で行います（名前とフォルダーの規則（`SENSITIVE_NAME_KEYWORDS`、`SENSITIVE_DIRS`）は、解析していなくても効きます）。本文のほか、Word のヘッダー・フッター・透かし、PowerPoint のノート・マスター、Excel のヘッダー・フッター、PDF の注釈・フォームの入力欄も読みます。グラフ、SmartArt、埋め込まれたファイル、Excel のコメント・図形、PowerPoint のコメント、画像の中の文字（スキャンしたページを含む）は調べません。PDF は先頭の `PDF_MAX_PAGES`（20）ページまでしか読まず、それより長い PDF は、読んだ範囲で機密の理由が見つからなければ「未判定」（既定では橙の枠）になります。
- Slack のチャット相手は、ウィンドウタイトルが `rules.py` の形に合うときだけ読み取ります（形は実機で未確認）。読めないときは「取得不可」と表示します。
- ドラッグの検知は、エクスプローラー（デスクトップを含む）と pip0 のデスクから始まるドラッグだけです。メールの添付などからのドラッグは対象外です。M5 は警告だけで、送信を止める機能はありません。
- ファイルを開く画面への表示は、画面の上辺に合わせてデスクを出し、候補を選ぶとファイル名の欄にパスを入れる方式です。画面の中に部品を入れることはしません。
- ミニドックとデスクの「開く」ボタンで開くのは、文書・画像・音声・動画・zip の決まった種類だけです（`.exe`、`.py`、マクロ付きの形式の Office ファイル（`.docm`、`.xlsm`、`.pptm` など）のように、プログラムが動く種類は開かず、エクスプローラーで場所を開くよう案内します。一覧は `shell/Ui/OpenableFile.cs`）。ただし、古い形式の `.doc`・`.xls`・`.ppt` は開きます。これらにもマクロを入れられます。マクロを動かすかどうかは、Office の設定（保護ビュー、マクロの設定）に任せていて、pip0 は確かめていません。
- ミニドック、デスク、警告の枠は、画面共有や録画に映らないように設定しています（Windows 10 2004 以降の機能。実機では未確認）。

## 8. 文書

| 文書 | 内容 |
| --- | --- |
| [CLAUDE_CODE_PROMPT.md](CLAUDE_CODE_PROMPT.md) | この初期コードの作成指示（仕様）と、作業開始時に確認した事項への回答 |
| [docs/design.md](docs/design.md) | 構成、採用技術と理由、機能ごとの決めごと、モジュールの約束、保管庫の形式 |
| [docs/ipc-protocol.md](docs/ipc-protocol.md) | 本体とシェル、拡張機能と受け口のやり取りの形 |
| [docs/setup-windows.md](docs/setup-windows.md) | Windows 11 での導入、起動、権限、復元、アンインストール |
| [docs/network.md](docs/network.md) | 外部通信の禁止（コードの確認と、OS による遮断の確認） |
| [docs/test-data.md](docs/test-data.md) | ダミーデータと、検索の3例・「ほかにも試せる検索」・機密の判定・改名の提案の期待する結果 |
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
| Windows SDK の .NET 向けの宣言（Microsoft.Windows.SDK.NET.Ref、WinRT.Runtime） | pip0 シェル（同期ルートの登録などの WinRT の API。`Pip0Shell.exe` に含まれる） | Windows SDK のライセンス（https://aka.ms/WinSDKLicenseURL） |
| CsWin32 | pip0 シェルのビルド（Win32 API の宣言の生成。実行時には含まれない） | MIT |
| Python 埋め込み用配布物 3.13.17 | Windows での pip0 専用の Python | Python Software Foundation License |

- Windows、Chrome、Edge の機能の使い方は、各社の公式資料を参考にしました（資料の一覧は [docs/setup-windows.md](docs/setup-windows.md) の最後、[docs/network.md](docs/network.md)・[browser-extension/README.md](browser-extension/README.md)・[native-host/README.md](native-host/README.md) の「参考資料」、パッケージの利用条件は [shell/README.md](shell/README.md) の「利用しているもの」）。
- Slack については、公式資料を使っていません。Slack のウィンドウタイトルの読み方（`rules.py` の `SLACK_TITLE_PATTERNS`）は、想定した形です。実機の Slack で確かめて、直す必要があります。
