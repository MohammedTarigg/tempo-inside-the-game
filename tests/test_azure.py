"""The Azure adapters, each against a stand-in for its SDK client (tests/azure_fakes.py): what each sends, and that each
keeps the contract of the local part it replaces. The ledger's contract runs against SQLite and Cosmos DB alike."""

import os
import tempfile

import numpy as np
import pytest

pytest.importorskip("azure.eventhub", reason="the Azure adapters need `uv sync --extra azure`")

import azure_fakes as fake

from tempo.azure import AzureSettings, wire
from tempo.azure.blob import upload_run
from tempo.azure.cosmos import CosmosLedger
from tempo.azure.eventhubs import EventHubsBus
from tempo.azure.foundry import FoundryBackend
from tempo.azure.search import SeasonSearch, alike_vector, document
from tempo.azure.speech import SpeechListener
from tempo.azure.telemetry import AuditedLedger
from tempo.azure.webpubsub import PushingBus, ScreenPush
from tempo.contracts import cue, fact
from tempo.instruments import twin
from tempo.pipeline.bus import LocalBus
from tempo.pipeline.ledger import Ledger
from tempo.pipeline.listener import Listener

CFG = AzureSettings(
    speech_endpoint="https://speech.example",
    eventhubs_namespace="tempo.servicebus.example",
    cosmos_endpoint="https://cosmos.example",
    webpubsub_endpoint="https://pubsub.example",
    search_endpoint="https://search.example",
    foundry_endpoint="https://foundry.example",
)


# ----- settings and wiring -----
def test_settings_come_from_the_environment(monkeypatch):
    import importlib

    mod = importlib.import_module("tempo.azure.settings")  # the module, not the function the package exports

    monkeypatch.setenv("TEMPO_AZURE_COSMOS_ENDPOINT", "https://cosmos.example")
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=x")
    mod.settings.cache_clear()
    try:
        s = mod.settings()
        assert s.cosmos_endpoint == "https://cosmos.example" and s.cosmos_database == "tempo"
        assert s.appinsights_connection == "InstrumentationKey=x" and s.any
    finally:
        mod.settings.cache_clear()


def test_with_no_settings_every_part_is_local():
    with tempfile.TemporaryDirectory() as work:
        w = wire("m_x", work, cfg=AzureSettings())
        assert isinstance(w.ledger, Ledger) and isinstance(w.bus, LocalBus)
        assert w.backend is None and w.push is None and w.on_azure == []


# ----- the ledger's contract, on SQLite and on Cosmos DB -----
def ledgers():
    yield Ledger()
    yield CosmosLedger(CFG, "m_x", database=fake.CosmosDatabase())


@pytest.mark.parametrize("ledger", list(ledgers()), ids=["sqlite", "cosmos"])
def test_the_ledger_contract(ledger):
    f1 = ledger.put_fact(fact("m_x", 10.0, "card", "p_1", 1, "card"))
    ledger.put_fact(fact("m_x", 90.0, "card", "p_2", 1, "card"))
    assert [f["subject"] for f in ledger.facts("m_x", 60.0)] == ["p_1"]  # nothing later can be read
    corrected = ledger.put_fact(dict(f1, value=2))
    assert corrected["version"] == f1["version"] + 1 and ledger.get_fact(f1["fact_id"])["value"] == 2
    c = cue("m_x", 11.0, "label", "tv", dict(text="Booked"), [f1["fact_id"]], 5, 6, "now")
    assert ledger.put_cue(c) and not ledger.put_cue(c)  # issued once, however often it is replayed
    assert ledger.withdraw_fact(f1["fact_id"]) == [c["cue_id"]]
    assert ledger.get_fact(f1["fact_id"]) is None and ledger.cues("m_x", status="withdrawn")[0]["cue_id"] == c["cue_id"]
    ledger.save_checkpoint("moment:goal:61.5", dict(frame=np.int64(4), done=True))
    assert ledger.load_checkpoint("moment:goal:61.5") == dict(frame=4, done=True)
    for k in range(3):
        ledger.audit(float(k), "held_back", dict(n=k))
    assert [b["n"] for _, _, b in ledger.audit_rows("held_back")] == [0, 1, 2]


def test_a_new_cosmos_ledger_carries_on_the_audit_numbering():
    db = fake.CosmosDatabase()
    a = CosmosLedger(CFG, "m_x", database=db)
    a.audit(1.0, "shown", {})
    a.audit(2.0, "shown", {})
    b = CosmosLedger(CFG, "m_x", database=db)  # the service after a restart
    b.audit(3.0, "shown", dict(last=True))
    assert [t for t, _, _ in b.audit_rows()] == [1.0, 2.0, 3.0]


