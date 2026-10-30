using System;
using Pip0Shell.Core;

namespace Pip0Shell.Checks;

/// <summary>
/// pip0 シェルの、Windows の機能を使わない部分を確かめる。
/// 失敗した確認は「NG」と表示し、失敗が1つでもあれば終了コード 1 を返します。
/// シェルの記録（標準エラー出力）にパスが書かれていないかは、実行した人が標準エラー出力を見て確かめます
/// （README.md の手順を参照）。
/// </summary>
internal static class Program
{
    private static int passed;
    private static int failed;

    public static int Main()
    {
        Log.Initialise();
        Section("1行ずつの読み書き（Ipc/JsonLineChannel、IncomingMessage）", ChannelChecks.Run);
        Section("要求と知らせの振り分け（Ipc/MessageRouter、ShellOutput）", RouterChecks.Run);
        Section("保管庫の確認（CloudFiles/VaultContent）", VaultChecks.Run);
        Section("範囲の計算と小さな道具（TransferRange、HydrationTracker ほか）", SmallChecks.Run);
        Section("常駐UI の判定（置き場所、接近で透過、ミニドック・デスク・警告・状態の読み取り）", UiChecks.Run);
        Section("入力と作業文脈の判定（ドラッグ、マウスの位置、まとめ、最近使ったファイル）", InputChecks.Run);
        Console.WriteLine();
        Console.WriteLine("結果：成功 " + passed + " 件、失敗 " + failed + " 件");
        return failed == 0 ? 0 : 1;
    }

    /// <summary>condition が真なら成功として数え、偽なら「NG」と表示する</summary>
    public static void Check(bool condition, string what)
    {
        if (condition)
        {
            passed++;
        }
        else
        {
            failed++;
            Console.WriteLine("  NG：" + what);
        }
    }

    private static void Section(string title, Action run)
    {
        Console.WriteLine("■ " + title);
        int before = failed;
        try
        {
            run();
        }
        catch (Exception error)
        {
            failed++;
            Console.WriteLine("  NG：予期しない例外 " + error.GetType().Name + "：" + error.Message);
        }
        Console.WriteLine(failed == before ? "  OK" : "  失敗あり");
    }
}
