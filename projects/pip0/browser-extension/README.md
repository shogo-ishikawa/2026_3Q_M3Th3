# pip0 連携（Chrome／Edge の拡張機能）

ダウンロードが完了したときに、そのダウンロードの記録を、**この PC で動く pip0 の受け口**（Native Messaging の `pip0.bridge`）へ1件ずつ渡す拡張機能です。Google Chrome と Microsoft Edge で、同じフォルダーをそのまま使えます。

pip0 本体は、この記録を使って、ファイルの入手経路（「Slack で貰った」など）や、ダウンロードした日を判断します（[docs/design.md](../docs/design.md) の 4-3 と 4-5）。

- **すること**：ダウンロードの開始時に、前面のタブの URL と題名を控え、完了時に記録を1件、受け口へ渡す。
- **しないこと**：Web ページの中身を読む、インターネットへ送る、ファイルを開く・動かす・消す、シークレット ウィンドウのダウンロードを扱う。

## ファイルの構成

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | 拡張機能の設定（名前、権限、ID を固定するための公開鍵） |
| `background.js` | サービスワーカー（拡張機能の本体）。ダウンロードのイベントを受けて、控え・送信・アイコンの表示を行う |
| `lib/sanitise.js` | URL と題名を、送る前に整える（`?` 以降を除く、文字数を制限する など） |
| `lib/message.js` | 受け口へ渡すメッセージを作る（形は [docs/ipc-protocol.md](../docs/ipc-protocol.md) の5節） |
| `tests/` | 自動テスト（Node.js 22 の `node --test`） |
| `package.json` | テストのための設定だけです。外部のライブラリは使わないため、`npm install` は要りません |

受け口の側のファイルは [native-host/](../native-host/README.md)、登録のスクリプトは `scripts/register-native-host.ps1` です。

## 処理の流れ

```text
ダウンロード開始（downloads.onCreated）
  └ 最後に操作したウィンドウで前面だったタブの URL・題名・時刻を、storage.session に控える
ダウンロード完了（downloads.onChanged の state が "complete"）
  └ downloads.search でダウンロードの情報を読み直す
  └ シークレットなら何もしない
  └ 控えと合わせてメッセージを作り（URL は ? 以降と # 以降を除く）、
     chrome.runtime.sendNativeMessage("pip0.bridge", …) で受け口へ渡す
  └ 控えを消す。受け口に届かなければ、アイコンに「!」を出す
中断（state が "interrupted"）・一覧から削除（downloads.onErased）
  └ 控えを消す
ツールバーのアイコンを押す
  └ 受け口へ ping を送り、接続できるかをアイコンの説明に出す
```

## 読み込み方（開発者モード）

先に、pip0 の導入と受け口の登録（`scripts\register-native-host.ps1`、[native-host/README.md](../native-host/README.md)）を済ませておくと、すぐに接続を確かめられます。拡張機能だけを先に読み込んでも構いません（その場合、アイコンを押すと「!」が出ます）。

### Google Chrome

1. アドレスバーに `chrome://extensions` と入力して開きます。
2. 右上の「デベロッパー モード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」を押し、この `browser-extension` フォルダーを選びます。
4. 「pip0 連携」のカードに表示される ID が `jfaghnlhhcojgeodhjalkchddhphnmhi` であることを確かめます。
5. ツールバーのパズルの形のアイコン（拡張機能）から「pip0 連携」の横のピンを押し、アイコンを常に表示させます（「!」のバッジが見えるようにするため）。

### Microsoft Edge

1. アドレスバーに `edge://extensions` と入力して開きます。
2. 左の「開発者モード」をオンにします。
3. 「展開して読み込みます」を押し、この `browser-extension` フォルダーを選びます。
4. ID が `jfaghnlhhcojgeodhjalkchddhphnmhi` であることを確かめます。
5. ツールバーの拡張機能のアイコンから「pip0 連携」を「ツールバーに表示」にします。

コードを書き換えたときは、拡張機能のページで「pip0 連携」の再読み込み（↻）を押してください。ブラウザーの起動時に、開発者モードの拡張機能についての注意が表示されることがあります。

## 固定の ID

`manifest.json` の `"key"` は、この拡張機能のための公開鍵です。Chrome と Edge は、フォルダーから読み込んだ拡張機能の ID を、次の手順で決めます。

1. `"key"` の Base64 を戻して、公開鍵のバイト列にする
2. その SHA-256 を計算し、16進数の先頭32文字を取る
3. 16進数の `0`〜`f` を、`a`〜`p` に置き換える

その結果が `jfaghnlhhcojgeodhjalkchddhphnmhi` です。`tests/extension-id.test.js` が、同じ計算をして確かめています。

この ID は、次の2か所に書かれています。食い違うと、受け口は接続を断ります。

- `native-host/pip0.bridge.json.template` の `allowed_origins`（ブラウザーが確かめる）
- `pip0/settings.py` の `ALLOWED_EXTENSION_ORIGINS`（受け口が確かめる）

