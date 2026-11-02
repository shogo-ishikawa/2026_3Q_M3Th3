# Native Messaging の受け口（pip0.bridge）

ブラウザー拡張「pip0 連携」（[browser-extension/](../browser-extension/README.md)）から、ダウンロードの記録を受け取る「受け口」を、Chrome と Edge に知らせるためのファイルです。受け口の本体（記録の検査と、暗号化DB への保存）は、Python の `pip0/native_host.py` です。

## このフォルダーのファイル

| ファイル | 役割 |
| --- | --- |
| `pip0.bridge.json.template` | 受け口の設定のひな形。`scripts\register-native-host.ps1` が、導入先の `native-host\pip0.bridge.json` に書き出します |
| `pip0-native-host.bat` | ブラウザーが起動するファイル。pip0 専用の Python で `python -I -m pip0.native_host` を起動します |
| `.gitattributes` | `.bat` の改行を CRLF に保つための Git の設定 |

## しくみ

```text
拡張機能：chrome.runtime.sendNativeMessage("pip0.bridge", メッセージ)
  ↓ ブラウザーがレジストリーを読む
HKCU\Software\Google\Chrome\NativeMessagingHosts\pip0.bridge（Edge は HKCU\Software\Microsoft\Edge\…）
  ↓ 既定の値 ＝ pip0.bridge.json の場所
pip0.bridge.json：allowed_origins に呼び出し元の拡張機能の ID があるかを、ブラウザーが確かめる
  ↓ path（同じフォルダーの pip0-native-host.bat）を、ブラウザーが cmd.exe で起動する
pip0-native-host.bat → <導入先>\runtime\python.exe -I -m pip0.native_host chrome-extension://jfaghnlhhcojgeodhjalkchddhphnmhi/ --parent-window=<番号>
  ↓ 標準入力：4バイトの長さ（リトルエンディアン）＋ UTF-8 の JSON
受け口（pip0/native_host.py）：呼び出し元を settings.ALLOWED_EXTENSION_ORIGINS で確かめ、内容を検査し、
                              暗号化DB に記録し、返事を1件書いて終わる
  ↓ 標準出力：返事（{"ok": true, "stored": true} など）
拡張機能に返事が届く
```

- やり取りは、ブラウザーと受け口のプロセスの間の標準入出力（パイプ）だけです。ネットワークは使いません。
- 受け口は、届いた内容を記録するだけです。ファイルの操作や、コマンドの実行は受け付けません。
- メッセージの形は [docs/ipc-protocol.md](../docs/ipc-protocol.md) の5節にあります。

## 導入後の配置

[docs/design.md](../docs/design.md) の 6-9 のとおり、次の場所に置かれている前提です。

```text
%LOCALAPPDATA%\Programs\pip0\        ← 導入先（InstallDir）
  runtime\python.exe                  ← pip0 専用の Python（埋め込み用配布物）
  app\pip0\                           ← pip0 本体（native_host.py を含む）
  native-host\pip0-native-host.bat    ← このフォルダーの .bat
  native-host\pip0.bridge.json        ← 登録のときに、ひな形から書き出すもの
```

`.bat` は、自分のいるフォルダー（`%~dp0`）の1つ上の `runtime\python.exe` を使います。ほかの Python（PC に入っている別の Python）は使いません。

- `-I`（隔離モード）：環境変数 `PYTHONPATH`、ユーザーの site-packages、今いるフォルダーを、モジュールの探す場所に入れません。pip0 専用の Python と pip0 本体だけを使うためです。
- そのため、`runtime` の `python3XX._pth`（埋め込み用配布物の設定）に、`..\app` が含まれている必要があります（pip0 の導入の手順で設定します）。含まれていないと、受け口は起動できず、拡張機能のアイコンに「!」が出ます。

## 登録と解除

管理者の権限は要りません。今のユーザーの設定だけを変えます。

```powershell
# 登録（導入先が既定の %LOCALAPPDATA%\Programs\pip0 の場合）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-native-host.ps1

# 導入先が別の場所の場合
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-native-host.ps1 -InstallDir "D:\Apps\pip0"

# 解除
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-native-host.ps1 -Unregister
```

`-ExecutionPolicy Bypass` は、この1回の PowerShell にだけ効く指定で、PC の設定は変えません。

登録で変わるもの：

