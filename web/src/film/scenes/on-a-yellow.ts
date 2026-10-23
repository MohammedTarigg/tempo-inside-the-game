// The film's fourth feature, On a yellow: beside the booked player, the model's score rising to where his card lights.
import { $, el, outCubic } from '../../shared/util.ts';
import type { Pt } from '../../shared/stage.ts';
import type { Chip } from '../furniture.ts';
import type { FilmCtx, Scene } from '../film.ts';

// Beside the booked player, the model's score rises to the two lines where his card turns on and then lights.
// The card lights SCORE.lit beats in, where the music comes back after two beats of nothing.
export function onAYellow(ctx: FilmCtx): Scene {
  const { api, M, FPS, DIR, SCORE, D, lit, booked, stakeMeta, glide, onPlayer, onBall, caption, look } = ctx;
  const pins = $('pins'),
    gauge = el('div', 'pin tgauge', pins);
  gauge.innerHTML = '<i></i><u></u><u></u>';
  const TOP = 0.4,
    notch = gauge.querySelectorAll('u');
  notch[0]!.style.bottom = `${(M.stake.faint / TOP) * 100}%`;
  notch[1]!.style.bottom = `${(M.stake.full / TOP) * 100}%`;
  // the opponents nearest to player i, closest first
  const nearest = (i: number, n = 1) => {
    const p = api.pos(api.getF(), i);
    if (!p) return [];
    return M.ids
      .map((_, j) => j)
      .filter((j) => j !== i && M.team[j] !== M.team[i])
      .map((j): [number, Pt | null] => [j, api.pos(api.getF(), j)])
      .filter((x): x is [number, Pt] => !!x[1])
      .sort((a, c) => Math.hypot(a[1][0] - p[0], a[1][1] - p[1]) - Math.hypot(c[1][0] - p[0], c[1][1] - p[1]))
      .slice(0, n)
      .map((x) => x[0]);
  };

  // the model's score as the gauge shows it, eased towards the real one, and when the gauge first stood up beside him
  let chance = 0,
    stood = -1;
  return {
    dur: D[3]!,
    enter() {
      const f = lit ?? api.frameAtClock(50 * 60);
      glide(
        f - SCORE.lit * SCORE.beat * 0.75 * FPS,
        0.75,
        booked >= 0 ? onPlayer(booked) : onBall(),
        booked >= 0 ? new Set([booked]) : null,
        0.3,
      );
      chance = 0;
      stood = -1; // the same player as the feature before, so the camera stays with him
      {
        // how often the card was already on a booked player at the moment he made a challenge, on real matches the model had never seen
        const hit = Math.round(stakeMeta.metrics.faint_on_at_contact * 100),
          chips: Chip[] = [
            ['model', 'Machine learning model'],
            ['target', `Caught ${hit} in 100 tackles in real matches`],
          ];
        caption('4', 'On a yellow', 'His card lights before the tackle', chips);
      }
    },
    update() {
      if (DIR.blend) {
        // still on the way here: the gauge waits until the picture has arrived
        gauge.style.opacity = '0';
        stood = -1;
        return;
      }
      const p = booked >= 0 ? api.pos(api.getF(), booked) : null;
      if (!p) {
        gauge.style.opacity = '0';
        return;
      }
      DIR.focus = new Set([booked, ...nearest(booked, 1)]); // him and the man he is closing on
      const [, c] = api.levelAt(booked, api.getF());
      chance += (c - chance) * 0.12;
      gauge.querySelector('i')!.style.height = `${Math.min(100, (chance / TOP) * 100)}%`;
      const xy = api.project(p[0] + 2.6, 0, -p[1]);
      gauge.style.opacity = '1';
      // it rises up out of his shoulder like the card it stands for, before its fill starts to climb
      if (stood < 0) stood = performance.now();
      const rise = outCubic(Math.min(1, (performance.now() - stood) / 450));
      gauge.style.setProperty('--rise', rise.toFixed(3));
      if (rise < 1) chance = 0;
      // it stands to his right, clear of his name tag: where the tag reaches further right, the gauge stands past it
      let gx = xy[0];
      const tag = [...pins.querySelectorAll<HTMLElement>('.pin.name')].find(
        (t) => t.textContent?.startsWith(ctx.name(M.ids[booked]!)) && Number(t.style.opacity || 0) > 0.05,
      );
      if (tag) {
        const box = pins.getBoundingClientRect(),
          k = box.width / (pins.clientWidth || 1),
          r = tag.getBoundingClientRect(),
          top = (r.top - box.top) / k,
          bottom = (r.bottom - box.top) / k,
          gy = xy[1] - 34;
        if (bottom > gy - 6 && top < gy + 74) gx = Math.max(gx, (r.right - box.left) / k + 12);
      }
      gauge.style.transform = `translate(${gx}px, ${xy[1] - 34}px)`;
      look(xy);
    },
    exit() {
      gauge.style.opacity = '0';
    },
  };
}
