class ShoppingCart:
    def __init__(self):
        self._items = {}
        self._discount = 0.0

    def add(self, name, price, qty=1):
        if name in self._items:
            self._items[name] = (price, self._items[name][1] + qty)
        else:
            self._items[name] = (price, qty)

    def remove(self, name):
        self._items.pop(name, None)

    def total(self):
        subtotal = sum(price * qty for price, qty in self._items.values())
        return round(subtotal * (1 - self._discount), 2)

    def apply_discount(self, percent):
        self._discount = percent / 100
