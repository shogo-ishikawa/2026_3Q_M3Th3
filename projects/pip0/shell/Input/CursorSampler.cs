using System;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Windows.Win32;

namespace Pip0Shell.Input;

/// <summary>
/// デスクの表示中だけ、マウスの位置を一定の間隔で調べ、まとめて input.cursor_batch で本体へ送る
/// （シェイクの判定は本体の desk.ShakeDetector が行う。docs/design.md 4-4）。
///
/// - shell.cursor_stream {"enabled": true} で始め、{"enabled": false} で止める（いつ始めるかは本体が決める）。
/// - cursor_sample_ms ごとに GetCursorPos で調べ、cursor_batch_ms ごとに [ミリ秒, x, y] の並びを送る。
///   ミリ秒は 1970年1月1日からの時刻で、止めた時計に合わせて単調に増える（時計の調整で戻らない）。
/// - 2 秒続けて位置を読めない（画面のロック中など）ときは、feature.status（cursor_sampler）で知らせる。
/// </summary>
internal sealed class CursorSampler
{
    private const long FailureReportMs = 2000;

    private readonly ShellOutput output;
    private readonly FeatureReporter features;
    private readonly object gate = new();
    private Thread? thread;
    private ManualResetEventSlim? stopSignal;
    private bool failing;

    public CursorSampler(ShellOutput output, FeatureReporter features)
    {
        this.output = output;
        this.features = features;
    }

    /// <summary>マウスの位置を読めるかを1回だけ確かめる（init のとき）</summary>
    public static bool Probe(out string reason)
    {
        if (PInvoke.GetCursorPos(out _))
        {
            reason = "";
            return true;
        }
        reason = "マウスの位置（GetCursorPos）を読めません。シェイクの判定に使う位置を送れません。";
        return false;
    }

    public bool IsRunning
    {
        get
        {
            lock (gate)
            {
                return thread is not null;
            }
        }
    }

    /// <summary>送り始める（すでに動いていれば何もしない）</summary>
    public void Start(int sampleMs, int batchMs)
    {
        lock (gate)
        {
            if (thread is not null)
            {
                return;
            }
            var signal = new ManualResetEventSlim(false);
            stopSignal = signal;
            thread = new Thread(() => Run(sampleMs, batchMs, signal))
            {
                IsBackground = true,
                Name = "pip0 cursor sampler",
            };
            thread.Start();
        }
        Log.Info("マウスの位置を送り始めました。");
    }

    /// <summary>止める（たまっている分は送ってから止まる）</summary>
    public void Stop()
    {
        Thread? running;
        lock (gate)
        {
            running = thread;
            stopSignal?.Set();
            thread = null;
            stopSignal = null;
        }
        if (running is not null)
        {
            running.Join(TimeSpan.FromSeconds(2));
            Log.Info("マウスの位置を送るのを止めました。");
        }
    }

    private void Run(int sampleMs, int batchMs, ManualResetEventSlim stop)
    {
        try
        {
            var clock = Stopwatch.StartNew();
            long epochMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var batcher = new CursorBatcher(batchMs, 0);
            long nextSample = 0;
            long failingSince = -1;

            while (!stop.IsSet)
            {
                long now = clock.ElapsedMilliseconds;
                if (now >= nextSample)
                {
                    if (PInvoke.GetCursorPos(out System.Drawing.Point point))
                    {
                        batcher.Add(epochMs + now, point.X, point.Y);
                        failingSince = -1;
                        ReportFailing(false);
                    }
                    else
                    {
                        if (failingSince < 0)
                        {
                            failingSince = now;
                        }
                        if (now - failingSince >= FailureReportMs)
                        {
                            ReportFailing(true);
                        }
                    }
                    nextSample += sampleMs;
                    if (nextSample <= now)
                    {
                        nextSample = now + sampleMs; // 遅れた分をまとめて取り返さない
                    }
                }

                JsonObject? payload = batcher.TakeIfDue(now);
                if (payload is not null)
                {
                    output.SendEvent("input.cursor_batch", payload);
                }

                long wait = Math.Min(nextSample, batcher.NextFlushAt) - clock.ElapsedMilliseconds;
                stop.Wait((int)Math.Clamp(wait, 1, 1000));
            }

            JsonObject? rest = batcher.TakeAll();
            if (rest is not null)
            {
                output.SendEvent("input.cursor_batch", rest);
            }
        }
        catch (Exception error)
        {
            Log.Error("マウスの位置を送る処理が止まりました：" + Log.Describe(error));
            features.Report(FeatureReporter.CursorSampler, false, "マウスの位置を送る処理が、予期しないエラーで止まりました（" + error.GetType().Name + "）。");
        }
    }

    private void ReportFailing(bool nowFailing)
    {
        if (nowFailing == failing)
        {
            return;
        }
        failing = nowFailing;
        features.Report(
            FeatureReporter.CursorSampler,
            !nowFailing,
            nowFailing
                ? "マウスの位置を読めません（画面のロック中など）。シェイクの判定に使う位置を送れません。"
                : "マウスの位置を、また読めるようになりました。");
    }
}