# ----- Event Hubs -----
def test_the_event_hubs_bus_reads_back_in_order_from_any_offset():
    hubs = fake.EventHubs()
    bus = EventHubsBus(CFG, "m_x", clients=hubs)
    for k in range(5):
        bus.publish("feed", dict(k=k))
    assert bus.size("feed") == 5
    assert [m["k"] for _, m in bus.read("feed", 0, wait=1.0)] == [0, 1, 2, 3, 4]
    assert [(o, m["k"]) for o, m in bus.read("feed", 3, 1, wait=1.0)] == [(3, 3)]
    other = EventHubsBus(CFG, "m_x", clients=hubs)
    assert other.partition("feed") == bus.partition("feed")  # one match, one partition: its order is kept
    bus.close()
    other.close()


# ----- Web PubSub -----
def test_every_cue_reaches_the_screens_in_the_sites_shape():
    client = fake.PubSub()
    push = ScreenPush(CFG, "m_x", client=client)
    bus = PushingBus(LocalBus(), push, lambda: 1234)
    c = cue("m_x", 49.4, "label", "tv", dict(text="Booked"), ["f_1"], 5, 6, "now")
    bus.publish("cues", c)
    bus.publish("cues", dict(cue_id=c["cue_id"], status="withdrawn", match_time=50.0))
    bus.publish("commentary", dict(text="not for the screens"))
    (g1, shown), (_, gone) = client.sent
    assert g1 == "match.m_x" and shown["id"] == c["cue_id"] and shown["frame"] == 1234 and shown["form"] == "label"
    assert gone == dict(id=c["cue_id"], status="withdrawn", t=50.0)
    assert "groups=match.m_x" in push.client_url()


def test_a_failed_push_never_stops_the_pipeline():
    push = ScreenPush(CFG, "m_x", client=fake.PubSub(fail=True))
    PushingBus(LocalBus(), push, lambda: 0).publish("cues", cue("m_x", 1.0, "tag", "tv", {}, [], 5, 4, "now"))
    assert push.failed == 1 and push.sent == 0


# ----- Foundry -----
FACTS = [fact("m_x", 1500.0, "card", "p_1", 1, "card")]
CTX = dict(names={"p_1": "Skoles"}, names_ar={"p_1": "سكولز"}, player="p_1", minute=26, facts=FACTS)


def test_the_model_cites_first_and_its_line_comes_back():
    model = fake.Model(
        dict(
            cites=[FACTS[0]["fact_id"]],
            nothing_to_say=False,
            line="Skoles is booked in minute 26.",
            label="Skoles booked",
        )
    )
    b = FoundryBackend(CFG, client=model)
    assert b.narrate("card", CTX) == "Skoles is booked in minute 26."
    assert b.label("card", CTX) == "Skoles booked"
    prompt = model.calls[0][1]["content"]
    assert FACTS[0]["fact_id"] in prompt and "[26]" in prompt and "Skoles" in prompt


def test_a_line_citing_a_fact_it_was_not_given_is_refused():
    b = FoundryBackend(CFG, client=fake.Model(dict(cites=["f_made_up"], nothing_to_say=False, line="x", label="")))
    with pytest.raises(ValueError):
        b.narrate("card", CTX)


def test_nothing_to_say_leaves_the_screen_clear():
    b = FoundryBackend(CFG, client=fake.Model(dict(cites=[], nothing_to_say=True, line="", label="")))
    assert b.narrate("card", CTX) == ""


def test_a_rejected_line_gets_one_repair_with_the_reasons():
    from tempo.agents import Writer
    from tempo.pipeline.cues import CueService

    ledger = Ledger()
    card = ledger.put_fact(fact("m_x", 1500.0, "card", "p_1", 1, "card"))
    meta = dict(
        names={"p_1": "Skoles"},
        names_ar={"p_1": "سكولز"},
        home=dict(name="Northgate", name_ar="نورثغيت"),
        away=dict(name="Harbour City", name_ar="هاربر سيتي"),
    )
    good = dict(cites=[card["fact_id"]], nothing_to_say=False, label="Skoles booked")
    model = fake.Model(
        dict(good, line="Skoles is booked in minute 27."),  # the wrong minute
        dict(good, line="Skoles is booked in minute 26. One more foul is a red card."),
        dict(good, line="سكولز ينال إنذارا في الدقيقة 26."),
    )
    w = Writer(ledger, CueService("m_x", ledger, LocalBus()), meta, backend=FoundryBackend(CFG, client=model))
    out = w.write_moment(dict(kind="card", t=1500.0, player="p_1", fact_ids=[card["fact_id"]]))
    assert out["texts"]["en"]["how"] == "repaired" and "26" in out["texts"]["en"]["text"]
    assert "27" in model.calls[1][2]["content"] and "rejected" in model.calls[1][3]["content"]
    assert out["texts"]["ar"]["how"] == "ok"