`"key"` を変えると ID も変わります。その場合は2か所も直してください（テストが食い違いを見つけます）。フォルダーから読み込む使い方では、秘密鍵は要りません（このリポジトリーにも置いていません）。

## 権限と、その理由

| 権限 | 使う理由 | 使わないこと |
| --- | --- | --- |
| `downloads` | ダウンロードの開始・完了・中断を知り、完了したファイルの保存先（パス）、ダウンロード URL、参照元 URL を読むため | ダウンロードを始める・開く・消す |
| `nativeMessaging` | 記録を、この PC の pip0 の受け口（`pip0.bridge`）だけへ渡すため。ブラウザーが受け口を起動し、標準入出力でやり取りします（ネットワークを通りません） | 受け口以外のアプリとのやり取り |
| `tabs` | ダウンロード開始時に前面だったタブの URL と題名を読むため | タブを開く・動かす、ページの中身を読む |
| `storage` | 開始時の控えを、完了するまで `chrome.storage.session` に置くため。メモリーの中だけで、ブラウザーを閉じると消えます | ディスクへの保存（`storage.local`、`storage.sync` は使いません） |

Web サイトへの権限（`host_permissions`）とコンテンツスクリプトはありません。そのため、この拡張機能は、ページの中身、入力した文字、Cookie を読めません。Chrome は `tabs` の権限を「閲覧履歴の読み取り」と表示しますが、読むのはダウンロード開始時の前面のタブ1つだけです。

## 送る内容

ダウンロードが完了するたびに、次の形のメッセージを1件送ります（[docs/ipc-protocol.md](../docs/ipc-protocol.md) の5節）。

```json
{
  "type": "download_completed",
  "protocol": 1,
  "browser": "chrome",
  "download": {
    "id": 42,
    "url": "https://files.slack.com/files-pri/T0/F0/report.pdf",
    "finalUrl": "https://files.slack.com/files-pri/T0/F0/report.pdf",
    "referrer": "https://app.slack.com/",
    "filename": "C:\\Users\\u\\Downloads\\report.pdf",
    "mime": "application/pdf",
    "startTime": "2026-10-29T03:12:00.000Z",
    "endTime": "2026-10-29T03:12:04.500Z",
    "fileSize": 123456,
    "danger": "safe",
    "incognito": false
  },
  "page": {
    "tabUrl": "https://app.slack.com/client/T0/C0",
    "tabTitle": "予算 (Channel) - ws - Slack",
    "capturedAt": "2026-10-29T03:12:00.010Z",
    "capture": "active_tab_at_download_start"
  }
}
```

- `browser`：`navigator.userAgentData.brands`（なければ User-Agent の文字列）から決めた `"chrome"`、`"edge"`、`"chromium"`。分からなければ `null`。
- `page`：ダウンロード開始時に、最後に操作したウィンドウで前面だったタブです。ダウンロードを始めたタブとは限らないため、受け口は送信元の判定に使わず、記録だけします。開始を見ていない（拡張機能を読み込む前に始まった等）、前面のタブがなかった場合は、`page` の4つの欄がすべて `null` になります。
- 分からない値（大きさが不明、終了時刻がない等）は `null` にします。

## プライバシーのための工夫

- **URL の鍵を残さない**：URL から `?` 以降、`#` 以降、ユーザー名・パスワードを除き、`スキーム://ホスト[:ポート]/パス` だけを送ります（Slack などの URL には、一時的な鍵が入っていることがあるため）。`data:`、`blob:`、`javascript:`、`file:` などは、`data:` のようにスキームだけを送ります。最大 2048 文字です。受け口も同じ処理をもう一度行います。
- **題名を整える**：タブの題名は、改行などの制御文字を空白にし、512 文字までにします。
- **シークレット ウィンドウを使わない**：`manifest.json` の `"incognito": "not_allowed"` で、シークレット ウィンドウでは拡張機能が動かないようにしています。さらにコードでも、シークレットのダウンロードとタブは、控えることも送ることもしません。
- **送り先は、この PC の受け口だけ**：外へ出す経路は `chrome.runtime.sendNativeMessage` だけです。`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`、外部のスクリプトの読み込みは使いません。
  - `tests/no-network.test.js` が、これらの名前が拡張機能のファイルに書かれていないこと、使っている chrome API が決めた一覧の中だけであること、`import` の読み込み先が拡張機能の中だけであることを確かめます（ソースコードの検査です）。
  - `manifest.json` の `content_security_policy` に `connect-src 'none'` を書き、拡張機能のページからの通信を、ブラウザーにも断らせています（二重の守り。実機のブラウザーでの確認はまだです）。
  - ブラウザー自体の Web 閲覧・ダウンロードの通信を止めるものではありません。pip0 本体の外部通信の遮断（ファイアウォールの規則）は、別の仕組みです（[docs/design.md](../docs/design.md) の2節）。
- **控えはメモリーだけ**：開始時の控えは `chrome.storage.session`（ディスクに書かない）に置き、送ったとき・中断・削除のときに消します。
- **記録に残さない**：拡張機能のログ（コンソール）には、URL と題名を書きません。

