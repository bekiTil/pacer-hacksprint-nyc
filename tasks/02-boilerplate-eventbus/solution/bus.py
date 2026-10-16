from collections import defaultdict


class EventBus:
    def __init__(self):
        self._subs = defaultdict(list)

    def subscribe(self, name, handler):
        self._subs[name].append(handler)

    def unsubscribe(self, name, handler):
        if handler in self._subs.get(name, []):
            self._subs[name].remove(handler)

    def publish(self, event):
        for handler in list(self._subs.get(event.name, [])):
            handler(event)
