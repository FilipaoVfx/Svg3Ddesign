import { describe, it, expect } from 'vitest';
import {
  analyzeSvg,
  buildLayerSvgs,
  layerTransforms,
  estimateVertices,
  topLevelGroups,
} from './intelligence';
import { hashSvg, analyzeSvgCached } from './hash';

// Mirrors the moving-head asset structure (7 depth layers).
const MOVING_HEAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<g id="lens_glass"><path/><path/><circle/></g>
<g id="lens_ring"><path/><path/></g>
<g id="head_housing"><path/><path/><path/><rect/><path/><path/></g>
<g id="yoke_arms"><path/><path/><path/><path/></g>
<g id="base_housing"><path/><path/><path/><path/><path/><path/></g>
<g id="base_detail"><rect/><rect/><circle/><path/><path/><path/><path/><path/></g>
<g id="feet_bottom"><path/><path/><path/><path/></g>
</svg>`;

describe('topLevelGroups', () => {
  it('extracts each top-level group with its id and path count', () => {
    const groups = topLevelGroups(MOVING_HEAD);
    expect(groups).toHaveLength(7);
    expect(groups.map((g) => g.id)).toEqual([
      'lens_glass', 'lens_ring', 'head_housing', 'yoke_arms', 'base_housing', 'base_detail', 'feet_bottom',
    ]);
  });

  it('handles nested groups without breaking the count', () => {
    const svg = '<svg><g id="outer"><g id="inner"><path/></g><path/></g><g id="b"><path/></g></svg>';
    const groups = topLevelGroups(svg);
    expect(groups.map((g) => g.id)).toEqual(['outer', 'b']);
  });
});

describe('analyzeSvg', () => {
  const p = analyzeSvg(MOVING_HEAD);

  it('finds all layers', () => {
    expect(p.layerCount).toBe(7);
    expect(p.pathCountTotal).toBe(33);
  });

  it('infers roles/materials from ids (ring is metal, not glass)', () => {
    const byId = Object.fromEntries(p.layers.map((l) => [l.id, l]));
    expect(byId.lens_glass.role).toBe('glass');
    expect(byId.lens_glass.material).toBe('glass');
    expect(byId.lens_ring.role).toBe('metal');
    expect(byId.head_housing.role).toBe('metal');
    expect(byId.yoke_arms.role).toBe('structure');
    expect(byId.feet_bottom.role).toBe('plastic');
  });

  it('recommends a scene and a curveSegments value', () => {
    expect(p.recommended.scene).toBe('studio');
    expect(p.recommended.curveSegments).toBe(32);
  });

  it('reports a within-budget estimate for a small asset', () => {
    expect(p.estimatedVertices).toBeGreaterThan(0);
    expect(p.withinBudget).toBe(true);
  });

  it('falls back to a single layer with a warning when there are no groups', () => {
    const p2 = analyzeSvg('<svg viewBox="0 0 10 10"><path/><path/></svg>');
    expect(p2.layerCount).toBe(1);
    expect(p2.layers[0].id).toBe('root');
    expect(p2.warnings.some((w) => /No <g id>/.test(w))).toBe(true);
  });
});

describe('fill-based material inference (#8)', () => {
  it('treats translucent fills as glass', () => {
    const p = analyzeSvg('<svg><g id="part1" fill-opacity="0.3"><path/></g></svg>');
    expect(p.layers[0].role).toBe('glass');
  });
  it('treats bright saturated fills as light/emissive', () => {
    const p = analyzeSvg('<svg><g id="part2"><path fill="#00ffaa"/></g></svg>');
    expect(p.layers[0].role).toBe('light');
    expect(p.layers[0].material).toBe('emissive');
  });
  it('treats dark grey fills as metal', () => {
    const p = analyzeSvg('<svg><g id="part3"><path fill="#1a1a1f"/></g></svg>');
    expect(p.layers[0].role).toBe('metal');
  });
});

describe('budget guard (#5)', () => {
  it('flags assets that exceed the vertex budget', () => {
    const many = '<svg><g id="big">' + '<path/>'.repeat(2000) + '</g></svg>';
    const p = analyzeSvg(many);
    expect(p.withinBudget).toBe(false);
    expect(p.warnings.some((w) => /budget/i.test(w))).toBe(true);
  });
});

describe('buildLayerSvgs + layerTransforms (#1/#3 foundation)', () => {
  it('splits into per-layer standalone SVGs preserving the viewBox', () => {
    const parts = buildLayerSvgs(MOVING_HEAD);
    expect(parts).toHaveLength(7);
    expect(parts[0].id).toBe('lens_glass');
    expect(parts[0].svg).toContain('viewBox="0 0 1024 1024"');
    expect(parts[0].svg).toContain('<g id="lens_glass"');
  });

  it('z-stacks layers front-to-back (order 0 at front)', () => {
    const p = analyzeSvg(MOVING_HEAD);
    const t = layerTransforms(p);
    expect(t[0].z).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i].z).toBeLessThan(t[i - 1].z);
  });
});

describe('hashSvg + cache (#6)', () => {
  it('is stable and content-sensitive', () => {
    expect(hashSvg('abc')).toBe(hashSvg('abc'));
    expect(hashSvg('abc')).not.toBe(hashSvg('abd'));
    expect(hashSvg(MOVING_HEAD)).toMatch(/^[0-9a-f]{8}$/);
  });
  it('memoizes analysis by content', () => {
    expect(analyzeSvgCached(MOVING_HEAD)).toBe(analyzeSvgCached(MOVING_HEAD));
  });
});

describe('estimateVertices', () => {
  it('scales with paths and curve segments', () => {
    expect(estimateVertices(10, 32)).toBeGreaterThan(estimateVertices(10, 16));
  });
});
