"""実験用パスワードだけを対象に、探索順序と計算速度を比べます。"""
import hashlib
import itertools
import math
import secrets
import string
import time

from hash_engines import make_engine, candidate_from_index

CHARSETS = {
    "digits": string.digits,
    "lower": string.ascii_lowercase,
    "upper": string.ascii_uppercase,
    "symbols": string.punctuation,
}
WORDS = [
    "password", "123456", "1234", "0000", "1111", "qwerty",
    "abc123", "welcome", "letmein", "sakura", "coffee", "python",
    "orange", "summer", "winter", "music", "hello", "dragon",
]
MAX_BATCH = 8192
VERSION = "1.0.0"


def alphabet_for(digits=True, lower=True, upper=True, symbols=False):
    flags = [digits, lower, upper, symbols]
    alphabet = "".join(value for value, use in zip(CHARSETS.values(), flags) if use)
    if not alphabet:
        raise ValueError("使える文字を1種類以上選んでください。")
    return alphabet


def validate_password(password):
    if not isinstance(password, str) or not 1 <= len(password) <= 32:
        raise ValueError("実験用の文字列を1〜32文字で指定してください。")
    if any(ord(c) < 33 or ord(c) > 126 for c in password):
        raise ValueError("今回は半角の英数字・記号（空白なし）を使ってください。")
    return password


def generate_password(length, alphabet):
    if not isinstance(length, int) or not 1 <= length <= 32:
        raise ValueError("長さは1〜32文字にしてください。")
    if not alphabet or len(set(alphabet)) != len(alphabet):
        raise ValueError("文字集合を確認してください。")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def dictionary_candidates():
    yield from WORDS


def rule_candidates():
    # この小さな教材用リストは、実際の出現頻度を再現するものではありません。
    suffixes = ["", "1", "12", "123", "2024", "2025", "2026", "2027", "!"]
    for word in WORDS:
        for base in dict.fromkeys([word, word.capitalize(), word.upper()]):
            for suffix in suffixes:
                yield base + suffix
                if suffix and suffix != "!":
                    yield base + suffix + "!"


def mask_alphabets(mask):
    """?l=小文字、?u=大文字、?d=数字、?s=記号。それ以外は固定文字。"""
    if not isinstance(mask, str) or not mask:
        raise ValueError("形式のヒントが空です。例：sakura?d?d?d?d")
    lookup = {"l": CHARSETS["lower"], "u": CHARSETS["upper"],
              "d": CHARSETS["digits"], "s": CHARSETS["symbols"], "?": "?"}
    positions = []
    i = 0
    while i < len(mask):
        if mask[i] == "?":
            if i + 1 >= len(mask) or mask[i + 1] not in lookup:
                raise ValueError("?の後はl・u・d・s・?のどれかにしてください。")
            positions.append(lookup[mask[i + 1]])
            i += 2
        else:
            if not 33 <= ord(mask[i]) <= 126:
                raise ValueError("形式のヒントには半角文字（空白なし）を使ってください。")
            positions.append(mask[i])
            i += 1
    if len(positions) > 32:
        raise ValueError("形式のヒントは展開後32文字以内にしてください。")
    return positions


def mask_candidates(mask):
    for values in itertools.product(*mask_alphabets(mask)):
        yield "".join(values)


def search_candidates(name, candidates, digest, seconds=2.0, limit=100000):
    if not 0 < seconds <= 30 or not 1 <= limit <= 1000000:
        raise ValueError("実験の時間・件数の上限を確認してください。")
    begin = time.perf_counter()
    tested = 0
    seen = set()
    for candidate in candidates:
        if tested >= limit or time.perf_counter() - begin >= seconds:
            return result(name, "打切り", tested, begin)
        if candidate in seen:
            continue
        seen.add(candidate)
        tested += 1
        if hashlib.sha256(candidate.encode("ascii")).digest() == digest:
            return result(name, "発見", tested, begin)
    return result(name, "この候補群では未発見", tested, begin)


def result(name, state, tested, begin, **extra):
    elapsed = max(time.perf_counter() - begin, 1e-12)
    return {"method": name, "state": state, "tested": tested,
            "seconds": elapsed, "rate": tested / elapsed, **extra}


def benchmark(alphabet, length, digest, include_gpu=True, batch=8192):
    """各方式で同じ件数を3回全走査。準備時間と実測を分けます。"""
    total = len(alphabet) ** length
    count = min(batch, total)
    names = ["Python", "Numba", "Numba parallel"] + (["GPU"] if include_gpu else [])
    rows, engines = [], {}
    for name in names:
        prepare = time.perf_counter()
        try:
            # 既知の正解と不正解を、hashlibの結果に対して実行時にも照合します。
            sample_index = min(count - 1, 7)
            sample = candidate_from_index(sample_index, alphabet, length)
            check = make_engine(name, alphabet, length,
                                hashlib.sha256(sample.encode("ascii")).digest())
            actual = check(0, min(count, 8))
            if actual != sample_index or check(0, sample_index) is not None:
                raise RuntimeError("既知の正解との一致確認に失敗しました。")
            engine = make_engine(name, alphabet, length, digest)
            engine(0, min(count, 8))
            preparation = time.perf_counter() - prepare
            times = []
            for _ in range(3):
                begin = time.perf_counter()
                engine(0, count)
                times.append(max(time.perf_counter() - begin, 1e-12))
            elapsed = sorted(times)[1]
            rows.append({"engine": name, "state": "実測", "count": count,
                         "seconds": elapsed, "rate": count / elapsed,
                         "prepare_seconds": preparation})
            engines[name] = engine
        except Exception as exc:
            rows.append({"engine": name, "state": "利用不可",
                         "reason": str(exc).splitlines()[0][:200]})
    available = [row for row in rows if row["state"] == "実測"]
    if not available:
        raise RuntimeError("利用できる照合方式がありません。")
    best = max(available, key=lambda row: row["rate"])
    return rows, best["engine"], engines[best["engine"]]


