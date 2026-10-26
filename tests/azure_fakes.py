"""Stand-ins for the Azure SDK clients, each with only the calls the adapters make, so the adapters can be tested
without a subscription. They keep what they are sent, so a test can check it."""

import json
import re
import threading
from types import SimpleNamespace
from typing import Any


# ----- Event Hubs -----
class EventHubs:
    """One namespace: each hub has four partitions, each a list of message bodies."""

    def __init__(self):
        self.hubs = {}

    def _hub(self, topic):
        return self.hubs.setdefault(topic, {str(k): [] for k in range(4)})

    def producer(self, topic):
        hub = self._hub(topic)

        class Batch(list):
            def __init__(self, partition_id):
                super().__init__()
                self.partition_id = partition_id

            def add(self, ev):
                self.append(ev)

        class Producer:
            def get_partition_ids(self):
                return list(hub)

            def create_batch(self, partition_id=None, **_):
                return Batch(partition_id)

            def send_batch(self, batch):
                hub[batch.partition_id].extend(ev.body_as_str() for ev in batch)

            def get_partition_properties(self, pid):
                n = len(hub[pid])
                return dict(is_empty=n == 0, last_enqueued_sequence_number=n - 1)

            def close(self):
                pass

        return Producer()

    def consumer(self, topic):
        hub, stop = self._hub(topic), threading.Event()

        class Consumer:
            def receive(self, on_event, partition_id, starting_position, starting_position_inclusive):
                for k, body in enumerate(list(hub[partition_id])):
                    if k >= starting_position:
                        on_event(None, SimpleNamespace(sequence_number=k, body_as_json=lambda b=body: json.loads(b)))
                stop.wait()

            def close(self):
                stop.set()

        return Consumer()


# ----- Cosmos DB -----
class _Exists(Exception):
    pass


class CosmosDatabase:
    """Four containers of items keyed by (partition, id). query_items understands the few query shapes the ledger
    writes: conjunctions of comparisons on item fields, ARRAY_CONTAINS, and MAX over a field."""

    def __init__(self):
        self.containers = {}

    def get_container_client(self, name):
        return self.containers.setdefault(name, CosmosContainer())


class CosmosContainer:
    def __init__(self):
        self.items = {}

    def read_item(self, item, partition_key):
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        if (partition_key, item) not in self.items:
            raise CosmosResourceNotFoundError(message="not found")
        return json.loads(json.dumps(self.items[(partition_key, item)]))

    def upsert_item(self, body):
        self.items[(body["match_id"], body["id"])] = json.loads(json.dumps(body))

    def create_item(self, body):
        from azure.cosmos.exceptions import CosmosResourceExistsError

        if (body["match_id"], body["id"]) in self.items:
            raise CosmosResourceExistsError(message="exists")
        self.upsert_item(body)

    def patch_item(self, item, partition_key, patch_operations):
        row = self.items[(partition_key, item)]
        for op in patch_operations:
            row[op["path"].strip("/")] = op["value"]

    def delete_item(self, item, partition_key):
        del self.items[(partition_key, item)]

    def query_items(self, query, parameters, partition_key):
        p = {x["name"]: x["value"] for x in parameters}
        rows = [r for (pk, _), r in self.items.items() if pk == partition_key]
        m = re.match(r"SELECT (VALUE MAX\(c\.(\w+)\)|c\.id|c) FROM c WHERE (.*)", query)
        assert m, query
        rows = [r for r in rows if all(_holds(r, clause, p) for clause in m.group(3).split(" AND "))]
        if m.group(2):
            return [max((r[m.group(2)] for r in rows), default=None)]
        if m.group(1) == "c.id":
            return [dict(id=r["id"]) for r in rows]
        return [json.loads(json.dumps(r)) for r in rows]


def _get(row, path):
    for k in path.split("."):
        row = row[k]
    return row


def _holds(row, clause, p):
    clause = clause.strip()
    if clause == "true":
        return True
    m = re.match(r"ARRAY_CONTAINS\(c\.([\w.]+), (@\w+)\)", clause)
    if m:
        return p[m.group(2)] in _get(row, m.group(1))
    m = re.match(r"c\.([\w.]+) (<=|>=|=) (@\w+|false|true|'\w+')", clause)
    assert m, clause
    left, right = _get(row, m.group(1)), m.group(3)
    right = p[right] if right.startswith("@") else {"false": False, "true": True}.get(right, right.strip("'"))
    return {"<=": left <= right, ">=": left >= right, "=": left == right}[m.group(2)]


