"""Short, unique, hard-to-mistype tracking codes (Crockford base32: no I, L, O, U) with a check character, so a
homeowner reading the code off a postcard over the phone can be validated before lookup."""

from __future__ import annotations

import secrets

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CHECK_ALPHABET = ALPHABET + "*~$=U"  # Crockford check symbols (37 total)
_DECODE = {c: i for i, c in enumerate(ALPHABET)} | {"O": 0, "I": 1, "L": 1}


def _check_char(body: str) -> str:
    value = 0
    for ch in body:
        value = value * 32 + _DECODE[ch]
    return _CHECK_ALPHABET[value % 37]


def new_code(length: int = 7) -> str:
    body = "".join(secrets.choice(ALPHABET) for _ in range(length))
    return body + _check_char(body)


def normalize(code: str) -> str:
    return code.strip().upper().replace("-", "").replace(" ", "")


def is_valid(code: str) -> bool:
    code = normalize(code)
    if len(code) < 2:
        return False
    body, check = code[:-1], code[-1]
    if any(ch not in _DECODE for ch in body):
        return False
    body = "".join(ALPHABET[_DECODE[ch]] for ch in body)
    return _check_char(body) == check


def display(code: str) -> str:
    """'7KQ2M9XA' -> '7KQ2-M9XA' for print."""
    return code[:4] + "-" + code[4:] if len(code) > 4 else code
