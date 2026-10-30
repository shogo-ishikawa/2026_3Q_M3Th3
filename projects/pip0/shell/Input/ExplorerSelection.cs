using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Pip0Shell.CloudFiles;
using Pip0Shell.Core;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Ole;
using Windows.Win32.UI.Shell;
using ComServiceProvider = Windows.Win32.System.Com.IServiceProvider;

namespace Pip0Shell.Input;

/// <summary>エクスプローラーで選ばれていた項目を読んだ結果</summary>
/// <param name="Ok">読めた（項目が0件のこともある）</param>
/// <param name="Paths">ファイル・フォルダーの完全なパス</param>
/// <param name="Unidentified">パスが分からなかった項目の数（コントロール パネルの項目、ZIP の中など）</param>
/// <param name="Reason">読めなかった理由（日本語）</param>
internal sealed record SelectionResult(bool Ok, IReadOnlyList<string> Paths, int Unidentified, string Reason)
{
    public static SelectionResult Unavailable(string reason) => new(false, Array.Empty<string>(), 0, reason);
}

/// <summary>
/// エクスプローラーのウィンドウ（デスクトップを含む）で選ばれている項目を、シェルのオートメーションで読む
/// （Shell.Application の Windows() と同じ ShellWindows の COM。docs/design.md 4-7）。
///
/// - COM の呼び出しは STA の専用のスレッドで行う（エクスプローラーの部品は STA で使う決まりのため）。
/// - ウィンドウの見分け方：ShellWindows の各ウィンドウの HWND が、ドラッグを始めた位置のトップレベルのウィンドウと同じもの。
///   Windows 11 のタブでは同じ HWND のものが複数あるので、各タブのウィンドウ（IOleWindow.GetWindow）の中に
///   押した位置のウィンドウがあるものを選ぶ。
/// - デスクトップ：IShellWindows.FindWindowSW（SWC_DESKTOP）で探す。
/// - 選ばれている項目：Document（IShellFolderViewDual）の SelectedItems() の Path。
/// 何かが読めなければ、推測せずに「読めなかった」と理由を返します。
/// </summary>
internal sealed class ExplorerSelection
{
    /// <summary>送る項目の数の上限。超えたら「読めなかった」にする（一部だけを送って、機密の判定を誤らせないため）</summary>
    public const int MaxItems = 1000;

    /// <summary>送るパスの文字数の合計の上限（1行 1 MiB の約束に収めるため）</summary>
    public const int MaxTotalPathChars = 256 * 1024;

    /// <summary>
    /// SID_SShellBrowser（Windows SDK の shlguid.h で IID_IShellBrowser と同じ値）。
    /// CsWin32 の一覧にない定数なので、ここに値を書いています。
    /// </summary>
    private static readonly Guid ShellBrowserService = new("000214E2-0000-0000-C000-000000000046");

    private readonly BlockingCollection<Job> jobs = new();
    private readonly Action? recovered;
    private Thread? thread;
    private volatile bool busy;
    private volatile bool working;

    /// <param name="recovered">
    /// 準備の確認（Start）に失敗した後、問い合わせに初めて答えられたときに呼ぶ（機能の状態を「使える」に戻すため）。
    /// 問い合わせのたびに ShellWindows を作り直すので、エクスプローラーが再起動中だっただけなら、後で読めるようになる。
    /// </param>
    public ExplorerSelection(Action? recovered = null)
    {
        this.recovered = recovered;
    }

    /// <summary>STA のスレッドを始め、ShellWindows を作れるかを確かめる（失敗しても、スレッドは止めない）</summary>
    public bool Start(out string reason)
    {
        thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "pip0 explorer selection",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Task<SelectionResult> probe = Enqueue(Probe);
        if (!probe.Wait(TimeSpan.FromSeconds(10)))
        {
            reason = "エクスプローラーの部品（ShellWindows）の準備が時間内に終わりませんでした。";
            return false;
        }
        reason = probe.Result.Reason;
        working = probe.Result.Ok;
        return probe.Result.Ok;
    }

    public void Stop()
    {
        jobs.CompleteAdding();
        thread?.Join(TimeSpan.FromSeconds(3));
    }

