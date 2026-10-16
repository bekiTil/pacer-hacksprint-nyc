from rules import is_email, is_adult, is_valid_username


def validate(form):
    errors = []
    if not is_email(form.get("email")):
        errors.append("invalid email")
    if not is_adult(form.get("age")):
        errors.append("must be 18 or older")
    if not is_valid_username(form.get("username")):
        errors.append("username too short")
    return errors
