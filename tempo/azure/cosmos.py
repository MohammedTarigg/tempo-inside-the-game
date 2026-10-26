"""The fact ledger, cue store, checkpoints and audit on Azure Cosmos DB, with the same methods as the SQLite Ledger.

Four containers in one database, each partitioned by match id, so everything one match reads and writes is one partition:
`facts`, `cues`, `checkpoints` and `audit`. Writes are idempotent by id, as on SQLite: a cue that already exists is not
issued again, so replaying a stretch of match after a restart shows nothing twice. Every write is durable as soon as it
returns, so commit() has nothing left to do."""

from typing import Any

from .settings import AzureSettings, credential

CONTAINERS = ("facts", "cues", "checkpoints", "audit")


class CosmosLedger:
    def __init__(self, cfg: AzureSettings, match_id: str, database: Any = None):
        if database is None:
            if not cfg.cosmos_endpoint:
                raise ValueError("TEMPO_AZURE_COSMOS_ENDPOINT is not set")
            from azure.cosmos import CosmosClient

            database = CosmosClient(cfg.cosmos_endpoint, credential=credential()).get_database_client(
                cfg.cosmos_database
            )
        self.match_id = match_id
        self.c = {name: database.get_container_client(name) for name in CONTAINERS}
        # the audit is read back in the order it was written: each row gets the next number in this match
        top = list(
            self.c["audit"].query_items(
                "SELECT VALUE MAX(c.seq) FROM c WHERE c.match_id = @m",
                parameters=[{"name": "@m", "value": match_id}],
                partition_key=match_id,
            )
        )
        self.seq = (top[0] or 0) if top else 0

    def _read(self, container, item_id):
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        try:
            return self.c[container].read_item(item_id, partition_key=self.match_id)
        except CosmosResourceNotFoundError:
            return None

    def _query(self, container, where, params=(), select="c"):
        return list(
            self.c[container].query_items(
                f"SELECT {select} FROM c WHERE c.match_id = @m AND {where}",
                parameters=[{"name": "@m", "value": self.match_id}, *params],
                partition_key=self.match_id,
            )
        )

    # ----- facts -----
    def put_fact(self, f):
        row = self._read("facts", f["fact_id"])
        if row:
            if row["body"]["value"] == f["value"]:
                return row["body"]
            f = dict(f, version=row["version"] + 1)  # a correction: same fact, new value
        self.c["facts"].upsert_item(
            dict(
                id=f["fact_id"],
                match_id=f["match_id"],
                match_time=f["match_time"],
                kind=f["kind"],
                subject=f["subject"],
                version=f["version"],
                withdrawn=False,
                body=_plain(f),
            )
        )
        return f

    def withdraw_fact(self, fact_id):
        """A fact the feed has taken back. Every cue resting on it is withdrawn too. Returns the withdrawn cue ids."""
        self.c["facts"].patch_item(
            fact_id, partition_key=self.match_id, patch_operations=[{"op": "set", "path": "/withdrawn", "value": True}]
        )
        out = []
        for row in self._query(
            "cues", "c.status = 'live' AND ARRAY_CONTAINS(c.body.fact_ids, @f)", [{"name": "@f", "value": fact_id}]
        ):
            self.c["cues"].patch_item(
                row["id"],
                partition_key=self.match_id,
                patch_operations=[{"op": "set", "path": "/status", "value": "withdrawn"}],
            )
            out.append(row["id"])
        return out

    def get_fact(self, fact_id):
        row = self._read("facts", fact_id)
        return row["body"] if row and not row["withdrawn"] else None

    def facts(self, match_id, as_of, kind=None, subject=None, since=0.0):
        """Facts that existed at match time `as_of`. Nothing later can be read: the no-peeking rule, enforced in the query."""
        where = "c.match_time <= @t AND c.match_time >= @s AND c.withdrawn = false"
        params = [{"name": "@t", "value": as_of}, {"name": "@s", "value": since}]
        if kind:
            where += " AND c.kind = @k"
            params.append({"name": "@k", "value": kind})
        if subject:
            where += " AND c.subject = @j"
            params.append({"name": "@j", "value": subject})
        rows = self._query("facts", where, params)
        return [r["body"] for r in sorted(rows, key=lambda r: r["match_time"])]

    # ----- cues -----
    def put_cue(self, c):
        from azure.cosmos.exceptions import CosmosResourceExistsError

        try:
            self.c["cues"].create_item(
                dict(
                    id=c["cue_id"],
                    match_id=c["match_id"],
                    match_time=c["match_time"],
                    form=c["form"],
                    screen=c["screen"],
                    status=c["status"],
                    body=_plain(c),
                )
            )
        except CosmosResourceExistsError:
            return False  # already issued: a replay must not show it twice
        return True

    def cues(self, match_id, status=None):
        rows = (
            self._query("cues", "c.status = @st", [{"name": "@st", "value": status}])
            if status
            else self._query("cues", "true")
        )
        rows.sort(key=lambda r: (r["match_time"], r["id"]))
        return [dict(r["body"], status=r["status"]) for r in rows]

    # ----- checkpoints and audit log -----
    def save_checkpoint(self, name, body):
        self.c["checkpoints"].upsert_item(dict(id=_key(name), match_id=self.match_id, name=name, body=_plain(body)))

    def load_checkpoint(self, name):
        row = self._read("checkpoints", _key(name))
        return row["body"] if row else None

    def audit(self, match_time, kind, body):
        self.seq += 1
        self.c["audit"].create_item(
            dict(
                id=f"{self.seq:08d}",
                match_id=self.match_id,
                seq=self.seq,
                match_time=match_time,
                kind=kind,
                body=_plain(body),
            )
        )

    def audit_rows(self, kind=None):
        rows = (
            self._query("audit", "c.kind = @k", [{"name": "@k", "value": kind}])
            if kind
            else self._query("audit", "true")
        )
        return [(r["match_time"], r["kind"], r["body"]) for r in sorted(rows, key=lambda r: r["seq"])]

    def clear(self):
        """Removes everything this match has written, for a run that starts the match again from kick-off."""
        for name, container in self.c.items():
            for row in self._query(name, "true", select="c.id"):
                container.delete_item(row["id"], partition_key=self.match_id)
        self.seq = 0

    def commit(self):
        """Each write is already durable."""


def _key(name):
    """A checkpoint's name as a Cosmos id, which may not hold / \\ ? or #."""
    return name.translate(str.maketrans({"/": "_", "\\": "_", "?": "_", "#": "_"}))


def _plain(obj):
    """What json.dumps(default=float) would make of it: numpy numbers become plain ones, as the SQLite ledger stores them."""
    import json

    return json.loads(json.dumps(obj, default=float))
