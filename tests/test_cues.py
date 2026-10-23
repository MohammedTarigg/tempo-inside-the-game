"""Every hold carries a short reason for the producer's desk, six words or fewer."""

from tempo.pipeline.cues import CueService


class Ledger:
    def __init__(self):
        self.rows = []

    def audit(self, t, kind, body):
        self.rows.append(body)

    def put_cue(self, c):
        return True


class Bus:
    def publish(self, *a):
        pass


def test_short_reasons():
    ledger = Ledger()
    cs = CueService("m_test", ledger, Bus(), rules=dict(enabled=dict(tag=False, duel=True)))
    cs.propose(1.0, "tag", "tv", dict(player="p_nor_7"), [])
    cs.propose(2.0, "duel", "tv", dict(defender="a", attacker="b"), [])
    cs.propose(3.0, "duel", "tv", dict(defender="a", attacker="b"), [])
    held = [r for r in ledger.rows if "short" in r]
    assert [r["short"] for r in held] == ["Switched off", "Duel shown under 90 s ago"]
    assert all(len(r["short"].split()) <= 6 for r in held)
