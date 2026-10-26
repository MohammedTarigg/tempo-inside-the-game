// The film's fifth feature, Yours: one match, a layer for each viewer.
import { el, seg, smooth, upper } from '../../shared/util.ts';
import type { PhoneSentenceCue } from '../../types/run.ts';
import type { FilmCtx, Scene } from '../film.ts';

// The moment On a yellow ends on, Skoles just booked, as two viewers have it. The first watches everyone, in English: the
// phone's line about the booking. A white rule sweeps across the picture and behind it is the second viewer, who follows
// Skoles, in Arabic: the picture keeps only him bright, his own running numbers, and the same line in Arabic. The players
// never stop moving underneath: the match is one, the layer is each viewer's.
export function yours(ctx: FilmCtx): Scene {
  const { api, M, FPS, DIR, D, booked, lit, name, wrap, cut, onPlayer, caption, look } = ctx;
  const rule = el('i', 'trule', wrap),
    viewers = [el('div', 'tviewer', wrap), el('div', 'tviewer', wrap)];
  const say = (lang: string, f: number) =>
    [...M.cues]
      .reverse()
      .find(
        (c): c is PhoneSentenceCue =>
          c.form === 'sentence' && c.screen === 'phone' && c.payload.lang === lang && c.frame <= f + 1,
      );
  let builtAt = -1e9;
  function build(f: number) {
    builtAt = f;
    const who = M.ids[booked]!,
      L = M.ledgers,
      k = Math.max(0, upper(L.frames, f) - 1),
      [made = 0, tried = 0] = L.passes[k]?.[booked] ?? [];
    // the first viewer: everyone, in English
    viewers[0]!.innerHTML = `<p class="tprefs"><b>English</b><span lang="ar">عربي</span><i></i><b>Everyone</b><span>${M.home.short}</span><span>${M.away.short}</span></p>`;
    el('p', 'tsaid', viewers[0]!, say('en', f)?.payload.text ?? '');
    // the second: following him, in Arabic, so all of it is Arabic and reads right to left: the choices, his card and the line, with his name kept as it is
    viewers[1]!.dir = 'rtl';
    viewers[1]!.lang = 'ar';
    viewers[1]!.innerHTML = `<p class="tprefs"><span lang="en">English</span><b>عربي</b><i></i><span>الجميع</span><b lang="en">${name(who)} ${M.numbers[booked]}</b></p>`;
    const card = el('div', 'tfollow', viewers[1]!);
    card.style.setProperty('--team', `var(--${M.team[booked] ? 'away' : 'home'})`);
    card.innerHTML = `<span class="disc">${M.numbers[booked]}</span><b lang="en">${name(who)}</b><dl><div><dt>المسافة</dt><dd>${(L.dist[k]![booked]! / 1000).toFixed(1)} كم</dd></div><div><dt>السرعة القصوى</dt><dd>${(L.top[k]![booked]! * 3.6).toFixed(1)} كم/س</dd></div><div><dt>التمريرات</dt><dd>${made} من ${tried}</dd></div></dl>`;
    const ar = el('p', 'tsaid', viewers[1]!, say('ar', f)?.payload.text ?? '');
    ar.dir = 'rtl';
  }
  return {
    dur: D[4]!,
    enter() {
      // played through, the picture is already at his card from On a yellow; opened here, go there
      const at = (lit ?? api.getF()) + 2 * FPS;
      if (Math.abs(api.getF() - at) > 20 * FPS) cut(at, 0.75, onPlayer(booked), new Set([booked]));
      build(api.getF());
      caption('5', 'Yours', 'One match, a layer for each viewer', [
        ['target', 'Follow a club or a player'],
        ['speech', 'English and Arabic'],
      ]);
    },
    update(u) {
      // built from the match as it stands, and again if the picture has moved on before the rule crosses
      if (u < 0.4 && Math.abs(api.getF() - builtAt) > api.FPS) build(api.getF());
      // the rule crosses from right to left between 0.42 and 0.58; what is left of it is the first viewer's, right of it
      // the second's
      const W = wrap.clientWidth,
        on = smooth(seg(u, 0.04, 0.12)) * (1 - smooth(seg(u, 0.93, 0.99))),
        x = W * (1 - smooth(seg(u, 0.42, 0.58)));
      rule.style.transform = `translateX(${x}px)`;
      rule.style.opacity = String(u > 0.4 && u < 0.6 ? 1 : 0);
      viewers[0]!.style.clipPath = `inset(-20px calc(100% - ${x - viewers[0]!.offsetLeft}px + 0px) -20px -20px)`;
      viewers[1]!.style.clipPath = `inset(-20px -20px -20px ${x - viewers[1]!.offsetLeft}px)`;
      viewers.forEach((v) => (v.style.opacity = String(on)));
      DIR.focus = x < api.project(api.pos(api.getF(), booked)?.[0] ?? 0, 0, 0)[0] ? new Set([booked]) : null;
      const p = api.pos(api.getF(), booked);
      if (p) look(api.project(p[0], 0, -p[1]));
    },
    exit() {
      DIR.focus = null;
      viewers.forEach((v) => (v.style.opacity = '0'));
      rule.style.opacity = '0';
    },
  };
}
