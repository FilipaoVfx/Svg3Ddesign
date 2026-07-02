import { describe, it, expect } from 'vitest';
import { pathBBox, shapeBBox, overlaps, contains, assignLevels } from './spatial';
import { analyzeSvg, layerTransforms } from './intelligence';

describe('shapeBBox', () => {
  it('rect / circle / ellipse / line', () => {
    expect(shapeBBox('rect', 'x="10" y="20" width="30" height="40"')).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(shapeBBox('circle', 'cx="50" cy="50" r="10"')).toEqual({ x: 40, y: 40, w: 20, h: 20 });
    expect(shapeBBox('ellipse', 'cx="50" cy="50" rx="20" ry="10"')).toEqual({ x: 30, y: 40, w: 40, h: 20 });
    expect(shapeBBox('line', 'x1="5" y1="9" x2="1" y2="3"')).toEqual({ x: 1, y: 3, w: 4, h: 6 });
  });

  it('polygon points', () => {
    expect(shapeBBox('polygon', 'points="0,0 10,0 5,8"')).toEqual({ x: 0, y: 0, w: 10, h: 8 });
  });

  it('unknown tag → null', () => {
    expect(shapeBBox('text', 'x="0" y="0"')).toBeNull();
  });
});

describe('pathBBox', () => {
  it('absolute M/L', () => {
    expect(pathBBox('M 10 10 L 30 40 L 20 5 Z')).toEqual({ x: 10, y: 5, w: 20, h: 35 });
  });

  it('relative l and H/V', () => {
    // M 10 10, l +10 +5 → (20,15), H 40 → (40,15), v -10 → (40,5)
    expect(pathBBox('M10 10 l10 5 H40 v-10')).toEqual({ x: 10, y: 5, w: 30, h: 10 });
  });

  it('cubic curves include control points (conservative hull)', () => {
    const bb = pathBBox('M0 0 C 0 100, 50 100, 50 0');
    expect(bb).toEqual({ x: 0, y: 0, w: 50, h: 100 });
  });

  it('arc contributes endpoints', () => {
    const bb = pathBBox('M0 0 A 10 10 0 0 1 20 0');
    expect(bb).toEqual({ x: 0, y: 0, w: 20, h: 0 });
  });

  it('empty/invalid → null', () => {
    expect(pathBBox('')).toBeNull();
  });
});

describe('overlaps / contains', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  it('strict overlap; touching edges do not count', () => {
    expect(overlaps(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(overlaps(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false); // shares edge
    expect(overlaps(a, { x: 20, y: 20, w: 5, h: 5 })).toBe(false);
  });
  it('containment', () => {
    expect(contains(a, { x: 2, y: 2, w: 4, h: 4 })).toBe(true);
    expect(contains(a, { x: 8, y: 8, w: 5, h: 5 })).toBe(false);
  });
});

describe('assignLevels (hybrid depth graph, C3)', () => {
  it('disjoint siblings share a level; containment rises', () => {
    const face = { x: 0, y: 0, w: 100, h: 100 };
    const eyeL = { x: 20, y: 20, w: 15, h: 15 };
    const eyeR = { x: 65, y: 20, w: 15, h: 15 };
    const pupilL = { x: 25, y: 25, w: 5, h: 5 };
    expect(assignLevels([face, eyeL, eyeR, pupilL])).toEqual([0, 1, 1, 2]);
  });

  it('null bbox falls back to painter stacking', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(assignLevels([a, null, a])).toEqual([0, 1, 1]);
  });

  it('fully disjoint set stays flat at level 0', () => {
    const boxes = [
      { x: 0, y: 0, w: 5, h: 5 },
      { x: 10, y: 0, w: 5, h: 5 },
      { x: 20, y: 0, w: 5, h: 5 },
    ];
    expect(assignLevels(boxes)).toEqual([0, 0, 0]);
  });
});

describe('integration: analyzeSvg + layerTransforms with levels', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="45" fill="#f4a261"/>
    <circle cx="35" cy="40" r="8" fill="#ffffff"/>
    <circle cx="65" cy="40" r="8" fill="#ffffff"/>
    <circle cx="35" cy="40" r="3" fill="#000000"/>
  </svg>`;

  it('shape mode assigns levels: face 0, eyes 1+1, pupil 2', () => {
    const p = analyzeSvg(svg);
    expect(p.layers.map((l) => l.level)).toEqual([0, 1, 1, 2]);
    expect(p.layers.every((l) => l.bbox)).toBe(true);
  });

  it('both eyes share the same z; pupil rises above', () => {
    const p = analyzeSvg(svg);
    const z = layerTransforms(p).map((t) => t.z);
    expect(z[1]).toBeCloseTo(z[2]); // eyes at same height (painter alone would stack them)
    expect(z[3]).toBeGreaterThan(z[1]); // pupil in relief above the eye
    expect(z[0]).toBe(0); // base at back
  });

  it('group mode (no levels) keeps painter stacking', () => {
    const grouped = `<svg viewBox="0 0 10 10"><g id="a"><rect x="0" y="0" width="5" height="5"/></g><g id="b"><rect x="6" y="6" width="3" height="3"/></g></svg>`;
    const p = analyzeSvg(grouped);
    expect(p.layers.every((l) => l.level === undefined)).toBe(true);
    const z = layerTransforms(p).map((t) => t.z);
    expect(z[1]).toBeGreaterThan(z[0]); // painter fallback intact
  });
});
