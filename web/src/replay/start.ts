// Where the replay starts and how it frames its runner. The product film arrives on the replay's first picture before the
// replay fades in over it, so both pages take the frame and the camera from here and cannot drift apart.

import type * as THREE from 'three';
import type { Clip } from '../types/run.ts';

// The frame of a clip on which player i has moved more than 0.4 m from where the clip found him: where his run sets off.
export const setOff = (clip: Clip, i: number) => {
  const first = clip.pos[0]?.[i];
  return Math.max(
    0,
    clip.pos.findIndex((row) => {
      const q = row[i];
      return !!q && !!first && Math.hypot(q[0]! - first[0]!, q[1]! - first[1]!) > 0.4;
    }),
  );
};

// How many frames past their marked starts both clips begin, so the wait before the runner sets off is skipped. It is the
// same for the goal and the earlier attempt, which keeps the two runs in step.
export const startLead = (goal: Clip, earlier: Clip, i: number) =>
  Math.max(0, Math.min(setOff(goal, i) - goal.start_offset, setOff(earlier, i) - earlier.start_offset) - 6);

// The camera on a runner at p who is heading the way of `dir` (1 or -1 along the pitch): from the main-stand side, a
// little ahead of him.
export const runnerCamera = (
  wantPos: THREE.Vector3,
  wantAim: THREE.Vector3,
  p: readonly [number, number],
  dir: number,
) => {
  wantPos.set(p[0] + 2 * dir, 30, -p[1] + 30);
  wantAim.set(p[0] + 4 * dir, 0, -p[1] + 5);
};
