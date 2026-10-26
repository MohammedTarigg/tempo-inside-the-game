"""Tracing in Application Insights, through OpenTelemetry and the Azure Monitor distribution.

Two things go there. Spans for the work each service does (a batch of the feed played through the pipeline, a moment
written, an utterance recognized), so a slow stretch shows where the time went. And the audit: every line the run writes
to its audit (shown, held back with its reason, withdrawn, rejected by the Verifier) also goes out as a log record with
its fields as custom dimensions, so the producer's desk and Application Insights read the same record.

Without a connection string nothing is configured and every span is a no-op."""

import logging
import os
from contextlib import nullcontext
from typing import Any

from .settings import AzureSettings

log = logging.getLogger("tempo.audit")


def start(cfg: AzureSettings, role: str) -> bool:
    """Sends this process's spans and logs to Application Insights under the role name given (the service's name in
    the application map). Returns whether it did."""
    if not cfg.appinsights_connection:
        return False
    from azure.monitor.opentelemetry import configure_azure_monitor

    os.environ.setdefault("OTEL_SERVICE_NAME", role)
    configure_azure_monitor(connection_string=cfg.appinsights_connection, logger_name="tempo")
    logging.getLogger("tempo").setLevel(logging.INFO)
    return True


def span(name: str, **attrs: Any):
    """A span around some work. A no-op when OpenTelemetry is not installed or not configured."""
    try:
        from opentelemetry import trace
    except ImportError:
        return nullcontext()
    return trace.get_tracer("tempo").start_as_current_span(
        name, attributes={k: v for k, v in attrs.items() if v is not None}
    )


class AuditedLedger:
    """A ledger whose audit also goes to Application Insights. Every other call passes straight through."""

    def __init__(self, inner, match_id: str):
        self._inner, self._match_id = inner, match_id

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def audit(self, match_time, kind, body):
        self._inner.audit(match_time, kind, body)
        log.info(
            "%s %s",
            kind,
            body.get("form") or body.get("cue_id") or "",
            extra={
                "match_id": self._match_id,
                "match_time": float(match_time),
                "audit": kind,
                "form": body.get("form"),
                "reason": body.get("short") or body.get("reason"),
            },
        )
