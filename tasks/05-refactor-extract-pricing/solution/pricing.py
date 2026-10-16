def calculate_total(items, coupon=None):
    total = 0.0
    for item in items:
        total += item["price"] * item["qty"]
    if coupon:
        total = total * (1 - coupon / 100)
    return round(total, 2)
