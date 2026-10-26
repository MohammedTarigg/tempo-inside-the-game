"""The bus on Azure Event Hubs, with LocalBus's three methods: publish, read from an offset, size.

Each topic is an event hub of the same name in one namespace: `feed` (the match as the providers deliver it), `commentary`
(lines from the listener service) and `cues` (what the cue service issues). Everything for one match goes to one
partition, chosen from the match id, so a match is read back in the order it was written. An offset is that partition's
sequence number: a service that restarts reads again from the offset its checkpoint saved."""

import json
import threading
import time
import zlib
from typing import Any

from .settings import AzureSettings, credential


class EventHubsBus:
    def __init__(self, cfg: AzureSettings, match_id: str, consumer_group="$Default", clients: Any = None):
        if not cfg.eventhubs_namespace and clients is None:
            raise ValueError("TEMPO_AZURE_EVENTHUBS_NAMESPACE is not set")
        self.cfg, self.match_id, self.group = cfg, match_id, consumer_group
        # clients: a stand-in for the SDK's two client classes, for the tests
        self._clients = clients
        self._producers: dict[str, Any] = {}
        self._partitions: dict[str, str] = {}
        self._readers: dict[str, _Reader] = {}

    def _producer(self, topic):
        if topic not in self._producers:
            if self._clients:
                self._producers[topic] = self._clients.producer(topic)
            else:
                from azure.eventhub import EventHubProducerClient

                self._producers[topic] = EventHubProducerClient(
                    fully_qualified_namespace=self.cfg.eventhubs_namespace or "",
                    eventhub_name=topic,
                    credential=credential(),
                )
        return self._producers[topic]

    def partition(self, topic):
        """This match's partition of the topic: the same one every time, from a checksum of the match id."""
        if topic not in self._partitions:
            ids = sorted(self._producer(topic).get_partition_ids(), key=int)
            self._partitions[topic] = ids[zlib.crc32(self.match_id.encode()) % len(ids)]
        return self._partitions[topic]

    # ----- the three methods -----
    def publish(self, topic, msg):
        """Sends one message. Its offset is given by the service, so this returns None; read() reports it."""
        from azure.eventhub import EventData

        producer = self._producer(topic)
        batch = producer.create_batch(partition_id=self.partition(topic))
        ev = EventData(json.dumps(msg, default=float))
        ev.content_type = "application/json"
        ev.properties = {"match_id": self.match_id}
        batch.add(ev)
        producer.send_batch(batch)

    def read(self, topic, offset=0, limit=None, wait=1.0):
        """Messages from `offset` on, as (offset, message), waiting up to `wait` seconds for the first one."""
        r = self._readers.get(topic)
        if r is None or offset < r.first:
            if r:
                r.close()
            r = self._readers[topic] = _Reader(self, topic, offset)
        return r.take(offset, limit, wait)

    def size(self, topic):
        props = self._producer(topic).get_partition_properties(self.partition(topic))
        return 0 if props["is_empty"] else props["last_enqueued_sequence_number"] + 1

    def dump(self, topic):
        """Event Hubs keeps the topic itself; there is no file to write."""

    def close(self):
        for r in self._readers.values():
            r.close()
        for p in self._producers.values():
            p.close()


class _Reader:
    """A receiver on one partition from a starting sequence number, filling a buffer in a background thread so read() can
    take what has arrived and return."""

    def __init__(self, bus: EventHubsBus, topic: str, first: int):
        self.first, self.got, self.lock = first, {}, threading.Condition()
        if bus._clients:
            self.client = bus._clients.consumer(topic)
        else:
            from azure.eventhub import EventHubConsumerClient

            self.client = EventHubConsumerClient(
                fully_qualified_namespace=bus.cfg.eventhubs_namespace or "",
                eventhub_name=topic,
                consumer_group=bus.group,
                credential=credential(),
            )
        self.thread = threading.Thread(
            target=self.client.receive,
            kwargs=dict(
                on_event=self._on_event,
                partition_id=bus.partition(topic),
                starting_position=first,
                starting_position_inclusive=True,
            ),
            daemon=True,
        )
        self.thread.start()

    def _on_event(self, _ctx, ev):
        if ev is None:
            return
        with self.lock:
            self.got[ev.sequence_number] = ev.body_as_json()
            self.lock.notify_all()

    def take(self, offset, limit, wait):
        deadline = time.monotonic() + wait
        with self.lock:
            while offset not in self.got and time.monotonic() < deadline:
                self.lock.wait(max(0.0, deadline - time.monotonic()))
            out, k = [], offset
            while k in self.got and (limit is None or len(out) < limit):
                out.append((k, self.got[k]))  # kept: a restart may read the same stretch again
                k += 1
            return out

    def close(self):
        self.client.close()
