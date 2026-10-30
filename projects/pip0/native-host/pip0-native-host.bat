@echo off
rem pip0 native messaging host launcher (pip0.bridge).
rem Chrome and Edge start this file through cmd.exe; it is not meant to be run by hand.
rem It runs the dedicated Python runtime of the installed layout (docs/design.md 6-9):
rem   InstallDir\native-host\pip0-native-host.bat   (this file)
rem   InstallDir\runtime\python.exe                 (pip0 own Python, finds InstallDir\app)
rem The browser passes the caller origin (chrome-extension://ID/) and, on Windows,
rem the --parent-window=N option. Both are handed on unchanged.
rem Keep this file ASCII-only with CRLF line endings: cmd.exe reads batch files in the
rem console code page. Nothing else may print to standard output, because standard
rem output carries the native messaging reply.
"%~dp0..\runtime\python.exe" -I -m pip0.native_host %*
