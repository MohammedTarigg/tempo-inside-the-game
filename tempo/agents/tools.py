"""The read-only tools an agent gets: nothing after the moment's own match time, and scope taken from who is calling."""


class ScopeError(Exception):
    pass


class FactTools:
    """Read-only tools over the fact ledger. Scope comes from the identity bound here, never from an argument."""

    def __init__(self, ledger, meta, role, team_id, as_of):
        self.ledger, self.meta, self.role, self.team_id, self.as_of = ledger, meta, role, team_id, as_of
        self.match_id = meta["match_id"]

    def _check_player(self, pid):
        if self.role in ("home", "away") and self.meta["team_of"].get(pid) != self.team_id:
            self.ledger.audit(self.as_of, "scope_refused", dict(role=self.role, asked_for=pid))
            raise ScopeError(f"{self.role} agent may not read {pid}")

    def _check_time(self, t):
        if t > self.as_of + 1e-6:
            self.ledger.audit(self.as_of, "time_refused", dict(role=self.role, asked_for=t))
            raise ScopeError("facts after the moment are not readable")

    def get_moment(self, fact_ids):
        return [f for f in (self.ledger.get_fact(i) for i in fact_ids) if f and f["match_time"] <= self.as_of + 1e-6]

    def get_player_ledger(self, pid, as_of=None):
        self._check_player(pid)
        self._check_time(as_of or self.as_of)
        return self.ledger.facts(self.match_id, as_of or self.as_of, subject=pid)

    def get_open_threads(self, as_of=None):
        self._check_time(as_of or self.as_of)
        t = as_of or self.as_of
        cards = [f for f in self.ledger.facts(self.match_id, t, kind="card") if f["value"] == "yellow"]
        if self.role in ("home", "away"):
            cards = [f for f in cards if self.meta["team_of"].get(f["subject"]) == self.team_id]
        duels = self.ledger.facts(self.match_id, t, kind="duel_count")
        return dict(booked=cards, duels=duels[-3:])

    def get_on_air_state(self, as_of=None):
        if self.role != "director":
            raise ScopeError("only the Director reads what is on air")
        self._check_time(as_of or self.as_of)
        return [c for c in self.ledger.cues(self.match_id) if c["match_time"] <= (as_of or self.as_of)][-8:]

    def get_season_habit(self, subject):
        return [f for f in self.ledger.facts(self.match_id, self.as_of, kind="habit") if f["subject"] == subject]
