# pip0 シェル（C#）

pip0 シェルは、pip0 のうち **Windows の機能を使う部分** です。pip0 本体（Python）が子プロセスとして起動し、標準入出力で JSON を1行ずつやり取りします（[docs/ipc-protocol.md](../docs/ipc-protocol.md)）。

- シェルは **判断をしません**。何をゴーストにするか、いつ戻すか、何を削除の候補にするか、ミニドック・デスク・警告の枠に何を出すか、いつ閉じるかは本体が決めます。シェルは指示を確かめて実行・表示し、結果と、OS で起きたこと（ゴーストが開かれた、前面のアプリが変わった、ファイルのドラッグが始まった等）を本体へ知らせます。
- 画面の画像（スクリーンショット）は取得しません。作業文脈として読むのは、前面のアプリのプロセス名・ウィンドウタイトル・ウィンドウの種類だけです。
- ネットワークを使うコードはありません。
- ユーザーのファイルを完全に削除する機能はありません（ごみ箱へ移すだけで、ごみ箱に入らない場所では削除しません）。

対象は Windows 11 です。Windows 以外では動きません（確認用の `Checks/` だけは Windows 以外でも動きます）。

## ビルド

必要なもの：.NET 8 SDK（Windows 以外でも、Windows 向けのビルドはできます）。

```bash
# 確認用（コンパイルだけ）
dotnet build Pip0Shell.csproj -c Release

# 配布用（1つの exe にまとめる。Windows 11 の x64 向け）。通常はリポジトリの scripts\build-shell.ps1 を使う
dotnet publish Pip0Shell.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o bin\publish\win-x64
```

