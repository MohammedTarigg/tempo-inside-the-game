
## Instruments

The folder `instruments/` holds what three specialist models have already published about this match. You may use them, check them against the raw data, or ignore them.

- `ghost_standoff.csv`: for every shot in the match, each defender who an average defender's model (a "ghost") would have had within 10 m of the ball in the six seconds before the shot, with how many metres further from the ball he was than his ghost at the worst moment. Positive means he stood off. For scale: across ordinary shots, the largest value at a shot has a median of {MED} m and a 90th percentile of {P90} m, so a value near those is not unusual by itself.
- `earlier_attempt.json`: whether an earlier attack in this match began very like the one that led to this goal and did not score, and if so which defender stood differently the second time and by how much.
- `ledger.csv`: for each player, his yellow card minute if he has one, his defending challenges per ten minutes before and after it, and his total for the match.
