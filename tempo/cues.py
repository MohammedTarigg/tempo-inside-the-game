"""Cue service. Applies the producer's rules, one-per-slot priorities, cooldowns and caps, then stores and publishes each cue.
Every decision, shown or held back, is written to the audit log with its reason, which is what the desk and the held-back counter read."""
from .contracts import cue

DEFAULT_RULES = {
    "enabled": {"stake_card": True, "tag": True, "kickoff_mark": True, "danger_window": True, "scene": True, "label": True, "sentence": True,
                "form_card": True, "halftime_card": True, "fulltime_card": True, "energy": True, "duel": True},
    "stake_full_cap_per_match": 20,              # the pass mark in the architecture: 20 full cards a match or fewer
    "stake_faint_max_at_once": 2,                # at most two faint cards on the picture together
    "tag_cooldown_s": 90,
    "tv_slot_gap_s": 4,                          # two television items never overlap
    "sentence_veto_window_s": 0,
}
SLOT = {"stake_card": "on_player", "tag": "tv_lower", "label": "tv_lower", "scene": "tv_full", "kickoff_mark": "pitch", "danger_window": "strip",
        "form_card": "tv_side", "halftime_card": "tv_full", "fulltime_card": "tv_full", "sentence": "phone", "energy": "on_player", "duel": "tv_lower"}


class CueService:
    def __init__(self, match_id, ledger, bus, rules=None):
        self.match_id, self.ledger, self.bus = match_id, ledger, bus
        self.rules = {**DEFAULT_RULES, **(rules or {})}
        self.slot_busy_until, self.last_tag, self.full_cards, self.faint_live = {}, -1e9, 0, set()
        self.shown, self.held = 0, 0
        self.frame, self.frame_of = 0, {}                # the tracking frame each cue was issued on, for a front end

    def state(self):
        return dict(slot_busy_until=self.slot_busy_until, last_tag=self.last_tag, full_cards=self.full_cards, faint_live=sorted(self.faint_live), shown=self.shown, held=self.held)

    def restore(self, s):
        self.slot_busy_until, self.last_tag, self.full_cards = dict(s["slot_busy_until"]), s["last_tag"], s["full_cards"]
        self.faint_live, self.shown, self.held = set(s["faint_live"]), s["shown"], s["held"]

    def propose(self, t, form, screen, payload, fact_ids, valid_for=2.0, priority=5, when="now"):
        """Returns the cue if it airs, or None if it is held back."""
        reason = None
        if not self.rules["enabled"].get(form, False):
            reason = "the producer has this form switched off"
        elif form == "stake_card":
            pid, level = payload["player"], payload["level"]
            if level == 0:
                self.faint_live.discard(pid)
            elif level == 1 and pid not in self.faint_live and len(self.faint_live) >= self.rules["stake_faint_max_at_once"]:
                reason = "two faint cards are already showing"
            elif level == 2 and self.full_cards >= self.rules["stake_full_cap_per_match"]:
                reason = "the match cap on full cards is reached"
            else:
                self.faint_live.add(pid)
                self.full_cards += level == 2
        elif form in ("tag", "duel") and t - self.last_tag < self.rules["tag_cooldown_s"]:
            reason = "a number tag was shown under 90 seconds ago"
        elif SLOT.get(form, "").startswith("tv") and when == "now" and t < self.slot_busy_until.get(SLOT[form], -1e9):
            reason = "the television slot is taken by something of equal or higher priority"
        if reason:
            self.held += 1
            self.ledger.audit(t, "held_back", dict(form=form, payload=payload, fact_ids=fact_ids, reason=reason))
            return None
        c = cue(self.match_id, t, form, screen, payload, fact_ids, valid_for, priority, when)
        if not self.ledger.put_cue(c):
            return None
        self.frame_of[c["cue_id"]] = self.frame
        if form in ("tag", "duel"):
            self.last_tag = t
        if SLOT.get(form, "").startswith("tv"):
            self.slot_busy_until[SLOT[form]] = t + valid_for + self.rules["tv_slot_gap_s"]
        self.shown += form != "stake_card" or payload.get("level", 0) > 0
        self.bus.publish("cues", c)
        self.ledger.audit(t, "shown", dict(cue_id=c["cue_id"], form=form))
        return c

    def withdraw(self, t, fact_id):
        for cid in self.ledger.withdraw_fact(fact_id):
            self.bus.publish("cues", dict(cue_id=cid, status="withdrawn", match_time=t))
            self.ledger.audit(t, "withdrawn", dict(cue_id=cid, fact_id=fact_id))
