"""The push to the screens on Azure Web PubSub. Every cue the cue service issues goes to its match's group the moment it
is issued, in the shape the site reads (export.screen_cue), stamped with the frame it was issued on. Each screen holds a
cue until its own picture reaches that frame, so a screen behind the live picture (a delay, a replay) is never shown
something before it happens. A withdrawn cue is sent as its id and status, and taken down.

A screen connects with a URL from client_url(): a token for this hub that joins the match's group and can only listen. The
live service hands it out at /negotiate (tempo/pipeline/live.py)."""

import json
import logging
from typing import Any

from ..pipeline.export import screen_cue
from .settings import AzureSettings, credential

log = logging.getLogger("tempo.push")


def group(match_id):
    return f"match.{match_id}"


class ScreenPush:
    def __init__(self, cfg: AzureSettings, match_id: str, client: Any = None):
        if client is None:
            if not cfg.webpubsub_endpoint:
                raise ValueError("TEMPO_AZURE_WEBPUBSUB_ENDPOINT is not set")
            from azure.messaging.webpubsubservice import WebPubSubServiceClient

            client = WebPubSubServiceClient(
                endpoint=cfg.webpubsub_endpoint, hub=cfg.webpubsub_hub, credential=credential()
            )
        self.client, self.group, self.sent, self.failed = client, group(match_id), 0, 0

    def send(self, msg):
        """One message to every screen on this match. A failed send is logged and counted, never raised: the screens
        can miss a cue, the pipeline must not stop for it."""
        try:
            self.client.send_to_group(self.group, json.dumps(msg, default=float), content_type="application/json")
            self.sent += 1
        except Exception as e:
            self.failed += 1
            log.warning("push to %s failed: %s", self.group, e)

    def client_url(self, minutes=180):
        """A URL a screen opens as a WebSocket: it joins this match's group on connect and may only receive."""
        return self.client.get_client_access_token(groups=[self.group], minutes_to_expire=minutes)["url"]


class PushingBus:
    """A bus that also pushes every cue to the screens. Wraps whichever bus the run uses; `frame` tells it the frame
    the cue service is on."""

    def __init__(self, inner, push: ScreenPush, frame):
        self.inner, self.push, self.frame = inner, push, frame

    def publish(self, topic, msg):
        out = self.inner.publish(topic, msg)
        if topic == "cues":
            self.push.send(
                screen_cue(msg, self.frame())
                if "form" in msg
                else dict(id=msg["cue_id"], status=msg["status"], t=msg["match_time"])
            )
        return out

    def read(self, topic, offset=0, limit=None, **kw):
        return self.inner.read(topic, offset, limit, **kw)

    def size(self, topic):
        return self.inner.size(topic)

    def dump(self, topic):
        return self.inner.dump(topic)
