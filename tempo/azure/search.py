"""The closest earlier attempt over the whole season, on Azure AI Search.

Every attack the season has seen is a document in the `attacks` index: its team, match, time and result, the attack as
the twin search stores it, and a vector of its first 1.6 seconds (the ball and the four players a side nearest it, in
metres, the part twin.compare reads to decide whether two attacks start alike). A new attack asks the index for its
nearest earlier attacks by that vector, filtered to the same team and a different result. The exact comparison, the
best one-to-one pairing of players and the percentile rule, then runs on those few, exactly as it does locally
(tempo/instruments/twin.py). The search narrows; the rule decides.

The run adds each of its own attacks to the index as it happens, so the next match can find them."""

import json
from typing import Any

import numpy as np

from ..instruments import twin
from .settings import AzureSettings, credential

DIMS = twin.ALIKE * 2 + 2 * twin.K * twin.ALIKE * 2  # the ball and 2 x K players, x and y, over the alike part
NEAREST = 40  # how many the index returns for the exact comparison


def alike_vector(vec) -> list[float]:
    """The part of an attack that decides whether two start alike, as one flat vector."""
    parts = [vec["ball"][: twin.ALIKE]] + [vec[k][:, : twin.ALIKE] for k in ("A", "D")]
    return [float(x) for x in np.concatenate([np.asarray(p).ravel() for p in parts])]


def document(vec, team, match_id, t, outcome, meta=None):
    plain = {k: (np.asarray(v).tolist() if k in ("ball", "A", "D") else v) for k, v in vec.items()}
    return dict(
        id=f"{match_id}-{team}-{round(t * 10)}",
        match_id=match_id,
        team=int(team),
        t=float(t),
        outcome=outcome,
        attack=json.dumps(plain),
        meta=json.dumps(meta or {}),
        alike=alike_vector(vec),
    )


def from_document(d):
    raw = json.loads(d["attack"])
    vec = {k: (np.array(v) if k in ("ball", "A", "D") else v) for k, v in raw.items()}
    return dict(
        vec=vec, team=d["team"], match_id=d["match_id"], t=d["t"], outcome=d["outcome"], meta=json.loads(d["meta"])
    )


def index_definition(name):
    from azure.search.documents.indexes.models import (
        HnswAlgorithmConfiguration,
        HnswParameters,
        SearchField,
        SearchIndex,
        VectorSearch,
        VectorSearchProfile,
    )

    return SearchIndex(
        name=name,
        fields=[
            SearchField(name="id", type="Edm.String", key=True, filterable=True),
            SearchField(name="match_id", type="Edm.String", filterable=True),
            SearchField(name="team", type="Edm.Int32", filterable=True),
            SearchField(name="t", type="Edm.Double", filterable=True, sortable=True),
            SearchField(name="outcome", type="Edm.String", filterable=True),
            SearchField(name="attack", type="Edm.String"),
            SearchField(name="meta", type="Edm.String"),
            SearchField(
                name="alike",
                type="Collection(Edm.Single)",
                searchable=True,
                vector_search_dimensions=DIMS,
                vector_search_profile_name="alike",
            ),
        ],
        vector_search=VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="hnsw", parameters=HnswParameters(metric="euclidean"))],
            profiles=[VectorSearchProfile(name="alike", algorithm_configuration_name="hnsw")],
        ),
    )


class SeasonSearch(twin.TwinSearch):
    """TwinSearch with the season in AI Search. `season` is the season's local search, which carries the spread of gaps
    between attacks that the percentile rule needs; its archive is not kept in memory."""

    def __init__(self, cfg: AzureSettings, season: twin.TwinSearch, client: Any = None):
        super().__init__()
        if client is None:
            if not cfg.search_endpoint:
                raise ValueError("TEMPO_AZURE_SEARCH_ENDPOINT is not set")
            from azure.search.documents import SearchClient

            client = SearchClient(cfg.search_endpoint, cfg.search_index, credential())
        self.client = client
        self._pairs = list(season._pairs)

    def add(self, vec, team, match_id, t, outcome, meta=None):
        super().add(vec, team, match_id, t, outcome, meta)  # this match's attacks stay in memory for its checkpoints
        self.client.upload_documents([document(vec, team, match_id, t, outcome, meta)])

    def candidates(self, vec, team, match_id, t, outcome):
        from azure.search.documents.models import VectorizedQuery

        hits = self.client.search(
            search_text=None,
            vector_queries=[VectorizedQuery(vector=alike_vector(vec), k_nearest_neighbors=NEAREST, fields="alike")],
            filter=f"team eq {int(team)} and outcome ne '{outcome}' and match_id ne '{match_id}'",
            select=["id", "match_id", "team", "t", "outcome", "attack", "meta"],
            top=NEAREST,
        )
        season = [from_document(d) for d in hits]
        return season + super().candidates(vec, team, match_id, t, outcome)  # and this match's own earlier attacks


def upload_season(cfg: AzureSettings, season: twin.TwinSearch, index_client: Any = None, client: Any = None):
    """Creates the index if it is not there and puts the season's archive in it. Returns how many attacks went in."""
    if index_client is None:
        from azure.search.documents.indexes import SearchIndexClient

        index_client = SearchIndexClient(cfg.search_endpoint or "", credential())
    index_client.create_or_update_index(index_definition(cfg.search_index))
    if client is None:
        from azure.search.documents import SearchClient

        client = SearchClient(cfg.search_endpoint or "", cfg.search_index, credential())
    docs = [document(o["vec"], o["team"], o["match_id"], o["t"], o["outcome"], o["meta"]) for o in season.archive]
    for k in range(0, len(docs), 500):  # the service takes up to 1000 documents a request
        client.upload_documents(docs[k : k + 500])
    return len(docs)
