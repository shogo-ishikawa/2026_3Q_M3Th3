# 確認の記録（2026-11-01）

この初期コードについて、**実際に行った確認**と、**行っていない確認**を分けて記録します。
機能ごとの対応は [status.md](status.md) にあります。

**Windows 11 の実機では、まだ一度も動かしていません。** ここに書いた確認は、すべて Linux の作業環境で行ったものです。

## 1. 行った場所

| もの | 版 |
| --- | --- |
| OS | Linux（クラウドの作業環境。Windows ではない） |
| Python | 3.11.17、3.12.3、3.13.17（それぞれ別の仮想環境） |
| ライブラリ | `requirements.txt` の版（sqlcipher3 0.6.4、keyring 25.7.0、watchdog 6.0.0、pillow 13.0.0、pypdf 6.21.4）、pytest 9.2.0 |
| SQLCipher | 4.19.0 community（`sqlcipher3` 0.6.4） |
| .NET SDK | 8.0.427（`Pip0Shell.exe` を `win-x64` 向けにビルド。Linux では起動できない） |
| Node.js | 22.22.0（拡張機能のテスト） |
| ブラウザー | Chrome for Testing 153.0.8010.12（Linux、Playwright で起動） |
| PowerShell | 7.4.6（スクリプトの構文と関数の確認。2026-10-30 に行ったもの。Windows PowerShell 5.1 では動かしていない） |

## 2. 行った確認と結果

### 2-1. Python の自動テスト（`python -m pytest`）

- 対象：`tests/` のすべて（ファイル内容の保全、削除の確認、途中の失敗からの復元、暗号化、検索の根拠、条件付きの高負荷処理、常駐処理、コマンドなど）。
- OS の機能は代役（`pip0/platform_fake.py`）、ファイルはテストごとに作る一時フォルダーの中のダミーだけを使います。本物のデスクトップやダウンロードには触れません。
- `pip0/platform_windows.py` のうち、Windows の API を呼ばずに試せる部分（属性の値からの判定、答えの読み取り、答えが遅れた印など）は、Linux でもテストしています。Windows の API を呼ぶ部分は、Windows でしか動きません。
- 結果：Python 3.11／3.12／3.13 のそれぞれで、**全件成功**（件数は 5節）。
- [README.md](../README.md) の 3-1 の手順（新しく作った仮想環境に `requirements.txt` と `requirements-dev.txt` を入れる）でも、デモと自動テストが動くことを確かめました（2026-11-01、Linux の Python 3.13.17）。仮想環境を使わずに Linux の PC の Python（Ubuntu 24.04 の Python 3.12）に入れようとすると、`externally-managed-environment` で止まりました。
- Windows の Python をまねた確認（2026-11-01）：Linux で `time.tzset` をなくして動かすと、`tests/test_base.py`、`tests/test_demo_data.py`、`tests/test_desk.py`、`tests/test_search.py` で、167 件がエラー、1 件が失敗になりました（Windows の Python には `time.tzset` がないため）。直すまでは、自動テストは Windows の Python では最後まで動きません。

### 2-2. デモ（`python -m pip0 demo`）

- ダミーデータで、検索の3例（「青いグラフ」「Slackで貰った」「先週の予算資料」）、「ほかにも試せる検索」、M5 の機密の判定を行い、期待する結果（[test-data.md](test-data.md)）と一致するかを表示します。
- M1 の改名の提案も表示しますが、デモは期待と比べません（「結果：すべて期待どおりです」にも含まれません）。期待する名前は [test-data.md](test-data.md) の8節で、2026-11-01 の表示と同じであることを目で確かめました。
- 「先月の予算」のように、動かした日付で答えが変わる検索の期待は、動かした日時から計算します。月の初め・月の終わり・年の初めの日付でも、自動テスト（`tests/test_demo_data.py`）で確かめています。
- 結果：すべて期待どおり（5節）。

### 2-3. pip0 シェル（C#）

- `dotnet build shell/Pip0Shell.csproj -c Release`：警告 0、エラー 0。
- `dotnet run --project shell/Checks/Pip0Shell.Checks.csproj -c Release`：OS を使わない部分（やり取りの形、表示の文、保管庫の内容の確かめ方、範囲の計算、開いてよいファイルの種類など）の確認。結果は 5節。
- Windows の API（Cloud Files、IFileOperation、フック、UI Automation、WPF の画面、画面の取り込みから外す設定）は、ビルドが通ることを確かめただけで、**動かしていません**。

### 2-4. ブラウザー拡張

