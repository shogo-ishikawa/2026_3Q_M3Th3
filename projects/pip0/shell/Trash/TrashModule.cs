using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.CloudFiles;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Pip0Shell.Ui;

namespace Pip0Shell.Trash;

/// <summary>
/// trash.confirm_and_recycle を処理する（docs/ipc-protocol.md の2節、docs/design.md の4-8）。
///
/// 1. 必ず確認画面を出し、対象のファイル名と件数を示す（自動分類や過去の許可を、この削除の許可として扱わない）。
/// 2. 「ごみ箱へ移動」が押されたときだけ、1件ずつ IFileOperation でごみ箱へ移す。
/// 3. キャンセル・画面を閉じたときは何もしない。表示なし（headless）のときは "unavailable" と答え、何もしない。
/// ごみ箱を空にする機能や、ファイルを完全に削除する機能はありません。
/// </summary>
internal sealed class TrashModule
{
    private readonly ShellState state;
    private readonly UiModule ui;
    private readonly FeatureReporter features;
    private readonly SemaphoreSlim oneDialogAtATime = new(1, 1);

    public TrashModule(ShellState state, UiModule ui, FeatureReporter features)
    {
        this.state = state;
        this.ui = ui;
        this.features = features;
    }

    public void RegisterHandlers(MessageRouter router)
    {
        router.AddRequest("trash.confirm_and_recycle", HandleConfirmAndRecycle);
    }

    /// <summary>init のとき：使えるかを確かめて feature.status（recycle_bin）で知らせる</summary>
    public bool Initialise(bool uiAvailable, bool headless)
    {
        if (headless)
        {
            features.Report(FeatureReporter.RecycleBin, false, "表示なし（headless）で動いているため、確認画面を出せません。ごみ箱へは移しません。");
            return false;
        }
        if (!uiAvailable)
        {
            features.Report(FeatureReporter.RecycleBin, false, "画面を準備できなかったため、確認画面を出せません。ごみ箱へは移しません。");
            return false;
        }
        if (!RecycleBin.Probe(out string reason))
        {
            features.Report(FeatureReporter.RecycleBin, false, "ごみ箱の操作（IFileOperation）を使えません：" + reason);
            return false;
        }
        features.Report(FeatureReporter.RecycleBin, true, "削除のたびに確認画面を出し、ごみ箱に入る場合だけ移します。");
        return true;
    }

    private RequestResult HandleConfirmAndRecycle(Payload payload, CancellationToken shutdown)
    {
        IReadOnlyList<Payload>? rawItems = payload.GetObjectArray("items");
        if (rawItems is null || rawItems.Count == 0)
        {
            return RequestResult.BadRequest("items に1件以上のファイルが必要です。");
        }

        var items = new List<TrashItem>();
        foreach (Payload raw in rawItems)
        {
            string? requested = raw.GetString("path");
            if (requested is null || !PathText.TryNormaliseAbsolute(requested, out string path))
            {
                return RequestResult.BadRequest("items の path には Windows の絶対パスが必要です。");
            }
            string name = (raw.GetString("name") ?? "").Trim();
            if (name.Length == 0)
            {
                name = System.IO.Path.GetFileName(path);
            }
            items.Add(new TrashItem(path, requested, name, raw.GetInt64("size")));
        }

        string title = (payload.GetString("title") ?? "").Trim();
        if (title.Length == 0)
        {
            title = "ごみ箱へ移動の確認";
        }
        string message = payload.GetString("message") ?? "";

        if (state.Configuration is not { Headless: false } || !ui.IsRunning)
        {
            Log.Info("確認画面を出せないため、ごみ箱への移動をしませんでした（" + items.Count + " 件）。");
            return Answer(false, "unavailable", items, "not_attempted",
                "画面を表示できない状態（表示なしで起動）のため、確認画面を出せませんでした。何も削除していません。");
        }

        // 確認画面は同時に1つだけ出す
        try
        {
            oneDialogAtATime.Wait(shutdown);
        }
        catch (OperationCanceledException)
        {
            return Answer(false, ConfirmDeleteWindow.AnswerClosed, items, "not_attempted", "シェルが終了するため、確認画面を出しませんでした。何も削除していません。");
        }

        string answer;
        try
        {
            answer = ui.Invoke(() =>
            {
                var window = new ConfirmDeleteWindow(title, message, items);
                window.ShowDialog();
                return window.Answer;
            });
        }
        catch (Exception error)
        {
            // 画面が止まっている・終了中などで出せなかった。承認されていないので、何も削除しない
            Log.Warning("確認画面を出せませんでした：" + Log.Describe(error));
            return Answer(false, "unavailable", items, "not_attempted", "確認画面を出せませんでした。何も削除していません。");
        }
        finally
        {
            oneDialogAtATime.Release();
        }

        if (answer != ConfirmDeleteWindow.AnswerApprove)
        {
            Log.Info("ごみ箱への移動は承認されませんでした（" + answer + "、" + items.Count + " 件）。");
            string reason = answer == ConfirmDeleteWindow.AnswerCancel
                ? "確認画面でキャンセルされました。何も削除していません。"
                : "確認画面が閉じられました。何も削除していません。";
            return Answer(false, answer, items, "not_attempted", reason);
        }

        List<RecycleResult> results = RecycleBin.RecycleEach(items.Select(item => item.Path).ToList(), shutdown);
        Log.Info(
            "ごみ箱への移動：承認 " + items.Count + " 件のうち、移動 " + Count(results, "recycled")
            + " 件、拒否 " + Count(results, "refused") + " 件、失敗 " + Count(results, "failed")
            + " 件、未実施 " + Count(results, "not_attempted") + " 件。");

        var array = new JsonArray();
        for (int i = 0; i < items.Count; i++)
        {
            array.Add(new JsonObject
            {
                ["path"] = items[i].RequestedPath,
                ["status"] = results[i].Status,
                ["reason"] = results[i].Reason,
            });
        }
        return RequestResult.Success(new JsonObject
        {
            ["approved"] = true,
            ["answer"] = ConfirmDeleteWindow.AnswerApprove,
            ["results"] = array,
        });
    }

    private static int Count(List<RecycleResult> results, string status) => results.Count(result => result.Status == status);

    private static RequestResult Answer(bool approved, string answer, List<TrashItem> items, string status, string reason)
    {
        var array = new JsonArray();
        foreach (TrashItem item in items)
        {
            array.Add(new JsonObject
            {
                ["path"] = item.RequestedPath,
                ["status"] = status,
                ["reason"] = reason,
            });
        }
        return RequestResult.Success(new JsonObject
        {
            ["approved"] = approved,
            ["answer"] = answer,
            ["results"] = array,
        });
    }
}
