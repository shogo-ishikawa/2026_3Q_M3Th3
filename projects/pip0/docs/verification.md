# 確認の記録（2026-10-30）

この初期コードについて、**実際に行った確認**と、**行っていない確認**を分けて記録します。
機能ごとの対応は [status.md](status.md) にあります。

## 1. 行った場所

| もの | 版 |
| --- | --- |
| OS | Linux（クラウドの作業環境。Windows ではない） |
| Python | 3.11.17、3.12.3、3.13.17（それぞれ別の仮想環境） |
| SQLCipher | 4.19.0 community（`sqlcipher3` 0.6.4） |
| .NET SDK | 8.0.427（`Pip0Shell.exe` を `win-x64` 向けにビルド。Linux では起動できない） |
| Node.js | 22.22.0（拡張機能のテスト） |
| ブラウザー | Chrome for Testing 153.0.8010.12（Linux、Playwright で起動） |
| PowerShell | 7.4.6（スクリプトの構文と関数の確認。Windows PowerShell 5.1 では動かしていない） |

## 2. 行った確認と結果

### 2-1. Python の自動テスト（`python -m pytest`）

- 対象：`tests/` のすべて（ファイル内容の保全、削除の確認、途中の失敗からの復元、暗号化、検索の根拠、条件付きの高負荷処理、常駐処理、コマンドなど）。
- OS の機能は代役（`pip0/platform_fake.py`）、ファイルはテストごとに作る一時フォルダーの中のダミーだけを使います。本物のデスクトップやダウンロードには触れません。
- 結果：Python 3.11／3.12／3.13 のそれぞれで、**全件成功**（件数は 5節）。

### 2-2. デモ（`python -m pip0 demo`）

- ダミーデータで、検索の3例（「青いグラフ」「Slackで貰った」「先週の予算資料」）、M1 の改名の提案、M5 の機密の判定を行い、期待する結果（[test-data.md](test-data.md)）と一致することを表示します。
- 結果：すべて期待どおり（5節）。

### 2-3. pip0 シェル（C#）

- `dotnet build shell/Pip0Shell.csproj -c Release`：警告 0、エラー 0。
- `dotnet run --project shell/Checks/Pip0Shell.Checks.csproj -c Release`：OS を使わない部分（やり取りの形、表示の文、保管庫の内容の確かめ方、範囲の計算、開いてよいファイルの種類など）の確認。結果は 5節。
- Windows の API（Cloud Files、IFileOperation、フック、UI Automation、WPF の画面）は、ビルドが通ることを確かめただけで、**動かしていません**。

### 2-4. ブラウザー拡張

- `node --test browser-extension/tests`：URL と題名の整え方、送るメッセージの形、manifest の権限、通信の機能がないこと、受け口の設定ファイル。結果は 5節。
- 通し確認（Linux の Chromium）：拡張機能を読み込んだ Chromium で、ローカルのテスト用サーバーからファイルをダウンロードし、本物の受け口（`pip0.native_host`）が暗号化DB に1件記録することを確かめました。
  - URL の `?token=…` と `#…` は記録に残らない
  - DB のファイルの中に、URL・ファイル名・ページ題名が平文で残らない
  - 確認用の受け口の設定では、Playwright が保存する一時フォルダーを「ダウンロードフォルダー」とみなした（ダウンロードフォルダーの外への保存を記録しないことは、自動テストで確かめた）
- Chrome と Edge（Windows）での読み込みと接続は、**確かめていません**。

### 2-5. スクリプト

- PowerShell 7 の構文解析、Windows PowerShell 5.1 で使えない書き方がないこと、Windows のコマンドを代役にした関数の確認（[setup-windows.md](setup-windows.md) の12節）。
- `restore-all.cmd`、`start-pip0.cmd`、`pip0-native-host.bat` の形（文字コード、改行）。cmd.exe では動かしていません。

### 2-6. 外部通信の禁止（コードの確認）

- `git grep` と自動テスト（`tests/test_safety_static.py`）で、通信のライブラリの読み込みが、自己点検（`netguard.py`）と URL の分解（`provenance.py` の `urllib.parse`）以外にないことを確かめました（[network.md](network.md)）。
- `python -m pip0 check-network`：pip0 のプロセスの中で、接続・名前解決・HTTP・許可していない外部コマンドの起動が止まることを確かめました。
- **OS のファイアウォールで遮断できたこと（`scripts\network-policy.ps1`）は、確かめていません。**

### 2-7. 敵対的なレビュー

- 作業の途中で、別の担当（AI のレビュー役）が、データの保全、セキュリティとプライバシー、C# の Windows API の使い方、Windows だけで動く Python、スクリプト、常駐処理とコマンド、機能の判断の処理を、それぞれ独立に読んで不具合を探しました。
- 見つかった点は、コードで確かめてから直し、直したことを確かめるテストを加えました（例：「開く」ボタンを文書・画像などの許可した種類だけにした、ゴーストかどうか分からないときに「通常のファイル」と答えない、BOM 付きの config.json を読む、1970年より前の日時、拡張機能の記録のうち画面の文脈を残さない）。

## 3. 行っていない確認（Windows 11 の実機が必要）

次のことは、**一度も確かめていません**。実機で確かめたら、この文書と [status.md](status.md) を更新してください。

- 導入（`install.ps1`）、起動（`start-pip0.cmd`）、アンインストール（`uninstall.ps1`）
- pip0 シェルの起動と、本体とのやり取り
- Cloud Files API：同期ルートの登録、ゴースト化、ゴーストを普通のアプリで開く、開くまでの時間、通常のファイルへの戻し、移動・削除・フォルダーの名前の変更の追跡
- ごみ箱：確認画面、ごみ箱への移動、ごみ箱に入らない場合の中止
- 前面のウィンドウ・ドラッグ・マウスの位置のフック、UI Automation でのファイル名の入力、Slack の実際のウィンドウタイトル
- ミニドック・デスク・警告の枠の表示、透過、シェイク、画面共有に映らない設定
- 電源と無操作の時間（`GetSystemPowerStatus`、`GetLastInputInfo`）の実際の値
- 資格情報マネージャーへの鍵の保存、Windows 版の SQLCipher
- Chrome と Edge での拡張機能と受け口の接続
- OS のファイアウォールでの遮断
- 権限がない・取り消された状態での表示

## 4. 確かめるときの手順

| 確かめること | 手順 |
| --- | --- |
| 自動テスト | `cd projects/pip0`、`python -m pytest -q` |
| デモ | `python -m pip0 demo` |
| シェルのビルドと確認 | `dotnet build shell/Pip0Shell.csproj -c Release`、`dotnet run --project shell/Checks/Pip0Shell.Checks.csproj -c Release` |
| 拡張機能のテスト | `node --test browser-extension/tests` |
| 外部通信の禁止 | [network.md](network.md) の2節と3節 |
| Windows 11 の実機 | [setup-windows.md](setup-windows.md) の手順で導入し、[status.md](status.md) の W の項目を順に |

## 5. 件数（最後に行ったとき）

（最後の確認の後に記入）