# ----- AI Search -----
def attack(rng, shift=0.0):
    t = len(twin.OFFS)
    return dict(
        ball=rng.normal(size=(t, 2)) + shift,
        A=rng.normal(size=(twin.K, t, 2)) * 5 + shift,
        D=rng.normal(size=(twin.K, t, 2)) * 5 + shift,
        A_idx=[1, 2, 3, 4],
        D_idx=[12, 13, 14, 15],
        n_real=t,
    )


def test_the_season_search_finds_what_the_local_search_finds():
    rng = np.random.default_rng(7)
    local, index = twin.TwinSearch(), fake.SearchIndex()
    remote = SeasonSearch(CFG, local, client=index)
    for k in range(60):
        a = attack(rng, shift=k % 3)
        side, match, outcome = k % 2, f"m_{k % 6}", "no_goal" if k % 4 else "goal"
        local.add(a, side, match, 60.0 * k, outcome)
        index.upload_documents([document(a, side, match, 60.0 * k, outcome)])
    remote._pairs = list(local._pairs)
    q = attack(rng, shift=1)
    want = local.closest_earlier(q, 1, "m_new", 10.0, "goal")
    got = remote.closest_earlier(q, 1, "m_new", 10.0, "goal")
    assert want and got  # both compared the attack with the season's nearest
    assert got["gap_m"] == pytest.approx(want["gap_m"]) and got["found"] == want["found"]
    assert index.queries[-1] == "team eq 1 and outcome ne 'goal' and match_id ne 'm_new'"
    assert len(alike_vector(q)) == 162


# ----- Blob Storage -----
def test_a_run_folder_goes_up_with_its_content_types():
    sent = []

    class Container:
        def upload_blob(self, name, data, overwrite, content_settings):
            sent.append((name, content_settings.content_type, overwrite, len(data.read())))

    with tempfile.TemporaryDirectory() as d:
        for name in ("match.json", "match.bin", "cues.jsonl"):
            with open(os.path.join(d, name), "wb") as f:
                f.write(b"{}")
        assert upload_run(CFG, d, "m_x", container=Container()) == [
            "runs/m_x/cues.jsonl",
            "runs/m_x/match.bin",
            "runs/m_x/match.json",
        ]
    assert [t for _, t, _, _ in sent] == ["application/x-ndjson", "application/octet-stream", "application/json"]


# ----- AI Speech -----
def test_speech_becomes_commentary_lines_with_match_times_and_mentions():
    sdk = fake.SpeechSDK()
    meta = dict(names={"p_1": "Skoles", "p_2": "Pell"}, home=dict(name="Northgate"), away=dict(name="Harbour City"))
    heard = []
    sl = SpeechListener(CFG, Listener.phrases(meta), start=1710.0, on_line=heard.append, sdk=sdk)
    assert sdk.phrases == ["Skoles", "Pell", "Northgate", "Harbour City"]
    sl.begin()
    sl.feed(b"\0" * 32000 * 3)  # three seconds of audio
    sdk.say("Skoles is everywhere for Harbour City today.", 0.4, [("Skoles", 0.4), ("is", 0.8), ("everywhere", 1.0)])
    lines = sl.end()
    assert lines == heard and len(lines) == 1
    line = lines[0]
    assert line["matchTime"] == pytest.approx(1710.4) and line["words"][2]["at"] == pytest.approx(1711.0)
    assert line["source"] == "ai-speech" and line["latency_ms"] >= 0
    assert Listener(meta).mentions(line["text"]) == ["p_1"]


# ----- Application Insights -----
def test_the_audit_also_goes_to_application_insights(caplog):
    led = AuditedLedger(Ledger(), "m_x")
    with caplog.at_level("INFO", logger="tempo.audit"):
        led.audit(12.0, "held_back", dict(form="tag", short="Screen slot taken"))
    assert led.audit_rows("held_back")[0][2]["short"] == "Screen slot taken"  # still in the ledger
    rec = caplog.records[-1]
    assert rec.__dict__["audit"] == "held_back" and rec.__dict__["reason"] == "Screen slot taken"
