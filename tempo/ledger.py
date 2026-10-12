"""Fact ledger, cue store and checkpoints. SQLite locally; the same four tables map onto Azure Cosmos DB containers partitioned by match.
Writes are idempotent by ID, so replaying a stretch of match after a failure changes nothing."""

import json
import sqlite3


class Ledger:
    def __init__(self, path=":memory:"):
        self.db = sqlite3.connect(path)
        self.db.executescript("""
            create table if not exists facts(fact_id text primary key, match_id text, match_time real, kind text, subject text, version int, withdrawn int default 0, body text);
            create index if not exists facts_t on facts(match_id, match_time);
            create table if not exists cues(cue_id text primary key, match_id text, match_time real, form text, screen text, status text, body text);
            create table if not exists checkpoints(name text primary key, body text);
            create table if not exists log(seq integer primary key autoincrement, match_time real, kind text, body text);
        """)

    # ----- facts -----
    def put_fact(self, f):
        row = self.db.execute("select version, body from facts where fact_id=?", (f["fact_id"],)).fetchone()
        if row:
            old = json.loads(row[1])
            if old["value"] == f["value"]:
                return old
            f = dict(f, version=row[0] + 1)  # a correction: same fact, new value
        self.db.execute(
            "insert or replace into facts values(?,?,?,?,?,?,0,?)",
            (
                f["fact_id"],
                f["match_id"],
                f["match_time"],
                f["kind"],
                f["subject"],
                f["version"],
                json.dumps(f, default=float),
            ),
        )
        return f

    def withdraw_fact(self, fact_id):
        """A fact the feed has taken back. Every cue resting on it is withdrawn too. Returns the withdrawn cue ids."""
        self.db.execute("update facts set withdrawn=1 where fact_id=?", (fact_id,))
        out = []
        for cid, body in self.db.execute("select cue_id, body from cues where status='live'").fetchall():
            if fact_id in json.loads(body)["fact_ids"]:
                self.db.execute("update cues set status='withdrawn' where cue_id=?", (cid,))
                out.append(cid)
        return out

    def get_fact(self, fact_id):
        row = self.db.execute("select body, withdrawn from facts where fact_id=?", (fact_id,)).fetchone()
        return json.loads(row[0]) if row and not row[1] else None

    def facts(self, match_id, as_of, kind=None, subject=None, since=0.0):
        """Facts that existed at match time `as_of`. Nothing later can be read: this is the no-peeking rule for everything downstream."""
        q, args = (
            "select body from facts where match_id=? and match_time<=? and match_time>=? and withdrawn=0",
            [match_id, as_of, since],
        )
        if kind:
            q += " and kind=?"
            args.append(kind)
        if subject:
            q += " and subject=?"
            args.append(subject)
        return [json.loads(r[0]) for r in self.db.execute(q + " order by match_time", args)]

    # ----- cues -----
    def put_cue(self, c):
        if self.db.execute("select 1 from cues where cue_id=?", (c["cue_id"],)).fetchone():
            return False  # already issued: a replay must not show it twice
        self.db.execute(
            "insert into cues values(?,?,?,?,?,?,?)",
            (
                c["cue_id"],
                c["match_id"],
                c["match_time"],
                c["form"],
                c["screen"],
                c["status"],
                json.dumps(c, default=float),
            ),
        )
        return True

    def cues(self, match_id, status=None):
        q, args = "select body, status from cues where match_id=?", [match_id]
        if status:
            q += " and status=?"
            args.append(status)
        return [dict(json.loads(b), status=s) for b, s in self.db.execute(q + " order by match_time, cue_id", args)]

    # ----- checkpoints and audit log -----
    def save_checkpoint(self, name, body):
        self.db.execute("insert or replace into checkpoints values(?,?)", (name, json.dumps(body, default=float)))

    def load_checkpoint(self, name):
        row = self.db.execute("select body from checkpoints where name=?", (name,)).fetchone()
        return json.loads(row[0]) if row else None

    def audit(self, match_time, kind, body):
        self.db.execute(
            "insert into log(match_time, kind, body) values(?,?,?)", (match_time, kind, json.dumps(body, default=float))
        )

    def audit_rows(self, kind=None):
        q = "select match_time, kind, body from log" + (" where kind=?" if kind else "") + " order by seq"
        return [(t, k, json.loads(b)) for t, k, b in self.db.execute(q, (kind,) if kind else ())]

    def commit(self):
        self.db.commit()