def brute_search(password, alphabet, engine, seconds=2.0, limit=100000,
                 engine_name="Python"):
    if any(c not in alphabet for c in password):
        return {"method": "総当たり", "state": "対象外：文字集合に含まれない文字",
                "tested": 0, "seconds": 0.0, "rate": 0.0, "engine": engine_name}
    total = len(alphabet) ** len(password)
    begin = time.perf_counter()
    tested = 0
    while tested < min(total, limit, 2**63 - 1):
        if time.perf_counter() - begin >= seconds:
            break
        count = min(MAX_BATCH, total - tested, limit - tested)
        match = engine(tested, count)
        tested += count
        if match is not None:
            return result("総当たり", "発見", tested, begin, engine=engine_name)
    state = "全候補で未発見" if tested == total else "打切り"
    return result("総当たり", state, tested, begin, engine=engine_name)


def estimate(alphabet, length, rate):
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError("実測速度が必要です。")
    total = len(alphabet) ** length
    return {"candidates": total, "average_seconds": (total + 1) / (2 * rate),
            "exhaustive_seconds": total / rate,
            "assumption": "固定長・選択した文字集合からの一様生成・SHA-256照合"}


def duration(seconds):
    if seconds < 1:
        return f"{seconds * 1000:.2f}ミリ秒"
    if seconds < 60:
        return f"{seconds:.2f}秒"
    if seconds < 3600:
        return f"{seconds / 60:.1f}分"
    if seconds < 86400:
        return f"{seconds / 3600:.1f}時間"
    if seconds < 31557600:
        return f"{seconds / 86400:.1f}日"
    years = seconds / 31557600
    return f"{years:,.1f}年" if years < 1e9 else f"{years:.2e}年"


def run_experiment(password, alphabet, mask="sakura?d?d?d?d",
                   seconds=2.0, limit=100000, include_gpu=True):
    validate_password(password)
    if not alphabet or len(set(alphabet)) != len(alphabet):
        raise ValueError("使える文字を指定してください。")
    if not 0 < seconds <= 30 or not 1 <= limit <= 1000000:
        raise ValueError("時間は30秒以内、件数は100万件以内にしてください。")
    # 先に形式を確認し、入力ミスのまま計測を始めないようにします。
    mask_alphabets(mask)
    digest = hashlib.sha256(password.encode("ascii")).digest()
    print("同じSHA-256照合でPython・Numba・GPUの速度を測っています…")
    speeds, fastest, engine = benchmark(alphabet, len(password), digest, include_gpu)
    trials = [
        search_candidates("辞書", dictionary_candidates(), digest, seconds, limit),
        search_candidates("単語の変形", rule_candidates(), digest, seconds, limit),
        search_candidates("形式のヒント", mask_candidates(mask), digest, seconds, limit),
        brute_search(password, alphabet, engine, seconds, limit, fastest),
    ]
    best_rate = next(r["rate"] for r in speeds if r["engine"] == fastest)
    matching = all(c in alphabet for c in password)
    return {
        "version": VERSION,
        "verification": "SHA-256（教材用・実サービスの保存方式を再現しません）",
        "length": len(password), "alphabet_size": len(alphabet),
        "input_within_alphabet": matching,
        "fastest_engine": fastest, "benchmarks": speeds, "trials": trials,
        "estimate": estimate(alphabet, len(password), best_rate) if matching else None,
        "notes": [
            "探索の打切りは安全の証明ではありません。",
            "平均時間は一様生成を仮定した総当たりの値です。辞書語には適用できません。",
            "形式のヒントは正解の一部を知っている仮定です。",
            "辞書・単語の変形・形式のヒントはPython hashlibで実行します。",
            "実サービスの試行制限、保存方式、フィッシングなどはこの実験の対象外です。",
            "速度は同じ候補範囲を3回全走査した中央値です。初回準備時間は別表示です。",
            "バッチは途中で止めないため、総当たりは発見後の余分な候補も件数に含みます。",
        ],
    }


def pbkdf2_comparison(password, iterations=100000, repeats=3):
    """保存方式で照合コストが変わることを、同じ文字列で比較します。"""
    validate_password(password)
    if iterations < 10000 or iterations > 1000000:
        raise ValueError("反復回数は1万〜100万回にしてください。")
    raw, salt = password.encode("ascii"), secrets.token_bytes(16)
    rows = []
    for name, function in [
        ("SHA-256", lambda: hashlib.sha256(raw).digest()),
        (f"PBKDF2-HMAC-SHA256 {iterations:,}回",
         lambda: hashlib.pbkdf2_hmac("sha256", raw, salt, iterations)),
    ]:
        function()
        begin = time.perf_counter()
        for _ in range(repeats):
            function()
        elapsed = (time.perf_counter() - begin) / repeats
        rows.append({"verification": name, "seconds_per_check": elapsed})
    return rows
