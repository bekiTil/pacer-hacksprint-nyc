def _slugify(text):
    return text.strip().lower().replace(" ", "-")


def create_post(title, body):
    return {"slug": _slugify(title), "title": title, "body": body}


def summarize(body, limit=100):
    return body if len(body) <= limit else body[: limit - 1] + "…"


def tag_post(post, tags):
    post = dict(post)
    post["tags"] = sorted(set(tags))
    return post
