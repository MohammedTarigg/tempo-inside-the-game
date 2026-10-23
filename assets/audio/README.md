# The film's music

"With You" by Soft and Furious, from the album "The Man I'm Not" on the Free Music Archive:
https://freemusicarchive.org/music/Soft_and_Furious/The_Man_Im_Not/Soft_And_Furious_-_The_Man_Im_Not_-_03_With_You/

The artist has dedicated it to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so
anyone can use, edit and publish it, with no credit required. The track's page showed "CC0 1.0 Universal" when it was
downloaded on 12 October 2026.

## The crowd

`crowd.mp3` is "CRWDReac-SOCCER Millerntor Stadium Crowd Reaction Mood Waves 01" by itmightgetloud, from Freesound:
https://freesound.org/people/itmightgetloud/sounds/829456/

It is also dedicated to the public domain under CC0 1.0 (shown on its page on 12 October 2026). The file here is the
128 kbit preview the site serves without an account; the 24-bit original needs a Freesound login. Only the steady in-play
stretch from 154 seconds is used, so there is no goal cheer.

## The commentator

`commentator.wav` is not a person. It was generated on 12 October 2026 with Qwen3-TTS VoiceDesign (Apache 2.0, run locally
through mlx-audio), which builds a voice from a written description: a British football commentator, energetic, projecting
over a crowd. No recording of a real commentator was used. `tools/commentator_voice.py` makes it again.

## Building

`uv run python tools/film_music.py` cuts `with-you.mp3` to the film and writes `web/public/audio/tempo-theme.m4a` with a `.json` of timings.
