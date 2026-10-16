_REGISTRY = {}


def register(name):
    def decorator(fn):
        _REGISTRY[name] = fn
        return fn
    return decorator


def dispatch(name, value):
    if name not in _REGISTRY:
        raise KeyError("unknown command: " + name)
    return _REGISTRY[name](value)
