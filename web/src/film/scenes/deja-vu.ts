// The film's fifth feature, Déjà vu: the replay view itself, in a frame, faded in over a picture that already matches it.
import { el } from '../../shared/util.ts';
import { startLead, runnerCamera } from '../../replay/start.ts';
import type { FilmCtx, Scene } from '../film.ts';

// The replay. One attempt at a time: the picture stops at the start of the goal, the clock winds back and the earlier
// attempt plays alone, then it rewinds and the goal plays alone, past two outlined markers left where the earlier one
// ended. Both at once was too much to follow. The film's own scoreboard shows which minute is on screen.
export function dejaVu(ctx: FilmCtx): Scene {
  const { api, M, DIR, D, REPLAY, scene, index, wrap, glide, onBall, caption, look, shut } = ctx;
  // the replay's frame, while it is on screen, and the point on the picture it opens out of and closes back into
  let frame: HTMLIFrameElement | null = null,
    from: () => readonly [number, number] = () => [wrap.clientWidth / 2, wrap.clientHeight / 2];
  // the ring of the opening, the eye's own ring, which grows out of that point with the replay inside it
  const iris = (on: boolean) => {
    const [x, y] = from(),
      ring = el('i', `tiris ${on ? 'open' : 'shut'}`, wrap);
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    setTimeout(() => ring.remove(), 1200);
    frame?.style.setProperty('--ox', `${x}px`);
    frame?.style.setProperty('--oy', `${y}px`);
  };
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
      // that same framing in one move, holds, and the replay fades in over a picture that is already identical.
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
        from = () => {
          const p = api.pos(api.getF(), si) ?? q,
            xy = api.project(p[0], 0, -p[1]);
          return [xy[0], xy[1]];
        }; // the runner the replay is about
        glide(f, 0, (wantPos, wantAim) => runnerCamera(wantPos, wantAim, q, dir), null, 0);
      } else if (scene) glide(scene.frame, 0, onBall(46, 44), null, 0);
      look([wrap.clientWidth / 2, wrap.clientHeight / 2]);
      frame = el('iframe', 'tframe', wrap);
      frame.src = `/replay/?turn=${turn}&wait=0.7&bare=1`;
      frame.title = 'Replay of the closest earlier attempt';
      {
        const f = frame,
          t1 = performance.now();
        f.addEventListener('load', () =>
          setTimeout(
            () => {
              if (frame === f) {
                iris(true);
                f.classList.add('on');
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
        iris(false);
        f.classList.remove('on');
        setTimeout(() => f.remove(), 700);
        frame = null;
      }
    },
  };
}
