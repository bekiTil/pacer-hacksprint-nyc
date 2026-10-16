from lru import LRUCache


def test_basic_eviction():
    c = LRUCache(2)
    c.put("a", 1); c.put("b", 2); c.put("c", 3)
    assert c.get("a") is None
    assert c.get("b") == 2
    assert c.get("c") == 3


def test_get_updates_recency():
    c = LRUCache(2)
    c.put("a", 1); c.put("b", 2)
    assert c.get("a") == 1  # 'a' now most recent
    c.put("c", 3)           # should evict 'b', not 'a'
    assert c.get("a") == 1
    assert c.get("b") is None


def test_put_existing_updates_recency():
    c = LRUCache(2)
    c.put("a", 1); c.put("b", 2)
    c.put("a", 10)   # refresh 'a'
    c.put("c", 3)    # evict 'b'
    assert c.get("a") == 10
    assert c.get("b") is None