- 配布用の出力は `bin\publish\win-x64\Pip0Shell.exe`（約 73 MB。.NET と WPF を含み、圧縮しています）と、問題を調べるための `Pip0Shell.pdb` です。`scripts\build-shell.ps1` も同じ場所に出力し、`scripts\install.ps1` はそこから導入します。`bin\` は Git に登録しません（`.gitignore`）。導入するときは `Pip0Shell.exe` を `%LOCALAPPDATA%\Programs\pip0\shell\Pip0Shell.exe` に置きます（[docs/design.md](../docs/design.md) 6-9）。
- 初めて起動したとき、.NET が WPF の部品（ネイティブの DLL）を `%TEMP%\.net\Pip0Shell\` に展開します（.NET の1つの exe の仕組みです）。
- ビルドに使う外部のパッケージは CsWin32（Win32 API の宣言を生成する道具、Microsoft、MIT ライセンス）だけで、実行時には含まれません。UI Automation（`System.Windows.Automation`）と `Microsoft.Win32.SystemEvents` は .NET の Windows デスクトップの部品に含まれています。

## 起動のされ方

本体の `python -m pip0 serve` が `Pip0Shell.exe` を起動します。`python -m pip0 restore-all` が常駐処理なしで復元するときは、`Pip0Shell.exe --headless` で起動します（画面を出さず、前面ウィンドウ・マウス・セッション・最近使ったファイルの見張りも始めない）。

- 同じ Windows のセッションでは1つしか動きません（名前付きミューテックス `Local\pip0.shell.<SID>`）。
- 標準入力が閉じられる（本体が終わる）か、`shell.quit` を受けると、片付けて終わります。自分でダブルクリックして起動した場合は、標準入力がないので、すぐに終わります。
- 終了コード：`0` 正常、`1` 起動できなかった、`3` 同じセッションでシェルがすでに動いている。

## ファイルの構成（入口）

| ファイル | 役割 |
| --- | --- |
| `Program.cs` | 入口。引数（`--headless`）、二重起動の防止、全体の開始 |
| `ShellApplication.cs` | 全体の流れ：`shell.ready` を送る → `init` を待つ → 画面を出し、OS の見張りを始める → `shell.quit` か標準入力の終わりで片付ける |
| `Core/` | 記録（`Log.cs`）、版（`ShellInfo.cs`）、init で受け取った値（`SessionConfiguration.cs`、`ShellSettings.cs`、`ShellState.cs`）、機能の状態の知らせ（`FeatureReporter.cs`）、二重起動の防止、親プロセスの判定（`Pip0Processes.cs`）、フック用のメッセージループのスレッド（`MessageLoopThread.cs`） |
| `Ipc/` | 本体との通信。1行ずつの読み書き（`JsonLineChannel.cs`、1行 1 MiB まで）、メッセージの読み取り（`IncomingMessage.cs`、`Payload.cs`）、type ごとの振り分け（`MessageRouter.cs`）、答えと知らせの送信（`ShellOutput.cs`、`RequestResult.cs`） |
| `CloudFiles/` | ゴースト（M4）。入口は `CloudFilesModule.cs`。同期ルートの登録（`SyncRootRegistrar.cs`）、接続とコールバック（`SyncProvider.cs`）、中身を渡す処理（`FetchDataService.cs`）、ゴーストの状態・作成・復元（`PlaceholderOperations.cs`）、保管庫の確認（`VaultContent.cs`）、エラーの日本語の理由（`HResultText.cs`） |
| `Trash/` | ごみ箱。入口は `TrashModule.cs`。確認画面（`ConfirmDeleteWindow.cs`）、ごみ箱へ移す処理（`RecycleBin.cs`、`RecycleProgressSink.cs`） |
| `Ui/` | 常駐UI。入口は `UiModule.cs`（WPF の Application と画面のスレッドを持ち、ui.* の知らせと OS の見張りの開始・終了をまとめる）。ミニドック（`MiniDockWindow.cs`、`MiniDockContent.cs`）、デスク（`DeskWindow.cs`、`DeskHandleWindow.cs`、`DeskContent.cs`、接近で透過の決まり `DeskProximity.cs`、デスクからのドラッグの記録 `DeskPressRecorder.cs`）、警告の枠（`HazardBorderWindow.cs`、`HazardContent.cs`）、通知領域アイコン（`TrayIcon.cs`、`TrayIconImage.cs`）、状態の画面（`StatusWindow.cs`、`StatusText.cs`）、再開の確認画面（`ConfirmResumeWindow.cs`）、ファイルを開く・場所を開く（`FileActions.cs`、開かない種類 `OpenableFile.cs`）、置き場所の計算（`ScreenGeometry.cs`、`WindowPlacement.cs`）、色と部品（`UiStyle.cs`） |
| `Input/` | マウス。低レベルのマウスのフック（`MouseHook.cs`）、ドラッグの判定（`DragTracker.cs`）と知らせ（`DragMonitor.cs`）、エクスプローラーで選ばれている項目（`ExplorerSelection.cs`）、マウスの位置を送る（`CursorSampler.cs`、`CursorBatcher.cs`） |
| `Context/` | 作業文脈と利用の記録。前面ウィンドウ（`ForegroundWatcher.cs`、まとめ方 `Debouncer.cs`、`WindowInfo.cs`、`ProcessInfo.cs`）、ファイルダイアログ（`FileDialogAutomation.cs`）、セッション（`SessionEventsWatcher.cs`）、最近使ったファイル（`RecentItemsWatcher.cs`、`RecentItems.cs`、`ShellLinkReader.cs`、`RecentTrackingSetting.cs`） |
| `NativeMethods.txt`、`NativeMethods.json` | CsWin32 に宣言を生成させる Win32 API の一覧と設定 |
| `app.manifest` | 管理者権限を求めない、長いパスに対応する、という Windows 向けの宣言 |
| `Checks/` | Windows の機能を使わない部分を、Windows 以外でも動かして確かめるプログラム（配布物に含めない） |

## 受け付ける要求と送る知らせ

| 種類 | type | 内容 |
| --- | --- | --- |
| 要求 | `init` | 保管庫・pip0 専用フォルダーの場所、表示の有無、画面の設定、`watched_roots` を受け取る。これより前は `init` と `shell.ping` 以外を `not_initialised` で断る |
| 要求 | `shell.ping` | `{"time"}` |
| 要求 | `cf.register_root` / `cf.connect` / `cf.unregister_root` | 同期ルートの登録・接続・解除 |
| 要求 | `cf.status` / `cf.make_ghost` / `cf.restore` | ゴーストの状態・作成・復元 |
| 要求 | `trash.confirm_and_recycle` | 確認画面を出し、承認されたものだけをごみ箱へ |
| 要求 | `shell.fill_file_dialog` | UI Automation でファイルダイアログのファイル名欄に入力する → `{"ok", "reason"}` |
| 要求 | `shell.open_file` / `shell.reveal_file` | 既定のアプリで開く／エクスプローラーで場所を開いて選ぶ → `{"ok", "reason"}` |
| 知らせ（受ける） | `shell.quit` | 終了する |
| 知らせ（受ける） | `ui.notify` / `ui.status` | 通知領域アイコンの吹き出し／アイコンの説明と状態の画面の文 |
| 知らせ（受ける） | `ui.mini_dock.show` / `ui.mini_dock.close` | ミニドックの行を置き換えて出す／閉じる |
| 知らせ（受ける） | `ui.desk.show` / `ui.desk.hide` | デスクの候補を置き換えて出す／隠す |
| 知らせ（受ける） | `ui.hazard.show` / `ui.hazard.hide` | すべての画面の縁を光らせる／消す |
| 知らせ（受ける） | `shell.cursor_stream` | マウスの位置を送り始める・止める |
| 知らせ（送る） | `shell.ready`、`feature.status`、`cf.fetch`、`cf.hydrated`、`cf.notify_delete`、`cf.notify_rename`、`tray.command` | |
| 知らせ（送る） | `context.foreground`、`input.cursor_batch`、`drag.started`、`drag.target_changed`、`drag.ended`、`session.event`、`usage.recent_items` | OS で起きたこと |
| 知らせ（送る） | `ui.mini_dock.interaction`、`ui.mini_dock.action`、`ui.desk.action`、`ui.desk.handle` | 画面での操作 |

`init` の答えの `capabilities.hooks` は、前面ウィンドウのフックとマウスのフックの **両方** を付けられたときだけ `true` です（`shell.ready` の値は起動時点の見込み）。表示なし（`--headless`）のときは、画面も見張りも始めません。

### feature.status で知らせる機能

使えない・権限がない・外されたときは `ok: false` と日本語の理由を送ります。1つの機能が失敗しても、ほかの機能は動き続けます。

| feature | 使うもの | 知らせる時 |
| --- | --- | --- |
| `cloud_files`、`recycle_bin` | Cloud Files API、IFileOperation（下の節） | init、登録・接続のとき |
| `foreground_hook` | `SetWinEventHook` | init。タイトルの変化のフックを付けられない・また付けられたとき |
| `uia` | UI Automation | init。ダイアログを調べて UI Automation が動かなかった・また動いたとき |
| `explorer_selection` | `ShellWindows`（Shell.Application の COM） | init |
| `mouse_hook` | `SetWindowsHookEx(WH_MOUSE_LL)` | init。Windows がフックを外したとき（`false`）と、付け直したとき（`true`） |
| `cursor_sampler` | `GetCursorPos` | init。2 秒続けて位置を読めない・また読めるようになったとき |
| `session_events` | `Microsoft.Win32.SystemEvents` | init |
| `recent_items` | Recent フォルダーと `IShellLinkW` | 最初に読み終えたとき（init の少し後） |

## 常駐UI

どの画面も、本体から届いた内容を出すだけで、何を出すか・いつ閉じるかは本体が決めます。ミニドック・デスク・つまみ・警告の枠は、枠のない最前面のウィンドウで、**前面に出ません**（`ShowActivated = false`、`WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`、`WM_MOUSEACTIVATE` に `MA_NOACTIVATE`）。ボタンを押しても、作業中のアプリからキーボードの入力先を奪いません。位置は物理ピクセルで `SetWindowPos` します（拡大率の違う画面でずれないように）。設定の px（`desk_approach_px`、`hazard_border_px`）は、100% 表示のときのピクセル数として、画面の拡大率に合わせて広げます。

### ミニドック（`ui.mini_dock.show` / `ui.mini_dock.close`）

- 主モニターの作業領域（タスクバーを除く範囲）の右下に出します。幅 380（100% のとき）。
- 1つのダウンロードが1行：ファイル名、状態（「仕分け先の候補なし」「解析待ち」）、仕分け先、新しい名前、理由、作業中のアプリ。ボタンは「提案どおり」（候補がない行では押せない）、別の仕分け先（`alternatives` の数だけ）、「そのまま」、「開く」。
- ボタンを押すと `ui.mini_dock.action {"dock_id", "entry_id", "action": "accept"/"alternative"/"keep"/"open", "alternative_index"}` を送り、その行のボタンを押せなくします。行を消す・閉じるのは本体からの次の `ui.mini_dock.show` / `ui.mini_dock.close` です。
- マウスが乗った・離れたら `ui.mini_dock.interaction {"dock_id", "state": "enter"/"leave"}`。残り時間を止める・数え直すのは本体です。シェルは残り時間を表示しません（本体が止めたり数え直したりするため、シェルの表示とずれないように）。
- `ui.mini_dock.close` は、表示中の `dock_id` と同じときだけ閉じます。

### デスク（`ui.desk.show` / `ui.desk.hide`）

- 置き場所：前面のウィンドウがある画面の右端（上下の中央）。`dialog_hwnd` か `dialog_rect` があれば、そのファイルダイアログの上辺に沿って横に並べます（上に入らなければダイアログの下）。ダイアログが動いたら 0.33 秒ごとに付いていきます。ダイアログの中に UI は入れません。
- 候補：届いた順に、届いた件数だけ並べます（10 件まで）。名前、状態（ゴーストは「退避中」の札）、理由、ボタン「開く」「場所を開く」（ダイアログのときは「ダイアログに入力」も）。ボタンは `ui.desk.action {"action": "open"/"reveal"/"fill_dialog", "path", "desk_id"}` を送るだけです（`fill_dialog` には `dialog_hwnd` も付ける）。開く・入力するかは本体が決め、`shell.open_file` などで頼んできます。
- **接近で透過**：33ms ごとにマウスの位置を調べ、デスクから `desk_approach_px` 以内（デスクの上を含む）なら、不透明度を `desk_transparent_opacity` にして、クリックを下のウィンドウへ通します（`WS_EX_TRANSPARENT`）。離れたら戻します。
- **つまみ**：デスクの左端に、常にクリックできる小さなウィンドウ（`DeskHandleWindow`）を付けます。つまみにマウスを 0.3 秒置くか、クリックすると **操作モード**（不透明でクリックできる）になり、`ui.desk.handle {"state": "engaged"}` を送ります。マウスがデスクとつまみから `desk_approach_px` より離れたら終わり、`{"state": "released"}` を送ります。操作モードのまま隠されたときも `released` を送ります。
- 候補はつかんでほかのアプリへドラッグできます（**コピーだけ**。元のファイルを動かさない）。このドラッグは `drag.started` の `source: "pip0"` で知らせます。
- シェイク（素早い左右の振り）の判定は本体（`desk.ShakeDetector`）です。シェルは `shell.cursor_stream` の間、マウスの位置を送るだけです。

### 警告の枠（`ui.hazard.show` / `ui.hazard.hide`）

- 画面（モニター）ごとに1つ、画面の全体（タスクバーを含む）を覆うウィンドウを出し、縁を `hazard_border_px` の太さで光らせ、上の中央に短い文（`message`）と対象のファイル名（3 件まで、残りは件数）を出します。
- 赤：`level: "sensitive"`（機密）、橙：`"unknown"`（機密か未判定）。知らない `level` は橙で出します（警告を消さない側に倒す）。
- 最前面で、クリックを下へ通し、前面にも出ないので、ドラッグ中の操作を邪魔しません。光り方は、外側から内側へ薄くなる3重の枠です（動かし続けると画面全体の描き直しが重くなるため、動かしません）。
- `ui.hazard.hide` で消します。画面の数や配置が変わっていたら、次の表示のときに作り直します。

### 通知領域アイコン

- メニュー：「状態」（`tray.command status` を送り、状態の画面を開く）、「デスクを表示」（`show_desk`）、「全復元（自動処理を止める）」（`kill_switch`、1回の操作で始める）、「自動処理を再開（確認）」（確認画面で「再開する」が押されたときだけ `{"command": "resume", "confirmed": true}`）、「終了」（`quit`）。
- `ui.notify` は吹き出し、`ui.status` はアイコンの説明（例：「pip0（自動処理：動作中）／使えない機能 2 件」）と状態の画面の文（自動処理、高負荷の処理の条件、全復元の進み具合、機能ごとの ○／× と理由）に使います。

## 入力と作業文脈

### 前面ウィンドウ（`context.foreground`）

- `SetWinEventHook`（`WINEVENT_OUTOFCONTEXT`、専用のスレッドとメッセージループ）で、前面の切り替え（`EVENT_SYSTEM_FOREGROUND`）と、前面のウィンドウのタイトルの変化（`EVENT_OBJECT_NAMECHANGE` のうち `OBJID_WINDOW`・`CHILDID_SELF`・前面のウィンドウのもの）を受け取ります。タイトルの変化のフックは、前面のアプリのプロセスだけに付け直します（ほかのアプリの大量の知らせを受けないため）。
- 300ms まとめてから（止まらないときは最大 1 秒で）、別のスレッドで読み、`{"hwnd", "process_name", "window_title", "window_class", "is_file_dialog", "dialog_rect", "inaccessible", "at"}` を送ります。前と同じ内容なら送りません。pip0 自身のウィンドウが前面のときも送りません。
- プロセス名：`GetWindowThreadProcessId` → `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` → `QueryFullProcessImageName`。拒否されたら `process_name: null`、`inaccessible: true`（`reason` 付き）。ストアアプリ（UWP）は、枠のプロセスの `ApplicationFrameHost.exe` になります（中のアプリの名前は取得していません）。
- ファイルダイアログ：ウィンドウの種類が `#32770` で、中に AutomationId `"1148"`（ファイル名欄）があるもの。まず子ウィンドウのコントロール ID 1148 で探して UI Automation で AutomationId を確かめ、なければ UI Automation で中を探します。`dialog_rect` は `{"left", "top", "right", "bottom"}`（物理ピクセル、DWM の見えている枠）。管理者として動くアプリのダイアログで中を調べられなければ `inaccessible: true`。

