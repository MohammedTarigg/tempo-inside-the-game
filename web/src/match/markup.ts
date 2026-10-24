// The match view's page: the picture with its scoreboard and plates, the match's strip under it edge to edge, and under
// that one row: the mark, the controls, the phone's words for this moment, and the viewer's choices. One definition, used
// by the match, the desk and the film, so the three pages cannot drift apart.

export const LOGO = `<svg class="logo" viewBox="0 0 120 120" width="34" height="34" aria-hidden="true"><circle cx="60" cy="60" r="27.5" fill="none" stroke="#fff" stroke-width="13"/><rect x="54.93" y="6" width="10.14" height="26.5" rx="5.07" fill="#fff"/><rect x="54.93" y="87.5" width="10.14" height="26.5" rx="5.07" fill="#fff"/><circle id="eye" cx="60" cy="60" r="13.2" fill="#fff"/></svg>`;

const PICTURE = `
  <div id="stagewrap">
    <div id="stage"></div>
    <div id="pins"></div>
    <div id="board">
      <span class="front">
        <span class="pill">
          <span class="side"><i class="cap"></i><b class="code" id="hs"></b><b class="goals" id="hg">0</b></span>
          <svg class="beye" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="#000" stroke="#fff" stroke-width="5"/><ellipse id="bspot" cx="20" cy="20" rx="6.8" ry="6.8" fill="#fff"/></svg>
          <span class="side"><b class="goals" id="ag">0</b><b class="code" id="as"></b><i class="cap"></i></span>
        </span>
        <p id="bsay"><i></i><span></span></p>
      </span>
      <span class="clock" id="clock">00:00</span>
    </div>
    <div id="replaytag"><b>Replay</b><a id="replaylink" href="/replay/">Watch the earlier attempt</a></div>
    <div id="counter"><p><span><b id="seen">0</b>events seen</span><span><b id="shown">0</b>shown</span></p><i><b id="sieve"></b></i></div>
    <div id="lower">
      <div id="kmhead" class="plate">Three things to watch, from the season so far</div>
      <div id="form" class="plate"><h3 id="fname"></h3><p id="fval"></p><div class="scale"><i class="mid"></i><i class="dot" id="fdot"></i></div><small>Middle mark is his usual distance a minute</small><q id="fheard"></q></div>
      <div id="label" class="plate"></div>
    </div>
    <div id="interval"><h2 id="ih"></h2><p id="ip"></p><div id="cards"></div></div>
  </div>
  <div id="strip">
    <div id="moment"></div>
    <div id="track" tabindex="0" role="slider" aria-label="Match position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><canvas id="mom"></canvas><div id="dwin"></div><div id="head"></div></div>
  </div>`;

// play, pause and again, and the arrows to the moments either side, as marks
export const ICONS = {
  Play: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 6 3.8z" fill="currentColor"/></svg>',
  Pause:
    '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="4.5" y="3.5" width="4" height="13" rx="1.2" fill="currentColor"/><rect x="11.5" y="3.5" width="4" height="13" rx="1.2" fill="currentColor"/></svg>',
  Replay:
    '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3.6 2.8v4.4H8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const PHONE = `
  <a id="brand" href="/" aria-label="Tempo">${LOGO}</a>
  <div id="controls"><button id="play" aria-label="Pause">${ICONS.Pause}</button><button id="speed" aria-label="Playback speed">1x</button><button id="prev" aria-label="Previous moment">${ICONS.prev}</button><button id="next" aria-label="Next moment">${ICONS.next}</button></div>
  <div id="story">
    <p id="psc" class="sr"></p>
    <div id="pfollow"><h3><b id="wnum"></b><span id="wwho"></span><i id="wbook"></i></h3><p id="wclub"></p><dl><div><dt>Distance</dt><dd id="wdist"></dd></div><div><dt>Top speed</dt><dd id="wtop"></dd></div><div><dt>Passes</dt><dd id="wpass"></dd></div></dl></div>
    <div id="pstake"><h3><i id="pcard"></i><span id="pname"></span></h3><p id="ptext"></p><div id="meter"><i></i></div></div>
    <div id="pline"><p id="pbig"></p><div id="proof" aria-label="What stands behind this line"></div></div>
    <div id="desk"><div id="dline"><i id="dnow"></i><ol id="drows" aria-label="Everything considered, newest first"></ol></div><p><span><b id="dshown">0</b> shown</span><span><b id="dheld">0</b> held</span></p></div>
  </div>
  <div id="prefs">
    <div id="modes" role="group" aria-label="Language"><button data-m="en" aria-pressed="true">English</button><button data-m="ar" aria-pressed="false">عربي</button></div>
    <div id="follow" role="group" aria-label="Follow"><button data-c="-1" aria-pressed="true">Everyone</button><button data-c="0" aria-pressed="false"></button><button data-c="1" aria-pressed="false"></button></div>
    <div id="squad" role="group" aria-label="Follow one player"></div>
  </div>`;

export function mountMatchPage(root: HTMLElement) {
  root.innerHTML = `<div id="app"><main id="screen">${PICTURE}</main><section id="phone" aria-live="polite">${PHONE}</section></div><div id="intro"></div><div id="err"></div>`;
}
