"""pip0 の規則と辞書（★ここを変えて試そう）

仕分けの規則、意味不明なファイル名の見分け方、送信元の対応表、作業中のアプリの見分け方、
検索の手掛かり語、機密の判定規則を、リストと辞書でまとめています。
処理（Python の関数）を変えずに、ここのデータを変えるだけで動きが変わります。
"""

# ----------------------------------------------------------------------
# M1 仕分けの規則
# ----------------------------------------------------------------------
# 1つの規則は辞書です。
#   "name"             画面に出す名前
#   "folder"           仕分け先（pip0 専用フォルダーの中のフォルダー名）
#   "keywords"         ファイル名・文書のタイトル・ダウンロード元のページ題名に含まれると +2 点
#   "context_keywords" 作業中のアプリのウィンドウタイトル（チャンネル名など）に含まれると +2 点
#   "extensions"       拡張子が一致すると +1 点
# 合計が settings.SORT_MIN_SCORE 以上の規則のうち、最も点数の高いものを提案します。

SORT_RULES = [
    {
        "name": "予算・会計",
        "folder": "予算・会計",
        "keywords": ["予算", "見積", "請求", "決算", "会計", "経費", "budget", "invoice"],
        "context_keywords": ["予算", "会計", "経理", "budget"],
        "extensions": [".xlsx", ".xls", ".csv", ".pdf"],
    },
    {
        "name": "授業・レポート",
        "folder": "授業・レポート",
        "keywords": ["講義", "授業", "レポート", "課題", "シラバス", "演習", "lecture", "report"],
        "context_keywords": ["講義", "授業", "ゼミ", "課題"],
        "extensions": [".pdf", ".docx", ".pptx"],
    },
    {
        "name": "会議・議事録",
        "folder": "会議・議事録",
        "keywords": ["議事録", "会議", "打ち合わせ", "ミーティング", "minutes", "agenda"],
        "context_keywords": ["会議", "ミーティング", "打ち合わせ"],
        "extensions": [".docx", ".pdf", ".txt"],
    },
    {
        "name": "画像・図",
        "folder": "画像・図",
        "keywords": ["グラフ", "図", "写真", "chart", "graph"],
        "context_keywords": [],
        "extensions": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"],
    },
]

# どの規則にも当てはまらないとき、移動しないで「仕分け先の候補なし」と表示します。

# ----------------------------------------------------------------------
# M1 意味不明なファイル名（自動改名の対象）
# ----------------------------------------------------------------------
# 拡張子を除いた名前が、次の正規表現のどれかに一致したら「意味不明」とみなします。
# 一致しない名前は、意味のある名前として残します（勝手に改名しません）。

MEANINGLESS_NAME_PATTERNS = [
    r"^(IMG|DSC|DSCN|PXL|MVIMG)[_-]?\d+.*$",                  # カメラの連番
    r"^(download|document|file|image|untitled|attachment)( ?\(\d+\))?$",
    r"^(無題|名称未設定|新規|新しい)(.*)?$",
    r"^(scan|スキャン)[_ -]?\d*.*$",
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}( ?\(\d+\))?$",  # UUID
    r"^[0-9a-fA-F]{16,}( ?\(\d+\))?$",                         # 長い16進数
    r"^\d{6,}( ?\(\d+\))?$",                                   # 数字だけ
    r"^(Screenshot|スクリーンショット)[ _-].*$",
]

# ----------------------------------------------------------------------
# 送信元（入手経路）の対応表
# ----------------------------------------------------------------------
# ダウンロード URL・参照元 URL のホスト名が host_suffixes のどれかで終わると、その label にします。
# 当てはまらないときは、ホスト名の主要部分（例：example.co.jp）を送信元にします。
# ダウンロードの記録がないファイルは「送信元不明」です（推測で決めません）。

