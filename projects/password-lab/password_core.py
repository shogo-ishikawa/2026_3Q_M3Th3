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
VERSION = "1.2.0"
ALL_CHARACTERS = "".join(CHARSETS.values())
GROUPS = {
    "数字": CHARSETS["digits"], "小文字": CHARSETS["lower"],
    "大文字": CHARSETS["upper"], "英字": string.ascii_letters,
    "英数字": string.ascii_letters + string.digits,
    "記号": CHARSETS["symbols"], "すべて": ALL_CHARACTERS, "なし": "",
}


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


def _length(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 32:
        raise ValueError(f"{label}は1〜32の整数にしてください。")
    return value


def make_attack(knowledge="手がかりなし", *, digits=True, lower=False,
                upper=False, symbols=False, length_known=True, search_length=4,
                search_max_length=6, prefix="", suffix="", group1="数字",
                group1_count=4, group2="なし", group2_count=0):
    """攻撃側の設定だけで候補範囲を作る。正解の情報は受け取らない。"""
    if knowledge not in ("手がかりなし", "文字の種類・文字数を指定", "文字の並び・一部を指定"):
        raise ValueError("手がかりの種類を選んでください。")
    if knowledge == "文字の並び・一部を指定":
        for fixed in (prefix, suffix):
            if not isinstance(fixed, str) or any(not 33 <= ord(c) <= 126 for c in fixed):
                raise ValueError("固定する文字には半角の英数字・記号（空白なし）を使ってください。")
        positions = list(prefix)
        parts = [prefix] if prefix else []
        groups = []
        for kind, count in ((group1, group1_count), (group2, group2_count)):
            if kind not in GROUPS:
                raise ValueError("文字グループと文字数を確認してください。")
            if kind == "なし":
                continue
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError("文字グループと文字数を確認してください。")
            if not 0 <= count <= 32:
                raise ValueError("文字グループの文字数は0〜32にしてください。")
            if count:
                positions.extend([GROUPS[kind]] * count)
                parts.append(f"{kind}{count}文字")
                groups.append({"kind": kind, "count": count})
        positions.extend(suffix)
        _length(len(positions), "並び全体の文字数")
        if suffix:
            parts.append(suffix)
        total = math.prod(len(chars) for chars in positions)
        public = {"knowledge": knowledge, "length_known": True,
                  "min_length": len(positions), "max_length": len(positions),
                  "prefix_length": len(prefix), "suffix_length": len(suffix),
                  "groups": groups, "candidates": total}
        return {"mode": "structure", "positions": positions, "candidates": total,
                "min_length": len(positions), "max_length": len(positions),
                "preview": "＋".join(parts), "public": public}

    if knowledge == "手がかりなし":
        alphabet = ALL_CHARACTERS
        minimum, maximum = 1, _length(search_max_length, "探索する最大文字数")
        types = list(CHARSETS)
    else:
        alphabet = alphabet_for(digits, lower, upper, symbols)
        maximum = _length(search_length if length_known else search_max_length,
                          "探索する文字数")
        minimum = maximum if length_known else 1
        types = [name for name, enabled in zip(CHARSETS, (digits, lower, upper, symbols)) if enabled]
    total = sum(len(alphabet) ** length for length in range(minimum, maximum + 1))
    length_text = f"{maximum}文字" if minimum == maximum else f"1〜{maximum}文字を短い順"
    public = {"knowledge": knowledge, "length_known": minimum == maximum,
              "min_length": minimum, "max_length": maximum,
              "charset_types": types, "alphabet_size": len(alphabet), "candidates": total}
    return {"mode": "charset", "alphabet": alphabet, "min_length": minimum,
            "max_length": maximum, "candidates": total,
            "preview": f"{len(alphabet)}種類の文字・{length_text}", "public": public}


def structure_candidates(positions):
    for values in itertools.product(*positions):
        yield "".join(values)


def candidate_allowed(candidate, attack):
    if attack["mode"] == "structure":
        return (len(candidate) == len(attack["positions"])
                and all(c in chars for c, chars in zip(candidate, attack["positions"])))
    return (attack["min_length"] <= len(candidate) <= attack["max_length"]
            and all(c in attack["alphabet"] for c in candidate))


def search_candidates(name, candidates, digest, seconds=2.0, limit=100000, attack=None):
    if not 0 < seconds <= 30 or not 1 <= limit <= 1000000:
        raise ValueError("実験の時間・件数の上限を確認してください。")
    begin = time.perf_counter()
    tested = 0
    seen = set()
    for candidate in candidates:
        if tested >= limit or time.perf_counter() - begin >= seconds:
            return result(name, "打切り", tested, begin)
        if (attack is not None and not candidate_allowed(candidate, attack)) or candidate in seen:
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


def brute_search(attack, digest, seconds=2.0, limit=100000, engine_name="Python"):
    """長さをまたいでも、1つの時間・件数上限を共有する。"""
    if not 0 < seconds <= 30 or not 1 <= limit <= 1000000:
        raise ValueError("実験の時間・件数の上限を確認してください。")
    begin = time.perf_counter()
    tested = 0
    alphabet = attack["alphabet"]
    for length in range(attack["min_length"], attack["max_length"] + 1):
        if tested >= limit or time.perf_counter() - begin >= seconds:
            return result("総当たり", "打切り", tested, begin, engine=engine_name)
        engine = make_engine(engine_name, alphabet, length, digest)
        total, index = len(alphabet) ** length, 0
        while index < total:
            if (tested >= limit or time.perf_counter() - begin >= seconds or index >= 2**63):
                return result("総当たり", "打切り", tested, begin, engine=engine_name)
            count = min(MAX_BATCH, total - index, limit - tested, 2**63 - index)
            match = engine(index, count)
            index += count
            tested += count
            if match is not None:
                return result("総当たり", "発見", tested, begin, engine=engine_name)
    return result("総当たり", "全候補で未発見", tested, begin, engine=engine_name)


def estimate(alphabet, length, rate, min_length=None):
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError("実測速度が必要です。")
    minimum = length if min_length is None else min_length
    total = sum(len(alphabet) ** n for n in range(minimum, length + 1))
    return {"candidates": total, "average_seconds": (total + 1) / (2 * rate),
            "exhaustive_seconds": total / rate,
            "assumption": "指定した全候補が同じ確率で選ばれ、全長で同じSHA-256照合速度と仮定"}


def benchmark_structure(positions, digest, batch=8192):
    """位置ごとに使える文字が異なる候補生成も含め、別に測定する。"""
    count = min(batch, math.prod(len(chars) for chars in positions))
    def scan():
        for candidate in itertools.islice(structure_candidates(positions), count):
            hashlib.sha256(candidate.encode("ascii")).digest() == digest
    scan()
    times = []
    for _ in range(3):
        begin = time.perf_counter()
        scan()
        times.append(max(time.perf_counter() - begin, 1e-12))
    elapsed = sorted(times)[1]
    return [{"engine": "Python hashlib（並びの指定）", "state": "実測",
             "count": count, "seconds": elapsed, "rate": count / elapsed,
             "prepare_seconds": 0.0}]


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


def run_experiment(password, attack=None,
                   seconds=2.0, limit=100000, include_gpu=True):
    validate_password(password)
    if not 0 < seconds <= 30 or not 1 <= limit <= 1000000:
        raise ValueError("時間は30秒以内、件数は100万件以内にしてください。")
    if attack is None:
        attack = make_attack()
    digest = hashlib.sha256(password.encode("ascii")).digest()
    if attack["mode"] == "structure":
        print("指定した並びの候補生成とSHA-256照合を測っています…")
        speeds = benchmark_structure(attack["positions"], digest)
        fastest = speeds[0]["engine"]
        search_row = search_candidates("指定した並び", structure_candidates(attack["positions"]),
                                       digest, seconds, limit)
        rate = speeds[0]["rate"]
        total = attack["candidates"]
        estimated = {"candidates": total, "average_seconds": (total + 1) / (2 * rate),
                     "exhaustive_seconds": total / rate,
                     "assumption": "指定した並びの全候補が同じ確率で選ばれると仮定"}
    else:
        print("攻撃側で指定した最大文字数で、同じSHA-256照合の速さを測っています…")
        speeds, fastest, _ = benchmark(attack["alphabet"], attack["max_length"],
                                      digest, include_gpu)
        search_row = brute_search(attack, digest, seconds, limit, fastest)
        rate = next(r["rate"] for r in speeds if r["engine"] == fastest)
        estimated = estimate(attack["alphabet"], attack["max_length"], rate, attack["min_length"])
    trials = [
        search_candidates("辞書", dictionary_candidates(), digest, seconds, limit, attack),
        search_candidates("単語の変形", rule_candidates(), digest, seconds, limit, attack),
        search_row,
    ]
    return {
        "version": VERSION,
        "verification": "SHA-256（教材用・実サービスの保存方式を再現しません）",
        "attack": attack["public"],
        "fastest_engine": fastest, "benchmarks": speeds, "trials": trials,
        "estimate": estimated,
        "notes": [
            "探索の打切りは安全の証明ではありません。",
            "平均時間は指定した全候補が同じ確率で選ばれる仮定です。人が考えた文字列の強さではありません。",
            "攻撃側の手がかりはセル3で指定し、正解の長さや文字種から取得しません。",
            "辞書と単語の変形も、攻撃側で指定した候補範囲の中で試します。",
            "文字数が不明なら短い順に調べ、時間・件数の上限は各方法の全体で共有します。",
            "最大文字数で測定した代表速度を、短い文字数にも同じと仮定して推定します。"
            if attack["mode"] != "structure" else
            "並び指定では位置ごとに文字集合が異なるため、Python hashlibで別に速度を測定します。",
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
