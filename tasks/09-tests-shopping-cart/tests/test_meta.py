import importlib


def test_user_tests_exist_and_cover():
    mod = importlib.import_module("test_shopping_cart")
    test_fns = [n for n in dir(mod) if n.startswith("test_")]
    assert len(test_fns) >= 4, f"expected >=4 test functions, found {test_fns}"
