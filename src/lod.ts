/**
 * Level of Detail (PRD v2.1, Phase 3 — "Level of Detail" + budget rule C2).
 *
 * Picks the extrusion resolution (curve + bevel segments) so the viewport stays
 * at 60fps while editing (draft) and exports can go crisp (high), and so a
 * complex SVG automatically drops resolution to stay within the triangle
 * budget — "if exceeded → reduce subdivision" (C2). Mobile uses the smaller
 * budget and lower ceilings.
 *
 * Pure and dependency-free (numbers only) → unit-testable and worker-safe.
 */
import { estimateTriangles, TRIANGLE_BUDGET } from './intelligence';

export type Quality = 'draft' | 'high';

export interface LodOptions {
  /** 'draft' (default) for interactive viewport, 'high' for export. */
  quality?: Quality;
  /** Use the mobile budget + lower ceilings. */
  isMobile?: boolean;
  /** Override the triangle budget (defaults to desktop/mobile per isMobile). */
  budget?: number;
}

export interface LodResult {
  curveSegments: number;
  bevelSegments: number;
  /** Triangle budget used for the decision. */
  budget: number;
  /** True if we had to drop below the quality ceiling to fit the budget. */
  reduced: boolean;
}

const CEIL: Record<'desktop' | 'mobile', Record<Quality, { curve: number; bevel: number }>> = {
  desktop: { draft: { curve: 10, bevel: 2 }, high: { curve: 32, bevel: 3 } },
  mobile: { draft: { curve: 6, bevel: 1 }, high: { curve: 16, bevel: 2 } },
};

const MIN_CURVE = 3;

/**
 * Choose curve/bevel segments for an asset. Starts at the quality ceiling for
 * the device, then reduces curveSegments (down to MIN_CURVE) until the
 * estimated triangles fit the budget.
 */
export function chooseLod(
  profile: { pathCountTotal: number; recommended: { curveSegments: number } },
  opts: LodOptions = {},
): LodResult {
  const quality: Quality = opts.quality ?? 'draft';
  const device = opts.isMobile ? 'mobile' : 'desktop';
  const budget = opts.budget ?? (opts.isMobile ? TRIANGLE_BUDGET.mobile : TRIANGLE_BUDGET.desktop);
  const ceil = CEIL[device][quality];

  const ceilCurve = Math.min(profile.recommended.curveSegments, ceil.curve);
  let curveSegments = ceilCurve;
  while (curveSegments > MIN_CURVE && estimateTriangles(profile.pathCountTotal, curveSegments) > budget) {
    curveSegments--;
  }
  return { curveSegments, bevelSegments: ceil.bevel, budget, reduced: curveSegments < ceilCurve };
}

/** SSR-safe coarse-pointer / small-screen check for auto mobile LOD. */
export function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768;
  } catch {
    return false;
  }
}
