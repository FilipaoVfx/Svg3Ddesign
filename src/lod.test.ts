import { describe, it, expect } from 'vitest';
import { chooseLod } from './lod';
import { estimateTriangles, TRIANGLE_BUDGET } from './intelligence';

const P = (pathCountTotal: number, recCurve = 32) => ({ pathCountTotal, recommended: { curveSegments: recCurve } });

describe('chooseLod — quality tiers', () => {
  it('draft desktop caps at 10 curve / 2 bevel', () => {
    const r = chooseLod(P(10), { quality: 'draft' });
    expect(r).toMatchObject({ curveSegments: 10, bevelSegments: 2, budget: TRIANGLE_BUDGET.desktop, reduced: false });
  });

  it('high desktop goes up to 32 curve / 3 bevel', () => {
    const r = chooseLod(P(10), { quality: 'high' });
    expect(r).toMatchObject({ curveSegments: 32, bevelSegments: 3, reduced: false });
  });

  it('respects recommended.curveSegments as an upper bound', () => {
    expect(chooseLod(P(10, 5), { quality: 'high' }).curveSegments).toBe(5);
  });

  it('mobile uses lower ceilings + the mobile budget', () => {
    const draft = chooseLod(P(10), { quality: 'draft', isMobile: true });
    expect(draft).toMatchObject({ curveSegments: 6, bevelSegments: 1, budget: TRIANGLE_BUDGET.mobile });
    const high = chooseLod(P(10), { quality: 'high', isMobile: true });
    expect(high).toMatchObject({ curveSegments: 16, bevelSegments: 2 });
  });
});

describe('chooseLod — budget adaptation (C2: reduce subdivision when over budget)', () => {
  it('drops curveSegments below the ceiling to fit the desktop budget', () => {
    const r = chooseLod(P(3000), { quality: 'draft' }); // 3000*10*12 = 360k > 250k
    expect(r.reduced).toBe(true);
    expect(r.curveSegments).toBe(6); // 3000*6*12 = 216k <= 250k, 7 → 252k > 250k
    expect(estimateTriangles(3000, r.curveSegments)).toBeLessThanOrEqual(TRIANGLE_BUDGET.desktop);
  });

  it('never goes below the MIN_CURVE floor even if still over budget', () => {
    const r = chooseLod(P(100000), { quality: 'draft' });
    expect(r.curveSegments).toBe(3);
    expect(r.reduced).toBe(true);
  });

  it('mobile budget forces a bigger reduction', () => {
    const r = chooseLod(P(500), { quality: 'high', isMobile: true }); // ceil 16 → 500*16*12=96k > 80k
    expect(r.reduced).toBe(true);
    expect(estimateTriangles(500, r.curveSegments)).toBeLessThanOrEqual(TRIANGLE_BUDGET.mobile);
  });

  it('defaults to draft desktop when no options given', () => {
    expect(chooseLod(P(10))).toMatchObject({ curveSegments: 10, bevelSegments: 2 });
  });
});
