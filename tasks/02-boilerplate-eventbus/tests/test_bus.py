from events import Event
from bus import EventBus


def test_publish_calls_subscribers_in_order():
    bus = EventBus()
    seen = []
    bus.subscribe("click", lambda e: seen.append(("a", e.payload)))
    bus.subscribe("click", lambda e: seen.append(("b", e.payload)))
    bus.publish(Event("click", {"x": 1}))
    assert seen == [("a", {"x": 1}), ("b", {"x": 1})]


def test_unsubscribe():
    bus = EventBus()
    calls = []
    h = lambda e: calls.append(e)
    bus.subscribe("tick", h)
    bus.unsubscribe("tick", h)
    bus.publish(Event("tick"))
    assert calls == []


def test_unknown_event_is_noop():
    bus = EventBus()
    bus.publish(Event("nope", {"a": 1}))  # must not raise


def test_default_payload():
    assert Event("x").payload == {}
