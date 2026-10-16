from pricing import calculate_total
from checkout import checkout


def test_total_no_coupon():
    items = [{"price": 2.5, "qty": 2}, {"price": 1.0, "qty": 3}]
    assert calculate_total(items) == 8.0


def test_total_with_coupon():
    items = [{"price": 10.0, "qty": 1}]
    assert calculate_total(items, coupon=10) == 9.0


def test_checkout_delegates():
    items = [{"price": 4.0, "qty": 2}]
    assert checkout(items, coupon=25) == 6.0
