# pip0 本体と pip0 シェルの通信

pip0 本体（Python）と pip0 シェル（C#）は、同じ PC の中の親子のプロセスで、標準入出力（匿名パイプ）を使ってやり取りします。ネットワーク、名前付きパイプ、ローカルのポートは使いません。

## 1. 形式

- 1つのメッセージは、UTF-8 の JSON オブジェクト1つを1行（`\n` で終わる）にしたものです。1行は最大 1 MiB で、超えた行は読み捨てて、エラーとして記録します。
- 本体 → シェルは、シェルの標準入力。シェル → 本体は、シェルの標準出力。シェルの標準エラー出力は、動作の記録（ファイル名・本文・URL・ウィンドウタイトルを含まない）にだけ使います。
- メッセージは3種類です。

```json
{"kind": "request",  "id": 12, "type": "cf.status", "payload": {"path": "C:\\Users\\u\\pip0\\a.pdf"}}
{"kind": "response", "id": 12, "ok": true, "payload": {"exists": true, "is_ghost": false}}
{"kind": "response", "id": 12, "ok": false, "error": {"code": "unavailable", "message": "日本語の説明"}}
{"kind": "event", "type": "context.foreground", "payload": {"process_name": "slack.exe"}}
```

- `request` には、必ず同じ `id` の `response` が1つ返ります。`id` は送る側が付ける整数です（本体からの要求だけを使います）。
- `event` は返事のいらない知らせで、本体 → シェル（表示の指示）と、シェル → 本体（OS で起きたこと）の両方に使います。
- 知らない `type` の要求には `ok: false`、`code: "unknown_type"` を返します。知らない `type` の知らせは無視します。
- シェルが返す失敗の `code` は、ほかに `bad_request`（形の誤り）、`not_initialised`（`init` の前）、`already_initialised`（場所の違う2回目の `init`）、`unsupported_protocol`、`shutting_down`、`too_large`、`internal_error` があります。
- シェルは起動するとすぐに `shell.ready` を送ります（`init` の前）。`capabilities` の最終的な値は `init` の返事にあります。
- 同じセッションでシェルがすでに動いているとき、2つ目のシェルは終了コード 3 で終わります。
- パスは Windows の絶対パスの文字列、時刻は 1970年1月1日からの秒数（小数）です。

## 2. 本体 → シェルの要求（request）

| type | payload | 返す payload |
| --- | --- | --- |
| `init` | `{"protocol": 1, "vault_dir", "pip0_root", "watched_roots": [絶対パス], "sync_root_display_name": "pip0", "headless": bool, "settings": {"desk_approach_px", "desk_transparent_opacity", "cursor_sample_ms", "cursor_batch_ms", "hazard_border_px", "mini_dock_max_rows"}}`（`watched_roots` は「最近使ったファイル」を知らせる範囲。最大64件。ないときは `pip0_root` だけ） | `{"shell_version", "capabilities": {"cloud_files", "trash", "ui", "hooks"}}`（`hooks` は前面ウィンドウとマウスのフックが両方入ったときだけ真） |
| `cf.register_root` | `{"path", "display_name"}` | `{"registered": bool, "already": bool, "reason"}` |
| `cf.connect` | `{"path"}` | `{"connected": bool, "reason"}`（FETCH_DATA 等の呼び出しを受け付ける） |
| `cf.status` | `{"path"}` | `{"exists", "is_ghost", "item_id", "dehydrated", "in_sync", "pinned", "reason"}` |
| `cf.make_ghost` | `{"path", "item_id", "expected": {"size", "mtime_ns", "file_key", "sha256"}}` | `{"result": "ghosted"/"changed"/"locked"/"not_in_root"/"error", "reason"}` |
| `cf.restore` | `{"path", "item_id"}` | `{"result": "restored"/"already_regular"/"not_our_placeholder"/"missing"/"error", "reason"}` |
| `cf.unregister_root` | `{"path"}` | `{"unregistered": bool, "reason"}`（アンインストールのときだけ。ゴーストが残っていないことを本体が確かめてから呼ぶ） |
| `trash.confirm_and_recycle` | `{"request_id", "title", "message", "items": [{"path", "name", "size"}]}`（名前と件数は、確認画面が `items` から一覧にする。`message` は言い回しだけ） | `{"approved": bool, "answer": "approve"/"cancel"/"closed"/"unavailable", "results": [{"path", "status": "recycled"/"refused"/"failed"/"not_attempted", "reason"}]}`（UI のない `--headless` では `unavailable` で、何も削除しない） |
| `shell.fill_file_dialog` | `{"dialog_hwnd", "path"}` | `{"ok": bool, "reason"}` |
| `shell.open_file` | `{"path"}` | `{"ok": bool, "reason"}`（既定のアプリで開く。`.exe`、`.bat`、`.ps1`、`.lnk`、`.url` など、プログラムを動かす種類は開かない） |
| `shell.reveal_file` | `{"path"}` | `{"ok": bool, "reason"}`（エクスプローラーで場所を開く） |
| `shell.ping` | `{}` | `{"time"}` |

