import pytest

from roofsignal.core.address import normalize_address


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("12 North Main Street", "12 N MAIN ST"),
        ("12 N. Main St., Apt 2", "12 N MAIN ST"),
        ("0012 Main St #3B", "12 MAIN ST"),
        ("45 Ocean Avenue", "45 OCEAN AVE"),
        ("7 Park Pl, Islip NY", "7 PARK PL"),
        ("North Road", "NORTH RD"),  # a street called North is not a direction
        ("", None),
        (None, None),
        ("   ", None),
    ],
)
def test_normalize(raw, expected):
    assert normalize_address(raw) == expected
