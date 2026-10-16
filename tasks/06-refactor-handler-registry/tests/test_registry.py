import pytest
from registry import register, dispatch
from handlers import run


def test_existing_commands_via_run():
    assert run("upper", "hi") == "HI"
    assert run("double", 4) == 8
    assert run("negate", 3) == -3


def test_dispatch_matches_run():
    assert dispatch("upper", "ab") == "AB"


def test_unknown_raises_keyerror():
    with pytest.raises(KeyError):
        dispatch("missing", 1)


def test_registry_is_extensible():
    @register("triple")
    def _triple(value):
        return value * 3
    assert dispatch("triple", 5) == 15
    assert run("triple", 5) == 15
