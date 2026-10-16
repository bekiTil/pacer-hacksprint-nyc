from dataclasses import dataclass, field


@dataclass
class Event:
    name: str
    payload: dict = field(default_factory=dict)
