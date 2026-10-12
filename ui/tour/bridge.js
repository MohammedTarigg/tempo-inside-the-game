// The film's moves between one moment of the match and the next: a plain cut, and the glide that carries every marker and
// the camera across without one. Also the one way every feature frames its subject.
import { seg, smooth } from '#util';

// how long a glide takes, in seconds: two beats of the music
const GL = 1.2;

export function makeBridge(api) {
  const { DIR, FPS } = api;
  // the glide in progress, if there is one: the camera to hand over to at the end, the speed to play at, and how far along
  let ride = null;
  // One way of framing a subject, used by every feature: high enough that markers stay round, the subject a little right of
  // centre so the caption has the lower left to itself.
  const frameOn =
    (get, height = 38, back2 = 30) =>
    (wantPos, wantAim, b) => {
      const p = get(b);
      if (!p) return;
      wantPos.set(p[0] - 5, height, -p[1] + back2);
      wantAim.set(p[0] - 5, 0, -p[1] + 4);
    };
  const onPlayer = (i, h, d) => frameOn(() => api.drawn(i), h, d),
    onBall = (h, d) => frameOn((b) => [b[0], b[1]], h, d); // where he is drawn, so the camera stays with him while the picture travels
  const cut = (frame, speed, cam, focus = null) => {
    ride = null;
    DIR.blend = null;
    api.seek(frame);
    api.setSpeed(speed);
    DIR.cam = cam;
    DIR.focus = focus;
    DIR.mark = null;
    api.snapCamera();
    api.setPlaying(true);
  };
  // The bridge between two features. Nothing goes black and nothing jumps: the camera lifts away from its subject, all 22 markers
  // and the ball glide from where they stand to where they stand at the next moment, the clock and the playhead run forward with
  // them, and the camera comes down on the next subject. Then play resumes. `lift` is how far the camera pulls away on the way:
  // 1 between two different subjects, less when the next feature is about the same player and the camera can stay with him.
  const glide = (frame, speed, cam, focus = null, lift = 1) => {
    const from = api.getF(),
      to = Math.min(api.LAST, frame + GL * FPS * speed); // land where play would have reached, so each feature keeps its timing
    DIR.blend = { from, k: 0 };
    api.seek(to, true);
    api.setSpeed(speed);
    api.setPlaying(false);
    DIR.focus = focus;
    DIR.mark = null;
    ride = { cam, speed, g: 0 };
    DIR.cam = (wantPos, wantAim, b) => {
      cam(wantPos, wantAim, b);
      const up = ride ? Math.sin(Math.PI * ride.g) * lift : 0;
      wantPos.y += 30 * up;
      wantPos.z += 24 * up;
    };
  };
  const ending = () => {
    if (!ride) return;
    DIR.blend = null;
    DIR.cam = ride.cam;
    api.setPlaying(true);
    ride = null;
  };
  return {
    cut,
    glide,
    ending,
    onPlayer,
    onBall,
    riding: () => !!ride,
    // Called every frame with the seconds since the feature began: moves a glide on, and ends it when it has arrived.
    advance(local) {
      if (!ride) return;
      ride.g = seg(local, 0, GL);
      if (DIR.blend) DIR.blend.k = smooth(ride.g);
      if (ride.g >= 1) ending();
    },
  };
}