### ファイルダイアログへの入力（`shell.fill_file_dialog`）

- `dialog_hwnd` のウィンドウが `#32770` で、ファイル名欄（AutomationId 1148、またはその中の Edit）があれば、`ValuePattern.SetValue` で完全なパスを入れ、読み直して同じか確かめます。「開く」ボタンはユーザーが押します。
- 失敗は正直に返します：ダイアログが閉じられた、ファイル名欄がない、読み取り専用、**管理者として動くアプリのダイアログ（Windows の制限 UIPI で入力できない）**。権限の高さは、相手のプロセスのトークンの整合性レベルで調べます。

### ドラッグ（`drag.started` / `drag.target_changed` / `drag.ended`）

- 低レベルのマウスのフック（`WH_MOUSE_LL`）を専用のスレッドとメッセージループで付けます。フックの関数は出来事を列に入れるだけで、すぐに戻ります（Windows は応答の遅い低レベルのフックを知らせなしに外すため）。判定は別のスレッドで行います。
- 2 秒ごとに「マウスが動いたのにフックが何も受け取っていない」かを確かめ、2 回続いたら外されたとみなして付け直し、`feature.status`（`mouse_hook`）で知らせます。管理者として動くアプリへの入力は、Windows の制限（UIPI）で元々フックに届かないので、そのときは判断しません。
- 左ボタンを押して、`SM_CXDRAG` / `SM_CYDRAG` を超えて動いたらドラッグの始まりです。押した位置のいちばん外側のウィンドウとプロセスで、次のように決めます。
  - `explorer.exe` のフォルダー表示（`SHELLDLL_DefView` の中。デスクトップを含む）：STA の専用のスレッドで `ShellWindows`（`Shell.Application` の `Windows()` と同じ）を使い、そのウィンドウ（HWND が同じもの。Windows 11 のタブは、タブのウィンドウの中に押した位置があるもの）の `Document.SelectedItems()` のパスを読みます。デスクトップは `IShellWindows.FindWindowSW(SWC_DESKTOP)` で探します。`{"source": "explorer", "items", "items_status": "ok"}`。読めない・2.5 秒で答えない・1000 件を超える・タブを見分けられないときは `items_status: "unavailable"` と理由。パスの分からない項目（仮想フォルダー等）は含めず、その数を `unidentified_count` に入れます。
  - pip0 のデスクの候補：その候補のパスで `{"source": "pip0"}`。
  - それ以外（ほかのアプリ、タイトルバー、タスクバー、ナビゲーション ウィンドウ等）：ファイルを特定できないため、知らせません。Windows 11 のエクスプローラーの「ホーム」「ギャラリー」のように、フォルダー表示（`SHELLDLL_DefView`）でない画面からのドラッグも、知らせない可能性があります（実機で確かめる必要があります）。
  - 選択の枠（ラバーバンド）を描くドラッグも「ドラッグ」に見えるため、その時点で選ばれている項目で `drag.started` を送ることがあります（項目の上で押したかは調べていません）。
