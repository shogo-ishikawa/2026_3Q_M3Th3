@echo off
setlocal
rem pip0: start the resident process (runtime\pythonw.exe -I -m pip0 serve) without a console.
rem Keep every line before the "chcp.com 65001" line ASCII-only (see restore-all.cmd).
set "PIP0_OLD_CP="
for /f "tokens=*" %%A in ('chcp') do for %%B in (%%A) do set "PIP0_OLD_CP=%%B"
if defined PIP0_OLD_CP set "PIP0_OLD_CP=%PIP0_OLD_CP:.=%"
"%SystemRoot%\System32\chcp.com" 65001 >nul
rem ===========================================================================
rem pip0 を起動します。画面のない Python（pythonw.exe）で「-I -m pip0 serve」を動かします。
rem pip0 シェル（通知領域のアイコン、ミニドック等）は、この常駐処理が起動します。
rem 止めるときは、通知領域の pip0 のアイコンの「終了」を使います。
rem
rem 書き方の約束：このファイルは UTF-8（BOM なし）、改行は CRLF です。
rem 上の chcp.com 65001 の行より前には、日本語を書かないでください。
rem ===========================================================================

rem 導入先：このファイルが導入先の scripts フォルダーにあれば、その導入先。なければ既定の導入先
set "PIP0_HOME=%LOCALAPPDATA%\Programs\pip0"
if exist "%~dp0..\pip0-install.json" for %%I in ("%~dp0..") do set "PIP0_HOME=%%~fI"
set "PIP0_PYTHONW=%PIP0_HOME%\runtime\pythonw.exe"
set "PIP0_EXIT=0"

rem 本体：作業フォルダーを導入先にして、pythonw.exe を起動します（このウィンドウは待たずに閉じます）
if exist "%PIP0_PYTHONW%" start "" /D "%PIP0_HOME%" "%PIP0_PYTHONW%" -I -m pip0 serve
if exist "%PIP0_PYTHONW%" echo pip0 を起動しました。通知領域に pip0 のアイコンが出ます。
if exist "%PIP0_PYTHONW%" echo アイコンが出ないときは、docs\setup-windows.md の「困ったとき」を見てください。

if not exist "%PIP0_PYTHONW%" set "PIP0_EXIT=1"
if not exist "%PIP0_PYTHONW%" echo pip0 が見つかりません："%PIP0_PYTHONW%"
if not exist "%PIP0_PYTHONW%" echo 先に scripts\install.ps1 で導入してください（docs\setup-windows.md）。
if not exist "%PIP0_PYTHONW%" pause
if defined PIP0_OLD_CP "%SystemRoot%\System32\chcp.com" %PIP0_OLD_CP% >nul 2>&1
endlocal & exit /b %PIP0_EXIT%