- `node --test browser-extension/tests`：URL と題名の整え方、送るメッセージの形、manifest の権限、通信の機能がないこと、受け口の設定ファイル。結果は 5節。
- 通し確認（Linux の Chromium）：拡張機能を読み込んだ Chromium で、ローカルのテスト用サーバーからファイルをダウンロードし、本物の受け口（`pip0.native_host`）が暗号化DB に記録することを確かめました（最後に行ったのは 2026-11-01）。
  - URL の `?token=…` と `#…` は記録に残らない
  - DB のファイルの中に、URL・ファイル名・ページ題名が平文で残らない（平文の SQLite の印もない）
  - 確認用の受け口の設定では、Playwright が保存する一時フォルダーを「ダウンロードフォルダー」とみなした（ダウンロードフォルダーの外への保存を記録しないことは、自動テストで確かめた）
- Chrome と Edge（Windows）での読み込みと接続は、**確かめていません**。

### 2-5. スクリプト

- PowerShell 7 の構文解析、Windows PowerShell 5.1 で使えない書き方がないこと、Windows のコマンドを代役にした関数の確認（[setup-windows.md](setup-windows.md) の12節）。どれも 2026-10-30 に行ったもので、記録が残っているのは、スクリプトを最後に直す（コミット fb292b8、2026-10-30）前の版に対する確認です。
- 直した後（fb292b8 と、それより後の修正）には、スクリプトの確認をやり直していません。直したときに加えた動き（`install.ps1` の入れ替えの前の確認、`uninstall.ps1` の項目ID の名前でないフォルダーの扱い等）は、確認済みとしていません（[setup-windows.md](setup-windows.md) の12節）。
- 確認に使った道具（Windows のコマンドを代役に置き換える PowerShell のスクリプト）は、リポジトリーに入れていません。そのため、この確認は、リポジトリーの中のものだけではくり返せません。
- `restore-all.cmd`、`start-pip0.cmd`、`pip0-native-host.bat` の形（文字コード、改行）。2026-11-01 にも、今の版で確かめました（UTF-8・BOM なし、取り出したときの改行が CRLF、`.cmd` は `chcp.com 65001` の行まで ASCII だけ、`.bat` はすべて ASCII）。cmd.exe では動かしていません。

### 2-6. 外部通信の禁止（コードの確認）

- `git grep` と自動テスト（`tests/test_safety_static.py`）で、通信のライブラリの読み込みが、自己点検（`netguard.py`）と URL の分解（`provenance.py` の `urllib.parse`）以外にないことを確かめました（[network.md](network.md)）。
- `python -m pip0 check-network`：pip0 のプロセスの中で、接続・名前解決・HTTP・許可していない外部コマンドの起動が止まることを確かめました。
- **OS のファイアウォールで遮断できたこと（`scripts\network-policy.ps1`）は、確かめていません。**

### 2-7. レビュー（AI のレビュー役による）

作った担当とは別の担当（AI のレビュー役）が、分野ごとに独立にコードを読んで、不具合と、説明の言い過ぎを探しました。

- 1回目のレビュー：データの保全、セキュリティとプライバシー、C# の Windows API の使い方、Windows だけで動く Python、スクリプト。
- 2回目のレビュー：機能の判断の処理（M1〜M5）、常駐処理とコマンド、常駐処理のプライバシーと安全。
- 修正のレビュー：1回目の指摘を直したコード（修正そのもの）を、別のレビュー役がもう一度読みました。
- 修正の確認：2回目と、修正のレビューで見つかった点を直した後、直した結果をもう一度読み、そこで見つかった点も直しました。
- 見つかった点は、コードで確かめてから直し、直したことを確かめるテスト（直す前のコードでは失敗するもの）を加えました。例：「開く」ボタンを文書・画像などの許可した種類だけにした、ゴーストかどうか分からないときに「通常のファイル」と答えない、BOM 付きの config.json を読む、1970年より前の日時、拡張機能の記録のうち画面の文脈を残さない、文書のヘッダー・フッターなどを読まずに「非機密」としない、画面を見られない間にダウンロードを自動で動かさない、全復元の依頼に番号を付ける。
- 一部は、範囲を絞って直し、残りを [status.md](status.md) の「残っていること」と7節に書きました（例：時計は戻されたときだけ直し、進んだときは直さない。規則を変えた後に解析し直す関数は、まだ常駐処理から呼んでいない）。
- 2026-10-30 に、スクリプトと C# を直した後に行うはずだった確認の一部が、途中で中断しました。どの確認が中断したかの記録は残っていません。C# は、2026-11-01 にビルドと `shell/Checks` を行いました（5節）。スクリプトは、直した後に確認をやり直した記録がないため、直したときに加えた動きを確認済みとしていません（2-5、[setup-windows.md](setup-windows.md) の12節）。
- レビュー役も AI で、Windows の実機は使っていません。レビューは、実機での確認の代わりにはなりません。

## 3. 行っていない確認（Windows 11 の実機が必要）

次のことは、**一度も確かめていません**。実機で確かめたら、この文書と [status.md](status.md) を更新してください。修正で加えた決まりのうち、実機でしか確かめられないものの一覧は [status.md](status.md) の6節にあります。

