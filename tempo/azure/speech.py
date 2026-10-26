"""Speech to text: the commentary feed through Azure AI Speech in real time.

The commentator's audio is pushed into a recognizer as it arrives, a tenth of a second at a time. The recognizer is told
both squads' names and the clubs' names as its phrase list, so a name it has never heard is still spelled the way the
match data spells it. Each finished utterance becomes one commentary line, the same shape the pipeline reads from the
generator's commentary: the match time it was said, its text, the time of each word, and how long recognition took after
the speaker stopped. The Listener (tempo/pipeline/listener.py) then finds the players named in it.

    SpeechListener   push audio in, get lines out, with the latency of each
    audio_chunks()   a file or a live stream as the recognizer's input, at speaking speed
    serve()          the listener service: the match's commentary audio to its commentary topic
"""

import json
import queue
import subprocess
import time
from collections.abc import Callable, Iterable
from typing import Any

from .settings import AzureSettings, credential

RATE = 16000  # the recognizer's input: 16 kHz, 16-bit, mono PCM
CHUNK_S = 0.1  # how much audio goes in at a time
TICKS = 10_000_000  # the service counts time in 100-nanosecond ticks


class SpeechListener:
    """One recognizer listening to one commentary feed. `start` is the match time at which the feed's first sample was
    spoken, so every word gets a match time. Lines arrive on `on_line` as they are recognized, and are also kept."""

    def __init__(
        self,
        cfg: AzureSettings,
        phrases: Iterable[str],
        start: float = 0.0,
        on_line: Callable[[dict[str, Any]], None] | None = None,
        sdk: Any = None,
    ):
        if sdk is None:
            import azure.cognitiveservices.speech as sdk
        if not cfg.speech_endpoint:
            raise ValueError("TEMPO_AZURE_SPEECH_ENDPOINT is not set")
        self.sdk, self.start, self.on_line = sdk, start, on_line
        conf = sdk.SpeechConfig(
            endpoint=cfg.speech_endpoint, token_credential=credential(), speech_recognition_language=cfg.speech_language
        )
        conf.output_format = sdk.OutputFormat.Detailed
        conf.request_word_level_timestamps()
        self.stream = sdk.audio.PushAudioInputStream(sdk.audio.AudioStreamFormat(samples_per_second=RATE))
        self.recognizer = sdk.SpeechRecognizer(conf, audio_config=sdk.audio.AudioConfig(stream=self.stream))
        grammar = sdk.PhraseListGrammar.from_recognizer(self.recognizer)
        for p in dict.fromkeys(phrases):  # once each, in the order given
            grammar.addPhrase(p)
        self.recognizer.recognized.connect(self._recognized)
        self.recognizer.canceled.connect(self._canceled)
        self.recognizer.session_stopped.connect(lambda _evt: self._done.put(None))
        self._done: queue.Queue[str | None] = queue.Queue()
        self.pushed: list[tuple[float, float]] = []  # (seconds of audio pushed so far, wall clock when pushed)
        self.lines: list[dict[str, Any]] = []

    # ----- the feed -----
    def begin(self):
        self.recognizer.start_continuous_recognition_async().get()

    def feed(self, pcm: bytes):
        """Push raw 16 kHz mono 16-bit audio, in the order it was spoken."""
        self.stream.write(pcm)
        so_far = (self.pushed[-1][0] if self.pushed else 0.0) + len(pcm) / (2 * RATE)
        self.pushed.append((so_far, time.monotonic()))

    def end(self, timeout=30.0):
        """The feed is over: let the recognizer finish what it heard, then stop it. Returns every line."""
        self.stream.close()
        try:
            err = self._done.get(timeout=timeout)
        except queue.Empty:
            err = None
        self.recognizer.stop_continuous_recognition_async().get()
        if err:
            raise RuntimeError(f"AI Speech stopped: {err}")
        return self.lines

    # ----- what the service sends back -----
    def _pushed_at(self, audio_s):
        """The wall-clock moment the audio up to `audio_s` had been pushed."""
        return next((wall for s, wall in self.pushed if s >= audio_s), self.pushed[-1][1] if self.pushed else 0.0)

    def _recognized(self, evt):
        r = evt.result
        if r.reason != self.sdk.ResultReason.RecognizedSpeech or not r.text:
            return
        best = (json.loads(r.json).get("NBest") or [{}])[0]
        words = [
            dict(word=w["Word"], at=round(self.start + w["Offset"] / TICKS, 3), len=round(w["Duration"] / TICKS, 3))
            for w in best.get("Words", [])
        ]
        said_end = (r.offset + r.duration) / TICKS
        line = dict(
            matchTime=round(self.start + r.offset / TICKS, 3),
            text=r.text,
            words=words,
            confidence=best.get("Confidence"),
            latency_ms=round((time.monotonic() - self._pushed_at(said_end)) * 1000),
            source="ai-speech",
        )
        self.lines.append(line)
        if self.on_line:
            self.on_line(line)

    def _canceled(self, evt):
        d = evt.cancellation_details
        if d.reason == self.sdk.CancellationReason.Error:
            self._done.put(f"{d.error_code}: {d.error_details}")
        else:
            self._done.put(None)


def audio_chunks(source, live=True):
    """A recording or a live stream as the recognizer wants it, 16 kHz mono 16-bit PCM, a tenth of a second at a time.
    ffmpeg reads anything it can open (a file, an HLS or RTMP address); `live` makes it read a file at the speed it was
    spoken, which is what the latency figure means. A live stream is real time already."""
    step = int(CHUNK_S * RATE) * 2
    cmd = ["ffmpeg", "-loglevel", "error", *(["-re"] if live else []), "-i", str(source)]
    cmd += ["-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as proc:
        assert proc.stdout
        while chunk := proc.stdout.read(step):
            yield chunk
    if proc.returncode:
        raise RuntimeError(f"ffmpeg could not read {source}")


def listen(listener: SpeechListener, chunks: Iterable[bytes]):
    """Feeds the audio through the listener and returns every line it recognized."""
    listener.begin()
    for c in chunks:
        listener.feed(c)
    listener.feed(b"\0" * int(0.8 * RATE) * 2)  # a moment of silence, so the last utterance is closed
    return listener.end()


def serve(match_id: str, source: str, start: float, live=True, log=print):
    """The listener service: the match's commentary audio in, one line on the bus's commentary topic for each thing
    said. Returns the lines, with word times and the latency of each."""
    from ..pipeline.listener import Listener
    from . import settings, wire
    from .telemetry import span
    from .telemetry import start as tracing

    cfg = settings()
    tracing(cfg, "tempo-listener")
    w = wire(match_id, f".work/{match_id}", cfg=cfg)
    meta = _sheet(w.bus)
    finder = Listener(meta)

    def on_line(line):
        with span("speech.line", match_id=match_id, latency_ms=line["latency_ms"]):
            w.bus.publish("commentary", line)
        names = [meta["names"][p] for p in finder.mentions(line["text"])]
        log(
            f"{line['matchTime']:8.2f}  {line['latency_ms']:5d} ms  {line['text']}"
            + (f"  [{', '.join(names)}]" if names else "")
        )

    sl = SpeechListener(cfg, Listener.phrases(meta), start=start, on_line=on_line)
    return listen(sl, audio_chunks(source, live))


def _sheet(bus, wait=5.0, patience=3600.0):
    """Who is playing, from the feed's first message: the phrase list is both squads."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < patience:
        got = bus.read("feed", 0, 1, wait=wait)
        if got:
            return got[0][1]["meta"]
    raise TimeoutError("no match sheet on the feed")
