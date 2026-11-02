using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// cf.locate の答え {"result": "found"/"not_found"/"error", "paths", "reason"} を作る（Windows の機能を使わない部分）。
///
/// - found：この項目のゴーストが見つかった（paths に場所。すべては探せなかったときも、見つかった分を返す）
/// - not_found：pip0 専用フォルダーの中をすべて探して、見つからなかった
/// - error：すべては探せず、1つも見つからなかった（「ない」とは言えない）
/// </summary>
internal static class LocateAnswer
{
    /// <summary>答えに入れる場所の最大の数（同じ項目のゴーストが何か所にもあるのは、ふつうはありえない）</summary>
    public const int MaxPaths = 20;

    public static JsonObject Build(IReadOnlyList<string> paths, bool complete, string problem)
    {
        var list = new JsonArray();
        for (int i = 0; i < paths.Count && i < MaxPaths; i++)
        {
            list.Add(paths[i]);
        }

        string result;
        string reason;
        if (paths.Count > 0)
        {
            result = "found";
            reason = paths.Count > 1 ? "同じ項目のゴーストが " + paths.Count + " か所にあります。" : "";
            if (!complete)
            {
                reason += "pip0 専用フォルダーの中をすべては探せませんでした（" + problem + "）。";
            }
        }
        else if (complete)
        {
            result = "not_found";
            reason = "pip0 専用フォルダーの中に、この項目のゴーストはありませんでした。";
        }
        else
        {
            result = "error";
            reason = "pip0 専用フォルダーの中をすべては探せなかったため、ゴーストがないとは言えません（" + problem + "）。";
        }

        return new JsonObject
        {
            ["result"] = result,
            ["paths"] = list,
            ["reason"] = reason,
        };
    }
}
