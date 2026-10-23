import { describe, expect, test } from 'bun:test';
import { clamp, mmss, seg, upper } from './util.ts';

describe('util', () => {
  test('upper counts entries at or below a value', () => {
    expect(upper([1, 3, 3, 7], 3)).toBe(3);
    expect(upper([1, 3, 3, 7], 0)).toBe(0);
    expect(upper([1, 3, 3, 7], 9)).toBe(4);
  });
  test('mmss writes a match clock', () => {
    expect(mmss(425)).toBe('07:05');
    expect(mmss(5520.9)).toBe('92:00');
  });
  test('seg and clamp hold to 0 to 1', () => {
    expect(seg(5, 0, 10)).toBe(0.5);
    expect(seg(-1, 0, 10)).toBe(0);
    expect(clamp(3)).toBe(1);
  });
});
