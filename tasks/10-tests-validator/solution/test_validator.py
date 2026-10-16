from validator import validate


def _ok():
    return {"email": "a@b.com", "age": 30, "username": "alice"}


def test_valid_form():
    assert validate(_ok()) == []


def test_missing_email():
    form = _ok(); form["email"] = ""
    assert "invalid email" in validate(form)


def test_email_without_at():
    form = _ok(); form["email"] = "nope.com"
    assert "invalid email" in validate(form)


def test_underage():
    form = _ok(); form["age"] = 16
    assert "must be 18 or older" in validate(form)


def test_non_integer_age():
    form = _ok(); form["age"] = "30"
    assert "must be 18 or older" in validate(form)


def test_short_username():
    form = _ok(); form["username"] = "ab"
    assert "username too short" in validate(form)
