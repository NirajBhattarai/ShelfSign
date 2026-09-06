"""
Fuzzy extractor (code-offset construction with BCH). Ported from
siliconwitness's gateway/puf/fuzzy_extractor.py.

    enroll:      helper = measured XOR random_codeword ; key = SHA256(codeword)
    regenerate:  codeword = BCH_decode(measured' XOR helper) ; key = SHA256(codeword)

Design notes / honest constraints (read before changing parameters)
---------------------------------------------------------------------
`bchlib`'s binary BCH codes have a hard, physical rate-distance tradeoff:
error-correction bits scale roughly as `ecc_bits ~= m * t` for an
`n = 2^m - 1`-bit codeword, so `t` cannot exceed roughly `n / m` before the
data payload hits zero. No standard binary BCH code corrects errors much
beyond ~10-12% of its own length while still leaving a non-trivial data
payload -- this is why coordinate selection quality (puf_coords.py) matters
so much.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from typing import Optional

import bchlib


@dataclass
class BCHParams:
    m: int
    t: int
    n: int              # codeword length in bits (bchlib's own n for this m)
    ecc_bits: int
    ecc_bytes: int
    data_bytes: int      # random-message length used for encode()
    buffer_bytes: int     # data_bytes + ecc_bytes -- the full XOR buffer size
    assumed_worst_flips: int
    achieved_margin: float  # t / assumed_worst_flips (>=1.0 required to be usable)


def _feasible(t: int, m: int) -> Optional["bchlib.BCH"]:
    try:
        return bchlib.BCH(t, m=m)
    except Exception:
        return None


def pick_bch_params(assumed_worst_flips: int, candidate_bits: int = 256,
                     target_margin: float = 2.5) -> BCHParams:
    """Search bchlib's feasible (m, t) space for the code that fits within
    candidate_bits and, among those meeting target_margin, maximises
    data_bytes (key entropy). Falls back to the best achievable margin if
    target_margin is unreachable within candidate_bits (reported honestly
    via achieved_margin, which may be < target_margin)."""
    candidates = []
    for m in (8, 9, 10):
        for t in range(1, 200):
            bch = _feasible(t, m)
            if bch is None:
                continue
            n = bch.n
            ecc_bits = bch.ecc_bits
            ecc_bytes = bch.ecc_bytes
            data_bits = n - ecc_bits
            if data_bits <= 0:
                continue
            data_bytes = data_bits // 8 or 1
            buffer_bytes = data_bytes + ecc_bytes
            if buffer_bytes * 8 > candidate_bits:
                continue
            candidates.append((m, t, n, ecc_bits, ecc_bytes, data_bytes, buffer_bytes))

    if not candidates:
        raise RuntimeError(
            f"No feasible BCH (m,t) found that fits within {candidate_bits} candidate bits."
        )

    def margin_of(row):
        t = row[1]
        return t / max(assumed_worst_flips, 1)

    meeting_target = [c for c in candidates if margin_of(c) >= target_margin]
    if meeting_target:
        chosen = max(meeting_target, key=lambda c: (c[5], -c[0]))
    else:
        chosen = max(candidates, key=lambda c: (margin_of(c), c[5]))

    m, t, n, ecc_bits, ecc_bytes, data_bytes, buffer_bytes = chosen
    return BCHParams(
        m=m, t=t, n=n, ecc_bits=ecc_bits, ecc_bytes=ecc_bytes,
        data_bytes=data_bytes, buffer_bytes=buffer_bytes,
        assumed_worst_flips=assumed_worst_flips,
        achieved_margin=t / max(assumed_worst_flips, 1),
    )


@dataclass
class EnrollResult:
    helper: bytes
    params: BCHParams
    key: bytearray  # 32 bytes, SHA256(codeword) -- caller must zero after use


@dataclass
class RegenerateResult:
    key: bytearray
    corrected_bit_errors: int


def enroll(measured: bytes, params: BCHParams) -> EnrollResult:
    """measured: raw extracted PUF bit-buffer (>= params.buffer_bytes bytes)."""
    if len(measured) < params.buffer_bytes:
        raise ValueError(
            f"measured buffer too short: got {len(measured)} bytes, need "
            f"{params.buffer_bytes} for BCH(m={params.m}, t={params.t})"
        )
    measured_buf = measured[:params.buffer_bytes]

    bch = bchlib.BCH(params.t, m=params.m)
    random_data = bytearray(os.urandom(params.data_bytes))
    ecc = bch.encode(random_data)
    codeword = bytes(random_data) + bytes(ecc)
    assert len(codeword) == params.buffer_bytes

    helper = bytes(a ^ b for a, b in zip(measured_buf, codeword))
    key_digest = hashlib.sha256(codeword).digest()
    key = bytearray(key_digest)

    for i in range(len(random_data)):
        random_data[i] = 0
    codeword_ba = bytearray(codeword)
    for i in range(len(codeword_ba)):
        codeword_ba[i] = 0

    return EnrollResult(helper=helper, params=params, key=key)


def regenerate(measured: bytes, helper: bytes, params: BCHParams) -> RegenerateResult:
    """Raises RuntimeError if the BCH decoder cannot correct the observed
    error pattern (i.e. more than params.t bits flipped)."""
    if len(measured) < params.buffer_bytes or len(helper) < params.buffer_bytes:
        raise ValueError("measured/helper buffer shorter than params.buffer_bytes")

    measured_buf = measured[:params.buffer_bytes]
    helper_buf = helper[:params.buffer_bytes]

    noisy_codeword = bytes(a ^ b for a, b in zip(measured_buf, helper_buf))
    data = bytearray(noisy_codeword[:params.data_bytes])
    ecc = bytearray(noisy_codeword[params.data_bytes:params.buffer_bytes])

    bch = bchlib.BCH(params.t, m=params.m)
    nerr = bch.decode(data, ecc)
    if nerr < 0:
        raise RuntimeError(
            f"BCH decode failed: observed error pattern exceeds correction "
            f"capacity t={params.t} for BCH(m={params.m})."
        )
    bch.correct(data, ecc)
    corrected_codeword = bytes(data) + bytes(ecc)
    key_digest = hashlib.sha256(corrected_codeword).digest()
    key = bytearray(key_digest)

    for i in range(len(data)):
        data[i] = 0
    for i in range(len(ecc)):
        ecc[i] = 0

    return RegenerateResult(key=key, corrected_bit_errors=nerr)


def zero_bytearray(b: bytearray) -> None:
    """Best-effort zeroing of key material -- CPython gives no guarantee
    this actually scrubs memory. Adequate for a hackathon prototype, not a
    production security guarantee (see gateway/README.md upstream)."""
    for i in range(len(b)):
        b[i] = 0
