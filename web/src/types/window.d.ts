// What the pages leave on `window` for the browser tests and the film recorder to read.
import type { Moment } from '../match/data.ts';

// How long a frame takes to draw, measured with ?bench
interface Bench {
  median_ms: number;
  p95_ms: number;
  draw_calls: number;
}

declare global {
  interface Window {
    __tempo?: {
      frames: number;
      moments: Moment[];
      seek: (f: number) => void;
      bench?: Bench;
    };
    __replay?: { TOTAL: number; marks: number[]; bench?: Bench };
    __tour?: { now: () => number; starts: number[]; TOTAL: number; marks: Record<string, number> };
  }
}
