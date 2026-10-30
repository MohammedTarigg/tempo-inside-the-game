// The film's sixth feature, Déjà vu: the replay view itself, in a frame, put in behind a blink of the eye.
import { site, el } from '../../shared/util.ts';
import { startLead, runnerCamera } from '../../replay/start.ts';
import type { FilmCtx, Scene } from '../film.ts';

// The replay. One attempt at a time: the picture stops at the start of the goal, the clock winds back and the earlier
// attempt plays alone, then it rewinds and the goal plays alone, past two outlined markers left where the earlier one
// ended. Both at once was too much to follow. The film's own scoreboard shows which minute is on screen.
export function dejaVu(ctx: FilmCtx): Scene {
  const { api, M, DIR, D, REPLAY, scene, index, wrap, glide, onBall, caption, look, shut, lids } = ctx;
  // the replay's frame, while it is on screen
  let frame: HTMLIFrameElement | null = null;
  // what the replay says about itself while it plays: the clock it is showing, and whether the goal has gone in
  const heard = (e: MessageEvent<{ tempoReplay?: { clock: number; scored: boolean } }>) => {
    const said = e.data?.tempoReplay;
    if (e.origin === location.origin && said && frame && frame.classList.contains('on')) {
      DIR.clock = said.clock;
      const g = M.goals[M.goals.length - 1];
      DIR.score = said.scored && g ? g.score : null;
    }
  };
  return {
    dur: D[5]!,
    enter() {
      // The bridge. The replay opens on the moment the scorer sets off, framed on him. The film goes to that same frame and
      // close framing in one move, holds, and the replay is put in behind a blink.
      const G = REPLAY?.clips.goal,
        E = REPLAY?.clips.earlier;
      let turn = 1;
      if (REPLAY && G && E) {
        const sc = REPLAY.ids.indexOf(REPLAY.scorer),
          si = index(REPLAY.scorer),
          base = api.frameAtClock(G.clock);
        // the frame the replay itself opens on
        const f = base + G.start_offset + startLead(G, E, sc);
        const shot = api.pos(base + G.shot_offset, si) || [1, 0],
          q = api.pos(f, si) ?? ([0, 0] as const),
          dir = Math.sign(shot[0] - q[0]) || 1;
        const stored = (G.pos[G.shot_offset]?.[sc]?.[0] ?? 0) - (G.pos[G.start_offset]?.[sc]?.[0] ?? 0);
        turn = Math.sign((shot[0] - q[0]) * stored) || 1; // the clips are stored turned one way; the film shows the pitch as it was played

        glide(f, 0, (wantPos, wantAim) => runnerCamera(wantPos, wantAim, q, dir), null, 0);
      } else if (scene) glide(scene.frame, 0, onBall(46, 44), null, 0);
      look([wrap.clientWidth / 2, wrap.clientHeight / 2]);
      frame = el('iframe', 'tframe', wrap);
      frame.src = site(`replay/?turn=${turn}&wait=0.7&bare=1`);
      frame.title = 'Replay of the closest earlier attempt';
      {
        const f = frame,
          t1 = performance.now();
        f.addEventListener('load', () =>
          setTimeout(
            () => {
              if (frame === f) {
                // the replay's camera is not quite the film's, so it is not dissolved over it: the eye blinks, the
                // replay is put in while it is shut, and it opens on the replay
                lids(true);
                setTimeout(() => {
                  if (frame !== f) return;
                  f.classList.add('on');
                  setTimeout(() => lids(false), 60);
                }, 240);
                document.body.classList.add('treplay');
              }
            },
            Math.max(350, 1250 - (performance.now() - t1)),
          ),
        );
      } // once it has drawn, and not before the film has arrived
      addEventListener('message', heard);
      caption('6', 'Déjà vu', 'Same move. One thing changed', [['twin', 'Found in this match']]);
    },
    exit() {
      removeEventListener('message', heard);
      DIR.clock = null;
      DIR.score = null;
      document.body.classList.remove('treplay');
      if (frame && shut()) {
        frame.remove(); // the eye is shut over the cut: it goes unseen, behind the lids
        frame = null;
      } else if (frame) {
        const f = frame;
        f.classList.remove('on');
        setTimeout(() => f.remove(), 700);
        frame = null;
      }
    },
  };
}
