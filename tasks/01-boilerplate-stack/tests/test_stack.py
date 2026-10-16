import pytest
from stack import Stack


def test_push_pop():
    s = Stack()
    s.push(1); s.push(2)
    assert s.pop() == 2
    assert s.pop() == 1


def test_peek_and_size():
    s = Stack()
    assert s.is_empty()
    s.push("a")
    assert s.peek() == "a"
    assert s.size() == 1
    assert not s.is_empty()


def test_empty_errors():
    s = Stack()
    with pytest.raises(IndexError):
        s.pop()
    with pytest.raises(IndexError):
        s.peek()
