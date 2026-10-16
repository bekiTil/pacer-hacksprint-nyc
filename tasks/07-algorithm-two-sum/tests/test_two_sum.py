from two_sum import two_sum


def test_found():
    assert two_sum([2, 7, 11, 15], 9) == (0, 1)


def test_middle():
    assert two_sum([3, 2, 4], 6) == (1, 2)


def test_none():
    assert two_sum([1, 2, 3], 100) is None


def test_negatives():
    assert two_sum([-3, 4, 1, -1], 0) == (2, 3)
