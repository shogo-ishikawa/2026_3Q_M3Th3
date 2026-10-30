namespace Pip0Shell.Core;

/// <summary>
/// コマンドラインの引数。
///
/// --headless：画面（通知領域アイコン、確認画面）を出さずに動く。
///             python -m pip0 restore-all が、常駐処理なしで復元するときに使う。
///             このとき、ごみ箱へ移す要求には、確認画面を出せないため "unavailable" と答え、何も削除しない。
/// </summary>
internal sealed class CommandLineOptions
{
    public bool Headless { get; private set; }

    public static CommandLineOptions Parse(string[] args)
    {
        var options = new CommandLineOptions();
        foreach (string arg in args)
        {
            if (arg == "--headless")
            {
                options.Headless = true;
            }
            else
            {
                // 将来の本体が新しい引数を渡しても止まらないよう、知らない引数は無視する（内容は記録しない）
                Log.Warning("知らない引数を1つ無視しました。");
            }
        }
        return options;
    }
}