- ドラッグ中、マウスの下のアプリ（いちばん外側のウィンドウのプロセス）が変わったら `drag.target_changed {"drag_id", "target_process"}`（30ms に1回まで調べる）。クリックを通すウィンドウ（警告の枠、薄くなったデスク）は飛ばされます。
- ボタンを離したら `drag.ended {"drag_id", "target_process", "dropped_on_other_process"}`。`dropped_on_other_process` は、離した位置のプロセスがドラッグ元のプロセスと違うとき真です。**送り先がドロップを受け入れたか、Esc で取り消されたかは、Windows から取得できないため確かめていません。** フックを付け直した等で離したことを確かめられなかったドラッグは、`dropped_on_other_process: false` と `reason` で閉じます。

### マウスの位置（`shell.cursor_stream` → `input.cursor_batch`）

- 本体が `{"enabled": true}` を送っている間だけ、`cursor_sample_ms` ごとに `GetCursorPos` で調べ、`cursor_batch_ms` ごとに `{"samples": [[ミリ秒, x, y], ...]}` を送ります。ミリ秒は 1970年1月1日からの時刻（始めたときの時計に、単調に増える時計を足したもの）、x・y は物理ピクセルです。

### セッション（`session.event`）

`Microsoft.Win32.SystemEvents` の SessionSwitch（`lock` / `unlock` / `logoff`）、PowerModeChanged（`suspend` / `resume`）、SessionEnding（`shutdown`、サインアウトなら `logoff`）を送ります。同じ kind が 2 秒以内に続いたら1回にまとめます。

