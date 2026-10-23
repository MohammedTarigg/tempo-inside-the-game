"""The commentator's line in the film, spoken by a voice made from a written description, so no real person's voice is
copied. Qwen3-TTS VoiceDesign (Apache 2.0), run locally on Apple Silicon through mlx-audio:

    uv run --with mlx-audio --with soundfile python tools/commentator_voice.py

It writes assets/audio/commentator.wav. The model samples, so each run is a new take; the one in the repository was the
second take of this description, chosen by ear. tools/film_music.py mixes it into the film's sound."""

import os

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio", "commentator.wav")
MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"
LINE = "Skoles is everywhere for Harbour City today!"
VOICE = (
    "A British male football commentator in his forties, live on television from a loud stadium. Energetic and urgent, "
    "projecting his voice over the crowd, fast and punchy, with rising excitement."
)


def main():
    model = load_model(MODEL)
    parts = list(model.generate_voice_design(text=LINE, instruct=VOICE, language="English"))
    audio = np.concatenate([np.asarray(p.audio, dtype=np.float32).reshape(-1) for p in parts])
    sf.write(OUT, audio, parts[0].sample_rate)
    print(f"wrote {os.path.relpath(OUT, ROOT)}, {len(audio) / parts[0].sample_rate:.1f} s")


if __name__ == "__main__":
    main()
