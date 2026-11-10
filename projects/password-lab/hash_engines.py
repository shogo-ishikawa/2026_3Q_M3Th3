"""教材用の固定長ASCII候補探索。暗号ライブラリとしては使用しない。"""

import hashlib
import struct
from functools import lru_cache
from numbers import Integral

MAX_INDEX = 2**63 - 1
MAX_BATCH = 65_536

_K = (
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5,
    0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
    0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC,
    0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7,
    0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
    0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3,
    0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5,
    0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
    0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
)
_H = (
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
    0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
)


def _integer(value, name):
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise ValueError(f"{name}は整数で指定してください。")
    return int(value)


def _settings(alphabet, length):
    length = _integer(length, "桁数")
    if not isinstance(alphabet, str) or not alphabet:
        raise ValueError("使用文字を1文字以上指定してください。")
    if not alphabet.isascii() or len(set(alphabet)) != len(alphabet):
        raise ValueError("使用文字は重複のないASCII文字にしてください。")
    if not 1 <= length <= 32:
        raise ValueError("実探索の桁数は1〜32にしてください。")
    return length, len(alphabet)**length


def _decode(index, alphabet, length):
    chars = [alphabet[0]] * length
    base = len(alphabet)
    for pos in range(length - 1, -1, -1):
        index, digit = divmod(index, base)
        chars[pos] = alphabet[digit]
    return "".join(chars)


def candidate_from_index(index, alphabet, length):
    length, total = _settings(alphabet, length)
    index = _integer(index, "候補番号")
    if not 0 <= index <= MAX_INDEX or index >= total:
        raise ValueError("候補番号が探索可能な範囲外です。")
    return _decode(index, alphabet, length)


def _range(start, count, total):
    start = _integer(start, "開始番号")
    count = _integer(count, "候補数")
    cap = min(total, MAX_INDEX + 1)
    if start < 0 or count < 0 or count > MAX_BATCH or start + count > cap:
        raise ValueError("探索範囲が不正です。1回の候補数は65536以下です。")
    return start, count


@lru_cache(maxsize=1)
def _numba_kernels():
    import numpy as np
    from numba import njit, prange

    constants = np.array(_K, dtype=np.uint32)
    initial = np.array(_H, dtype=np.uint32)

    @njit(inline="always")
    def rotate(x, shift):
        x = np.uint32(x)
        shift = np.uint32(shift)
        return np.uint32(
            (x >> shift) | (x << (np.uint32(32) - shift))
        )

    @njit
    def matches(index, codes, length, target):
        # SHA-256の1ブロック分を構築する。
        w = np.zeros(64, dtype=np.uint32)
        remainder = np.uint64(index)
        base = np.uint64(len(codes))
        for pos in range(length - 1, -1, -1):
            digit = int(remainder % base)
            byte = codes[digit]
            shift = np.uint32(24 - 8 * (pos % 4))
            w[pos // 4] = np.uint32(
                w[pos // 4] | (np.uint32(byte) << shift)
            )
            remainder //= base
        shift = np.uint32(24 - 8 * (length % 4))
        w[length // 4] = np.uint32(
            w[length // 4] | (np.uint32(0x80) << shift)
        )
        w[15] = np.uint32(length * 8)

        for i in range(16, 64):
            s0 = np.uint32(
                rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18)
                ^ (w[i - 15] >> np.uint32(3))
            )
            s1 = np.uint32(
                rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19)
                ^ (w[i - 2] >> np.uint32(10))
            )
            w[i] = np.uint32(w[i - 16] + s0 + w[i - 7] + s1)

        a, b, c, d = initial[0], initial[1], initial[2], initial[3]
        e, f, g, h = initial[4], initial[5], initial[6], initial[7]
        for i in range(64):
            upper = np.uint32(rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
            choice = np.uint32((e & f) ^ ((~e) & g))
            t1 = np.uint32(h + upper + choice + constants[i] + w[i])
            lower = np.uint32(rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22))
            majority = np.uint32((a & b) ^ (a & c) ^ (b & c))
            t2 = np.uint32(lower + majority)
            h, g, f, e = g, f, e, np.uint32(d + t1)
            d, c, b, a = c, b, a, np.uint32(t1 + t2)

        return (
            np.uint32(a + initial[0]) == target[0]
            and np.uint32(b + initial[1]) == target[1]
            and np.uint32(c + initial[2]) == target[2]
            and np.uint32(d + initial[3]) == target[3]
            and np.uint32(e + initial[4]) == target[4]
            and np.uint32(f + initial[5]) == target[5]
            and np.uint32(g + initial[6]) == target[6]
            and np.uint32(h + initial[7]) == target[7]
        )

    @njit
    def serial(start, count, codes, length, target):
        found = np.int64(-1)
        for offset in range(count):
            index = np.uint64(start) + np.uint64(offset)
            hit = matches(index, codes, length, target)
            # 比較のため、一致後もバッチ全体を処理する。
            if hit and found < 0:
                found = np.int64(index)
        return found

    @njit(parallel=True)
    def parallel(start, count, codes, length, target):
        hits = np.full(count, -1, dtype=np.int64)
        for offset in prange(count):
            index = np.uint64(start) + np.uint64(offset)
            if matches(index, codes, length, target):
                hits[offset] = np.int64(index)
        for offset in range(count):
            if hits[offset] >= 0:
                return hits[offset]
        return np.int64(-1)

    return serial, parallel