### 最近使ったファイル（`usage.recent_items`）

- `%APPDATA%\Microsoft\Windows\Recent\*.lnk` を、STA のスレッドで `IShellLinkW` と `IPersistFile` で読み、指す先のパスを得ます（`Resolve` は呼ばないので、指す先のファイルには触れません）。`opened_at` はショートカットの更新日時です。
- 知らせるのは、init の `watched_roots`（なければ `pip0_root`）の中のファイルだけです。最初に全部、その後は `FileSystemWatcher` で増えた・更新されたものだけを 1.5 秒まとめて送ります。見張りがあふれたときと 1 時間ごと（見張れないときは 10 分ごと）に読み直し、変わったものだけを送ります。
- `tracking_enabled`：`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced` の `Start_TrackDocs` がない → `true`、`0` → `false`、0 以外 → `true`、読めない → `null`。ポリシー `NoRecentDocsHistory` が 1 なら `false`。Recent フォルダーを読めない・対象のフォルダーがないときは、当てにできないので `null`（`items` は空）です。

## ゴースト（Cloud Files API）

`%USERPROFILE%\pip0` を同期ルートとして登録し、その中のファイルだけを、元のパスのままゴーストにします。

- 同期ルートの登録：ID は `pip0!<ユーザーの SID>!default`。取得の方式 Full、一覧の方式 AlwaysFull、ハードリンク不可、同期済みの判定は既定、「常にこのデバイス上に保持する」を許可、アイコンは `%SystemRoot%\system32\imageres.dll,-1043`。NTFS 以外のドライブは登録しません。
- 接続：`CfConnectSyncRoot` で FETCH_DATA、CANCEL_FETCH_DATA、NOTIFY_DELETE、NOTIFY_RENAME を受けます（開いたプロセスと完全なパスを受け取る設定）。コールバックの委譲は静的フィールドで持ち続け、GC に回収されないようにしています。
- **ゴーストが開かれたとき（FETCH_DATA）**：FileIdentity の項目ID から `VAULT_DIR\items\<項目ID>\manifest.json` を読み、`content` の大きさと SHA-256 が一致することを **渡す前に** 確かめます。確かめた `content` は、ほかのプロセスが書き換えられない開き方のまま、同じハンドルから 1 MiB ずつ渡します（長さは 4 KiB の倍数。ファイルの終わりで終わる最後の1回だけ半端）。一致しない・ないときはエラーで返し、違う内容や空の内容は渡しません。毎回 `cf.fetch` を送り、ファイル全体を渡し終えたら `cf.hydrated` を送ります。
- **ゴーストにする（cf.make_ghost）**：保管庫の内容と manifest.json が `expected` の大きさとハッシュに一致することを確かめてから、原本を `CfOpenFileWithOplock`（排他、書き込み可）で開き、大きさ・最終更新日時（1970年からのナノ秒）・ファイル番号を比べ、原本をそのハンドルから読み直してハッシュを比べます。もう一度確かめてから `CfConvertToPlaceholder(MARK_IN_SYNC | DEHYDRATE)` を呼び、実際の状態を読み直して `ghosted` かを決めます。1つでも違えば `changed` で、何も変えません。中身を外せなかったときは、中身がディスクにあることを確かめてから通常のファイルに戻します。
- **戻す（cf.restore）**：属性だけを読む開き方で自分の項目のゴーストかを確かめ、中身がディスクにない部分があれば `CfHydratePlaceholder` で戻させます（Windows がこのシェルの FETCH_DATA を呼び、上の確認をしてから渡します）。そのあと排他的に開き直し、中身がすべてディスクにあることをもう一度確かめてから `CfRevertPlaceholder` を呼びます。中身がすべてあると判断するのは、`OnDiskDataSize` がファイルの大きさ以上で、**かつ** 属性に `RECALL_ON_DATA_ACCESS`（データの一部がローカルにない印）がないときだけです。
- **解除（cf.unregister_root）**：本体が確かめた後に呼ばれますが、シェルも念のため同期ルートの中にプレースホルダーが残っていないかを数え、残っていれば解除しません。

## ごみ箱（trash.confirm_and_recycle）