- `cf.make_ghost`：シェルは、`CfOpenFileWithOplock`（排他）で原本を開き、サイズ、最終更新日時（`mtime_ns` は Windows の FILETIME を 1970年起点のナノ秒に直した値）、ファイル番号（`ボリュームのシリアル番号:ファイル番号`）が `expected` と一致し、保管庫の `content` のハッシュが `expected.sha256` と一致することを確かめてから、`CfConvertToPlaceholder(MARK_IN_SYNC | DEHYDRATE)` を呼びます。1つでも違えば `"changed"` を返し、何も変えません。`FileIdentity` には項目ID（32桁の16進数の ASCII）を入れます。
- `cf.make_ghost` の追加の確認：保管庫の `manifest.json` の `item_id`・`size`・`sha256` が `expected` と一致すること、ファイルの本当の場所（`GetFinalPathNameByHandle`）が同期ルートの中にあること、リンクやフォルダーでないこと。変換の後に中身がまだディスクにあれば通常のファイルへ戻して `error`／`locked` とし、すでに同じ項目のゴーストなら `ghosted` を返します（やり直しても同じ結果）。`expected.file_key` は Python 3.11 と 3.12 以降の `os.stat` のどちらの形でも受け付けます。
- `cf.restore`：自分の項目のゴーストなら、まず属性だけで開いて、中身がなければ `CfHydratePlaceholder`（シェルの FETCH_DATA が保管庫から渡す）で戻し、中身がすべてディスクにあることを確かめてから `CfRevertPlaceholder` で通常のファイルに戻します（中身のないまま戻すと、0で埋まったファイルになるため）。
- `cf.unregister_root`：同期ルートの下にプレースホルダーが残っている間（または数え終わらないとき）は解除しません。
- `trash.confirm_and_recycle`：シェルは必ず確認画面を出します（対象のファイル名と件数を表示）。承認されたときだけ、1件ずつ `IFileOperation` でごみ箱へ移します。`IFileOperationProgressSink::PreDeleteItem` に `TSF_DELETE_RECYCLE_IF_POSSIBLE` が付いていない（ごみ箱に入らず完全に削除される）場合は、その削除を中止して `"refused"` を返します。`PostDeleteItem` で、ごみ箱の中の項目が作られなかった場合も `"failed"` とします。

## 3. 本体 → シェルの知らせ（event）

| type | payload |
| --- | --- |
| `ui.mini_dock.show` | `{"dock_id", "rows": [{"entry_id", "file_name", "status": "proposed"/"no_candidate"/"needs_analysis", "dest_label", "new_name", "reasons": [文字列], "alternatives": [{"index", "label"}], "context_label", "remaining_seconds"}]}`（表示中の全行。行が変わるたびに送り直す） |
| `ui.mini_dock.close` | `{"dock_id", "reason"}` |
| `ui.desk.show` | `{"desk_id", "context_label", "partner_label", "dialog_hwnd", "dialog_rect", "items": [{"path", "name", "status": "present"/"ghost", "reasons": [文字列]}]}` |
| `ui.desk.hide` | `{"reason": "shake"/"no_items"/"context"/"kill_switch"}` |
| `ui.hazard.show` | `{"level": "sensitive"/"unknown", "message", "items": [{"name", "level", "reasons"}]}`（赤：sensitive、橙：unknown） |
| `ui.hazard.hide` | `{}` |
| `ui.notify` | `{"title", "message", "level": "info"/"warning"/"error"}` |
| `ui.status` | `{"automation": "running"/"stopped", "throttle": {...}, "restore": {...}, "features": [{"feature", "ok", "reason"}]}` |
| `shell.cursor_stream` | `{"enabled": bool}`（デスクの表示中だけ、マウスの位置を送る） |
| `shell.quit` | `{}` |

## 4. シェル → 本体の知らせ（event）

