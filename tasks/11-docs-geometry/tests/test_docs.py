import geometry


def test_behaviour_unchanged():
    assert geometry.area_rectangle(2, 3) == 6
    assert geometry.area_triangle(4, 2) == 4.0


def test_each_function_has_docstring():
    for name in ("area_circle", "area_rectangle", "area_triangle"):
        fn = getattr(geometry, name)
        assert fn.__doc__ and fn.__doc__.strip(), f"{name} missing docstring"


def test_docstrings_mention_params():
    assert "radius" in geometry.area_circle.__doc__.lower()
    assert "width" in geometry.area_rectangle.__doc__.lower()
    assert "base" in geometry.area_triangle.__doc__.lower()
