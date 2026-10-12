// The film's fifth feature, Déjà vu: the replay view itself, in a frame, faded in over a picture that already matches it.
import { el } from '#util';
import { startLead, runnerCamera } from '#replay/start';

// The replay. One attempt at a time: the picture stops at the start of the goal, the clock winds back and the earlier
// attempt plays alone, then it rewinds and the goal plays alone, past two outlined markers left where the earlier one
// ended. Both at once was too much to follow. The film's own scoreboard shows which minute is on screen.
export function dejaVu(ctx) {
  const { api, M, DIR, D, REPLAY, scene, index, wrap, glide, onBall, caption, look } = ctx;
  // the replay's frame, while it is on screen
  let frame = null;
  return {
    dur: D[4],
    enter() {
      // The bridge. The replay opens on the moment the scorer sets off, framed on him. The film goes to that same frame and
      // that same framing in one move, holds, and the replay fades in over a picture that is already identical.
      const G = REPLAY && REPLAY.clips.goal,
        E = REPLAY && REPLAY.clips.earlier;
      let turn = 1;
      if (G && E) {
        const sc = REPLAY.ids.indexOf(REPLAY.scorer),
          si = index(REPLAY.scorer),
          base = api.frameAtClock(G.clock);
        // the frame the replay itself opens on
        const f = base + G.start_offset + startLead(G, E, sc);
        const shot = api.pos(base + G.shot_offset, si) || [1, 0],
          q = api.pos(f, si) || [0, 0],
          dir = Math.sign(shot[0] - q[0]) || 1;
        turn = Math.sign((shot[0] - q[0]) * (G.pos[G.shot_offset][sc][0] - G.pos[G.start_offset][sc][0])) || 1; // the clips are stored turned one way; the film shows the pitch as it was played
        glide(f, 0, (wantPos, wantAim) => runnerCamera(wantPos, wantAim, q, dir), null, 0);
      } else if (scene) glide(scene.frame, 0, onBall(46, 44), null, 0);
      look([wrap.clientWidth / 2, wrap.clientHeight / 2]);
      frame = el('iframe', 'tframe', wrap);
      frame.src = `../replay/index.html?turn=${turn}&wait=0.7&bare=1`;
      frame.title = 'Replay of the closest earlier attempt';
      {
        const f = frame,
          t1 = performance.now();
        f.addEventListener('load', () =>
          setTimeout(
            () => {
              if (frame === f) {
                f.classList.add('on');
                document.body.classList.add('treplay');
              }
            },
            Math.max(350, 1250 - (performance.now() - t1)),
          ),
        );
      } // once it has drawn, and not before the film has arrived
      this.heard = (e) => {
        if (e.origin === location.origin && e.data && e.data.tempoReplay && frame && frame.classList.contains('on')) {
          DIR.clock = e.data.tempoReplay.clock;
          const g = M.goals[M.goals.length - 1];
          DIR.score = e.data.tempoReplay.scored && g ? g.score : null;
        }
      };
      addEventListener('message', this.heard);
      caption('5', 'Déjà vu', 'Same move. One thing changed', [['twin', 'Found in this match']]);
    },
    exit() {
      removeEventListener('message', this.heard);
      DIR.clock = null;
      DIR.score = null;
      document.body.classList.remove('treplay');
      if (frame) {
        const f = frame;
        f.classList.remove('on');
        setTimeout(() => f.remove(), 700);
        frame = null;
      }
    },
  };
}
