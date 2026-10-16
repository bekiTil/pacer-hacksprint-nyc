def is_email(value):
    return isinstance(value, str) and "@" in value and "." in value.split("@")[-1]


def is_adult(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 18


def is_valid_username(value):
    return isinstance(value, str) and len(value) >= 3
