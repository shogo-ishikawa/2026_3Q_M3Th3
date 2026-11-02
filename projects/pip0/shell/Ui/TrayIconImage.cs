using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Windows.Forms;
using Windows.Win32;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Ui;

/// <summary>
/// 通知領域のアイコンの絵（小さなゴーストの形）を、起動時に描いて作る。画像ファイルを同梱しないためです。
/// 色や形を変えたいときは <see cref="Draw"/> を変えてください。
/// </summary>
internal sealed class TrayIconImage : IDisposable
{
    private static readonly Color BodyColour = Color.FromArgb(255, 108, 132, 214);
    private static readonly Color OutlineColour = Color.FromArgb(255, 36, 48, 92);
    private static readonly Color EyeColour = Color.White;

    private readonly IntPtr handle;

    private TrayIconImage(Icon icon, IntPtr handle)
    {
        Icon = icon;
        this.handle = handle;
    }

    public Icon Icon { get; }

    public static TrayIconImage Create()
    {
        int side = Math.Max(16, SystemInformation.SmallIconSize.Width);
        using var bitmap = new Bitmap(side, side, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            Draw(graphics, side);
        }
        IntPtr handle = bitmap.GetHicon();
        return new TrayIconImage(Icon.FromHandle(handle), handle);
    }

    public void Dispose()
    {
        Icon.Dispose();
        // Icon.FromHandle は handle を持ち主として扱わないので、自分で消す
        PInvoke.DestroyIcon(new HICON(handle));
    }

    private static void Draw(Graphics graphics, int side)
    {
        float s = side;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(Color.Transparent);

        using var body = new GraphicsPath();
        // 頭（上半分の円）
        body.AddArc(s * 0.15f, s * 0.08f, s * 0.70f, s * 0.70f, 180, 180);
        // 右の辺、下のぎざぎざ、左の辺
        body.AddLines(new[]
        {
            new PointF(s * 0.85f, s * 0.43f),
            new PointF(s * 0.85f, s * 0.92f),
            new PointF(s * 0.73f, s * 0.80f),
            new PointF(s * 0.62f, s * 0.92f),
            new PointF(s * 0.50f, s * 0.80f),
            new PointF(s * 0.38f, s * 0.92f),
            new PointF(s * 0.27f, s * 0.80f),
            new PointF(s * 0.15f, s * 0.92f),
            new PointF(s * 0.15f, s * 0.43f),
        });
        body.CloseFigure();

        using (var fill = new SolidBrush(BodyColour))
        {
            graphics.FillPath(fill, body);
        }
        using (var outline = new Pen(OutlineColour, Math.Max(1f, s / 16f)))
        {
            graphics.DrawPath(outline, body);
        }
        using (var eye = new SolidBrush(EyeColour))
        {
            float eyeWidth = s * 0.12f;
            float eyeHeight = s * 0.16f;
            graphics.FillEllipse(eye, s * 0.33f, s * 0.32f, eyeWidth, eyeHeight);
            graphics.FillEllipse(eye, s * 0.55f, s * 0.32f, eyeWidth, eyeHeight);
        }
    }
}