1. 必ず確認画面を出します。対象のファイル名・大きさと件数を示し、「ごみ箱へ移動」と「キャンセル」のボタンを置きます。最初は「キャンセル」にフォーカスがあります。
2. 「キャンセル」（Esc キー）は `cancel`、画面を閉じた場合（×、シェルの終了）は `closed` と答え、どちらも何も削除しません。表示なし（`--headless`）のときは `unavailable` と答え、何も削除しません。
3. 承認されたときだけ、1件ずつ、STA のスレッドで `IFileOperation` を使ってごみ箱へ移します。印は `FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE | FOF_NO_CONNECTED_ELEMENTS` です。
4. `PreDeleteItem` に `TSF_DELETE_RECYCLE_IF_POSSIBLE` が付いていない（ごみ箱に入らず完全に削除される）ときは、`E_ABORT` で止めて `refused` にします。`PostDeleteItem` でごみ箱の中に項目ができなかったときは `failed` にします。

## 記録（標準エラー出力）

UTF-8 で1行ずつ書きます。**ファイル名・パス・URL・ファイルの中身・ウィンドウタイトル・プロセス名は書きません**。書くのは処理の種類、件数、HRESULT、項目ID だけです。例外は種類と HRESULT だけを書きます（例外のメッセージにはパスが入ることがあるため）。パス・ファイル名・ウィンドウタイトルは、本体への答えと知らせ（標準出力）にだけ入ります。

## 確かめたこと・確かめていないこと

### Linux の開発環境で実際に確かめたこと

- `dotnet build Pip0Shell.csproj -c Release`：エラー 0、警告 0（常駐UI・入力・作業文脈を加えた後も）。
- `dotnet publish … -r win-x64 --self-contained true -p:PublishSingleFile=true`：Windows 用の実行ファイル（PE32+、GUI、x86-64、約 73 MB）が1つできること。
- `Checks/`（`cd Checks && dotnet run -c Release`）：Windows の機能を使わない部分の 283 件の確認がすべて成功。
  - 1行ずつの読み書き：1 MiB ちょうどは読める、超えた行は読み捨てて次の行を正しく読む、`\r\n`、改行なしで終わる行、BOM を付けない、1 MiB を超える答えは送らない。
  - 振り分け：init の前は `not_initialised`（`shell.ping` と `shell.quit` は受け付ける）、知らない type は `unknown_type`、type なしは `bad_request`、処理の例外は `internal_error`（例外のメッセージを答えにも記録にも入れない）、要求ごとに答えがちょうど1つ、終了中は `shutting_down`。
  - 保管庫の確認：一致すれば開ける、1バイト違う・大きさが違う・manifest が壊れている・`sha256` がない・`item_id` が違う・ファイルがない場合は開かない、項目ID でない文字列ではファイルに触れない、取り消し、進み具合の知らせ。
  - 4 KiB 単位の範囲の計算（5000 通りのばらばらな値を含む）、渡し終えた範囲の記録、項目ID、HRESULT の説明、パスの文字列の比較、設定の読み取り、確認画面の1行の表示。
  - 標準エラー出力に、例外のメッセージに含めたパスが出ないこと。
  - 置き場所の計算：点から長方形までの距離、作業領域の右下・右端の中央、ダイアログの上辺に沿う（上に入らなければ下、どちらも入らなければ上端）、はみ出しの直し方、左側の画面（負の座標）、拡大率に合わせたピクセル数。
  - デスクの接近で透過とつまみ：48px 以内で薄くなる（ちょうど 48px を含む）、0.299 秒では操作モードにならず 0.3 秒でなる、クリックですぐに操作モード、離れたら `released`、隠すときの `released`、マウスの位置を読めないときはそのまま。
  - ミニドック・デスク・警告・状態の payload の読み取り：ID は文字列か整数のまま送り返す（"1" と 1 は別）、形の違う行・候補・別の仕分け先は飛ばす、行と候補の上限、長すぎる名前、候補のない行は「提案どおり」を押せない、`dialog_rect` の形の確認、知らない `level` は橙、ツールチップは 127 文字以内。
  - ドラッグの判定：`SM_CXDRAG` までは動かしてもクリック、超えたら始まり、離したら終わり、離したことを取りこぼした場合とフックの付け直しの場合。デスクからのドラッグの記録（位置と時間の範囲）。
  - マウスの位置のまとめ方（`[ミリ秒, x, y]`、間隔、たまりすぎたときに古いものから捨てる）、前面ウィンドウの知らせのまとめ方（最後から 300ms、止まらなければ最初から 1 秒）。
  - 最近使ったファイル：対象のフォルダーの中だけ（大文字小文字、名前の先頭が同じだけの別のフォルダー）、`Start_TrackDocs` とポリシーの解釈、件数が多いときに分けて送る、当てにできないときの `tracking_enabled: null`、init の `watched_roots` の読み取り。
  - 開かない種類のファイル（`.exe`、二重の拡張子、末尾の点・空白で隠したもの等）。
  - Windows 以外では `Path` の決まりが違うため、パスを整える確認（`Path.GetFullPath`）は、その OS の絶対パスで確かめています。「..」を含むパスの確認は Windows で実行したときだけ行います。

### コンパイルだけで確かめたこと（Windows 11 の実機で確かめる必要があるもの）

