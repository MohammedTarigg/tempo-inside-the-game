// The film's last scene, the close: the mark erases the word and is left alone in the middle.
import { MARK } from '../../brand/intro.ts';
import { seg, inOutCubic } from '../../shared/util.ts';
import type { FilmCtx, Scene } from '../film.ts';

// The logo comes to the centre. The eye turns to the word, the mark slides across it and the letters are gone behind it. It
// looks back at where they were, comes to the middle alone, and then looks straight out, blinks once, slowly, and stays.
// The word is erased by the mark itself and by nothing else. The ring is filled black for this scene, so each letter
// goes under it as its leading edge arrives, and what has gone under does not come out the other side: the word fades
// out across the mark's own width. Before, a straight invisible edge ran ahead of the mark and wiped the letters like
// a block. The limbs are soft tails here (intro.ts): they trail as it crosses the word and whip back when it stops.
export function close(ctx: FilmCtx): Scene {
  const { D, side, veil, logo, look } = ctx;
  let was: number | undefined;
  return {
    dur: D[7]!,
    enter() {
      side.classList.remove('on');
      veil.classList.add('on', 'black');
      logo.classList.add('centre');
      look(null);
      if (ctx.art) ctx.art.ring.setAttribute('fill', '#000');
    },
    update(u) {
      // the logo's parts are made after this feature is built, so they are read here and not at the top
      const { art, eye, eyeAt } = ctx;
      if (!art || !eye) return;
      const t = u * 7.5,
        [x0 = 0, y0 = 0, reach = 0] = eyeAt;
      const over = inOutCubic(seg(t, 1.7, 3.1)),
        home = inOutCubic(seg(t, 3.9, 4.9));
      const far = art.end + MARK.RO,
        x = x0 + (far - x0) * over + (art.mid - far) * home; // out along the word and a ring's width past its last letter, so nothing of it is left, then back to the middle
      // alone at the end it floats a little, straight up and down. At rest the tails stay upright: they bend only when it moves
      const alone = inOutCubic(seg(t, 4.7, 5.6)),
        y = y0 + alone * 2.2 * Math.sin(t * 2.1),
        dt = was === undefined ? 0 : ((t - was) * D[7]!) / 7.5;
      was = t;
      const [dTop, dBot] = art.tails.step(x, y, MARK.STUB, dt);
      art.ring.setAttribute('cx', String(x));
      art.ring.setAttribute('cy', String(y));
      art.limbs[0]?.setAttribute('d', dTop);
      art.limbs[1]?.setAttribute('d', dBot);
      const gone = over > 0 ? x0 + (far - x0) * over : -1e4;
      art.fade.setAttribute('x1', String(gone - MARK.RO * 0.9));
      art.fade.setAttribute('x2', String(gone + MARK.RO * 0.15)); // the word is gone behind the mark, and stays gone when the mark comes back
      // the eye: straight ahead while the logo comes down to the middle, as the logo is; then it turns to the word just before
      // it sets off across it, looks back at the gap it left, and ends dead ahead, wider, with one slow blink and a small start
      const side2 =
        t < 3.25
          ? inOutCubic(seg(t, 1.05, 1.6))
          : t < 4.0
            ? 1 - 2 * inOutCubic(seg(t, 3.25, 3.6))
            : -1 + inOutCubic(seg(t, 4.0, 4.9));
      const wide = 1 + 0.08 * inOutCubic(seg(t, 4.9, 5.5)),
        blink = Math.max(0, 1 - Math.abs(t - 5.95) / 0.22),
        start = t > 6.5 && t < 6.62 ? 2.2 : 0;
      eye.setAttribute('cx', String(x + side2 * reach + start));
      eye.setAttribute('cy', String(y));
      eye.setAttribute('rx', String(art.rx * wide));
      eye.setAttribute('ry', String(art.rx * wide * (1 - 0.94 * blink)));
    },
  };
}