## 接続の確かめ方

1. pip0 を導入し、受け口を登録します（`scripts\register-native-host.ps1`。[native-host/README.md](../native-host/README.md)）。
2. 上の手順で拡張機能を読み込みます。
3. ツールバーの「pip0 連携」のアイコンを押します。受け口に `{"type": "ping"}` を送り、結果をアイコンに出します。
   - 接続できたとき：バッジは出ず、アイコンにマウスを置くと「pip0 連携：pip0 の受け口に接続できました（時刻 に確認）」と表示されます。
   - 届かなかったとき：アイコンに赤い「!」が付き、マウスを置くと理由が表示されます。
4. 実際にファイルをダウンロードし、完了後にアイコンに「!」が出ないことを確かめます。

より詳しく調べるときは、拡張機能のページの「pip0 連携」にある「Service Worker」（Edge は「サービス ワーカー」）を押して開発者ツールを開き、コンソールで次を実行します。

```js
await chrome.runtime.sendNativeMessage("pip0.bridge", { type: "ping", protocol: 1 });
// 接続できれば { ok: true, pong: true } が返ります
```

「!」のときの説明に出る、ブラウザーの英語のメッセージの意味は次のとおりです。

| メッセージ | 主な原因 | 対処 |
| --- | --- | --- |
| `Specified native messaging host not found.` | 受け口が登録されていない | `scripts\register-native-host.ps1` を実行する |
| `Access to the specified native messaging host is forbidden.` | 拡張機能の ID が、受け口の `allowed_origins` にない | 拡張機能の ID が `jfaghnlhhcojgeodhjalkchddhphnmhi` か確かめる |
| `Native host has exited.` / `Error when communicating with the native messaging host.` | 受け口が起動できない、または途中で終わった | 導入先に `runtime\python.exe` と `app\pip0\` があるか確かめる |
| （「受け口が記録しませんでした」と理由） | 受け口が記録を断った（例：許可されていない拡張機能、暗号化DB を開けない） | 理由に従う。pip0 本体の `python -m pip0 status` も確かめる |

## テスト

プロジェクトのフォルダー（`projects/pip0`）で、次を実行します。Node.js 22 以上が必要です。追加のライブラリは要りません。

```bash
node --test browser-extension/tests
```

確かめていること：

- `sanitise.test.js`：URL の `?` 以降（鍵）・`#` 以降・ユーザー名とパスワードを除くこと、`data:`・`blob:`・`javascript:`・`file:` をスキームだけにすること、2048 文字で切ること、読めない URL を `null` にすること、題名の整え方
- `message.test.js`：メッセージの各欄の対応、シークレットなら送らないこと、控えがなければ `page` の欄が `null` になること、ブラウザーの判定（brands と User-Agent）
- `background.test.js`：chrome API の代役（`tests/helpers/chrome-mock.js`）でイベントを起こし、完了で受け口へ1回だけ送ること、シークレットでは送らないこと、`lastError` でバッジ「!」が出ること、成功でバッジが消えること、控えの書き込みが遅れても待つこと、中断・削除で控えを消すこと
- `extension-id.test.js`：`"key"` から計算した ID と、受け口のひな形・`pip0/settings.py` の ID が同じこと
- `manifest.test.js`：権限がちょうど4つで、サイトへの権限・コンテンツスクリプト等がないこと
- `no-network.test.js`：ネットワークを使う機能の名前がないこと（上の「プライバシーのための工夫」）
- `native-host-files.test.js`：受け口のファイル（`.bat` は ASCII と CRLF、登録スクリプトは BOM 付きの UTF-8 等）

テストは代役の chrome API で動かしたものです。本物の Chrome・Edge での動作（読み込み、ID の表示、受け口との接続、バッジの表示、`connect-src 'none'` が効くこと）は、Windows 11 の実機で確かめる必要があります（まだ確かめていません）。

## 変えて試せるところ

- `lib/sanitise.js` の `URL_MAX_CHARS`、`TITLE_MAX_CHARS`：送る URL と題名の最大文字数。受け口（Python）の上限と合わせてください。
- `background.js` の `ERROR_BADGE_TEXT`、`ERROR_BADGE_COLOUR`、`NOT_REACHABLE_TITLE`：届かなかったときのバッジの文字・色・説明。
- `lib/message.js`：送る項目。メッセージの形を変えるときは、受け口（`pip0/native_host.py` の `validate_message`）と [docs/ipc-protocol.md](../docs/ipc-protocol.md) も一緒に直してください。片方だけを変えると、受け口が記録を断ります。
- 新しい chrome API を使うときは、`tests/no-network.test.js` の `ALLOWED_CHROME_APIS` に追加する必要があります。外へ送る経路を増やさないか、追加する前に確かめてください。

## 参考資料

外部のライブラリやコードは使っていません。次の公式資料を参考にしました。

- Chrome：Native messaging　https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Chrome：chrome.downloads　https://developer.chrome.com/docs/extensions/reference/api/downloads
- Microsoft Edge：ネイティブ メッセージング　https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/native-messaging