SOURCE_RULES = [
    {"label": "Slack", "host_suffixes": ["slack.com", "slack-edge.com", "slack-files.com"]},
    {"label": "Gmail", "host_suffixes": ["mail.google.com", "mail-attachment.googleusercontent.com"]},
    {"label": "Googleドライブ", "host_suffixes": ["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]},
    {"label": "Outlook", "host_suffixes": ["outlook.office.com", "outlook.office365.com", "outlook.live.com", "attachments.office.net"]},
    {"label": "Teams", "host_suffixes": ["teams.microsoft.com", "teams.live.com"]},
    {"label": "OneDrive", "host_suffixes": ["onedrive.live.com", "1drv.ms", "sharepoint.com"]},
    {"label": "Dropbox", "host_suffixes": ["dropbox.com", "dropboxusercontent.com"]},
    {"label": "LINE", "host_suffixes": ["line.me", "line-scdn.net"]},
]

# 「co.jp」のように2段で1つの区切りになるもの（ホスト名の主要部分を求めるときに使う）
SECOND_LEVEL_SUFFIXES = ["co.jp", "ac.jp", "go.jp", "or.jp", "ne.jp", "ed.jp", "lg.jp", "co.uk", "ac.uk", "gov.uk", "org.uk", "com.au"]

# ----------------------------------------------------------------------
# M2 作業中のアプリ（前面のウィンドウ）
# ----------------------------------------------------------------------
# プロセス名（小文字）→ 表示名と種類

APP_RULES = {
    "slack.exe": {"label": "Slack", "category": "chat"},
    "ms-teams.exe": {"label": "Teams", "category": "chat"},
    "teams.exe": {"label": "Teams", "category": "chat"},
    "chrome.exe": {"label": "Chrome", "category": "browser"},
    "msedge.exe": {"label": "Edge", "category": "browser"},
    "winword.exe": {"label": "Word", "category": "document"},
    "excel.exe": {"label": "Excel", "category": "document"},
    "powerpnt.exe": {"label": "PowerPoint", "category": "document"},
    "outlook.exe": {"label": "Outlook", "category": "mail"},
    "olk.exe": {"label": "Outlook", "category": "mail"},
    "explorer.exe": {"label": "エクスプローラー", "category": "files"},
    "acrobat.exe": {"label": "Acrobat", "category": "document"},
    "notepad.exe": {"label": "メモ帳", "category": "document"},
}

# Slack デスクトップアプリのウィンドウタイトルから、会話（チャンネル・相手）を読み取る正規表現。
# ★Slack の版や表示言語でタイトルの形は変わります。実機のタイトルを見て直してください。
# どれにも一致しないときは「チャット相手：取得不可」と表示し、推測しません。
SLACK_TITLE_PATTERNS = [
    r"^(?P<conversation>.+?) \((?P<kind>Channel|DM|Group DM|チャンネル|DM|グループDM)\) - (?P<workspace>.+?) - Slack$",
    r"^Slack \| (?P<conversation>.+?) \| (?P<workspace>.+)$",
]

# タイトルの kind を、pip0 の種類（channel / dm）に直す表
SLACK_KIND_MAP = {
    "Channel": "channel", "チャンネル": "channel",
    "DM": "dm", "Group DM": "dm", "グループDM": "dm",
}

# ブラウザーのウィンドウタイトルの末尾（取り除くとページの題名になる）
# Edge のタイトルには、見えない文字（U+200B）が入ることがあります
BROWSER_TITLE_SUFFIXES = [" - Google Chrome", " - Microsoft​ Edge", " - Microsoft Edge"]

# 文脈の語から除く、意味の薄い語
CONTEXT_STOP_WORDS = ["Slack", "Google", "Chrome", "Microsoft", "Edge", "Word", "Excel", "PowerPoint",
                      "新しいタブ", "New Tab", "ホーム", "Home", "Channel", "DM", "チャンネル"]

# ----------------------------------------------------------------------
# M3 検索の手掛かり語
# ----------------------------------------------------------------------

# 色の言葉 → 解析で使う色の名前（analyse_image.COLOUR_NAMES と同じ名前）
COLOUR_WORDS = {
    "青い": "blue", "青": "blue", "ブルー": "blue", "紺": "blue",
    "水色": "cyan",
    "赤い": "red", "赤": "red", "レッド": "red",
    "緑": "green", "緑の": "green", "グリーン": "green",
    "黄色い": "yellow", "黄色": "yellow", "黄": "yellow", "イエロー": "yellow",
    "オレンジ": "orange", "橙": "orange",
    "紫": "purple", "パープル": "purple",
    "ピンク": "pink",
}

# 「青」と言ったとき、どの色の割合を足して判定するか（水色も青に含める）
COLOUR_GROUPS = {
    "blue": ["blue", "cyan"],
    "cyan": ["cyan"],
    "red": ["red"],
    "green": ["green"],
    "yellow": ["yellow"],
    "orange": ["orange"],
    "purple": ["purple"],
    "pink": ["pink"],
}

# 見た目の種類の言葉
VISUAL_KIND_WORDS = {
    "グラフ": "chart", "チャート": "chart", "図表": "chart",
    "写真": "photo",
    "画像": "image", "イメージ": "image",
}

# 文書の種類の言葉
DOC_KIND_WORDS = {
    "資料": "document", "書類": "document", "文書": "document", "ドキュメント": "document",
    "表": "spreadsheet", "エクセル": "spreadsheet", "スプレッドシート": "spreadsheet",
    "スライド": "slides", "パワポ": "slides",
    "PDF": "pdf", "pdf": "pdf",
}

# 種類 → 当てはまる拡張子
KIND_EXTENSIONS = {
    "document": [".pdf", ".docx", ".doc", ".txt", ".md", ".xlsx", ".pptx", ".csv"],
    "spreadsheet": [".xlsx", ".xls", ".csv"],
    "slides": [".pptx", ".ppt"],
    "pdf": [".pdf"],
    "image": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"],
    "photo": [".jpg", ".jpeg", ".png", ".webp"],
    "chart": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".xlsx", ".pptx", ".docx"],
}

# 入手経路の言葉 → 送信元の名前（SOURCE_RULES の label）
SOURCE_WORDS = {
    "Slack": ["Slack", "slack", "スラック"],
    "Gmail": ["Gmail", "gmail", "Gメール"],
    "Outlook": ["Outlook", "outlook", "アウトルック"],
    "Teams": ["Teams", "teams", "チームズ"],
    "Googleドライブ": ["Googleドライブ", "グーグルドライブ", "Google Drive"],
    "LINE": ["LINE", "ライン"],
}
# 「メールで」のように、いくつかの送信元をまとめて指す言葉
SOURCE_GROUP_WORDS = {
    "メール": ["Gmail", "Outlook"],
}
# 入手したことを表す言葉（「Slackで貰った」の「貰った」）。検索では手掛かりの一部として読み飛ばします
ACQUIRE_WORDS = ["貰った", "もらった", "受け取った", "届いた", "送られてきた", "落とした", "ダウンロードした", "来た"]

# 読み飛ばす助詞など
QUERY_PARTICLES = ["の", "で", "から", "に", "を", "が", "は", "と", "へ", "った", "した", "やつ", "もの", "ファイル"]

# ----------------------------------------------------------------------
# M5 機密の判定規則
# ----------------------------------------------------------------------

SENSITIVE_NAME_KEYWORDS = ["社外秘", "機密", "極秘", "部外秘", "取扱注意", "confidential", "secret", "マイナンバー", "個人情報"]
SENSITIVE_CONTENT_KEYWORDS = ["社外秘", "機密", "極秘", "部外秘", "取扱注意", "Confidential", "CONFIDENTIAL", "個人番号"]
# Office 文書の秘密度ラベル（Microsoft Purview）の名前に、次の語が含まれたら機密
SENSITIVE_LABEL_KEYWORDS = ["Confidential", "Highly Confidential", "Secret", "社外秘", "機密", "極秘"]
DETECT_MY_NUMBER = True    # 本文に12桁の個人番号（検査用数字が正しいもの）があれば機密
DETECT_CARD_NUMBER = True  # 本文にクレジットカード番号らしい数字（Luhn 検査に合格）があれば機密

# ----------------------------------------------------------------------
# 対象外にするファイル名（一時ファイル、ロックファイルなど）
# ----------------------------------------------------------------------

EXCLUDED_NAME_PATTERNS = [
    r"^~\$",                 # Office の作業中ファイル
    r"^\.~lock\.",           # LibreOffice のロック
    r"\.tmp$", r"\.temp$",
    r"\.crdownload$",        # Chrome／Edge のダウンロード途中
    r"\.part$", r"\.partial$", r"\.download$",
    r"^desktop\.ini$", r"^thumbs\.db$", r"\.lnk$", r"\.url$",
    r"^\.",                  # 隠しファイル（名前が . で始まる）
]

# 拡張子 → ファイルの種類（解析と表示に使う）
FILE_KINDS = {
    ".pdf": "pdf", ".docx": "document", ".doc": "document", ".txt": "text", ".md": "text",
    ".csv": "spreadsheet", ".xlsx": "spreadsheet", ".xls": "spreadsheet",
    ".pptx": "slides", ".ppt": "slides",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".bmp": "image",
}
