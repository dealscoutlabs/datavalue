from hypothesis import given
from hypothesis import strategies as st

from roofsignal.outreach import tracking


def test_new_code_shape():
    code = tracking.new_code()
    assert len(code) == 8
    assert all(c in tracking.ALPHABET for c in code[:-1])
    assert tracking.is_valid(code)


def test_codes_are_unique_enough():
    assert len({tracking.new_code() for _ in range(5000)}) == 5000


def test_display_and_normalize_roundtrip():
    code = tracking.new_code()
    shown = tracking.display(code)
    assert "-" in shown
    assert tracking.is_valid(shown.lower())
    assert tracking.display("ABC") == "ABC"


@given(st.integers(min_value=0, max_value=6), st.sampled_from(tracking.ALPHABET))
def test_single_substitution_detected(pos, ch):
    code = tracking.new_code()
    if code[pos] == ch:
        return
    bad = code[:pos] + ch + code[pos + 1:]
    assert not tracking.is_valid(bad)


def test_invalid_inputs():
    assert not tracking.is_valid("")
    assert not tracking.is_valid("A")
    assert not tracking.is_valid("ABC!DEFG")


def test_confusable_letters_decode_like_digits():
    code = tracking.new_code()
    swapped = code[:-1].replace("0", "O").replace("1", "I") + code[-1]
    assert tracking.is_valid(swapped)
