using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using Pip0Shell.Core;
using Pip0Shell.Ui;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace Pip0Shell.Context;

/// <summary>ファイルダイアログの判定の結果</summary>
/// <param name="IsFileDialog">「開く／保存」のダイアログ（ファイル名欄がある）か</param>
/// <param name="Rect">ダイアログの位置（物理ピクセル）。ファイルダイアログでなければ null</param>
/// <param name="AccessDenied">権限の違い（UIPI 等）で中を調べられなかった</param>
/// <param name="AutomationBroken">UI Automation そのものが動かなかった（権限とは別の失敗）</param>
internal readonly record struct DialogProbe(bool IsFileDialog, PixelRect? Rect, bool AccessDenied, bool AutomationBroken)
{
    public static DialogProbe NotDialog => new(false, null, false, false);
}

/// <summary>shell.fill_file_dialog の結果</summary>
internal readonly record struct FillOutcome(bool Ok, string Reason);

/// <summary>
/// Windows の「開く／保存」のダイアログを、UI Automation で見分け、ファイル名欄に入力する（docs/design.md 4-4）。
///
/// - 見分け方：ウィンドウの種類が "#32770"（ダイアログ）で、その中に AutomationId が "1148" の要素（ファイル名欄）があるもの。
///   まず子ウィンドウの番号（コントロール ID 1148）で速く探し、UI Automation で AutomationId を確かめる。
///   見つからなければ、UI Automation で中の要素を探す（遅いことがあるので、ダイアログのときだけ）。
/// - 入力：ファイル名欄（またはその中の Edit）の ValuePattern.SetValue で完全なパスを入れ、読み直して確かめる。
///   「開く」ボタンはユーザーが押します（シェルは押しません）。
/// - 管理者として動くアプリのダイアログには、Windows の制限（UIPI）で入力できません。その場合は正直に失敗を返します。
///
/// UI Automation はほかのアプリへの呼び出しで時間がかかることがあるため、画面のスレッドでは使いません。
/// </summary>
internal static class FileDialogAutomation
{
    public const string DialogClassName = "#32770";
    public const string FileNameAutomationId = "1148";
    private const int FileNameControlId = 1148;

    /// <summary>UI Automation が使えるかを確かめる（init のとき）</summary>
    public static bool Probe(out string reason)
    {
        try
        {
            AutomationElement root = AutomationElement.RootElement;
            _ = root.Current.ControlType;
            reason = "";
            return true;
        }
        catch (Exception error)
        {
            Log.Warning("UI Automation を使えません：" + Log.Describe(error));
            reason = "UI Automation を使えません（" + error.GetType().Name + "）。ファイルダイアログを見分けられません。";
            return false;
        }
    }

    /// <summary>hwnd のウィンドウがファイルダイアログかを調べる（種類の名前が "#32770" のときだけ呼ぶ）</summary>
    public static DialogProbe ProbeDialog(HWND hwnd)
    {
        try
        {
            AutomationElement? field = FindFileNameField(hwnd);
            if (field is null)
            {
                return DialogProbe.NotDialog;
            }
            return new DialogProbe(true, WindowInfo.GetFrameRect(hwnd), false, false);
        }
        catch (ElementNotAvailableException)
        {
            return DialogProbe.NotDialog; // 調べている間に閉じられた
        }
        catch (Exception error) when (IsAccessDenied(error))
        {
            return new DialogProbe(false, null, true, false);
        }
        catch (Exception error)
        {
            Log.Warning("ファイルダイアログかどうかを調べられませんでした：" + Log.Describe(error));
            return new DialogProbe(false, null, false, true);
        }
    }