# ----- AI Search -----
class SearchIndex:
    """Documents by id. search() returns them nearest first by the vector, after the filter."""

    def __init__(self):
        self.docs = {}
        self.queries = []

    def upload_documents(self, docs):
        for d in docs:
            self.docs[d["id"]] = d

    def search(self, search_text, vector_queries, filter, select, top):
        self.queries.append(filter)
        team = int(_find(r"team eq (\d+)", filter))
        outcome = _find(r"outcome ne '(\w+)'", filter)
        match_id = _find(r"match_id ne '(\w+)'", filter)
        q = vector_queries[0].vector
        hits = [
            d for d in self.docs.values() if d["team"] == team and d["outcome"] != outcome and d["match_id"] != match_id
        ]
        hits.sort(key=lambda d: sum((a - b) ** 2 for a, b in zip(d["alike"], q, strict=True)))
        return [{k: d[k] for k in select} for d in hits[:top]]


def _find(pattern, text):
    m = re.search(pattern, text)
    assert m, (pattern, text)
    return m.group(1)


# ----- Web PubSub -----
class PubSub:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send_to_group(self, group, message, content_type):
        if self.fail:
            raise ConnectionError("service unavailable")
        self.sent.append((group, json.loads(message)))

    def get_client_access_token(self, groups, minutes_to_expire):
        return dict(url=f"wss://pubsub.example/client/hubs/tempo?groups={groups[0]}&ttl={minutes_to_expire}")


# ----- Foundry (the OpenAI client's chat completions) -----
class Model:
    """Answers each call with the next of the replies it was given, and keeps the messages it was sent."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, model, messages, **_):
        self.calls.append(messages)
        content = json.dumps(self.replies.pop(0))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


# ----- AI Speech -----
class SpeechSDK:
    """The recognizer's surface: a recognizer whose events the test fires by hand."""

    recognizer: Any = None

    def __init__(self):
        sdk = self

        class Signal(list):
            def connect(self, fn):
                self.append(fn)

            def fire(self, evt):
                for fn in self:
                    fn(evt)

        class Recognizer:
            def __init__(self, conf, audio_config):
                self.recognized, self.canceled, self.session_stopped = Signal(), Signal(), Signal()
                sdk.recognizer = self

            def start_continuous_recognition_async(self):
                return SimpleNamespace(get=lambda: None)

            def stop_continuous_recognition_async(self):
                return SimpleNamespace(get=lambda: None)

        class Grammar:
            @staticmethod
            def from_recognizer(_r):
                return SimpleNamespace(addPhrase=sdk.phrases.append)

        self.phrases, self.pushed = [], []
        self.SpeechConfig = lambda **kw: SimpleNamespace(request_word_level_timestamps=lambda: None, **kw)
        self.OutputFormat = SimpleNamespace(Detailed="detailed")
        self.ResultReason = SimpleNamespace(RecognizedSpeech="recognized")
        self.CancellationReason = SimpleNamespace(Error="error")
        self.SpeechRecognizer = Recognizer
        self.PhraseListGrammar = Grammar
        self.audio_stream = SimpleNamespace(
            write=self.pushed.append, close=lambda: sdk.recognizer.session_stopped.fire(None)
        )
        self.audio = SimpleNamespace(
            PushAudioInputStream=lambda fmt: sdk.audio_stream,
            AudioStreamFormat=lambda samples_per_second: samples_per_second,
            AudioConfig=lambda stream: stream,
        )

    def say(self, text, offset_s, words):
        """The service recognizing an utterance: its text, where it starts in the audio, and each word's start."""
        t = 10_000_000
        best = dict(
            Confidence=0.93,
            Words=[dict(Word=w, Offset=int(s * t), Duration=int(0.3 * t)) for w, s in words],
        )
        result = SimpleNamespace(
            reason="recognized",
            text=text,
            json=json.dumps(dict(NBest=[best])),
            offset=int(offset_s * t),
            duration=int((words[-1][1] + 0.3 - offset_s) * t),
        )
        self.recognizer.recognized.fire(SimpleNamespace(result=result))
