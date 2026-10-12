// Reading a replay clip: where a player and the ball are at any moment of it, and putting a marker there.
import { facing } from '#stage';
import { lerp } from '#util';

export function sample(clip, f, i) {
  // player i at fractional frame f: position in metres, or null if he is off the pitch
  const n = clip.pos.length - 1,
    a = Math.min(n, Math.max(0, Math.floor(f))),
    b = Math.min(n, a + 1),
    t = Math.min(1, Math.max(0, f - a));
  const p = clip.pos[a][i],
    q = clip.pos[b][i];
  if (!p || !q || p[0] === null || q[0] === null) return null;
  return [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
}
export function sampleBall(clip, f) {
  const n = clip.ball.length - 1,
    a = Math.min(n, Math.max(0, Math.floor(f))),
    b = Math.min(n, a + 1),
    t = Math.min(1, Math.max(0, f - a));
  return [
    lerp(clip.ball[a][0], clip.ball[b][0], t),
    lerp(clip.ball[a][1], clip.ball[b][1], t),
    lerp(clip.ball[a][2], clip.ball[b][2], t),
  ];
}
export function place(fig, clip, f, i, dt, rate) {
  const p = sample(clip, f, i);
  if (!p) {
    fig.group.visible = false;
    return null;
  }
  if (!fig.ghost) fig.group.visible = true;
  const a = sample(clip, f - 3, i) || p,
    b = sample(clip, f + 3, i) || p;
  const vx = ((b[0] - a[0]) * 25) / 6,
    vy = ((b[1] - a[1]) * 25) / 6,
    sp = Math.hypot(vx, vy);
  fig.group.position.set(p[0], 0, -p[1]);
  const bl = sampleBall(clip, f); // he watches the ball; his streak shows where he is running
  let d = facing(p[0], p[1], vx, vy, bl[0], bl[1]) - fig.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  fig.yaw += d * (rate ? 0.2 : 1);
  if (sp > 0.5) fig.motion.rotation.y = Math.atan2(vx, -vy);
  fig.turn.rotation.y = fig.yaw;
  fig.update(dt, sp, rate);
  return p;
}