    /// <summary>ファイルダイアログのファイル名欄に path を入力する</summary>
    public static FillOutcome Fill(HWND hwnd, string path)
    {
        if (hwnd.IsNull || !PInvoke.IsWindow(hwnd))
        {
            return new FillOutcome(false, "ダイアログが見つかりません（閉じられた可能性があります）。");
        }
        if (!string.Equals(WindowInfo.GetClassName(hwnd), DialogClassName, StringComparison.Ordinal))
        {
            return new FillOutcome(false, "指定のウィンドウは、ファイルを開く・保存するダイアログではありません。");
        }
        bool? elevated = ProcessInfo.IsHigherIntegrityThanSelf(WindowInfo.GetProcessId(hwnd));

        try
        {
            AutomationElement? field = FindFileNameField(hwnd);
            if (field is null)
            {
                return new FillOutcome(false, elevated == true
                    ? UipiReason()
                    : "ダイアログの中にファイル名欄（AutomationId 1148）が見つかりません。");
            }

            // ファイル名欄は、入力できる Edit を中に持つコンボボックスのことが多い。Edit を先に使う
            AutomationElement? edit = field.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            foreach (AutomationElement target in edit is null ? new[] { field } : new[] { edit, field })
            {
                if (!target.TryGetCurrentPattern(ValuePattern.Pattern, out object pattern))
                {
                    continue;
                }
                var value = (ValuePattern)pattern;
                if (value.Current.IsReadOnly)
                {
                    continue;
                }
                value.SetValue(path);
                string written = value.Current.Value ?? "";
                if (string.Equals(written, path, StringComparison.OrdinalIgnoreCase))
                {
                    Log.Info("ファイルダイアログのファイル名欄に入力しました。");
                    return new FillOutcome(true, "");
                }
                return new FillOutcome(false, elevated == true
                    ? UipiReason()
                    : "ファイル名欄に入力しましたが、読み直した値が違いました（入力を確かめられません）。");
            }
            return new FillOutcome(false, elevated == true
                ? UipiReason()
                : "ファイル名欄が入力を受け付けません（読み取り専用か、値を設定できない種類です）。");
        }
        catch (ElementNotAvailableException)
        {
            return new FillOutcome(false, "入力の途中でダイアログが閉じられました。");
        }
        catch (Exception error) when (IsAccessDenied(error) || elevated == true)
        {
            Log.Warning("ファイル名欄に入力できませんでした：" + Log.Describe(error));
            return new FillOutcome(false, UipiReason());
        }
        catch (InvalidOperationException error)
        {
            Log.Warning("ファイル名欄に入力できませんでした：" + Log.Describe(error));
            return new FillOutcome(false, "ファイル名欄が入力を受け付けませんでした（無効になっている可能性があります）。");
        }
        catch (Exception error)
        {
            Log.Warning("ファイル名欄に入力できませんでした：" + Log.Describe(error));
            return new FillOutcome(false, "UI Automation で入力できませんでした（" + error.GetType().Name + "）。");
        }
    }

    private static string UipiReason()
    {
        return "このダイアログは管理者として動くアプリのものため、Windows の制限（UIPI）で pip0 から入力できません。パスを手で入力してください。";
    }

    /// <summary>ファイル名欄（AutomationId "1148"）の要素。なければ null</summary>
    private static AutomationElement? FindFileNameField(HWND dialog)
    {
        // 1. 子ウィンドウのコントロール ID で探す（速い）
        HWND child = FindChildByControlId(dialog, FileNameControlId);
        if (!child.IsNull)
        {
            AutomationElement element = AutomationElement.FromHandle((IntPtr)child);
            if (string.Equals(element.Current.AutomationId, FileNameAutomationId, StringComparison.Ordinal))
            {
                return element;
            }
        }

        // 2. UI Automation で中の要素を探す
        AutomationElement root = AutomationElement.FromHandle((IntPtr)dialog);
        return root.FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, FileNameAutomationId));
    }

    private static unsafe HWND FindChildByControlId(HWND parent, int controlId)
    {
        HWND found = HWND.Null;
        Windows.Win32.UI.WindowsAndMessaging.WNDENUMPROC callback = (child, _) =>
        {
            if (PInvoke.GetDlgCtrlID(child) == controlId)
            {
                found = child;
                return false; // 見つかったので終わる
            }
            return true;
        };
        PInvoke.EnumChildWindows(parent, callback, default);
        GC.KeepAlive(callback);
        return found;
    }

    private static bool IsAccessDenied(Exception error)
    {
        return error is UnauthorizedAccessException
            || (error is COMException com && com.HResult == unchecked((int)0x80070005));
    }
}
