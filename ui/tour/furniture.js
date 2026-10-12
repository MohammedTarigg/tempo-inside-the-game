// The film's own furniture, laid over the match view: the logo in the corner, the caption, the side panel, the veil, and
// the overlay that features draw on. Also the small shapes more than one feature draws.
import { softTails } from '#intro';
import { $, el, svgEl } from '#util';
import { ICON } from '#tour/icons';

// The caption's line when it is one of Tempo's calls: the words with a small mark in front, which is the same mark as the
// one on the pitch (an outline while the call is only something said, solid once it has happened), and then a tick.
export const callLine = (text) => {
  const sw = document.createElement('i');
  sw.className = 'tsw';
  const tk = document.createElement('i');
  tk.className = 'ttk';
  tk.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.8l5 5L19.5 7"/></svg>';
  return [sw, document.createTextNode(text), tk];
};

// the outline of a set of points on the screen
export const hull = (P) => {
  const q = [...P].sort((m, n) => m[0] - n[0] || m[1] - n[1]),
    cross = (o, m, n) => (m[0] - o[0]) * (n[1] - o[1]) - (m[1] - o[1]) * (n[0] - o[0]);
  const half = (pts) => {
    const h = [];
    for (const pt of pts) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], pt) <= 0) h.pop();
      h.push(pt);
    }
    h.pop();
    return h;
  };
  return [...half(q), ...half(q.reverse())];
};

// A goal as a box to be outlined: its frame on the goal line at x = gx (7.32 m wide, 2.44 m high) and its depth, gd metres
// behind and lower at the back. Each point is [x, y, height].
export const goalBox = (gx, gd) => [
  [gx, -3.66, 0],
  [gx, 3.66, 0],
  [gx, -3.66, 2.44],
  [gx, 3.66, 2.44],
  [gx + gd, -3.66, 0],
  [gx + gd, 3.66, 0],
  [gx + gd, -3.66, 1.6],
  [gx + gd, 3.66, 1.6],
];

