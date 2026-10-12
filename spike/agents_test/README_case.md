# One match, one question

This folder holds one synthetic football match between Northgate (`t_nor`, home) and Harbour City (`t_har`, away).

**The question.** A goal was scored in minute {MIN} (at {T} seconds on the match clock). Is there a specific, checkable reason in this data why that goal went in: something one defender, or the defending team, did differently from what he or they usually do, or did earlier in this match? Or was it an ordinary goal with no clear cause? Football is noisy. "No clear cause" is a valid answer and is the right one when nothing stands out strongly.

## Files

- `events.csv`: one row per event. `time_s` is the match clock in seconds. `type` is one of pass, take_on, foul, out, corner, tackle, interception, save, clearance, miss, attempt_saved, goal, card, challenge, ball_recovery, start, end. For a tackle or challenge the row's player is the defender; `outcome` 1 means he won it. For a foul, `outcome` 0 is the player who committed it. `x`, `y` run 0 to 100 in the attacking direction of the event's team. `card` is filled on card events.
- `tracking.npz` (numpy): `pos` is (frames, 22, 2) in metres from the centre spot, 5 frames a second, NaN when a player is off. `ball` is (frames, 3): x, y, height. `clock` is seconds, `period` is 1 or 2, `live` says whether the ball is in play, `poss` is the team index in possession (0 home, 1 away, -1 nobody), `home_dir` is +1 when the home team attacks towards positive x.
- `meta.json`: `player_ids` in the order of the `pos` axis, `names`, `numbers`, `team_index` (0 home, 1 away), `keepers` (indices), and the goal's time.

## What to hand in

Write `verdict.json` in this folder with exactly these fields:

```json
{
  "cause_type": "player_held_off | player_out_of_position | team_shape | set_piece | individual_skill | no_clear_cause | other",
  "player_id": "the one defending player most responsible, or null",
  "one_sentence": "a plain sentence a TV viewer could read",
  "evidence": ["2 to 5 short strings, each with a number you computed or read"],
  "alternatives_ruled_out": ["short strings"],
  "confidence": 0.0
}
```

Name a player only if the data supports it. Confidence is your own estimate from 0 to 1 that the cause you name is real.
