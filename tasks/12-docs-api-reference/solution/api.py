"""Small blog-post API: create, summarize and tag posts."""


def _slugify(text):
    return text.strip().lower().replace(" ", "-")


def create_post(title, body):
    """Create a post record from a title and body.

    Args:
        title: the human-readable post title.
        body: the post's text content.

    Returns:
        A dict with 'slug', 'title' and 'body' keys.
    """
    return {"slug": _slugify(title), "title": title, "body": body}


def summarize(body, limit=100):
    """Shorten a body of text to at most ``limit`` characters.

    Args:
        body: the text to summarize.
        limit: the maximum length of the result.

    Returns:
        The body unchanged if short enough, otherwise a truncated string
        ending in an ellipsis.
    """
    return body if len(body) <= limit else body[: limit - 1] + "…"


def tag_post(post, tags):
    """Attach a sorted, de-duplicated set of tags to a post.

    Args:
        post: the post dict to tag.
        tags: an iterable of tag strings.

    Returns:
        A new post dict with a sorted 'tags' list added.
    """
    post = dict(post)
    post["tags"] = sorted(set(tags))
    return post