    /// <summary>
    /// root（トップレベルのウィンドウ）の、pointed（押した位置のウィンドウ）を含むタブで選ばれている項目を読む。
    /// desktop が真ならデスクトップの項目を読む。timeout を過ぎたら「読めなかった」を返す。
    /// </summary>
    public SelectionResult Query(nint root, nint pointed, bool desktop, TimeSpan timeout)
    {
        if (busy)
        {
            return SelectionResult.Unavailable("前の問い合わせにエクスプローラーがまだ答えていません。");
        }
        Task<SelectionResult> task;
        try
        {
            task = Enqueue(() => desktop ? ReadDesktop() : ReadWindow(new HWND(root), new HWND(pointed)));
        }
        catch (InvalidOperationException)
        {
            return SelectionResult.Unavailable("シェルが終了の処理中です。");
        }
        if (!task.Wait(timeout))
        {
            return SelectionResult.Unavailable("エクスプローラーが時間内に答えませんでした。");
        }
        SelectionResult result = task.Result;
        if (result.Ok && !working)
        {
            working = true;
            recovered?.Invoke();
        }
        return result;
    }

    private Task<SelectionResult> Enqueue(Func<SelectionResult> work)
    {
        var job = new Job(work);
        jobs.Add(job);
        return job.Completion.Task;
    }

    private void Run()
    {
        foreach (Job job in jobs.GetConsumingEnumerable())
        {
            busy = true;
            try
            {
                job.Completion.TrySetResult(job.Work());
            }
            catch (Exception error)
            {
                Log.Warning("エクスプローラーの選択項目を読めませんでした：" + Log.Describe(error));
                job.Completion.TrySetResult(SelectionResult.Unavailable(
                    "エクスプローラーの選択項目を読めませんでした：" + HResultText.Describe(error.HResult)));
            }
            finally
            {
                busy = false;
            }
        }
    }

    private static SelectionResult Probe()
    {
        object windows = new ShellWindows();
        try
        {
            _ = ((IShellWindows)windows).Count;
            return new SelectionResult(true, Array.Empty<string>(), 0, "");
        }
        finally
        {
            Release(windows);
        }
    }

    private static SelectionResult ReadDesktop()
    {
        object windows = new ShellWindows();
        object? desktop = null;
        try
        {
            object location = (int)PInvoke.CSIDL_DESKTOP;
            object? empty = null;
            desktop = ((IShellWindows)windows).FindWindowSW(
                in location,
                in empty,
                ShellWindowTypeConstants.SWC_DESKTOP,
                out _,
                ShellWindowFindWindowOptions.SWFO_NEEDDISPATCH);
            if (desktop is not IWebBrowserApp browser)
            {
                return SelectionResult.Unavailable("デスクトップのフォルダー表示を見つけられませんでした（FindWindowSW）。");
            }
            return ReadSelection(browser);
        }
        finally
        {
            Release(desktop);
            Release(windows);
        }
    }

    private static SelectionResult ReadWindow(HWND root, HWND pointed)
    {
        object windows = new ShellWindows();
        var candidates = new List<IWebBrowserApp>();
        try
        {
            var shellWindows = (IShellWindows)windows;
            int count = shellWindows.Count;
            for (int i = 0; i < count; i++)
            {
                object? item = null;
                try
                {
                    item = shellWindows.Item(i);
                    if (item is IWebBrowserApp browser && browser.HWND.Value == (nint)(IntPtr)root)
                    {
                        candidates.Add(browser);
                        item = null; // candidates が持つ
                    }
                }
                catch (COMException)
                {
                    // 閉じかけのウィンドウなど。飛ばす
                }
                finally
                {
                    Release(item);
                }
            }

            if (candidates.Count == 0)
            {
                return SelectionResult.Unavailable("ドラッグを始めたエクスプローラーのウィンドウを、ShellWindows の中に見つけられませんでした。");
            }
            IWebBrowserApp? chosen = candidates.Count == 1 ? candidates[0] : ChooseTab(candidates, pointed);
            if (chosen is null)
            {
                return SelectionResult.Unavailable("エクスプローラーのどのタブからのドラッグかを見分けられませんでした。");
            }
            return ReadSelection(chosen);
        }
        finally
        {
            foreach (IWebBrowserApp candidate in candidates)
            {
                Release(candidate);
            }
            Release(windows);
        }
    }

