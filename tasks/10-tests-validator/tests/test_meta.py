import importlib


def test_user_tests_exist_and_cover():
    mod = importlib.import_module("test_validator")
    test_fns = [n for n in dir(mod) if n.startswith("test_")]
    assert len(test_fns) >= 6, f"expected >=6 test functions, found {test_fns}"
