def run(name, value):
    if name == "upper":
        return value.upper()
    elif name == "double":
        return value * 2
    elif name == "negate":
        return -value
    else:
        raise ValueError("unknown command: " + name)
