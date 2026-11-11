"""顔照合・表情分析システム  コマンド一覧

  python main.py download                         モデルを取得(初回のみ)
  python main.py register 名前 --folder 画像フォルダ  画像から登録
  python main.py register 名前 --camera              カメラで自動撮影して登録
  python main.py list                             登録者の一覧
  python main.py delete 名前                       登録者のデータを削除
  python main.py run                              カメラでリアルタイム実行
  python main.py run --source video.mp4           動画ファイルで実行
  python main.py evaluate data/test               精度を評価し、しきい値を提案
  python main.py report logs/session_xxx.csv [...] 記録からレポートを作成(複数で比較)
"""
from __future__ import annotations

import argparse
import sys

from face_app import config


def cmd_download(a):
    from face_app.downloader import main as dl_main
    if not dl_main():
        sys.exit(1)


def engine():
    from face_app.engine import Engine
    return Engine()


def source_arg(s):
    return int(s) if str(s).isdigit() else s


def confirm_consent(name, yes):
    if yes:
        return True
    print(f"{name} さんの顔の特徴量を登録します。本人の同意を得ていますか?"
          "(写真そのものは保存しません。delete でいつでも消せます)")
    return input("同意を得ている場合は y を入力: ").strip().lower() == "y"


def cmd_register(a):
    from face_app import enroll
    if not confirm_consent(a.name, a.yes):
        sys.exit("登録を中止しました。")
    if a.folder:
        enroll.register_folder(engine(), a.name, a.folder, min_quality=a.min_quality)
    else:
        enroll.register_camera(engine(), a.name, source=source_arg(a.source), shots=a.shots,
                               mirror=not a.no_mirror)


def cmd_list(a):
    from face_app.registry import FaceDB
    db = FaceDB()
    if not db.names:
        print("登録者はいません。")
    for n in db.names:
        m = db.meta.get(n, {})
        print(f"  {n}: 登録データ {db.labels.count(n)}件  同意日時 {m.get('consent_at', '-')}")


def cmd_delete(a):
    from face_app.privacy import delete_person
    result = delete_person(a.name)
    if result["ok"]:
        print(f"{a.name} さんの登録情報と関連する記録を削除しました。"
              "生成済みレポートと画面保存もすべて削除しました。")
    else:
        print(f"{a.name} さんは登録されていません。")


def cmd_run(a):
    from face_app.app import run
    run(engine(), source=source_arg(a.source), threshold=a.threshold, mirror=not a.no_mirror,
        log_every=a.log_every, auth=a.auth)


def cmd_camtest(a):
    from face_app.camera import diagnose
    diagnose()


def cmd_evaluate(a):
    from face_app.evaluate import run_evaluation
    run_evaluation(engine(), a.test_dir, threshold=a.threshold)


def cmd_report(a):
    from face_app.report import build
    build(a.csv, out=a.out)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:                      # ダブルクリックなど、引数なしで起動したときはアプリ画面を開く
        from face_app.webapp import main as app_main
        app_main()
        return
    p = argparse.ArgumentParser(description="顔照合・表情分析システム",
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("download", help="モデルを取得").set_defaults(f=cmd_download)

    r = sub.add_parser("register", help="顔を登録")
    r.add_argument("name")
    g = r.add_mutually_exclusive_group(required=True)
    g.add_argument("--folder", help="登録用画像のフォルダ")
    g.add_argument("--camera", action="store_true", help="カメラで撮影して登録")
    r.add_argument("--source", default="0", help="カメラ番号")
    r.add_argument("--shots", type=int, default=10, help="カメラ登録の枚数")
    r.add_argument("--min-quality", type=int, default=config.REGISTER_MIN_QUALITY)
    r.add_argument("--no-mirror", action="store_true")
    r.add_argument("--yes", action="store_true", help="同意確認を省略(同意済みの場合)")
    r.set_defaults(f=cmd_register)

    sub.add_parser("list", help="登録者一覧").set_defaults(f=cmd_list)
    d = sub.add_parser("delete", help="登録者を削除")
    d.add_argument("name"); d.set_defaults(f=cmd_delete)

    ru = sub.add_parser("run", help="リアルタイム実行")
    ru.add_argument("--source", default="0", help="カメラ番号 または 動画ファイル")
    ru.add_argument("--threshold", type=float, default=config.DEFAULT_THRESHOLD)
    ru.add_argument("--no-mirror", action="store_true", help="鏡のような左右反転表示をしない")
    ru.add_argument("--auth", action="store_true", help="認証モード(確認できたらあいさつして終了)")
    ru.add_argument("--log-every", type=int, default=1, help="何フレームごとに記録するか")
    ru.set_defaults(f=cmd_run)

    sub.add_parser("camtest", help="カメラの診断").set_defaults(f=cmd_camtest)

    e = sub.add_parser("evaluate", help="精度評価としきい値の提案")
    e.add_argument("test_dir", nargs="?", default=str(config.DATA_DIR / "test"))
    e.add_argument("--threshold", type=float, default=config.DEFAULT_THRESHOLD)
    e.set_defaults(f=cmd_evaluate)

    rp = sub.add_parser("report", help="記録からレポート作成")
    rp.add_argument("csv", nargs="+")
    rp.add_argument("--out")
    rp.set_defaults(f=cmd_report)

    a = p.parse_args(argv)
    try:
        a.f(a)
    except (FileNotFoundError, RuntimeError) as e:
        sys.exit(f"エラー: {e}")


if __name__ == "__main__":
    main()
