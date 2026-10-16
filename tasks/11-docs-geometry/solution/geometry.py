import math


def area_circle(radius):
    """Return the area of a circle with the given radius.

    radius: the circle's radius. Returns pi * radius ** 2.
    """
    return math.pi * radius * radius


def area_rectangle(width, height):
    """Return the area of a rectangle.

    width: the rectangle's width. height: its height. Returns width * height.
    """
    return width * height


def area_triangle(base, height):
    """Return the area of a triangle.

    base: the triangle's base length. height: its height. Returns 0.5 * base * height.
    """
    return 0.5 * base * height
