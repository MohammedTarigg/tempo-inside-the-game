# Credits

## Data

- **DFL open tracking and event data.** Bassek, M., Rein, R., Weber, H., Memmert, D. (2025). An integrated dataset of spatiotemporal and event data in elite soccer. Seven Bundesliga matches, CC BY 4.0. https://doi.org/10.6084/m9.figshare.28196177. Used only to train and evaluate the stake model and to check the generator against real football. Nothing from it is shown on screen. `uv run tempo data` downloads it from the source and checks every file.
- **Field names** for the event and tracking shapes follow the open-source kloppy parsers (BSD 3-Clause). https://github.com/PySport/kloppy

## Sound

- **Music:** "With You" by Soft and Furious, from "The Man I'm Not", Free Music Archive, CC0 1.0 (shown on its page when downloaded on 12 October 2026). https://freemusicarchive.org/music/Soft_and_Furious/The_Man_Im_Not/Soft_And_Furious_-_The_Man_Im_Not_-_03_With_You/
- **Crowd:** "CRWDReac-SOCCER Millerntor Stadium Crowd Reaction Mood Waves 01" by itmightgetloud, Freesound 829456, CC0 1.0. https://freesound.org/people/itmightgetloud/sounds/829456/. `assets/audio/crowd.mp3` is the 128 kbit preview the site serves without an account. Only the steady in-play stretch from 154 seconds is used, so there is no goal cheer.
- **Commentator:** `assets/audio/commentator.wav` is not a person. It was made with Qwen3-TTS VoiceDesign (Apache 2.0, run locally through mlx-audio), which builds a voice from a written description: a British football commentator, energetic, projecting over a crowd. No recording of a real commentator was used. `tools/commentator_voice.py` makes it again.

`tools/film_music.py` cuts the music to the film, lays the crowd and the commentator under it, and writes `web/public/audio/tempo-theme.m4a` with its timings.

## Software and type

- three.js (MIT), Vite (MIT), TypeScript (Apache 2.0), Playwright (Apache 2.0), Bun (MIT)
- PyTorch (BSD 3-Clause), NumPy (BSD 3-Clause)
- Hanken Grotesk and Noto Sans Arabic (SIL Open Font License 1.1), through Fontsource

## The clubs and players

Northgate, Harbour City and every player in the demo match are invented. The portraits are drawn from numbers, not from anyone's likeness.