- 同期ルートの登録・接続・解除（`StorageProviderSyncRootManager`、`CfConnectSyncRoot`）。
- FETCH_DATA で中身を渡すこと（`CfExecute`）、取り消し、NOTIFY_DELETE と NOTIFY_RENAME への返事。
- ゴーストの作成（`CfOpenFileWithOplock`、`CfConvertToPlaceholder`）、状態の読み取り（`CfGetPlaceholderInfo`）、復元（`CfHydratePlaceholder`、`CfRevertPlaceholder`）。特に、`OnDiskDataSize` と属性の値が、この README に書いた判断のとおりになるか。
- ファイル番号（`file_key`）の書き方が、本体の Python の `os.stat` と一致するか（Python 3.11 と 3.12 以降の両方の書き方を受け付けています）。
- 確認画面、ごみ箱へ移す処理（`IFileOperation` と進み具合の知らせ）、ごみ箱が使えないドライブで `refused` になること。
- 通知領域アイコンとメニュー（5 項目）、吹き出し、ツールチップ、状態の画面、再開の確認画面、高 DPI の表示。
- ゴーストを開いてから使えるまでの時間（`cf.fetch` の `elapsed_ms` で実測できます）。
- 常駐UI・入力・作業文脈は、**すべて Windows 11 の実機で確かめていません**（Linux ではコンパイルと、上の判定の確認だけ）。下の「実機で確かめること」を参照してください。

### 実機で確かめること（Windows 11）

| 確かめること | 見るところ |
| --- | --- |
| ミニドックが主モニターの右下に出て、ボタンを押しても作業中のアプリの入力先（キャレット）が移らない | `WS_EX_NOACTIVATE` と `WM_MOUSEACTIVATE` の効き目。WPF のボタンのクリックが前面に出ないウィンドウで動くか |
| マウスの出入りで `ui.mini_dock.interaction` が1回ずつ届く | 透明な余白で出入りしないか |
| デスクが前面のウィンドウの画面の右端に出る。マウスを近づけると薄くなり、クリックが下のウィンドウに届く。離れると戻る | `AllowsTransparency` と `WS_EX_TRANSPARENT` の組み合わせ、Opacity |
| つまみに 0.3 秒置く・クリックで操作モードになり、候補のボタンが押せる。離れると `released` | つまみが薄くならずに押せるか |
| デスクの候補を Slack・ブラウザー・エクスプローラーへドラッグしてコピーでき、`drag.started` の `source` が `"pip0"` になる | `DoDragDrop` と、フックの位置と画面の位置の一致（24px 以内） |
| ファイルダイアログ（メモ帳・Word・Chrome の「開く」）で `is_file_dialog: true` と `dialog_rect` が届き、デスクがダイアログの上辺に沿って出て、ダイアログを動かすと付いていく | AutomationId 1148 の見つけ方。「保存」のダイアログにも 1148 があるか |
| 「ダイアログに入力」で完全なパスが入る。管理者として動くアプリのダイアログでは UIPI の理由で失敗する | `ValuePattern.SetValue` と読み直し |
| 拡大率の違う複数の画面で、警告の枠が各画面の縁にぴったり出て、ドラッグとドロップを邪魔しない | `SetWindowPos`（物理ピクセル）と `DpiChanged` の後の置き直し |
| エクスプローラー（タブが複数ある Windows 11 のウィンドウを含む）とデスクトップからのドラッグで、選んだファイルのパスが `drag.started` に入る | `SID_SShellBrowser` でタブのウィンドウを見分けられるか。ドラッグ中（`DoDragDrop` の間）にエクスプローラーが答えるか（2.5 秒） |
| ドラッグ中に Slack・ブラウザーの上へ動かすと `drag.target_changed`、離すと `drag.ended` の `dropped_on_other_process: true` | 警告の枠・薄いデスクが飛ばされるか |
| タイトルバー・タスクバー・ナビゲーション ウィンドウからのドラッグ、ほかのアプリでの文字の選択では、何も送らない | `SHELLDLL_DefView` の判定。選択の枠（ラバーバンド）を描くドラッグでは、その時点で選ばれている項目が送られることがある |
| Slack で会話を切り替えると、タイトルの変化で `context.foreground` が届く（300ms まとめ） | プロセスごとのタイトルの変化のフック |
| 管理者として動くアプリが前面のとき、`inaccessible` と理由が正しく、マウスのフックの「外れた」の誤判定が起きない | UIPI と低レベルのフック |
| 画面のロック・ロック解除・スリープ・復帰・サインアウト・シャットダウンで `session.event` が届く | `SystemEvents` |
| ファイルを開くと `usage.recent_items` が届き、設定アプリで「最近開いた項目」を切ると `tracking_enabled: false` になる | Recent のショートカットの更新日時、レジストリーの値 |
| 応答の遅いフックが外されたとき（デバッガーで止める等）に付け直し、`mouse_hook` の `false` → `true` が届く | 2 秒ごとの点検 |

## docs/ipc-protocol.md との違い・補足