export function makeFurniture() {
  const wrap = $('stagewrap');
  // The film is one 1280 by 720 frame, scaled to fit the window like a video, so it looks the same on any screen.
  const scale = () => document.body.style.setProperty('--k', Math.min(innerWidth / 1280, innerHeight / 720));
  addEventListener('resize', scale);
  scale();
  el('div', 'tscrim', wrap);
  const logo = el('div', 'tlogo', wrap); // filled with the intro's own finished drawing, so the two can never differ
  const cap = el('div', 'tcap', wrap),
    capNo = el('div', 'tno', cap),
    capBody = el('div', '', cap),
    capName = el('h2', '', capBody),
    capLine = el('p', '', capBody),
    capChips = el('div', 'tchips', capBody);
  const side = el('div', 'tside', wrap),
    veil = el('div', 'tveil', wrap),
    over = svgEl('svg', { class: 'tover', 'aria-hidden': 'true' }, wrap);
  let eye = null,
    eyeAt = [0, 0, 0],
    art = null;
  const look = (xy) => {
    // the logo's eye turns towards what is being shown
    if (!eye) return;
    const [ex, ey, reach] = eyeAt;
    if (!xy) {
      eye.setAttribute('cx', ex + reach);
      eye.setAttribute('cy', ey);
      return;
    }
    const dx = xy[0] - (logo.offsetLeft + 18),
      dy = xy[1] - (logo.offsetTop + 18),
      L = Math.hypot(dx, dy) || 1;
    eye.setAttribute('cx', ex + (dx / L) * reach);
    eye.setAttribute('cy', ey + (dy / L) * reach);
  };
  // The caption stays where it is from the first feature to the last. Between features its number, title and line change in
  // place: they fade out, the words are swapped, and they come back.
  let capUp = false;
  function caption(no, title, line, chips) {
    const fill = () => {
      capNo.textContent = no;
      capName.textContent = title;
      capLine.className = typeof line === 'string' ? '' : 'tcall';
      if (typeof line === 'string') capLine.textContent = line;
      else capLine.replaceChildren(...line);
      capChips.replaceChildren(
        ...chips.map(([icon, text, planned]) => {
          const c = document.createElement('span');
          c.className = planned ? 'planned' : '';
          c.innerHTML = ICON[icon];
          el('b', '', c, text);
          if (planned) el('em', '', c, 'planned');
          return c;
        }),
      );
    };
    if (!capUp || !cap.classList.contains('on')) {
      capUp = true;
      fill();
      cap.classList.remove('chg');
      void cap.offsetWidth;
      cap.classList.add('on');
      return;
    }
    cap.classList.add('chg');
    setTimeout(() => {
      fill();
      cap.classList.remove('chg');
    }, 250);
  }
  const panel = (html) => {
    side.innerHTML = html;
    side.classList.add('on');
  };
  const clearPanel = () => side.classList.remove('on');
  const swapCall = (text) => {
    capLine.classList.add('out');
    setTimeout(() => {
      capLine.replaceChildren(...callLine(text));
      capLine.className = 'tcall';
    }, 240);
  };
  // The corner logo is a copy of the intro's finished drawing, cut to the logo's own box, so the two can never differ. Takes
  // what playIntro resolved with and gives back the copy. It also keeps the logo's parts: the eye, for look(), and the rest
  // for the close, where the mark eats the word and is left alone.
  const adoptLogo = (fin) => {
    const copy = fin.svg.cloneNode(true),
      bx = fin.box;
    copy.setAttribute('viewBox', `${bx.x} ${bx.y} ${bx.w} ${bx.h}`);
    copy.removeAttribute('style');
    copy.style.opacity = 1;
    logo.replaceChildren(copy);
    eye = copy.querySelector('[data-eye]');
    eyeAt = fin.svg.dataset.eye.split(' ').map(Number);
    {
      // the parts of the logo, kept for the close, where the mark eats the word and is left alone
      const [ring] = copy.querySelectorAll('ellipse'),
        limbs = [...copy.querySelectorAll('[data-limb]')],
        texts = [...copy.querySelectorAll('text')];
      // the word fades out across the width of the mark as it passes, so no straight edge is ever seen, even on the tall letters
      const defs = svgEl('defs', {}, copy),
        fade = svgEl(
          'linearGradient',
          { id: 'twfade', gradientUnits: 'userSpaceOnUse', x1: -1e4, x2: -1e4 + 1, y1: 0, y2: 0 },
          defs,
        );
      svgEl('stop', { offset: 0, 'stop-color': '#000' }, fade);
      svgEl('stop', { offset: 1, 'stop-color': '#fff' }, fade);
      const mask = svgEl(
        'mask',
        {
          id: 'twipe',
          maskUnits: 'userSpaceOnUse',
          x: bx.x - 200,
          y: bx.y - 80,
          width: bx.w + 400,
          height: bx.h + 160,
        },
        defs,
      );
      svgEl('rect', { x: bx.x - 200, y: bx.y - 80, width: bx.w + 400, height: bx.h + 160, fill: 'url(#twfade)' }, mask);
      texts.forEach((t) => t.setAttribute('mask', 'url(#twipe)'));
      [ring, ...limbs, eye].forEach((n) => copy.appendChild(n));
      copy.style.overflow = 'visible'; // the mark is drawn over the word, so letters can go under it
      art = {
        ring,
        limbs,
        fade,
        tails: softTails(),
        rx: +eye.getAttribute('rx'),
        end: bx.x + bx.w,
        mid: bx.x + bx.w / 2,
      };
    }
    return copy;
  };
  return {
    wrap,
    logo,
    cap,
    capLine,
    side,
    veil,
    over,
    look,
    caption,
    swapCall,
    panel,
    clearPanel,
    adoptLogo,
    // these three are set by adoptLogo, after the features have been built: read them when they are needed, not before
    get eye() {
      return eye;
    },
    get eyeAt() {
      return eyeAt;
    },
    get art() {
      return art;
    },
  };
}
