import inspect
import api


PUBLIC = ["create_post", "summarize", "tag_post"]


def test_behaviour_unchanged():
    post = api.create_post("Hello World", "body")
    assert post["slug"] == "hello-world"
    assert api.summarize("x" * 10, limit=5) == "xxxx…"
    assert api.tag_post(post, ["b", "a", "b"])["tags"] == ["a", "b"]


def test_module_docstring():
    assert api.__doc__ and api.__doc__.strip()


def test_public_functions_have_args_and_returns():
    for name in PUBLIC:
        doc = inspect.getdoc(getattr(api, name)) or ""
        assert "Args:" in doc, f"{name} missing Args section"
        assert "Returns:" in doc, f"{name} missing Returns section"


def test_private_helper_untouched():
    assert api._slugify("A B") == "a-b"
