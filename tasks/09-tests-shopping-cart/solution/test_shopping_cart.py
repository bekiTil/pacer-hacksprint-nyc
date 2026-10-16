from shopping_cart import ShoppingCart


def test_add_and_total():
    cart = ShoppingCart()
    cart.add("apple", 1.5, 2)
    cart.add("bread", 2.0)
    assert cart.total() == 5.0


def test_remove():
    cart = ShoppingCart()
    cart.add("apple", 1.5, 2)
    cart.remove("apple")
    assert cart.total() == 0.0


def test_discount():
    cart = ShoppingCart()
    cart.add("widget", 10.0, 1)
    cart.apply_discount(10)
    assert cart.total() == 9.0


def test_remove_missing_is_noop():
    cart = ShoppingCart()
    cart.add("apple", 1.0, 1)
    cart.remove("ghost")
    assert cart.total() == 1.0
