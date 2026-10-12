"""Can the local Kokoro voice (the one Mohamed's interview trainer uses) read the commentator's line, and does it sound excited?

    /Users/mohamedsaeed/Desktop/Mo/interview-prep/.tts/venv/bin/python spike/voice/kokoro_test.py

Writes one mp3 per voice and speed into spike/voice/out/ and prints each clip's length and pitch. Research on football
commentary (Trouvain 2011, 2015) puts an excited call one to two octaves above a speaker's resting pitch, often over 400 Hz,
so the pitch printed here says whether a read-aloud voice gets anywhere near that. It uses the trainer's model files in
place and changes nothing in that project.
"""
import subprocess
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

TTS = Path("/Users/mohamedsaeed/Desktop/Mo/interview-prep/.tts")
OUT = Path(__file__).parent / "out"
LINES = {"calm": "Skoles is everywhere for Harbour City today.", "push": "Skoles! He is EVERYWHERE for Harbour City today!"}


def pitch(x, sr):
    """Median pitch of the voiced parts, by the lag at which each short stretch best matches itself."""
    n, hop, out = int(0.04 * sr), int(0.01 * sr), []
    for i in range(0, len(x) - n, hop):
        w = x[i:i + n] - x[i:i + n].mean()
        if np.sqrt(np.mean(w ** 2)) < 0.02:
            continue
        ac = np.correlate(w, w, "full")[n - 1:]; lo, hi = int(sr / 450), int(sr / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.45 * ac[0]:
            out.append(sr / k)
    return (float(np.median(out)), float(np.percentile(out, 95))) if out else (0.0, 0.0)


def main():
    OUT.mkdir(exist_ok=True)
    kokoro = Kokoro(str(TTS / "kokoro-v1.0.onnx"), str(TTS / "voices-v1.0.bin"))
    for voice in ("bm_george", "bm_lewis", "bm_daniel", "bm_fable"):
        for tag, text in LINES.items():
            for speed in ((1.0, 1.2) if tag == "push" else (1.0,)):
                t0 = time.time(); samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-gb"); took = time.time() - t0
                name = f"{voice}-{tag}-{speed}"; wav = OUT / (name + ".wav"); sf.write(wav, samples, rate)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-b:a", "128k", str(OUT / (name + ".mp3"))], check=True); wav.unlink()
                med, top = pitch(np.asarray(samples, dtype=np.float64), rate)
                print(f"{name:26s} {len(samples) / rate:4.1f} s  made in {took:4.1f} s  pitch median {med:4.0f} Hz, top {top:4.0f} Hz")


if __name__ == "__main__":
    main()
