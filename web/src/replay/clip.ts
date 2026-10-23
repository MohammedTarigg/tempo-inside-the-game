// Reading a replay clip: where a player and the ball are at any moment of it, and putting a marker there.
import { facing } from '../shared/stage.ts';
import { lerp } from '../shared/util.ts';
import type { Pt } from '../shared/stage.ts';
import type { Marker } from '../shared/marker.ts';
import type { Clip } from '../types/run.ts';

export function sample(clip: Clip, f: number, i: number): Pt | null {
  // player i at fractional frame f: position in metres, or null if he is off the pitch
  const n = clip.pos.length - 1,
    a = Math.min(n, Math.max(0, Math.floor(f))),
    b = Math.min(n, a + 1),
    t = Math.min(1, Math.max(0, f - a));
  const p = clip.pos[a]?.[i],
    q = clip.pos[b]?.[i];
  if (!p || !q || p[0] == null || q[0] == null || p[1] == null || q[1] == null) return null;
  return [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
}
export function sampleBall(clip: Clip, f: number): [number, number, number] {
  const n = clip.ball.length - 1,
    a = Math.min(n, Math.max(0, Math.floor(f))),
    b = Math.min(n, a + 1),
    t = Math.min(1, Math.max(0, f - a));
  const A = clip.ball[a]!,
    B = clip.ball[b]!;
  return [lerp(A[0]!, B[0]!, t), lerp(A[1]!, B[1]!, t), lerp(A[2]!, B[2]!, t)];
}
export function place(fig: Marker, clip: Clip, f: number, i: number, dt: number, rate: number) {
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
