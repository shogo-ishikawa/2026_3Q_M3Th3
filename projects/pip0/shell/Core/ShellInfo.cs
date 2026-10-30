namespace Pip0Shell.Core;

/// <summary>シェルの版と、pip0 本体との通信の版（docs/ipc-protocol.md）</summary>
internal static class ShellInfo
{
    /// <summary>シェルの版。Pip0Shell.csproj の &lt;Version&gt; と同じ値にする</summary>
    public const string Version = "0.1.0";

    /// <summary>init の "protocol" で受け付ける通信の版</summary>
    public const int ProtocolVersion = 1;
}
