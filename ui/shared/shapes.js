// What is drawn on the turf besides the players: the ball, the ring where a challenge is made, and the patches and arrows
// the system points with.
import * as THREE from 'three';
import { scene, INK, PAPER, basic, flat } from '#stage';

// The ball, with a mark on the turf beneath it so its height reads.
export function makeBall(opacity = 1) {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity }),
  );
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 20, 14),
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, transparent: true, opacity }),
  );
  const mark = flat(new THREE.CircleGeometry(0.22, 24), basic({ color: 0x000000, opacity: 0.6 * opacity }), 0.07, 4);
  ball.renderOrder = 5;
  rim.renderOrder = 5;
  group.add(mark, rim, ball);
  return {
    group,
    set(x, h, z) {
      group.position.set(x, 0, z);
      ball.position.y = rim.position.y = Math.max(h, 0.11) + 0.1;
      mark.scale.setScalar(1 + Math.min(h, 8) * 0.14);
    },
    setOpacity(o) {
      ball.material.opacity = o;
      rim.material.opacity = o;
      mark.material.opacity = 0.5 * o;
      group.visible = o > 0.004;
    },
  };
}

// A thin ring that opens where a challenge is made. The views say where and how old; nothing is remembered here.
export function makePulses(n = 4) {
  const rings = Array.from({ length: n }, () => {
    const m = flat(
      new THREE.RingGeometry(0.92, 1.0, 40),
      basic({ color: PAPER, opacity: 0, side: THREE.DoubleSide }),
      0.035,
      2,
    );
    scene.add(m);
    return m;
  });
  return (list) =>
    rings.forEach((m, i) => {
      const p = list[i];
      if (!p) {
        m.material.opacity = 0;
        return;
      }
      const u = Math.min(1, p.age / 0.5);
      m.position.set(p.x, 0.035, p.z);
      m.scale.setScalar(1 + u * 1.6);
      m.material.opacity = (1 - u) * 0.7;
    });
}

// A patch of pitch the system points at: a pale fill that opens from its centre. A patch that follows a player is held by
// four corner brackets, which are drawn as solid shapes so they stay crisp and steady while it moves.
export function makeZone(color = PAPER) {
  const group = new THREE.Group();
  const fill = flat(new THREE.PlaneGeometry(1, 1), basic({ color, opacity: 0 }), 0.02, 1);
  const cg = new THREE.BufferGeometry(),
    cv = new Float32Array(8 * 4 * 3),
    ci = [];
  cg.setAttribute('position', new THREE.BufferAttribute(cv, 3));
  for (let q = 0; q < 8; q++) ci.push(4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3);
  cg.setIndex(ci);
  const corners = new THREE.Mesh(cg, basic({ color, opacity: 0, side: THREE.DoubleSide }));
  corners.renderOrder = 2;
  corners.frustumCulled = false;
  group.add(fill, corners);
  scene.add(group);
  group.visible = false;
  return {
    set(x0, z0, x1, z1, k, bracket = true) {
      group.visible = k > 0.004;
      if (!group.visible) return;
      const cx = (x0 + x1) / 2,
        cz = (z0 + z1) / 2,
        open = 0.86 + 0.14 * k,
        hx = (Math.abs(x1 - x0) / 2) * open,
        hz = (Math.abs(z1 - z0) / 2) * open;
      fill.position.set(cx, 0.02, cz);
      fill.scale.set(2 * hx, 2 * hz, 1);
      fill.material.opacity = k * (bracket ? 0.08 : 0.15);
      corners.visible = bracket;
      if (!bracket) return;
      const t = 0.22,
        L = Math.min(hx, hz) * 0.42;
      let o = 0;
      const quad = (ax, az, bx, bz) => {
        for (const [x, z] of [
          [ax, az],
          [bx, az],
          [bx, bz],
          [ax, bz],
        ]) {
          cv[o++] = x;
          cv[o++] = 0.03;
          cv[o++] = z;
        }
      };
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = cx + sx * hx,
            z = cz + sz * hz;
          quad(x, z, x - sx * L, z - sz * t);
          quad(x, z - sz * t, x - sx * t, z - sz * L); // one arm along each side, meeting at the corner
        }
      cg.attributes.position.needsUpdate = true;
      corners.material.opacity = k * 0.9;
    },
  };
}

// An arrow lying on the pitch. It grows from its tail as `k` goes from 0 to 1, by length and not point by point, so it moves
// evenly. The shaft is thin at the tail and full at the head, the head is there from the first moment, and `show` fades the
// whole arrow with whatever it belongs to.
export function makeArrow(color = PAPER) {
  const N = 48,
    geo = new THREE.BufferGeometry(),
    v = new Float32Array((2 * N + 3) * 3),
    idx = [];
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  for (let i = 1; i < N; i++) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  idx.push(2 * N, 2 * N + 1, 2 * N + 2);
  geo.setIndex(idx);
  const mat = basic({ color, opacity: 0, side: THREE.DoubleSide }),
    mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return {
    set(pts, k, width = 0.6, show = 1) {
      // pts: [[x, z], ...] along the arrow
      mesh.visible = k > 0.004 && show > 0.004;
      if (!mesh.visible) return;
      const cum = [0];
      for (let i = 1; i < pts.length; i++)
        cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1];
      const at = (d) => {
        // the point a distance d along it, and the way it is heading there
        let i = 1;
        while (i < pts.length - 1 && cum[i] < d) i++;
        const a = pts[i - 1],
          b = pts[i],
          L = cum[i] - cum[i - 1] || 1,
          f = Math.min(1, Math.max(0, (d - cum[i - 1]) / L));
        const p = pts[Math.max(0, i - 2)],
          n = pts[Math.min(pts.length - 1, i + 1)]; // heading turns smoothly from one piece to the next
        let tx = (b[0] - p[0]) * (1 - f) + (n[0] - a[0]) * f,
          tz = (b[1] - p[1]) * (1 - f) + (n[1] - a[1]) * f;
        const T = Math.hypot(tx, tz) || 1;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, tx / T, tz / T];
      };
      const tip = total * Math.min(1, k),
        headL = Math.min(width * 3.4, tip),
        headW = width * 2.9 * (headL / (width * 3.4)),
        shaft = tip - headL;
      let o = 0;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1),
          [x, z, tx, tz] = at(shaft * u),
          w = (width / 2) * (0.3 + 0.7 * u * u * (3 - 2 * u));
        v[o++] = x - tz * w;
        v[o++] = 0.03;
        v[o++] = z + tx * w;
        v[o++] = x + tz * w;
        v[o++] = 0.03;
        v[o++] = z - tx * w;
      }
      const [bx, bz, tx, tz] = at(shaft),
        [ex, ez] = at(tip);
      v[o++] = bx - (tz * headW) / 2;
      v[o++] = 0.03;
      v[o++] = bz + (tx * headW) / 2;
      v[o++] = bx + (tz * headW) / 2;
      v[o++] = 0.03;
      v[o++] = bz - (tx * headW) / 2;
      v[o++] = ex;
      v[o++] = 0.03;
      v[o++] = ez;
      geo.attributes.position.needsUpdate = true;
      mat.opacity = show * 0.95;
    },
  };
}
