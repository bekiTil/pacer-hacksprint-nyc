class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def put(self, key, value):
        if key not in self.store and len(self.store) >= self.capacity:
            # evicts the oldest inserted key, ignoring reads -- BUG
            oldest = next(iter(self.store))
            del self.store[oldest]
        self.store[key] = value