    /// <summary>
    /// 同じウィンドウの複数のタブから、押した位置のウィンドウを中に持つタブを選ぶ。
    /// タブごとのブラウザー（SID_SShellBrowser）の IOleWindow.GetWindow は、そのタブのウィンドウ（ShellTabWindowClass）を返す。
    /// </summary>
    private static IWebBrowserApp? ChooseTab(List<IWebBrowserApp> candidates, HWND pointed)
    {
        foreach (Guid service in new[] { ShellBrowserService, PInvoke.SID_STopLevelBrowser })
        {
            var matches = new List<IWebBrowserApp>();
            foreach (IWebBrowserApp candidate in candidates)
            {
                HWND tab = BrowserWindow(candidate, service);
                if (!tab.IsNull && (tab == pointed || PInvoke.IsChild(tab, pointed)))
                {
                    matches.Add(candidate);
                }
            }
            if (matches.Count == 1)
            {
                return matches[0];
            }
            // 0 件、または複数のタブが当てはまる（見分けられない）ときは、次の方法を試す。推測で選ばない
        }
        return null;
    }

    /// <summary>service のブラウザーのウィンドウ。調べられなければ HWND.Null</summary>
    private static unsafe HWND BrowserWindow(IWebBrowserApp candidate, Guid service)
    {
        object? browser = null;
        try
        {
            Guid iid = typeof(IOleWindow).GUID;
            ((ComServiceProvider)candidate).QueryService(&service, &iid, out browser);
            HWND window;
            ((IOleWindow)browser).GetWindow(&window);
            return window;
        }
        catch (Exception error) when (error is COMException or InvalidCastException)
        {
            return HWND.Null; // このタブは調べられなかった
        }
        finally
        {
            Release(browser);
        }
    }

    private static SelectionResult ReadSelection(IWebBrowserApp browser)
    {
        object? document = null;
        FolderItems? selected = null;
        try
        {
            document = browser.Document;
            if (document is not IShellFolderViewDual view)
            {
                return SelectionResult.Unavailable("このウィンドウはフォルダーを表示していないため、選ばれている項目を読めません。");
            }
            selected = view.SelectedItems();
            int count = selected.Count;
            if (count > MaxItems)
            {
                return SelectionResult.Unavailable("選ばれている項目が多すぎるため（" + count + " 件）、項目を送りません。");
            }

            var paths = new List<string>();
            int unidentified = 0;
            int totalChars = 0;
            for (int i = 0; i < count; i++)
            {
                string? path = ReadPath(selected, i);
                if (path is null)
                {
                    unidentified++;
                    continue;
                }
                totalChars += path.Length;
                if (totalChars > MaxTotalPathChars)
                {
                    return SelectionResult.Unavailable("選ばれている項目のパスが長すぎるため、項目を送りません。");
                }
                paths.Add(path);
            }
            if (count > 0 && paths.Count == 0)
            {
                return new SelectionResult(false, paths, unidentified, "選ばれている項目は、ファイルの場所が分からない種類です（仮想フォルダーの項目など）。");
            }
            string reason = unidentified > 0
                ? "選ばれている項目のうち " + unidentified + " 件は、ファイルの場所が分からないため含めていません。"
                : "";
            return new SelectionResult(true, paths, unidentified, reason);
        }
        finally
        {
            Release(selected);
            Release(document);
        }
    }

    /// <summary>i 番目の項目のパス。ファイルシステムの項目でなければ null</summary>
    private static string? ReadPath(FolderItems items, int index)
    {
        FolderItem? item = null;
        try
        {
            item = items.Item(index);
            if (item is null || item.IsFileSystem.Value == 0)
            {
                return null;
            }
            BSTR path = item.Path;
            try
            {
                string? text = path.ToString();
                return text is not null && PathText.TryNormaliseAbsolute(text, out _) ? text : null;
            }
            finally
            {
                if ((IntPtr)path != IntPtr.Zero)
                {
                    Marshal.FreeBSTR(path);
                }
            }
        }
        catch (COMException)
        {
            return null;
        }
        finally
        {
            Release(item);
        }
    }

    private static void Release(object? comObject)
    {
        if (comObject is not null && Marshal.IsComObject(comObject))
        {
            Marshal.ReleaseComObject(comObject);
        }
    }

    private sealed class Job
    {
        public Job(Func<SelectionResult> work)
        {
            Work = work;
        }

        public Func<SelectionResult> Work { get; }

        public TaskCompletionSource<SelectionResult> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
