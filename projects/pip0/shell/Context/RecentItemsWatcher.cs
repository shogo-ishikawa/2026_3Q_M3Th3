using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Core;
using Pip0Shell.Ipc;

namespace Pip0Shell.Context;

/// <summary>
/// Windows の「最近使ったファイル」（%APPDATA%\Microsoft\Windows\Recent の *.lnk）を読み、usage.recent_items で本体へ知らせる
/// （M4 の「長期間未読」の判定に使う利用の記録。docs/design.md 4-6）。
///
/// 1. 始めたときに全部読み、watched_roots の中のファイルを指すものだけを知らせる（opened_at はショートカットの更新日時）。
/// 2. FileSystemWatcher で Recent フォルダーを見張り、増えた・更新されたショートカットだけを、1.5 秒まとめて知らせる。
/// 3. 見張りが取りこぼした（バッファーがあふれた）ときと、1時間ごとに、全部を読み直して、変わったものだけを知らせる。
///
/// tracking_enabled は毎回レジストリーから読み直します。Recent フォルダーを読めない・watched_roots がないときは null（当てにできない）。
/// ショートカットの指す先のファイルには触れません。パスは記録（ログ）に書きません。
/// </summary>
internal sealed class RecentItemsWatcher
{
    private const long QuietMilliseconds = 1500;
    private const long MaxWaitMilliseconds = 10_000;
    private static readonly TimeSpan RescanInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan RescanIntervalWithoutWatcher = TimeSpan.FromMinutes(10);

    private readonly ShellOutput output;
    private readonly FeatureReporter features;
    private readonly object gate = new();
    private readonly HashSet<string> changedLinks = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, CachedLink> cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Debouncer debouncer = new(QuietMilliseconds, MaxWaitMilliseconds);
    private readonly AutoResetEvent wake = new(false);
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private IReadOnlyList<string> roots = Array.Empty<string>();
    private FileSystemWatcher? watcher;
    private Thread? thread;
    private volatile bool stopping;
    private bool overflowed;

    public RecentItemsWatcher(ShellOutput output, FeatureReporter features)
    {
        this.output = output;
        this.features = features;
    }

