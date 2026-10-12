// A player's marker on the stage: a disc in his team's colour with his number, a wedge for the way he faces and a streak
// when he sprints. A marker shows only what the tracking feed knows: where he is, which way he is going and how fast.
import * as THREE from 'three';
import { SIGNAL, INK, PAPER, FONT, basic, flat } from '#stage';

const CARD = 0xffd21f;
// a marker is a symbol, drawn larger than the man so his number reads
const R = 0.8;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const STREAK = canvasTexture(8, 64, (g, w, h) => {
  const r = g.createLinearGradient(0, 0, 0, h);
  r.addColorStop(0, 'rgba(255,255,255,0.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
});
// the referee's card, upright, as an outline and as a solid
const cardTexture = (solid) =>
  canvasTexture(80, 112, (g, w, h) => {
    g.beginPath();
    g.roundRect(8, 8, w - 16, h - 16, 10);
    if (solid) {
      g.fillStyle = css(CARD);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = css(INK);
      g.stroke();
    } else {
      g.fillStyle = 'rgba(0, 0, 0, 0.6)';
      g.fill();
      g.lineWidth = 9;
      g.strokeStyle = css(CARD);
      g.stroke();
    }
  });
const CARD_OUTLINE = cardTexture(false),
  CARD_SOLID = cardTexture(true);

// One player. `group` sits at his position and never turns, so the number stays upright. `turn` carries the wedge that shows
// which way his body faces, and `motion` the streak that shows which way he is running. The two differ: a player watches the
// ball while he moves.
export class Marker {
  constructor({ number, kit, ghost = false }) {
    this.ghost = ghost;
    this.yaw = 0;
    this.k = 1;
    this.group = new THREE.Group();
    this.turn = new THREE.Group();
    this.motion = new THREE.Group();
    this.group.add(this.turn, this.motion);
    const face = canvasTexture(192, 192, (g, n) => {
      // a ghost is where someone was: a pale disc inside a dashed ring, with no number
      g.beginPath();
      g.arc(n / 2, n / 2, n * 0.44, 0, 7);
      if (ghost) {
        g.globalAlpha = 0.22;
        g.fillStyle = css(kit.line);
        g.fill();
        g.globalAlpha = 1;
        g.lineWidth = n * 0.075;
        g.strokeStyle = css(kit.line);
        g.setLineDash([n * 0.11, n * 0.08]);
        g.stroke();
      } else {
        g.fillStyle = css(kit.shirt);
        g.fill();
        g.lineWidth = n * 0.055;
        g.strokeStyle = css(kit.rim);
        g.stroke();
      }
      g.fillStyle = css(ghost ? kit.line : kit.number);
      g.font = `700 ${n * 0.46}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (!ghost) g.fillText(String(number), n / 2, n * 0.53); // an outline is where someone was, not a second player: no number
    });
    this.mats = [];
    const add = (mesh, parent, base) => {
      mesh.userData.base = base;
      this.mats.push(mesh);
      parent.add(mesh);
      return mesh;
    };
    add(flat(new THREE.PlaneGeometry(R * 2.27, R * 2.27), basic({ map: face }), 0.06, 3), this.group, 1);
    const tri = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.22, 0, R + 0.1),
      new THREE.Vector3(0.22, 0, R + 0.1),
      new THREE.Vector3(0, 0, R + 0.46),
    ]);
    tri.setIndex([0, 1, 2]);
    const wedge = new THREE.Mesh(tri, basic({ color: ghost ? kit.line : PAPER, side: THREE.DoubleSide }));
    wedge.position.y = 0.05;
    wedge.renderOrder = 3;
    add(wedge, this.turn, ghost ? 1 : 0.85);
    this.trail = flat(
      new THREE.PlaneGeometry(R * 1.2, 1),
      basic({ map: STREAK, color: kit.shirt, opacity: 0 }),
      0.03,
      2,
    );
    this.motion.add(this.trail);
    if (!ghost) {
      // The stake, as in the mock-up: a yellow ring round him and a small card above his right shoulder.
      // Faint, the ring is thin and the card an outline. Lit, the ring is whole and the card solid.
      this.ring = flat(
        new THREE.RingGeometry(R + 0.14, R + 0.27, 64),
        basic({ color: SIGNAL, opacity: 0, side: THREE.DoubleSide }),
        0.04,
        2,
      );
      this.group.add(this.ring);
      const badge = (tex) => {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }),
        );
        sp.center.set(0.5, 0);
        sp.position.set(R * 1.15, 0.55, -R * 0.35);
        sp.renderOrder = 6;
        this.group.add(sp);
        return sp;
      };
      this.cardFaint = badge(CARD_OUTLINE);
      this.cardFull = badge(CARD_SOLID);
    }
  }
  update(dt, speed, rate) {
    // a streak behind him once he is sprinting
    const len = Math.max(0, speed - 5.5) * 1.1,
      on = this.ghost || !rate ? 0 : Math.min(1, len / 1.5) * 0.5 * this.k;
    this.trail.material.opacity += (on - this.trail.material.opacity) * Math.min(1, dt * 8 + (rate ? 0 : 1));
    const L = Math.max(0.2, len);
    this.trail.scale.set(1, L, 1);
    this.trail.position.z = -(R + L / 2);
  }
  // Which marker lies on top where two overlap. `layer` is a small number that grows towards the camera, so the nearer man covers
  // the further one, as bodies do. A marked player is lifted over everyone.
  order(layer = this.layerNow || 0) {
    this.layerNow = layer;
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.userData.order ??= o.renderOrder;
        o.renderOrder = o.userData.order + (this.lifted || 0) + layer;
      }
    });
  }
  // What contact does to him. hit: the instant of a challenge, a quick give and spring back. down: 0 to 1, on the ground.
  setBody(hit, down) {
    const s = (1 - 0.18 * hit) * (1 - 0.26 * down);
    this.group.scale.set(s, 1, s);
    this.turn.visible = down < 0.5;
  }
  setOpacity(o) {
    this.k = o;
    this.group.visible = o > 0.004;
    for (const m of this.mats) m.material.opacity = m.userData.base * o;
  }
  // k: how far the mark has faded in. full: 0 faint, 1 lit. beat: a slow pulse for the lit ring, 0 to 1.
  setStake(k, full, beat = 1) {
    if (!this.ring) return;
    const up = k > 0.05 ? 10 : 0; // a marked player is drawn over his neighbours
    if (up !== this.lifted) {
      this.lifted = up;
      this.order();
    }
    this.ring.material.opacity = k * (0.5 + 0.5 * full) * (1 - 0.35 * full * (1 - beat));
    this.ring.scale.setScalar(1 - 0.06 * (1 - full));
    const s = 0.62 + 0.14 * full; // metres wide; the card is 20 by 28
    this.cardFaint.scale.set(s, s * 1.4, 1);
    this.cardFull.scale.set(s, s * 1.4, 1);
    this.cardFaint.material.opacity = k * (1 - full);
    this.cardFull.material.opacity = k * full;
  }
}
