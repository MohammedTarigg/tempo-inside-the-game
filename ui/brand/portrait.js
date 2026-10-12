// A drawn portrait for a fictional player: head, hair, neck and shoulders in his club's shirt. Nobody real is pictured.
// Every part is built from a few numbers taken from the player's id, so each player gets his own face and keeps it.
// Flat, solid shapes with no see-through layers: greys for the person, the club's colour for the shirt.
const SKIN = [['#F0F0F0', '#D3D3D3'], ['#D9D9D9', '#BABABA'], ['#B4B4B4', '#969696'], ['#8A8A8A', '#707070']];     // face, then the shaded side of it
const HAIR = ['#111111', '#2B2B2B', '#5C5C5C', '#F5F5F5'];

function seeded(text) {                                                          // a small repeatable generator from a string
  let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
const n = (x) => x.toFixed(1);

export function portrait(id, shirt = '#FF8A3D') {
  const r = seeded(id), pick = (k) => Math.floor(r() * k);
  const s = pick(SKIN.length), [tone, shade] = SKIN[s];
  const hair = HAIR[s === 3 ? [0, 0, 3][pick(3)] : s === 2 ? [0, 1, 3][pick(3)] : pick(3)];      // hair always stands clear of the skin
  const cx = 60, cy = 56, rx = 22.5 + r() * 3, ry = 28 + r() * 3, jaw = 0.74 + r() * 0.12, top = cy - ry;
  const style = pick(5), beard = r() < 0.28 && style !== 3;
  // the head: a smooth skull that narrows to the chin
  const head = `M${n(cx - rx)},${cy - 3} C${n(cx - rx)},${n(top - 3)} ${n(cx + rx)},${n(top - 3)} ${n(cx + rx)},${cy - 3} C${n(cx + rx)},${n(cy + ry * 0.5)} ${n(cx + rx * jaw)},${n(cy + ry)} ${cx},${n(cy + ry)} C${n(cx - rx * jaw)},${n(cy + ry)} ${n(cx - rx)},${n(cy + ry * 0.5)} ${n(cx - rx)},${cy - 3} Z`;
  // hair is one solid shape: an outer line over the skull and a hairline across the forehead
  const outer = (lift, side) => `M${n(cx - rx - 1.5)},${n(cy - 4 + side)} C${n(cx - rx - 3)},${n(top - 8 - lift)} ${n(cx + rx + 3)},${n(top - 8 - lift)} ${n(cx + rx + 1.5)},${n(cy - 4 + side)}`;
  const line = (dip) => `C${n(cx + rx - 3)},${n(top + 10 - dip)} ${n(cx + 6)},${n(top + 9)} ${cx},${n(top + 9 + dip * 0.4)} C${n(cx - 6)},${n(top + 9)} ${n(cx - rx + 3)},${n(top + 10 - dip)} ${n(cx - rx - 1.5)},`;
  const mop = (lift, side, dip) => `<path d="${outer(lift, side)} ${line(dip)}${n(cy - 4 + side)} Z" fill="${hair}"/>`;
  const hairs = [
    mop(0, 0, 0),                                                                                              // short back and sides
    mop(4, 2, 0) + `<path d="M${n(cx - rx + 2)},${n(top + 11)} C${n(cx - 8)},${n(top - 1)} ${n(cx + 10)},${n(top)} ${n(cx + rx - 1)},${n(top + 13)} C${n(cx + 8)},${n(top + 6)} ${n(cx - 4)},${n(top + 7)} ${n(cx - rx + 2)},${n(top + 11)} Z" fill="${hair}"/>`,      // swept fringe
    mop(-4, -5, 3),                                                                                            // cropped close, with a widow's peak
    Array.from({ length: 8 }, (_, i) => { const a = Math.PI * (1.1 + 0.8 * i / 7); return `<circle cx="${n(cx + Math.cos(a) * (rx + 1.5))}" cy="${n(cy - 7 + Math.sin(a) * (ry - 2))}" r="8" fill="${hair}"/>`; }).join('') + mop(1, 1, 0),      // curls
    '',                                                                                                        // shaved
  ][style];
  const eyeY = cy + 2, eyeX = rx * 0.43, browY = eyeY - 7.5, mouthY = cy + ry * 0.63, chinY = cy + ry;
  // a beard is a solid band along the jaw, its top edge passing under the mouth
  const stubble = hair === '#F5F5F5' ? '#5C5C5C' : hair;
  const face = beard ? `<path d="M${n(cx - rx)},${cy + 6} C${n(cx - rx)},${n(cy + ry * 0.5)} ${n(cx - rx * jaw)},${n(chinY)} ${cx},${n(chinY)} C${n(cx + rx * jaw)},${n(chinY)} ${n(cx + rx)},${n(cy + ry * 0.5)} ${n(cx + rx)},${cy + 6} C${n(cx + rx - 3)},${n(mouthY + 1)} ${n(cx + 11)},${n(mouthY + 6.5)} ${cx},${n(mouthY + 6.5)} C${n(cx - 11)},${n(mouthY + 6.5)} ${n(cx - rx + 3)},${n(mouthY + 1)} ${n(cx - rx)},${cy + 6} Z" fill="${stubble}"/>` : '';
  const ink = beard && hair === '#F5F5F5' ? '#111' : '#111';
  return `<svg viewBox="0 0 120 132" role="img" aria-label="Drawn portrait of a fictional player">
  <path d="M4,140 C4,110 24,100 45,95 L75,95 C96,100 116,110 116,140 Z" fill="${shirt}"/>
  <path d="M45,95 C49,106 71,106 75,95 L71,93.500 C67,101 53,101 49,93.500 Z" fill="#111"/>
  <path d="M51,${n(chinY - 9)} L51,96 C54,103 66,103 69,96 L69,${n(chinY - 9)} Z" fill="${shade}"/>
  <ellipse cx="${n(cx - rx + 0.5)}" cy="${cy + 3}" rx="4.2" ry="6.8" fill="${shade}"/><ellipse cx="${n(cx + rx - 0.5)}" cy="${cy + 3}" rx="4.2" ry="6.8" fill="${shade}"/>
  <path d="${head}" fill="${tone}"/>
  ${face}${hairs}
  <ellipse cx="${n(cx - eyeX)}" cy="${eyeY}" rx="2.5" ry="2.9" fill="${ink}"/><ellipse cx="${n(cx + eyeX)}" cy="${eyeY}" rx="2.5" ry="2.9" fill="${ink}"/>
  <path d="M${n(cx - eyeX - 5.2)},${n(browY + 0.6)} Q${n(cx - eyeX)},${n(browY - 1.6)} ${n(cx - eyeX + 4.8)},${n(browY)} M${n(cx + eyeX - 4.8)},${n(browY)} Q${n(cx + eyeX)},${n(browY - 1.6)} ${n(cx + eyeX + 5.2)},${n(browY + 0.6)}" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>
  <path d="M${cx},${n(eyeY + 5)} Q${n(cx - 3.4)},${n(eyeY + 12.5)} ${n(cx + 1.6)},${n(eyeY + 13)}" fill="none" stroke="${shade}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M${n(cx - 6)},${n(mouthY)} Q${cx},${n(mouthY + 2.6)} ${n(cx + 6)},${n(mouthY)}" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round"/>
</svg>`;
}