_CUDA = r"""
__device__ __constant__ unsigned int K[64] = { __K_VALUES__ };

__device__ __forceinline__
unsigned int rr(unsigned int x, unsigned int n) {
    return (x >> n) | (x << (32 - n));
}

__device__
bool sha_match(
    unsigned long long index, const unsigned char* codes,
    unsigned int base, unsigned int length, const unsigned int* target
) {
    unsigned int w[64] = {0};
    for (int pos = (int)length - 1; pos >= 0; --pos) {
        unsigned int digit = (unsigned int)(index % base);
        w[pos / 4] |= ((unsigned int)codes[digit]) << (24 - 8 * (pos % 4));
        index /= base;
    }
    w[length / 4] |= 0x80u << (24 - 8 * (length % 4));
    w[15] = length * 8;
    for (int i = 16; i < 64; ++i) {
        unsigned int s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >> 3);
        unsigned int s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >> 10);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }
    unsigned int a=0x6a09e667u, b=0xbb67ae85u;
    unsigned int c=0x3c6ef372u, d=0xa54ff53au;
    unsigned int e=0x510e527fu, f=0x9b05688cu;
    unsigned int g=0x1f83d9abu, h=0x5be0cd19u;
    for (int i = 0; i < 64; ++i) {
        unsigned int s1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
        unsigned int ch = (e & f) ^ ((~e) & g);
        unsigned int t1 = h + s1 + ch + K[i] + w[i];
        unsigned int s0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
        unsigned int maj = (a & b) ^ (a & c) ^ (b & c);
        unsigned int t2 = s0 + maj;
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    return a+0x6a09e667u==target[0] && b+0xbb67ae85u==target[1]
        && c+0x3c6ef372u==target[2] && d+0xa54ff53au==target[3]
        && e+0x510e527fu==target[4] && f+0x9b05688cu==target[5]
        && g+0x1f83d9abu==target[6] && h+0x5be0cd19u==target[7];
}

extern "C" __global__
void search_sha256(
    unsigned long long start, unsigned int count,
    const unsigned char* codes, unsigned int base, unsigned int length,
    const unsigned int* target, unsigned long long* result
) {
    unsigned int offset = blockIdx.x * blockDim.x + threadIdx.x;
    if (offset >= count) return;
    unsigned long long index = start + (unsigned long long)offset;
    if (sha_match(index, codes, base, length, target))
        atomicMin(result, index);
}
"""


def make_engine(name, alphabet, length, target_digest_bytes):
    """全バッチを検証し、最小の一致indexまたはNoneを返す関数を作る。"""
    length, total = _settings(alphabet, length)
    if not isinstance(target_digest_bytes, (bytes, bytearray, memoryview)):
        raise ValueError("照合値はSHA-256の32バイトで指定してください。")
    digest = bytes(target_digest_bytes)
    if len(digest) != 32:
        raise ValueError("照合値はSHA-256の32バイトで指定してください。")
    if name not in ("Python", "Numba", "Numba parallel", "GPU"):
        raise ValueError("計算方法が不明です。")

    if name == "Python":
        def check(start, count):
            start, count = _range(start, count, total)
            found = None
            for index in range(start, start + count):
                candidate = _decode(index, alphabet, length).encode("ascii")
                hit = hashlib.sha256(candidate).digest() == digest
                if hit and found is None:
                    found = index
            return found
        return check

    import numpy as np
    codes = np.frombuffer(alphabet.encode("ascii"), dtype=np.uint8).copy()
    target = np.array(struct.unpack(">8I", digest), dtype=np.uint32)

    if name in ("Numba", "Numba parallel"):
        serial, parallel = _numba_kernels()
        kernel = parallel if name == "Numba parallel" else serial

        def check(start, count):
            start, count = _range(start, count, total)
            if count == 0:
                return None
            found = int(kernel(
                np.int64(start), np.int64(count), codes, length, target
            ))
            return None if found < 0 else found
        return check

    import cupy as cp
    if cp.cuda.runtime.getDeviceCount() == 0:
        raise RuntimeError("GPUが見つかりません。")
    source = _CUDA.replace(
        "__K_VALUES__", ", ".join(f"0x{k:08x}u" for k in _K)
    )
    kernel = cp.RawKernel(source, "search_sha256")
    device_codes, device_target = cp.asarray(codes), cp.asarray(target)
    sentinel = 2**64 - 1

    def check(start, count):
        start, count = _range(start, count, total)
        if count == 0:
            return None
        result = cp.full(1, sentinel, dtype=cp.uint64)
        kernel(
            ((count + 255) // 256,), (256,),
            (
                np.uint64(start), np.uint32(count), device_codes,
                np.uint32(len(alphabet)), np.uint32(length),
                device_target, result,
            ),
        )
        cp.cuda.get_current_stream().synchronize()
        found = int(cp.asnumpy(result)[0])
        return None if found == sentinel else found
    return check
