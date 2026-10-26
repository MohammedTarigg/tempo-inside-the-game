"""Tempo on Azure. Each module is one adapter behind an interface the pipeline already has, so the pipeline's code is the
same on a laptop and in a Container App:

    speech.py      AI Speech: the commentary feed to commentary lines        (the Listener's input)
    eventhubs.py   Event Hubs: the feed, the commentary and the cues          (LocalBus)
    cosmos.py      Cosmos DB: facts, cues, checkpoints and the audit          (Ledger)
    search.py      AI Search: earlier attacks across the season               (TwinSearch)
    foundry.py     a Foundry model: the line a moment's facts allow           (LocalBackend, which stays the fallback)
    webpubsub.py   Web PubSub: every cue to the screens as it is issued
    blob.py        Blob Storage: a finished run's files, where the site reads them
    telemetry.py   Application Insights: spans and the audit

wire() picks, for each part, the Azure adapter when its setting is present (settings.py) and the local stand-in when it
is not. Identity is Entra ID throughout: no client holds a key."""

import os
from dataclasses import dataclass, field
from typing import Any

from .settings import AzureSettings, settings


@dataclass
class Wiring:
    """What a run is built from, part by part, and which parts are on Azure."""

    ledger: Any
    bus: Any
    search: Any = None
    backend: Any = None
    push: Any = None
    on_azure: list[str] = field(default_factory=list)


def wire(match_id: str, work_dir: str, search: Any = None, cfg: AzureSettings | None = None) -> Wiring:
    from ..pipeline.bus import LocalBus
    from ..pipeline.ledger import Ledger

    cfg = cfg or settings()
    on: list[str] = []
    if cfg.cosmos_endpoint:
        from .cosmos import CosmosLedger

        ledger: Any = CosmosLedger(cfg, match_id)
        on.append("ledger on Cosmos DB")
    else:
        os.makedirs(work_dir, exist_ok=True)
        ledger = Ledger(os.path.join(work_dir, "tempo.sqlite"))
    if cfg.appinsights_connection:
        from .telemetry import AuditedLedger

        ledger = AuditedLedger(ledger, match_id)
        on.append("audit to Application Insights")
    if cfg.eventhubs_namespace:
        from .eventhubs import EventHubsBus

        bus: Any = EventHubsBus(cfg, match_id)
        on.append("bus on Event Hubs")
    else:
        bus = LocalBus(work_dir)
    if cfg.search_endpoint and search is not None:
        from .search import SeasonSearch

        search = SeasonSearch(cfg, search)
        on.append("earlier attacks from AI Search")
    backend = None
    if cfg.foundry_endpoint:
        from .foundry import FoundryBackend

        backend = FoundryBackend(cfg)
        on.append(f"writer on Foundry ({cfg.foundry_deployment})")
    push = None
    if cfg.webpubsub_endpoint:
        from .webpubsub import ScreenPush

        push = ScreenPush(cfg, match_id)
        on.append("cues pushed through Web PubSub")
    return Wiring(ledger=ledger, bus=bus, search=search, backend=backend, push=push, on_azure=on)


__all__ = ["AzureSettings", "Wiring", "settings", "wire"]