| type | payload |
| --- | --- |
| `shell.ready` | `{"shell_version", "capabilities"}` |
| `feature.status` | `{"feature": "foreground_hook"/"mouse_hook"/"cursor_sampler"/"uia"/"explorer_selection"/"cloud_files"/"recycle_bin"/"recent_items"/"session_events", "ok": bool, "reason"}`（権限がない・取り消された・フックが外れた等も、ここで知らせる） |
| `context.foreground` | `{"hwnd", "process_name", "window_title", "window_class", "is_file_dialog", "dialog_rect": {"left", "top", "right", "bottom"}（物理ピクセル）, "inaccessible": bool, "reason", "at"}`（前面が変わったとき、タイトルが変わったとき。300ms まとめる。pip0 自身のウィンドウと、前回と同じ内容は送らない） |
| `input.cursor_batch` | `{"samples": [[ミリ秒, x, y], ...]}`（ミリ秒は 1970年起点、x と y は物理ピクセル） |
| `drag.started` | `{"drag_id"（32桁の16進数）, "source_process", "source": "explorer"/"pip0", "items": [パス], "items_status": "ok"/"unavailable", "unidentified_count", "reason", "at"}`（エクスプローラーのフォルダー表示（デスクトップを含む）と pip0 のデスクからのドラッグだけ。1000件を超える、2.5秒で選択を読めない等は `unavailable`） |
| `drag.target_changed` | `{"drag_id", "target_process", "at"}`（ドラッグ中に、マウスの下のアプリが変わったとき） |
| `drag.ended` | `{"drag_id", "target_process", "dropped_on_other_process": bool, "reason", "at"}`（ボタンを離したことを確かめられなかったときは `target_process` が null で `reason` が付く。本体は「続行していない」とみなす。Esc で取り消したドラッグや、送り先が受け入れなかったドロップは見分けられない） |
| `ui.mini_dock.interaction` | `{"dock_id", "state": "enter"/"leave"}` |
| `ui.mini_dock.action` | `{"dock_id", "entry_id", "action": "accept"/"alternative"/"keep"/"open", "alternative_index"}`（`alternative` 以外では `alternative_index` は null） |
| `ui.desk.action` | `{"desk_id", "action": "open"/"reveal"/"fill_dialog", "path", "dialog_hwnd"}` |
| `ui.desk.handle` | `{"state": "engaged"/"released"}`（操作モードの開始・終了） |
| `tray.command` | `{"command": "kill_switch"/"resume"/"show_desk"/"status"/"quit", "confirmed"}`（`resume` は、シェルの確認画面で承認された後にだけ、`"confirmed": true` を付けて送る） |
| `session.event` | `{"kind": "lock"/"unlock"/"logoff"/"suspend"/"resume"/"shutdown"}` |
| `cf.fetch` | `{"item_id", "path", "process_name", "process_id", "by_pip0": bool, "result": "served"/"failed", "reason", "elapsed_ms"}`（ゴーストが開かれて中身を渡したとき。利用の記録と応答時間の実測に使う。`by_pip0` は、開いたのが pip0 本体・シェル自身のときに真で、そのときは利用として数えない） |
| `cf.hydrated` | `{"item_id", "path", "by_pip0": bool}`（ゴーストの中身がすべて戻ったとき。本体は `RESTORE_AFTER_OPEN_SECONDS` 後に通常のファイルへ戻す。`by_pip0` が真（`cf.restore` の中で戻した）ときは何もしない） |
| `cf.notify_delete` | `{"item_id", "path"}` |
| `cf.notify_rename` | `{"item_id", "old_path", "new_path", "inside_root": bool}` |
| `usage.recent_items` | `{"tracking_enabled": bool/null, "items": [{"target_path", "opened_at"}]}`（`watched_roots` の中のものだけ。500件ずつに分け、最初の一覧の後は変わったものだけ送る。Recent を読めないときは `tracking_enabled` が null） |

## 5. ブラウザー拡張 → 受け口（Native Messaging）

ブラウザーは、受け口のプロセスを起動し、標準入力に「32ビットの長さ（リトルエンディアン）＋ UTF-8 の JSON」を書きます。受け口は1件を読み、検査し、暗号化DB に記録して、1件の返事を書いて終了します（`runtime.sendNativeMessage` を使うため）。

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

- 拡張機能は、URL から `?` 以降と `#` 以降を除いてから送ります（Slack 等の URL に含まれることがある一時的な鍵を残さないため）。受け口も同じ処理をもう一度行います。
- `page` は、ダウンロード開始時（`downloads.onCreated`）に、最後に操作したウィンドウで前面だったタブです。ダウンロードを始めたタブとは限らないため、送信元の判定には使わず、記録だけします。
- シークレットウィンドウのダウンロード（`incognito: true`）は送りません。受け口も記録しません。
- 受け口の返事：`{"ok": true, "stored": true}`、または `{"ok": false, "error": "日本語の理由"}`。受け取った内容をそのまま返すことはしません。
- 種類 `ping` は接続の確認用で、`{"ok": true, "pong": true}` を返し、何も記録しません。拡張機能のアイコンをクリックすると `{"type": "ping", "protocol": 1}` を送り、結果をアイコンのバッジと説明に表示します。
- 拡張機能のページには `connect-src 'none'` の CSP を付け、ブラウザーの側でも通信を止めています。
- 拡張機能は、記録がない値（スナップショットがないときの `page` の4項目、`browser`、`url` 等）を `null` で送り、受け口はそれを受け付けます。
- 受け口は、第1引数の呼び出し元（`chrome-extension://<ID>/`）が `settings.ALLOWED_EXTENSION_ORIGINS` にない場合、何も記録せずにエラーを返します。
