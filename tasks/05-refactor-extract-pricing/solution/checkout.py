from pricing import calculate_total


def checkout(items, coupon=None):
    return calculate_total(items, coupon)