- `shell.ready` は、受け付けを始めた直後（`init` の前）に、ほかのどの答えよりも先に送ります。付ける `capabilities` は起動時点の見込みで、確定した値は `init` の答えです。
- `cf.hydrated` に、約束にない `by_pip0`（pip0 自身の復元で中身が戻ったとき真）を加えています。
- `trash.confirm_and_recycle` の `answer` には、表示なしのとき `unavailable` を返します（docs/design.md 6-2 の約束に合わせたもの）。
- ごみ箱へ移す印に `FOF_NO_CONNECTED_ELEMENTS` を加えています（`page.html` と一緒に `page_files` まで消さないため）。
- `cf.restore` は、`CfRevertPlaceholder` が中身を戻すことに頼らず、先に `CfHydratePlaceholder` で中身を戻させ、すべてあることを確かめてから戻します。
- `cf.make_ghost` の `file_key` は、Python 3.12 以降（64ビットのボリューム番号:128ビットのファイル番号）と 3.11 まで（32ビット:64ビット）のどちらの書き方でも照合します。
- `cf.notify_delete` と `cf.notify_rename` は、項目ID を持つファイルについてだけ送ります（フォルダーには送りません）。
- 失敗の答えの `code`：`unknown_type`、`bad_request`、`not_initialised`、`already_initialised`、`unsupported_protocol`、`shutting_down`、`too_large`、`internal_error`。
- `init` に、約束にない `watched_roots`（絶対パスの配列。「最近使ったファイル」を知らせる対象のフォルダー）を加えています。ない場合は `pip0_root` だけを対象にします。本体は `config.index_folders(config)` のフォルダーを渡すと、ダウンロード等のフォルダーの利用も届きます。
- `context.foreground`：`dialog_rect` の形は `{"left", "top", "right", "bottom"}`（物理ピクセル）。`hwnd` は整数。`inaccessible: true` のときは約束にない `reason` を付けます。pip0 自身のウィンドウが前面のときと、前と同じ内容のときは送りません。
- `drag.started`：約束にない `unidentified_count`（パスの分からない項目の数）を付けます。`drag_id` は 32 桁の16進数。知らせるのはエクスプローラー（デスクトップを含む）のフォルダー表示と pip0 のデスクからのドラッグだけです。
- `drag.ended`：離したことを確かめられなかったときは、`target_process: null`、`dropped_on_other_process: false` に約束にない `reason` を付けます。
- `ui.desk.action`：約束にない `desk_id` を付けます（`fill_dialog` には `dialog_hwnd` も）。`ui.mini_dock.action` の `alternative_index` は、`alternative` 以外では `null` です。
- `tray.command` の `resume` は、確認画面で「再開する」が押されたときだけ送り、約束にない `confirmed: true` を付けます（`killswitch.resume` の `confirmed` に使える）。
- `input.cursor_batch` の時刻は 1970年1月1日からのミリ秒（整数）です。
- `usage.recent_items` の `tracking_enabled` は、Recent フォルダーを読めない・対象のフォルダーがないときも `null` にします（当てにできないため）。
- `shell.open_file` は、開くとプログラムが動く種類（`.exe`、`.bat`、`.ps1`、`.lnk` など。`Ui/OpenableFile.cs`）を開かず、`ok: false` と理由を返します（ボタン1つで実行させないため）。`shell.fill_file_dialog`・`shell.open_file`・`shell.reveal_file` は、`* ? " < > |` を含むパスを `bad_request` で断り、表示なしのときは `ok: false` を返します。
- ミニドックの行は 20 件まで、デスクの候補は 10 件まで並べます（本体の上限より大きい、画面のための上限）。

## 変更しやすい箇所

- 通知領域のメニューの文字と順番：`Ui/TrayIcon.cs`
- 通知領域のアイコンの絵（色や形）：`Ui/TrayIconImage.cs` の `Draw`
- 確認画面の文言と見た目：`Trash/ConfirmDeleteWindow.cs`
- 利用者に見せるエラーの理由：`CloudFiles/HResultText.cs`
- 新しい要求・知らせを加える：それぞれの `…Module.cs` の `RegisterHandlers`（常駐UI・入力・作業文脈は `Ui/UiModule.cs`）
- ミニドック・デスク・警告の枠の色と文字の大きさ：`Ui/UiStyle.cs`
- ミニドック・デスクの文言と並べ方：`Ui/MiniDockWindow.cs` の `BuildRow`、`Ui/DeskWindow.cs` の `BuildCard`
- 置き場所（右下・右端・ダイアログの上辺）：`Ui/ScreenGeometry.cs`
- つまみにとどまる時間（0.3 秒）：`Ui/DeskProximity.cs` の `HoverMilliseconds`
- 状態の画面の機能の日本語の名前：`Ui/StatusText.cs` の `FeatureNames`
- 開かない種類のファイル：`Ui/OpenableFile.cs` の `RunnableExtensions`
- 前面ウィンドウの知らせをまとめる時間（300ms）：`Context/ForegroundWatcher.cs` の `QuietMilliseconds`
- ドラッグを知らせるアプリ（今はエクスプローラーと pip0 のデスク）：`Input/DragMonitor.cs` の `BeginDrag`

## 利用しているもの

| 名前 | 用途 | 利用条件 |
| --- | --- | --- |
| .NET 8（WPF、Windows Forms を含む） | 実行環境。配布用の exe に含まれる | MIT ライセンス |
| Windows SDK の .NET 向けの宣言（Microsoft.Windows.SDK.NET.Ref 10.0.19041.56、WinRT.Runtime） | `StorageProviderSyncRootManager` など WinRT の API。.NET SDK が自動で使い、配布用の exe に含まれる | Windows SDK のライセンス（https://aka.ms/WinSDKLicenseURL） |
| Microsoft.Windows.CsWin32 0.3.183 | Win32 API・COM の宣言の生成（ビルドのときだけ。実行時には含まれない） | MIT ライセンス。生成に使う Win32 のメタデータ（Microsoft.Windows.SDK.Win32Metadata 等）は Windows SDK のライセンス |

出典：各パッケージの nuspec（NuGet のパッケージの説明）に書かれた利用条件です。
