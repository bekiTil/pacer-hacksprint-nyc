from registry import register, dispatch


@register("upper")
def _upper(value):
    return value.upper()


@register("double")
def _double(value):
    return value * 2


@register("negate")
def _negate(value):
    return -value


def run(name, value):
    return dispatch(name, value)
