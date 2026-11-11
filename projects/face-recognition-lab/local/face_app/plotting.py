"""グラフ描画の共通設定(日本語フォント)。"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402

from .render import find_font  # noqa: E402

_fp = find_font()
if _fp:
    font_manager.fontManager.addfont(_fp)
    plt.rcParams["font.family"] = font_manager.FontProperties(fname=_fp).get_name()
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["figure.dpi"] = 110

__all__ = ["plt"]
