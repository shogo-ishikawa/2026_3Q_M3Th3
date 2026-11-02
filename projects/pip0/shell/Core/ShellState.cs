using System.Text.Json.Nodes;

namespace Pip0Shell.Core;

/// <summary>
/// シェル全体で共有する状態：init で受け取った値と、使える機能（capabilities）。
/// init の前は Configuration が null です。
/// </summary>
internal sealed class ShellState
{
    private volatile SessionConfiguration? configuration;

    public ShellState(CommandLineOptions options)
    {
        Options = options;
    }

    public CommandLineOptions Options { get; }

    public SessionConfiguration? Configuration
    {
        get => configuration;
        set => configuration = value;
    }

    public Capabilities Capabilities { get; } = new();
}

/// <summary>
/// init の答えと shell.ready で知らせる、シェルで使える機能。
/// 本体はこれを見て、使えない機能を「利用不可」と表示します（理由は feature.status で知らせます）。
/// </summary>
internal sealed class Capabilities
{
    private readonly object gate = new();
    private bool cloudFiles;
    private bool trash;
    private bool ui;
    private bool hooks;

    /// <summary>Cloud Files API（同期ルート、ゴースト）を使えるか</summary>
    public bool CloudFiles
    {
        get { lock (gate) { return cloudFiles; } }
        set { lock (gate) { cloudFiles = value; } }
    }

    /// <summary>確認画面つきで、ごみ箱へ移せるか</summary>
    public bool Trash
    {
        get { lock (gate) { return trash; } }
        set { lock (gate) { trash = value; } }
    }

    /// <summary>画面（通知領域アイコン等）を出せるか</summary>
    public bool Ui
    {
        get { lock (gate) { return ui; } }
        set { lock (gate) { ui = value; } }
    }

    /// <summary>前面ウィンドウのフックと、ドラッグを検知するマウスのフックの両方を付けられたか（個々の状態は feature.status）</summary>
    public bool Hooks
    {
        get { lock (gate) { return hooks; } }
        set { lock (gate) { hooks = value; } }
    }

    public JsonObject ToJson()
    {
        lock (gate)
        {
            return new JsonObject
            {
                ["cloud_files"] = cloudFiles,
                ["trash"] = trash,
                ["ui"] = ui,
                ["hooks"] = hooks,
            };
        }
    }
}
