"""Cuts a real, public-domain track to Tempo's film, the way an editor cuts library music to picture.

    python3 tools/film_music.py           (needs numpy and ffmpeg)

Four attempts at writing the music in code were rejected: sine waves do not sound like instruments, and nobody here can
hear. So the music is a recording by a musician, and this script only edits it.

The track is "With You" by Soft and Furious, from the Free Music Archive, dedicated to the public domain by the artist
under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). No credit is required; it is given anyway in
ui/tour/music/README.md. Mohamed chose it by ear on 12 October 2026 from nine public-domain tracks. His references for
the sound were two OpenAI product films (youtube uXspbC2srEQ and PUBc2G0Tj5E), measured and deleted: about 129 beats a
minute in C major, led by the bass, centred near 250 Hz, at a steady level. This track was the closest to that of 109
measured. Another track can be tried by putting its mp3 in ui/tour/music/ and adding a line to TRACKS; it plays with
?music=<name>.

The crowd is "Millerntor Stadium Crowd Reaction Mood Waves 01" by itmightgetloud on Freesound (sound 829456), also CC0,
in the 128 kbit preview the site serves without an account. Mohamed chose it and asked for ordinary in-play noise, with
no goal cheer: the recording is a set of waves, and from 150 s to its end it stays within a few decibels, so the bed is
cut from there.

The commentator's line is not a person. It was made on 12 October 2026 with Qwen3-TTS VoiceDesign (Apache 2.0), which
builds a voice from a written description; Mohamed chose this take by ear (spike/voice/expressive_test.py,
'commentator', take 2).

What the edit does:
  finds the track's beat and writes the film's timings as whole numbers of beats, so every feature starts on one
  starts the track so its own first lift (where the drums come in) falls where the film's first feature starts
  gives each feature its own level, turns the music down and dulls it under the commentator's line
  stops the music, with the room ringing on, before the shot and before the card lights
  dulls it for the close and cuts it at the blink

The sources are read from ui/tour/music/. For each track it writes ui/tour/tempo-theme[-name].m4a and a .json of the
same name, which tour.js reads for its timings. The moments named here (the shot 'strike' beats into Thunderbolt, the
card 'lit' beats into On a yellow, the blink in the close) are the film's. If one moves in tour.js, move it here."""

import json
import os
import subprocess
import sys

import numpy as np

SR, AN = 44100, 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOUR = os.path.join(ROOT, "ui", "tour")  # the film's folder: sources in music/, the cut beside the page
TRACKS = {  # name: (title, artist, page). The first is the default
    "with-you": (
        "With You",
        "Soft and Furious",
        "https://freemusicarchive.org/music/Soft_and_Furious/The_Man_Im_Not/Soft_And_Furious_-_The_Man_Im_Not_-_03_With_You/",
    ),
}
# the film: what each part wants in seconds, and how loud the music is under it (dB against the fullest part)
PARTS = [
    ("opening", 9.6, -7),
    ("heads up", 9.6, -3),
    ("thunderbolt", 7.2, 0),
    ("speak", 9.6, -5),
    ("yellow", 14.4, -4),
    ("deja vu", 16.8, -4),
    ("calls", 14.8, -2),
    ("proof", 11.1, -7),
    ("close", 7.2, -9),
]
STRIKE_S, LIT_S, OPEN_MIN = 2.6, 9.6, 9.2  # wanted; each is moved to the nearest beat
SPEECH = "Skoles is everywhere for Harbour City today"  # the commentator's line; it must match the run's form card
SPEECH_BEATS, SPEECH_DB = (
    3,
    -19.0,
)  # how many beats into Speak of the devil it starts, and its level: about 6 dB over everything else, as on a broadcast
CROWD_FROM, CROWD_DB = 154.0, -33.0  # where the steady in-play stretch of the crowd recording starts, and its level


def load(path, sr, ch):
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", str(ch), "-ar", str(sr), "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(raw, "<f4")
    return x.reshape(-1, ch) if ch > 1 else x


def lowpass(x, fc, order=2):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
    return np.fft.irfft(X * (H[:, None] if x.ndim > 1 else H), len(x), axis=0)


