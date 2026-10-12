"""Message bus. LocalBus keeps every topic as an append-only log with offsets, which is the property the pipeline relies
on from Azure Event Hubs: a consumer that restarts reads again from its saved offset. An Event Hubs adapter implements
the same three methods."""

import json
import os


class LocalBus:
    def __init__(self, path=None):
        self.topics, self.path = {}, path
        if path:
            os.makedirs(path, exist_ok=True)

    def publish(self, topic, msg):
        log = self.topics.setdefault(topic, [])
        log.append(msg)
        return len(log) - 1

    def read(self, topic, offset=0, limit=None):
        log = self.topics.get(topic, [])
        end = len(log) if limit is None else min(len(log), offset + limit)
        return [(i, log[i]) for i in range(offset, end)]

    def size(self, topic):
        return len(self.topics.get(topic, []))

    def dump(self, topic):
        if self.path:
            with open(os.path.join(self.path, topic + ".jsonl"), "w") as f:
                for m in self.topics.get(topic, []):
                    f.write(json.dumps(m, default=float) + "\n")
