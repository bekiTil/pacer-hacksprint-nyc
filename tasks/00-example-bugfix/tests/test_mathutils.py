from mathutils import sum_to_n


def test_small():
    assert sum_to_n(3) == 6


def test_one():
    assert sum_to_n(1) == 1


def test_non_positive():
    assert sum_to_n(0) == 0
    assert sum_to_n(-5) == 0