1. `<導入先>\native-host\pip0.bridge.json` を書きます（ひな形の内容を確かめてから、UTF-8・BOM なしで書きます）。
2. 次の2つのレジストリーキーの「既定」の値に、`pip0.bridge.json` の完全なパスを書きます（キーがなければ作ります）。
   - `HKCU\Software\Google\Chrome\NativeMessagingHosts\pip0.bridge`
   - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\pip0.bridge`

解除（`-Unregister`）は、この2つのキーを消すだけです。`pip0.bridge.json` は残します（pip0 を削除するときに、導入先と一緒に消えます）。ブラウザーは、メッセージを送るたびに登録を読むため、登録・解除の後にブラウザーを起動し直す必要はありません。

## 確かめ方

1. 登録を確かめる（コマンド プロンプトか PowerShell で）：

   ```bat
   reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\pip0.bridge" /ve
   reg query "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\pip0.bridge" /ve
   ```

   `(既定)` の値が `...\native-host\pip0.bridge.json` になっていれば登録済みです。
2. 拡張機能から確かめる：ツールバーの「pip0 連携」のアイコンを押します（[browser-extension/README.md](../browser-extension/README.md) の「接続の確かめ方」）。
3. ブラウザーを使わずに、受け口だけを確かめる：次の内容を `ping_bridge.py` として保存し、`<導入先>\runtime\python.exe ping_bridge.py` で実行します。受け口が動けば `{'ok': True, 'pong': True}` と表示されます（ping は何も記録しません）。

   ```python
   # pip0 の受け口に ping を送って、返事を表示します（ブラウザーを使わない確認）
   import json
   import struct
   import subprocess
   import sys

   ORIGIN = "chrome-extension://jfaghnlhhcojgeodhjalkchddhphnmhi/"

   body = json.dumps({"type": "ping", "protocol": 1}).encode("utf-8")
   result = subprocess.run(
       [sys.executable, "-I", "-m", "pip0.native_host", ORIGIN],
       input=struct.pack("<I", len(body)) + body,
       capture_output=True,
       timeout=30,
   )
   if len(result.stdout) < 4:
       print("返事がありません。終了コード：", result.returncode)
       print(result.stderr.decode("utf-8", "replace"))
   else:
       size = struct.unpack("<I", result.stdout[:4])[0]
       print(json.loads(result.stdout[4:4 + size].decode("utf-8")))
   ```

## よくあるエラー

拡張機能のアイコンの「!」にマウスを置くと、ブラウザーの英語のメッセージが表示されます。

| メッセージ | 主な原因 | 対処 |
| --- | --- | --- |
| `Specified native messaging host not found.` | 登録されていない、または `pip0.bridge.json` がない | `register-native-host.ps1` を実行する。`reg query` で場所を確かめる |
| `Access to the specified native messaging host is forbidden.` | 拡張機能の ID が `allowed_origins` にない | 拡張機能の ID が `jfaghnlhhcojgeodhjalkchddhphnmhi` か確かめる |
| `Native host has exited.` | `.bat` や `runtime\python.exe` がない、`pip0` が見つからない、受け口がエラーで終わった | 導入先の配置を確かめる。上の `ping_bridge.py` で受け口だけを試す |
| `Error when communicating with the native messaging host.` | 受け口の返事の形が違う（標準出力に余計な文字が出た等） | `.bat` や受け口が、返事以外を標準出力に書いていないか確かめる |

## ファイルの形についての注意

- **`pip0-native-host.bat` は ASCII だけ、改行は CRLF**：`cmd.exe` は、バッチファイルを PC のコードページ（日本語の Windows では Shift_JIS 系）で読みます。UTF-8 の日本語を書くと、行の区切りを読み違えて、次の行（Python を起動する行）が壊れることがあるため、コメントも英語にしています。また、標準出力はブラウザーへの返事に使うため、`@echo off` を消したり、`echo` を足したりしないでください。
- **`pip0.bridge.json` は UTF-8（BOM なし）**：登録スクリプトがこの形で書きます。手で書き換えるときも、BOM を付けないでください。`path` は、`pip0.bridge.json` と同じフォルダーにあるファイルの名前（相対パス）です。
- **`scripts\register-native-host.ps1` は UTF-8（BOM 付き）**：Windows PowerShell 5.1 は、BOM のない .ps1 を PC のコードページで読み、日本語の表示が崩れるためです。

`browser-extension/tests/native-host-files.test.js` が、これらの形を確かめています。

## 実機で確かめていないこと

- Windows 11 の Chrome・Edge が、この登録で受け口を起動できること（`cmd.exe` 経由の起動、`--parent-window` の受け渡し、相対パスの `path`）
- `register-native-host.ps1` を Windows PowerShell 5.1 で実行したときの、レジストリーへの書き込み

登録スクリプトは、Linux の PowerShell 7 で構文を確かめ、レジストリーの操作を代役に置き換えて、書き出すファイル・書き込むキー・解除するキーを確かめました。

## 参考資料

- Chrome：Native messaging　https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Microsoft Edge：ネイティブ メッセージング　https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/native-messaging