def beat_of(x):
    """The track's beat: its length in seconds and when the first one falls. These tracks were made on a grid, so one
    length holds from start to end. Found by laying a comb of evenly spaced teeth over the note starts and keeping the
    spacing and shift that catch the most."""
    hop, n = 256, 1024
    dt = hop / AN
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    S = np.log1p(30 * np.abs(np.fft.rfft(fr, axis=1)))
    f = np.fft.rfftfreq(n, 1 / AN)
    on = np.maximum(0, np.diff(S, axis=0)).sum(1)
    lo = np.maximum(0, np.diff(S[:, f < 130], axis=0)).sum(1)
    on = on / on.max()
    idx = np.arange(len(on))
    T = len(on) * dt

    def comb(period, shift, sig=on):
        return np.interp(np.arange(shift, T - 1, period) / dt, idx, sig).mean()

    best = max(
        (
            (max(comb(60 / b, s) + 0.5 * comb(30 / b, s) for s in np.arange(0, 60 / b, 0.02)), b)
            for b in np.arange(60, 110, 0.25)
        )
    )[1]
    fine = max(
        ((comb(60 / b, s), b, s) for b in np.arange(best - 0.4, best + 0.4, 0.01) for s in np.arange(0, 60 / b, 0.005))
    )
    _, bpm, shift = fine
    period = 60 / bpm
    down = max(
        range(4), key=lambda k: comb(4 * period, shift + k * period, lo)
    )  # the beat in four that the low drum favours
    contrast = comb(period, shift) / (comb(period, shift + period / 2) + 1e-9)
    return period, shift + down * period, bpm, contrast


