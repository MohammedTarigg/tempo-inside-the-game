// The film's second feature, Thunderbolt: a shot hit harder than almost any other, and the line that shows how rare.

// A hard shot. Under the player, a short line: the season's usual, where rare begins, and a dot that runs out past both.
// In the demo match this is the attempt the replay comes back to later.
// The shot is struck SCORE.strike beats in, where the music comes back after its rest.
export function thunderbolt(ctx) {
  const { api, FPS, SCORE, D, rare, strike, index, glide, onPlayer, caption, look } = ctx;
  return {
    dur: D[1],
    enter() {
      const i = rare ? index(rare.payload.player) : 0;
      this.i = i;
      glide(
        (strike ? strike.frame : rare ? rare.start : api.frameAtClock(12 * 60)) - SCORE.strike * SCORE.beat * 0.6 * FPS,
        0.6,
        onPlayer(i, 40, 32),
        new Set([i]),
      );
      caption('2', 'Thunderbolt', 'Faster than almost every shot', [['rules', 'Shown only when rare']]);
    },
    update() {
      const p = api.pos(api.getF(), this.i);
      if (p) look(api.project(p[0], 0, -p[1]));
    },
  };
}
