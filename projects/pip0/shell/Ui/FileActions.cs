using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.CloudFiles;
using Pip0Shell.Core;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell.Common;

namespace Pip0Shell.Ui;

/// <summary>
/// shell.open_file（既定のアプリで開く）と shell.reveal_file（エクスプローラーで場所を開いて選ぶ）。
/// どちらも本体が決めて頼むもので、シェルは頼まれたファイルを開くだけです。答えは {"ok", "reason"}。
///
/// - 開く：ShellExecuteEx（Process.Start の UseShellExecute）。ゴーストなら、開いたアプリが読むときに Windows が
///   pip0 シェルを呼び、保管庫から中身が戻ります。開くとプログラムが動く種類（<see cref="OpenableFile"/>）は開きません。
/// - 場所を開く：SHParseDisplayName と SHOpenFolderAndSelectItems（ファイルの中身は読みません）。
/// どちらも COM を使うので、STA の専用のスレッドで実行します。
/// </summary>
internal static class FileActions
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    /// <summary>ERROR_NO_ASSOCIATION（その種類のファイルを開くアプリが登録されていない）</summary>
    private const int NoAssociation = 1155;

    public static JsonObject Open(string path)
    {
        if (!DirectoryEntry.TryRead(path, out EntryInfo entry))
        {
            return Answer(false, "ファイルが見つかりません（移動・削除された可能性があります）。");
        }
        if (entry.IsDirectory)
        {
            return Answer(false, "フォルダーは開きません（場所を開いてください）。");
        }
        if (OpenableFile.IsRunnable(path))
        {
            return Answer(false, "開くとプログラムが動く種類のファイルのため、pip0 からは開きません。場所を開いて確かめてください。");
        }

        return RunOnSta(() =>
        {
            try
            {
                using Process? started = Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                Log.Info("ファイルを既定のアプリで開きました。");
                return Answer(true, "");
            }
            catch (Win32Exception error)
            {
                Log.Warning("ファイルを開けませんでした：" + Log.Describe(error));
                if (error.NativeErrorCode == NoAssociation)
                {
                    return Answer(false, "この種類のファイルを開くアプリが登録されていません。場所を開いて、開くアプリを選んでください。");
                }
                return Answer(false, "ファイルを開けませんでした：" + HResultText.Describe(HResultText.FromWin32(error.NativeErrorCode)));
            }
        });
    }

    public static JsonObject Reveal(string path)
    {
        if (!DirectoryEntry.TryRead(path, out _))
        {
            return Answer(false, "ファイルが見つかりません（移動・削除された可能性があります）。");
        }
        return RunOnSta(() => RevealCore(path));
    }

    private static unsafe JsonObject RevealCore(string path)
    {
        ITEMIDLIST* pidl = null;
        HRESULT parsed;
        fixed (char* name = path)
        {
            parsed = PInvoke.SHParseDisplayName(new PCWSTR(name), null, &pidl, 0, null);
        }
        if (parsed.Failed || pidl is null)
        {
            return Answer(false, "場所を開けませんでした：" + HResultText.Describe(parsed.Value));
        }
        try
        {
            // 項目の完全な PIDL を cidl = 0 で渡すと、その項目のあるフォルダーを開いて、項目を選んだ状態にする
            HRESULT opened = PInvoke.SHOpenFolderAndSelectItems(pidl, 0, null, 0);
            if (opened.Failed)
            {
                return Answer(false, "場所を開けませんでした：" + HResultText.Describe(opened.Value));
            }
            Log.Info("エクスプローラーでファイルの場所を開きました。");
            return Answer(true, "");
        }
        finally
        {
            PInvoke.ILFree(pidl);
        }
    }

    private static JsonObject RunOnSta(Func<JsonObject> work)
    {
        JsonObject? answer = null;
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                answer = work();
            }
            catch (Exception error)
            {
                failure = error;
            }
        })
        {
            IsBackground = true,
            Name = "pip0 file action",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(Timeout))
        {
            return Answer(false, "時間内に終わりませんでした（開く処理が応答していません）。");
        }
        if (failure is not null)
        {
            Log.Warning("ファイルの操作でエラーが起きました：" + Log.Describe(failure));
            return Answer(false, "予期しないエラーが起きました（" + failure.GetType().Name + "）。");
        }
        return answer ?? Answer(false, "結果がありません。");
    }

    private static JsonObject Answer(bool ok, string reason)
    {
        return new JsonObject
        {
            ["ok"] = ok,
            ["reason"] = reason,
        };
    }
}