def lift_of(x, period, first):
    """Where the track first steps up to its full level (the drums coming in), on a bar line; None if it has no such
    step."""
    bar = 4 * period
    n = int(bar * AN)
    db = lambda v: 10 * np.log10(np.mean(v**2) + 1e-12)
    starts = np.arange(first % bar, len(x) / AN - bar, bar)
    lv = np.array([db(x[int(s * AN) : int(s * AN) + n]) for s in starts])
    full = np.median(lv[len(lv) // 3 :])
    for i in range(1, len(lv)):
        if starts[i] > 30:
            break
        if lv[i] - lv[i - 1] >= 3 and lv[i] >= full - 3 and lv[:i].mean() <= full - 4:
            return float(starts[i])
    return None


def plan(period, first, lift):
    """The film in beats. Every part is an even number of beats, close to the seconds it wants."""
    beats = [max(2, int(round(sec / period / 2)) * 2) for _, sec, _ in PARTS]
    while beats[0] * period < OPEN_MIN:
        beats[0] += 2
    open_s = beats[0] * period
    start = (
        lift - open_s if lift is not None and lift >= open_s else first % period
    )  # the track's time at the film's zero
    if lift is None:
        while start + 1e-6 < 0:
            start += period
    return beats, start


def edit(name):
    src = os.path.join(TOUR, "music", name + ".mp3")
    title, artist, url = TRACKS[name]
    period, first, bpm, contrast = beat_of(load(src, AN, 1))
    lift = lift_of(load(src, AN, 1), period, first)
    beats, start = plan(period, first, lift)
    starts = np.concatenate([[0], np.cumsum(beats)]) * period
    total = float(starts[-1])
    at = dict(zip([p[0] for p in PARTS], starts))
    strike_b, lit_b = max(3, round(STRIKE_S / period)), round(LIT_S / period)
    full = load(src, SR, 2)
    i0 = int(start * SR)
    N = int(total * SR)
    if i0 + N > len(full):
        raise SystemExit(f"{name}: the track is too short for the film")
    x = full[i0 : i0 + N].astype(np.float64)
    t = np.arange(N) / SR
    x /= np.sqrt(np.mean(full[len(full) // 3 : 2 * len(full) // 3].astype(np.float64) ** 2)) * 10 ** (
        24 / 20
    )  # the track's own full level to -24 dB: under the film, never in front of it
    # ---- the level of each part, moving to the next over the last beat before it ----
    lev = np.zeros(N)
    for (pname, _, db), a, b in zip(PARTS, starts[:-1], starts[1:]):
        lev[int(a * SR) : int(b * SR)] = db
    ya, yb = at["yellow"], at["yellow"] + lit_b * period  # under the booked player it grows towards the card
    m = (t >= ya) & (t < yb)
    lev[m] = -9 + 7 * ((t[m] - ya) / (yb - ya)) ** 1.5
    # ---- the commentator's line: a clip of a described, invented voice. Where its sound starts and stops is measured,
    #      and its words are spread across that stretch by their length, which is close enough for words to appear as
    #      he says them ----
    voice = load(os.path.join(TOUR, "music", "commentator.wav"), SR, 1).astype(np.float64)
    win = int(0.02 * SR)
    env = np.array([np.sqrt(np.mean(voice[i : i + win] ** 2)) for i in range(0, len(voice) - win, win)])
    loud = np.where(env > env.max() * 10 ** (-28 / 20))[0]
    v0, v1 = loud[0] * 0.02, (loud[-1] + 1) * 0.02
    words = SPEECH.split()
    wlen = np.array([len(w) + 1.5 for w in words], float)
    word_at = [round(float(v0 + (v1 - v0) * c), 3) for c in np.concatenate([[0], np.cumsum(wlen)[:-1]]) / wlen.sum()]
    voice *= 10 ** (SPEECH_DB / 20) / np.sqrt(np.mean(voice[int(v0 * SR) : int(v1 * SR)] ** 2))
    sa = at["speak"]
    say = sa + SPEECH_BEATS * period
    say_len = len(voice) / SR
    dull = np.zeros(N)
    m = (t >= say - 0.5) & (t < say + say_len + 0.3)
    lev[m] = -17
    dull[m] = 1  # the music steps back and dulls while he speaks
    ca = at["close"]
    cd = beats[-1] * period
    blink = ca + 5.95 / 7.5 * cd
    dull[t >= ca] = 1
    k = int(0.35 * SR)

    def smooth(v):  # a running mean, twice: no level ever jumps
        for _ in range(2):
            c = np.cumsum(np.pad(v, (k + 1, k), mode="edge"))
            v = (c[2 * k + 1 :] - c[: -2 * k - 1]) / (2 * k + 1)
        return v

    lev, dull = smooth(lev), smooth(dull)
    y = (x * (1 - dull[:, None]) + lowpass(x, 420) * dull[:, None]) * (10 ** (lev / 20))[:, None]
    # ---- the rests: the music stops and the room it was in rings on; it comes back on the moment itself ----
    rests = [
        (at["thunderbolt"] + (strike_b - 1) * period, at["thunderbolt"] + strike_b * period),
        (at["yellow"] + (lit_b - 2) * period, at["yellow"] + lit_b * period),
        (blink, total),
    ]
    n_ir = int(2.0 * SR)
    rng = np.random.default_rng(4)
    ti = np.arange(n_ir) / SR
    ir = np.stack(
        [lowpass(rng.standard_normal(n_ir), 3200) * np.exp(-ti / 0.38) * np.minimum(1, ti / 0.015) for _ in range(2)], 1
    )
    ir /= np.sqrt((ir**2).sum(0))
    gate = np.ones(N)
    tails = np.zeros_like(y)
    fade = int(0.03 * SR)
    for a, b in rests:
        ia, ib = int(a * SR), min(N, int(b * SR))
        gate[ia:ib] = 0
        gate[max(0, ia - fade) : ia] = np.minimum(gate[max(0, ia - fade) : ia], np.linspace(1, 0, min(fade, ia)))
        if ib < N:
            gate[ib : ib + 200] = np.linspace(0, 1, 200)[: max(0, min(200, N - ib))]
        seg = y[max(0, ia - int(0.45 * SR)) : ia] * np.linspace(0, 1, min(ia, int(0.45 * SR)))[:, None] ** 2
        for c in range(2):
            size = 1 << int(np.ceil(np.log2(len(seg) + n_ir)))
            tail = np.fft.irfft(np.fft.rfft(seg[:, c], size) * np.fft.rfft(ir[:, c], size), size)[
                len(seg) : len(seg) + n_ir
            ][: N - ia]
            tails[ia : ia + len(tail), c] += 0.55 * tail
    y = y * gate[:, None] + tails
    # ---- the crowd: a real stadium between big moments, under the match and never over it. It comes up as the players
    #      appear, carries on through the music's rests (a ground does not go silent because the music has), and leaves
    #      with the match before the proof page ----
    crowd_src = load(os.path.join(TOUR, "music", "crowd.mp3"), SR, 2).astype(np.float64)
    c0 = int((CROWD_FROM - 6.0) * SR)
    crowd = crowd_src[c0 : c0 + N]
    crowd = np.pad(crowd, ((0, N - len(crowd)), (0, 0)))
    crowd /= np.sqrt(np.mean(crowd[int(8 * SR) : int(80 * SR)] ** 2)) * 10 ** (-CROWD_DB / 20)
    cg = np.zeros(N)
    m = (t >= 6.0) & (t < at["proof"])
    cg[m] = 1.0
    st = at["thunderbolt"] + strike_b * period
    m = (t >= st) & (t < st + 2.5)
    cg[m] = 1.4  # the ground reacts to the shot
    m = (t >= say - 0.3) & (t < say + say_len + 0.2)
    cg[m] = 0.75  # and gives the commentator a little room
    k = int(0.6 * SR)
    cg = smooth(cg)
    k = int(0.35 * SR)
    y = y + crowd * cg[:, None]
    i_s = int(say * SR)
    y[i_s : i_s + len(voice)] += voice[: N - i_s, None]
    y *= (np.minimum(1, t / 0.25) * np.minimum(1, (total - t) / 0.3))[:, None]
    y = np.tanh(y * 1.2) / 1.2
    # ---- report ----
    db = lambda v: 20 * np.log10(np.sqrt(np.mean(v**2)) + 1e-12)
    print(
        f"{name}: {bpm:.2f} beats a minute (beat {period:.4f} s, comb contrast {contrast:.1f}),"
        f" first lift {'none' if lift is None else f'{lift:.1f} s'}, track starts at {start:.2f} s"
    )
    print(
        f"   film {total:.1f} s, peak {20 * np.log10(np.abs(y).max()):.1f} dB;",
        "  ".join(
            f"{p[0]} {s:.1f}s {db(y[int(s * SR) : int(e * SR)]):.0f}dB"
            for p, s, e in zip(PARTS, starts[:-1], starts[1:])
        ),
    )
    print(
        f"   commentator: starts {say:.2f} s, {say_len:.2f} s long, words at {word_at};"
        f" while he speaks the whole mix is {db(y[i_s : i_s + len(voice)]):.0f} dB, his voice {SPEECH_DB:.0f}"
    )
    crowd_in_play = crowd[int(30 * SR) : int(60 * SR)] * cg[int(30 * SR) : int(60 * SR), None]
    print(f"   crowd alone, in play: {db(crowd_in_play):.0f} dB")
    print(
        "   rests:",
        "  ".join(
            f"{a:.1f} to {b:.1f} ({db(y[int((a + 0.5 * (b - a)) * SR) : int(b * SR) - 1]):.0f} dB)" for a, b in rests
        ),
        "| the bar after each:",
        "  ".join(f"{db(y[int(b * SR) : int((b + 0.5) * SR)]):.0f}" for a, b in rests[:-1]),
    )
    out = "tempo-theme-" + name
    raw = os.path.join(TOUR, "_theme.f32")
    y.astype("<f4").tofile(raw)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "f32le",
            "-ar",
            str(SR),
            "-ac",
            "2",
            "-i",
            raw,
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            os.path.join(TOUR, out + ".m4a"),
        ],
        check=True,
    )
    os.remove(raw)
    with open(os.path.join(TOUR, out + ".json"), "w") as fh:
        json.dump(
            {
                "track": title,
                "by": artist,
                "licence": "CC0 1.0",
                "source": url,
                "beat": round(period, 5),
                "open": beats[0],
                "parts": beats[1:],
                "strike": strike_b,
                "lit": lit_b,
                "speech": {
                    "text": SPEECH,
                    "at": round(SPEECH_BEATS * period, 3),
                    "len": round(say_len, 3),
                    "words": word_at,
                },
            },
            fh,
            indent=1,
        )
    if name == next(iter(TRACKS)):  # the default is also written under the plain name
        for ext in (".m4a", ".json"):
            with (
                open(os.path.join(TOUR, out + ext), "rb") as a,
                open(os.path.join(TOUR, "tempo-theme" + ext), "wb") as b,
            ):
                b.write(a.read())


if __name__ == "__main__":
    for name in sys.argv[1:] or TRACKS:
        edit(name)
