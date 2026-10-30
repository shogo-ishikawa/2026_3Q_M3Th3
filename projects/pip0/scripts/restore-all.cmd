@echo off
setlocal
rem pip0: restore all evacuated files (kill switch) without the graphical interface.
rem Keep every line before the "chcp.com 65001" line ASCII-only: until the code page is
rem switched, cmd.exe reads this file in the console code page (932 on Japanese Windows).
set "PIP0_OLD_CP="
for /f "tokens=*" %%A in ('chcp') do for %%B in (%%A) do set "PIP0_OLD_CP=%%B"
if defined PIP0_OLD_CP set "PIP0_OLD_CP=%PIP0_OLD_CP:.=%"
"%SystemRoot%\System32\chcp.com" 65001 >nul
rem ===========================================================================
rem pip0 の全復元（キルスイッチ）を、画面（UI）を使わずに実行します。
rem   1. 新しい自動仕分け・自動改名・自動退避を止めます（停止の印を書きます）
rem   2. 保管庫に退避したファイルを、元の場所へ1件ずつ戻します
rem      （途中で止まっても、もう一度実行すると続きから戻します）
rem pip0 が動いていれば、その pip0 に依頼して進み具合を表示します。
rem 動いていなければ、このコマンドが pip0 シェルを画面なしで起動して戻します。
rem 戻すのは pip0 が退避したファイルだけです。自動仕分け・自動改名は戻しません。
rem
rem 書き方の約束：このファイルは UTF-8（BOM なし）、改行は CRLF です。
rem 上の chcp.com 65001 の行より前には、日本語を書かないでください。
rem 画面に出す文には、半角の記号（かっこ、アンド、縦線、不等号、山形、パーセント）を使わないでください。
rem ===========================================================================

rem 導入先：このファイルが導入先の scripts フォルダーにあれば、その導入先。なければ既定の導入先
set "PIP0_HOME=%LOCALAPPDATA%\Programs\pip0"
if exist "%~dp0..\pip0-install.json" for %%I in ("%~dp0..") do set "PIP0_HOME=%%~fI"
set "PIP0_PYTHON=%PIP0_HOME%\runtime\python.exe"
set "PIP0_EXIT=1"

echo pip0 の全復元
echo   自動処理を止めて、保管庫に退避したファイルを元の場所に戻します。
echo   戻すのは pip0 が退避したファイルだけです（自動仕分け・自動改名は戻しません）。
echo.

rem 本体：pip0 専用の Python で「python -I -m pip0 restore-all」を実行します
if exist "%PIP0_PYTHON%" "%PIP0_PYTHON%" -I -m pip0 restore-all
if exist "%PIP0_PYTHON%" set "PIP0_EXIT=%ERRORLEVEL%"

echo.
if not exist "%PIP0_PYTHON%" echo pip0 専用の Python が見つかりません："%PIP0_PYTHON%"
if not exist "%PIP0_PYTHON%" echo pip0 を導入し直してから、もう一度実行してください（docs\setup-windows.md）。
if not exist "%PIP0_PYTHON%" echo 退避したファイルは、保管庫に残っています。手で取り出す方法は、次のファイルにあります。
if not exist "%PIP0_PYTHON%" echo   "%LOCALAPPDATA%\pip0\vault\README.txt"
if exist "%PIP0_PYTHON%" if "%PIP0_EXIT%"=="0" echo 全復元の処理が終わりました。上の結果（成功・衝突・失敗の件数）を確かめてください。
if exist "%PIP0_PYTHON%" if not "%PIP0_EXIT%"=="0" echo 全復元で問題がありました（終了コード %PIP0_EXIT%）。上の表示を確かめてください。もう一度実行すると、続きから戻します。
echo 自動処理は止まったままです。再開するときは、通知領域の pip0 のアイコンの「自動処理を再開」を使います。
echo.
pause
if defined PIP0_OLD_CP "%SystemRoot%\System32\chcp.com" %PIP0_OLD_CP% >nul 2>&1
endlocal & exit /b %PIP0_EXIT%
