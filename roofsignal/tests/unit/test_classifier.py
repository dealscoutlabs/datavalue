import pytest

from roofsignal.adapters.permits.classifier import classify
from roofsignal.db.models import WorkCategory as W


@pytest.mark.parametrize(
    "desc,expected",
    [
        ("Strip and re-shingle roof", W.roof),
        ("RE-ROOF SFD", W.roof),
        ("Reroofing - tear off 2 layers", W.roof),
        ("Roof replacement", W.roof),
        ("Install roof mounted solar PV system", W.solar),
        ("Photovoltaic array on garage", W.solar),
        ("Roof deck over garage", W.other),
        ("Rooftop unit replacement", W.other),
        ("Replace furnace and AC unit", W.hvac),
        ("Ductless mini-split heat pump", W.hvac),
        ("New asphalt driveway", W.driveway),
        ("Kitchen renovation", W.other),
        ("", W.other),
        (None, W.other),
    ],
)
def test_classify(desc, expected):
    assert classify(desc) is expected
