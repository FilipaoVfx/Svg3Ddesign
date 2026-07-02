import { describe, it, expect, afterAll } from 'vitest';
import {
  analyzeSvg,
  applyOverrides,
  layerTransforms,
  estimateTriangles,
  TRIANGLE_BUDGET,
} from './intelligence';
import { analyzeSvgAsync, disposeAnalysisWorker } from './analysisWorker';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#f4a261"/>
  <circle cx="35" cy="40" r="8" fill="#ffffff"/>
  <circle cx="65" cy="40" r="8" fill="#ffffff"/>
</svg>`;

describe('triangle budget (C2)', () => {
  it('estimates triangles and exposes both units', () => {
    const p = analyzeSvg(svg);
    expect(p.estimatedTriangles).toBe(estimateTriangles(p.pathCountTotal, p.recommended.curveSegments));
    expect(p.estimatedTriangles).toBeGreaterThan(p.estimatedVertices); // 1.5×
    expect(p.withinBudget).toBe(true);
  });

  it('budget constants are the PRD values', () => {
    expect(TRIANGLE_BUDGET.desktop).toBe(250_000);
    expect(TRIANGLE_BUDGET.mobile).toBe(80_000);
  });
});

describe('applyOverrides (sculpt restacking fix)', () => {
  it('returns the same profile when nothing changes', () => {
    const p = analyzeSvg(svg);
    expect(applyOverrides(p)).toBe(p);
    expect(applyOverrides(p, { shape_0: {} })).toBe(p);
    expect(applyOverrides(p, { shape_0: { depth: p.layers[0].depth } })).toBe(p);
  });

  it('overriding a base depth restacks the levels above it', () => {
    const p = analyzeSvg(svg);
    const zBefore = layerTransforms(p).map((t) => t.z);
    const bigger = applyOverrides(p, { shape_0: { depth: p.layers[0].depth + 100 } });
    const zAfter = layerTransforms(bigger).map((t) => t.z);
    expect(zAfter[0]).toBe(0); // base stays at back
    expect(zAfter[1]).toBeGreaterThan(zBefore[1]); // eyes pushed forward by thicker base
    expect(zAfter[1]).toBeCloseTo(zAfter[2]); // eyes still share a level
    expect(p.layers[0].depth).not.toBe(bigger.layers[0].depth); // original untouched
  });
});

describe('analyzeSvgAsync (C6 worker with sync fallback)', () => {
  afterAll(() => disposeAnalysisWorker());

  it('resolves the same profile as analyzeSvg (fallback path in Node)', async () => {
    const p = await analyzeSvgAsync(svg);
    expect(p).toEqual(analyzeSvg(svg));
  });

  it('caches by content hash (same object back)', async () => {
    const a = await analyzeSvgAsync(svg);
    const b = await analyzeSvgAsync(svg);
    expect(b).toBe(a);
  });

  it('honours granularity in the cache key', async () => {
    const grouped = `<svg viewBox="0 0 10 10"><g id="a"><rect x="0" y="0" width="5" height="5"/></g></svg>`;
    const auto = await analyzeSvgAsync(grouped);
    const perShape = await analyzeSvgAsync(grouped, { granularity: 'shape' });
    expect(auto.layers[0].id).toBe('a');
    expect(perShape.layers[0].level).toBe(0); // shape mode carries levels
  });
});
