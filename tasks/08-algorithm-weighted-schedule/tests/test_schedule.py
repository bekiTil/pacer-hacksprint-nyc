from schedule import max_profit


def test_empty():
    assert max_profit([]) == 0


def test_single():
    assert max_profit([(0, 5, 10)]) == 10


def test_pick_higher_profit():
    # one long job vs two short ones
    assert max_profit([(1, 10, 100), (1, 3, 40), (3, 10, 50)]) == 100


def test_touching_allowed():
    assert max_profit([(1, 3, 50), (3, 6, 60)]) == 110


def test_overlap_excluded():
    assert max_profit([(1, 4, 50), (2, 6, 60), (6, 9, 70)]) == 130


def test_large_is_fast():
    jobs = [(i, i + 1, 1) for i in range(5000)]
    assert max_profit(jobs) == 5000
