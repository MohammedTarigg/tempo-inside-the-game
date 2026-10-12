"""Voices that can be told how to speak, tried on the commentator's line because Kokoro could only read it flat.

Run with an environment that has mlx-audio (Apple Silicon):  python spike/voice/expressive_test.py [design|custom|chatterbox]

Qwen3-TTS VoiceDesign makes a voice from a written description, so no real person's voice is copied. Each clip is written
to spike/voice/out2/ with its length and pitch, the same measure used for the Kokoro clips.
"""
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model

OUT = Path(__file__).parent / "out2"
LINE = "Skoles is everywhere for Harbour City today!"
DESIGNS = {
    "commentator": "A British male football commentator in his forties, live on television from a loud stadium. Energetic and urgent, projecting his voice over the crowd, fast and punchy, with rising excitement.",
    "lead": "Male English Premier League play-by-play commentator, warm baritone, lively and animated, speaking quickly with strong emphasis on the player's name, as if the play is happening right now.",
    "measured": "A seasoned British male sports broadcaster, confident and engaged, slightly raised voice with a smile in it, brisk pace, clear diction, live match atmosphere.",
    "radio": "An excited British radio football commentator, high energy, loud and passionate, voice lifting in pitch as he speaks, breathless pace.",
}


def pitch(x, sr):
    n, hop, out = int(0.04 * sr), int(0.01 * sr), []
    for i in range(0, len(x) - n, hop):
        w = x[i:i + n] - x[i:i + n].mean()
        if np.sqrt(np.mean(w ** 2)) < 0.02:
            continue
        ac = np.correlate(w, w, "full")[n - 1:]; lo, hi = int(sr / 450), int(sr / 70); k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.45 * ac[0]:
            out.append(sr / k)
    return (float(np.median(out)), float(np.percentile(out, 95))) if out else (0.0, 0.0)


def save(name, results, t0):
    audio = np.concatenate([np.asarray(r.audio, dtype=np.float32).reshape(-1) for r in results]); sr = results[0].sample_rate
    sf.write(OUT / f"{name}.wav", audio, sr); med, top = pitch(audio.astype(np.float64) / (np.abs(audio).max() + 1e-9) * 0.7, sr)
    print(f"{name:34s} {len(audio) / sr:4.1f} s  made in {time.time() - t0:5.1f} s  pitch median {med:4.0f} Hz, top {top:4.0f} Hz", flush=True)


def main():
    OUT.mkdir(exist_ok=True); what = sys.argv[1] if len(sys.argv) > 1 else "design"
    if what == "design":
        model = load_model(os.environ.get("QWEN_DESIGN", "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"))
        for key, text in DESIGNS.items():
            for take in (1, 2):
                t0 = time.time(); save(f"design-{key}-{take}", list(model.generate_voice_design(text=LINE, instruct=text, language="English")), t0)
    elif what == "custom":
        model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit")
        for speaker in ("Ryan", "Aiden"):
            for key, ins in (("excited", "Excited live football commentary, loud, fast and urgent."), ("lively", "Lively sports broadcaster, brisk and engaged.")):
                t0 = time.time(); save(f"custom-{speaker}-{key}", list(model.generate_custom_voice(text=LINE, speaker=speaker, language="English", instruct=ins)), t0)
    elif what == "chatterbox":
        model = load_model("mlx-community/chatterbox-fp16")
        for ex, cfg in ((0.5, 0.5), (0.8, 0.3), (1.0, 0.3)):
            t0 = time.time(); save(f"chatterbox-ex{ex}-cfg{cfg}", list(model.generate(text=LINE, exaggeration=ex, cfg_weight=cfg)), t0)


if __name__ == "__main__":
    main()