    /// <summary>読み取りのスレッドを始める（結果は feature.status と usage.recent_items で知らせる。待たない）</summary>
    public void Start(IReadOnlyList<string> watchedRoots)
    {
        roots = watchedRoots;
        thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "pip0 recent items",
        };
        // ShellLink（COM の部品）を使うので STA にする
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
    }

    public void Stop()
    {
        stopping = true;
        wake.Set();
        try
        {
            watcher?.Dispose();
        }
        catch (Exception)
        {
            // 終了のときの後片付けの失敗は無視する
        }
        thread?.Join(TimeSpan.FromSeconds(3));
    }

    private void Run()
    {
        try
        {
            RunCore();
        }
        catch (Exception error)
        {
            Log.Error("「最近使ったファイル」の読み取りが止まりました：" + Log.Describe(error));
            features.Report(FeatureReporter.RecentItems, false, "「最近使ったファイル」の読み取りが、予期しないエラーで止まりました（" + error.GetType().Name + "）。");
            SendUnreliable();
        }
    }

    private void RunCore()
    {
        if (roots.Count == 0)
        {
            features.Report(FeatureReporter.RecentItems, false, "対象のフォルダー（watched_roots・pip0_root）が init で渡されていないため、「最近使ったファイル」を知らせません。");
            SendUnreliable();
            return;
        }

        string folder = Environment.GetFolderPath(Environment.SpecialFolder.Recent);
        if (folder.Length == 0 || !Directory.Exists(folder))
        {
            features.Report(FeatureReporter.RecentItems, false, "「最近使ったファイル」のフォルダー（Recent）が見つかりません。");
            SendUnreliable();
            return;
        }

        if (!FullScan(folder, sendAll: true))
        {
            features.Report(FeatureReporter.RecentItems, false, "「最近使ったファイル」のフォルダー（Recent）を読めません。");
            SendUnreliable();
            return;
        }

        TimeSpan rescanInterval = RescanInterval;
        string note = "";
        if (!StartWatcher(folder))
        {
            rescanInterval = RescanIntervalWithoutWatcher;
            note = "（フォルダーの変化を見張れないため、10 分ごとに読み直します）";
        }
        features.Report(FeatureReporter.RecentItems, true, "Windows の「最近使ったファイル」から、対象のフォルダーの中のファイルの利用を知らせます" + note + "。");

        DateTime nextRescan = DateTime.UtcNow + rescanInterval;
        while (!stopping)
        {
            long? due = debouncer.DueAt();
            long now = clock.ElapsedMilliseconds;
            TimeSpan untilRescan = nextRescan - DateTime.UtcNow;
            long waitMs = (long)Math.Max(0, untilRescan.TotalMilliseconds);
            if (due is not null)
            {
                waitMs = Math.Min(waitMs, Math.Max(0, due.Value - now));
            }
            wake.WaitOne((int)Math.Min(waitMs, int.MaxValue));
            if (stopping)
            {
                break;
            }

            bool rescan;
            lock (gate)
            {
                rescan = overflowed;
                overflowed = false;
            }
            if (rescan || DateTime.UtcNow >= nextRescan)
            {
                if (!FullScan(folder, sendAll: false))
                {
                    Log.Warning("「最近使ったファイル」のフォルダーを読み直せませんでした。");
                }
                nextRescan = DateTime.UtcNow + rescanInterval;
                continue;
            }
            if (debouncer.TryFire(clock.ElapsedMilliseconds))
            {
                ProcessChanged();
            }
        }
    }

    /// <summary>Recent フォルダーを全部読む。sendAll が偽なら、前と変わったものだけを知らせる。フォルダーを読めなければ偽</summary>
    private bool FullScan(string folder, bool sendAll)
    {
        List<string> links;
        try
        {
            links = new List<string>(Directory.EnumerateFiles(folder, "*.lnk", SearchOption.TopDirectoryOnly));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            Log.Warning("Recent フォルダーを読めませんでした：" + Log.Describe(error));
            return false;
        }

        var seen = new HashSet<string>(links, StringComparer.OrdinalIgnoreCase);
        foreach (string stale in new List<string>(cache.Keys))
        {
            if (!seen.Contains(stale))
            {
                cache.Remove(stale);
            }
        }

        var items = new List<RecentItem>();
        foreach (string link in links)
        {
            if (stopping)
            {
                return true;
            }
            if (Resolve(link, out RecentItem item, out bool changed) && (sendAll || changed))
            {
                items.Add(item);
            }
        }
        Send(items);
        Log.Info("「最近使ったファイル」を読みました（ショートカット " + links.Count + " 件、知らせたもの " + items.Count + " 件）。");
        return true;
    }

    /// <summary>見張りで変化があったショートカットだけを読み、知らせる</summary>
    private void ProcessChanged()
    {
        List<string> links;
        lock (gate)
        {
            links = new List<string>(changedLinks);
            changedLinks.Clear();
        }
        var items = new List<RecentItem>();
        foreach (string link in links)
        {
            if (Resolve(link, out RecentItem item, out bool changed) && changed)
            {
                items.Add(item);
            }
        }
        if (items.Count > 0)
        {
            Send(items);
        }
    }

    /// <summary>
    /// 1つのショートカットを読む。対象のフォルダーの中のファイルを指していれば真（item に入れる）。
    /// changed：前に読んだときから更新日時が変わった（初めて読んだときも真）
    /// </summary>
    private bool Resolve(string link, out RecentItem item, out bool changed)
    {
        item = default;
        changed = false;
        DateTime lastWrite;
        try
        {
            if (!File.Exists(link))
            {
                cache.Remove(link);
                return false;
            }
            lastWrite = File.GetLastWriteTimeUtc(link);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }

        string? target;
        if (cache.TryGetValue(link, out CachedLink cached) && cached.LastWriteUtc == lastWrite)
        {
            target = cached.Target;
        }
        else
        {
            target = ShellLinkReader.ReadTarget(link);
            cache[link] = new CachedLink(lastWrite, target);
            changed = true;
        }

        if (target is null || !RecentItems.IsInsideAny(target, roots))
        {
            return false;
        }
        item = new RecentItem(target, lastWrite);
        return true;
    }

    private void Send(IReadOnlyList<RecentItem> items)
    {
        bool? tracking = RecentItems.InterpretTracking(RecentTrackingSetting.Read());
        foreach (JsonObject payload in RecentItems.BuildMessages(tracking, items))
        {
            output.SendEvent("usage.recent_items", payload);
        }
    }

    /// <summary>「最近使ったファイル」を当てにできないことを知らせる（tracking_enabled: null）</summary>
    private void SendUnreliable()
    {
        foreach (JsonObject payload in RecentItems.BuildMessages(null, Array.Empty<RecentItem>()))
        {
            output.SendEvent("usage.recent_items", payload);
        }
    }

    private bool StartWatcher(string folder)
    {
        try
        {
            watcher = new FileSystemWatcher(folder, "*.lnk")
            {
                IncludeSubdirectories = false,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
                InternalBufferSize = 64 * 1024,
            };
            watcher.Created += OnLinkChanged;
            watcher.Changed += OnLinkChanged;
            watcher.Renamed += (_, e) => Remember(e.FullPath);
            watcher.Error += (_, _) =>
            {
                lock (gate)
                {
                    overflowed = true;
                }
                wake.Set();
            };
            watcher.EnableRaisingEvents = true;
            return true;
        }
        catch (Exception error) when (error is IOException or ArgumentException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            Log.Warning("Recent フォルダーの変化を見張れません：" + Log.Describe(error));
            watcher?.Dispose();
            watcher = null;
            return false;
        }
    }

    private void OnLinkChanged(object sender, FileSystemEventArgs e) => Remember(e.FullPath);

    private void Remember(string path)
    {
        if (!path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }
        lock (gate)
        {
            changedLinks.Add(path);
        }
        debouncer.Signal(clock.ElapsedMilliseconds);
        wake.Set();
    }

    private readonly record struct CachedLink(DateTime LastWriteUtc, string? Target);
}
