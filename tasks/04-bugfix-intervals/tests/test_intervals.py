from models import Interval
from intervals import merge


def test_touching_merge():
    out = merge([Interval(1, 3), Interval(3, 5)])
    assert out == [Interval(1, 5)]


def test_overlap_merge():
    out = merge([Interval(1, 4), Interval(2, 6), Interval(8, 10)])
    assert out == [Interval(1, 6), Interval(8, 10)]


def test_unsorted_input():
    out = merge([Interval(8, 10), Interval(1, 3), Interval(2, 6)])
    assert out == [Interval(1, 6), Interval(8, 10)]


def test_nested():
    out = merge([Interval(1, 10), Interval(2, 4)])
    assert out == [Interval(1, 10)]


def test_empty():
    assert merge([]) == []