- 導入（`install.ps1`）、起動（`start-pip0.cmd`）、アンインストール（`uninstall.ps1`）
- Windows の Python での自動テストとデモ（自動テストの一部は、Windows にない `time.tzset` を使うため、今は動かない。2-1）
- pip0 シェルの起動と、本体とのやり取り
- Cloud Files API：同期ルートの登録、ゴースト化、ゴーストを普通のアプリで開く、開くまでの時間、通常のファイルへの戻し、移動・削除・フォルダーの名前の変更の追跡（終わりの知らせ、`cf.locate`）、読み取り専用のファイルを断る理由、「常にこのデバイス上に保持する」の属性の値
- ごみ箱：確認画面、ごみ箱への移動、ごみ箱に入らない場合の中止
- 前面のウィンドウ・ドラッグ・マウスの位置のフック、UI Automation でのファイル名の入力、Slack の実際のウィンドウタイトル
- ミニドック・デスク・警告の枠の表示、透過、シェイク、画面共有に写らない設定
- 画面のロック・スリープの知らせと、その間のダウンロードの扱い。サインアウト・シャットダウンを取り消した後のシェル
- 電源と無操作の時間（`GetSystemPowerStatus`、`GetLastInputInfo`）の実際の値
- 資格情報マネージャーへの鍵の保存、Windows 版の SQLCipher
- Chrome と Edge での拡張機能と受け口の接続
- OS のファイアウォールでの遮断
- 権限がない・取り消された状態での表示

## 4. 確かめるときの手順

| 確かめること | 手順 |
| --- | --- |
| 自動テスト | `cd projects/pip0`、仮想環境に入る（[README.md](../README.md) の 3-1）、`python -m pytest -q`（今は Linux で） |
| デモ | `python -m pip0 demo`（M1 の改名の提案は、[test-data.md](test-data.md) の8節と目で比べる） |
| シェルのビルドと確認 | `dotnet build shell/Pip0Shell.csproj -c Release`、`dotnet run --project shell/Checks/Pip0Shell.Checks.csproj -c Release` |
| 拡張機能のテスト | `node --test browser-extension/tests` |
| 外部通信の禁止 | [network.md](network.md) の2節と3節 |
| スクリプト | Linux での関数の確認（2-5）に使った道具は、リポジトリーに入れていないため、ここに手順を書けません。Windows 11 の実機で、[setup-windows.md](setup-windows.md) の手順を実行して確かめます |
| Windows 11 の実機 | [setup-windows.md](setup-windows.md) の手順で導入し、[status.md](status.md) の W の項目を順に |

## 5. 件数（最後に行ったとき）

| 確認 | 結果 |
| --- | --- |
| 自動テスト（Python 3.11.17） | 1314 件すべて成功 |
| 自動テスト（Python 3.12.3） | 1314 件すべて成功 |
| 自動テスト（Python 3.13.17） | 1314 件すべて成功（この文書を書くときに、もう一度実行して同じ結果。約 70 秒） |
| デモ（`python -m pip0 demo`） | 検索の3例、「ほかにも試せる検索」、機密の判定のすべてが期待どおり（この文書を書くときに、2026-11-01 の日付でもう一度実行して同じ結果。終了コード 0）。M1 の改名の提案は、デモでは比べていない（[test-data.md](test-data.md) の8節と同じであることを目で確かめた） |
| pip0 シェルのビルド（`dotnet build -c Release`） | 警告 0、エラー 0 |
| `shell/Checks`（OS を使わない部分の確認） | 293 件すべて成功 |
| 拡張機能のテスト（`node --test browser-extension/tests`） | 70 件すべて成功（この文書を書くときに、もう一度実行して同じ結果） |
| 拡張機能 → 受け口 → 暗号化DB の通し確認（Linux の Chromium） | 1回（2026-11-01）。記録は1件で、URL の `?` 以降と `#` 以降は残らず、DB のファイルに平文なし |
| `python -m pip0 check-network` | 名前解決・接続・HTTP・外部コマンドの起動の4つが、すべて止まった（この文書を書くときに、もう一度実行して同じ結果。終了コード 0）。OS のファイアウォールの確認ではない |
| スクリプトの確認（PowerShell 7） | 2026-10-30。[setup-windows.md](setup-windows.md) の12節と [network.md](network.md) の7節のとおり。スクリプトを最後に直した後（fb292b8 と、それより後の修正）は、やり直していない |
| 自動テスト（Windows の Python をまねたもの。Linux で `time.tzset` をなくした Python 3.13.17） | 1314 件のうち、1144 件が成功、167 件がエラー、1 件が失敗、2 件は飛ばした（2026-11-01。4つのテストのファイルが `time.tzset` を使うため） |
| Windows 11 の実機 | なし（一度も動かしていない） |
