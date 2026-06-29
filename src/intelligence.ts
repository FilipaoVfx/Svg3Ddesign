/**
 * SVG Intelligence — interprets an SVG as a layered creative asset instead of a
 * flat list of paths. Pure, dependency-free and DOM-free (regex/scan based), so
 * it's fast and safe to run in a Web Worker. No GPU, no rendering.
 *
 * It reads top-level `<g id="...">` groups (the convention used by 3D-optimized
 * SVGs) and infers, per layer, a role → material + extrusion depth/bevel, plus
 * a recommended scene and performance warnings.
 */

import type { MaterialPreset } from './types';

export type LayerRole =
  | 'glass'
  | 'metal'
  | 'plastic'
  | 'screen'
  | 'light'
  | 'structure'
  | 'detail'
  | 'unknown';

export interface SvgLayer {
  /** Group id (e.g. "lens_glass"). */
  id: string;
  /** Document order (0 = first). */
  order: number;
  /** Number of drawable elements inside the group. */
  pathCount: number;
  /** Dominant fill if found. */
  fill?: string;
  /** Inferred semantic role. */
  role: LayerRole;
  /** Engine material preset to use for this layer. */
  material: MaterialPreset;
  /** Suggested extrusion depth (world units). */
  depth: number;
  /** Suggested bevel size. */
  bevel: number;
}

export interface AssetProfile {
  layerCount: number;
  pathCountTotal: number;
  complexity: 'low' | 'medium' | 'high';
  layers: SvgLayer[];
  recommended: {
    scene: 'studio' | 'cyberpunk' | 'industrial' | 'minimal';
    /** [min, max] depth across layers. */
    depthRange: [number, number];
    curveSegments: number;
  };
  /** Performance / authoring advisories. */
  warnings: string[];
}

const DRAWABLE = /<(path|rect|circle|ellipse|polygon|polyline|line)\b/g;

interface RawGroup {
  id: string;
  content: string;
  attrs: string;
}

/** Extract top-level `<g>` groups via a depth-aware linear scan (handles nesting). */
function topLevelGroups(svg: string): RawGroup[] {
  const out: RawGroup[] = [];
  const tagRe = /<(\/?)g\b([^>]*)>/g;
  let depth = 0;
  let current: { attrs: string; start: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svg))) {
    const closing = m[1] === '/';
    const selfClosing = !closing && /\/\s*$/.test(m[2]);
    if (!closing) {
      if (depth === 0 && !selfClosing) current = { attrs: m[2], start: tagRe.lastIndex };
      if (!selfClosing) depth++;
    } else {
      depth--;
      if (depth === 0 && current) {
        out.push({
          id: (current.attrs.match(/id="([^"]+)"/) || [])[1] || '',
          attrs: current.attrs,
          content: svg.slice(current.start, m.index),
        });
        current = null;
      }
    }
  }
  return out;
}

function countDrawables(s: string): number {
  return (s.match(DRAWABLE) || []).length;
}

function firstFill(attrs: string, content: string): string | undefined {
  return (
    (attrs.match(/fill="([^"]+)"/) || [])[1] ||
    (content.match(/fill="(?!none)([^"]+)"/) || [])[1] ||
    undefined
  );
}

/** Infer a role from the group id (and fall back to fill brightness). */
function inferRole(id: string, fill?: string): LayerRole {
  const s = id.toLowerCase();
  // "ring"/"bezel" is a metal trim even next to "lens" — check before glass.
  if (/\b(ring|bezel|trim)\b|_ring|_bezel/.test(s)) return 'metal';
  if (/glass|lens|crystal|transparent/.test(s)) return 'glass';
  if (/screen|display|lcd|panel|monitor/.test(s)) return 'screen';
  if (/led|light|glow|emit|neon|beam|bulb/.test(s)) return 'light';
  if (/ring|metal|chrome|steel|alu|housing|mount|bracket|frame/.test(s)) return 'metal';
  if (/yoke|arm|support|leg|stand|bracket|pillar/.test(s)) return 'structure';
  if (/detail|screw|vent|port|button|knob|grill|logo|label|text/.test(s)) return 'detail';
  if (/base|foot|feet|bottom|body|cover|case|shell|plastic/.test(s)) return 'plastic';
  // Fallback: very bright fill → likely glass/light; very dark → metal
  if (fill && /^#?(f|e)/i.test(fill.replace('#', ''))) return 'glass';
  return 'unknown';
}

const ROLE_SPEC: Record<LayerRole, { material: MaterialPreset; depth: number; bevel: number }> = {
  glass: { material: 'glass', depth: 8, bevel: 6 },
  metal: { material: 'metal', depth: 18, bevel: 4 },
  plastic: { material: 'plastic', depth: 44, bevel: 3 },
  screen: { material: 'emissive', depth: 10, bevel: 2 },
  light: { material: 'emissive', depth: 10, bevel: 3 },
  structure: { material: 'metal', depth: 28, bevel: 3 },
  detail: { material: 'metal', depth: 6, bevel: 1 },
  unknown: { material: 'default', depth: 20, bevel: 2 },
};

/**
 * Interpret an SVG string into an AssetProfile. If the SVG has no `<g id>`
 * groups it is treated as a single "unknown" layer (graceful fallback).
 */
export function analyzeSvg(svg: string): AssetProfile {
  const groups = topLevelGroups(svg).filter((g) => g.id || countDrawables(g.content) > 0);

  const layers: SvgLayer[] = groups.map((g, order) => {
    const pathCount = countDrawables(g.content);
    const fill = firstFill(g.attrs, g.content);
    const role = inferRole(g.id, fill);
    const spec = ROLE_SPEC[role];
    return { id: g.id || `layer_${order}`, order, pathCount, fill, role, ...spec };
  });

  // Fallback: no groups → whole file as one layer
  if (layers.length === 0) {
    const pathCount = countDrawables(svg);
    layers.push({ id: 'root', order: 0, pathCount, role: 'unknown', ...ROLE_SPEC.unknown });
  }

  const pathCountTotal = layers.reduce((n, l) => n + l.pathCount, 0);
  const complexity = pathCountTotal < 30 ? 'low' : pathCountTotal < 120 ? 'medium' : 'high';
  const curveSegments = complexity === 'high' ? 24 : 32;

  const depths = layers.map((l) => l.depth);
  const roles = new Set(layers.map((l) => l.role));
  const scene: AssetProfile['recommended']['scene'] = roles.has('light') || roles.has('screen')
    ? 'cyberpunk'
    : roles.has('metal') || roles.has('structure')
      ? 'studio'
      : 'minimal';

  const warnings: string[] = [];
  if (pathCountTotal > 300) warnings.push('High path count (>300): lower curveSegments to keep 60fps.');
  if (!layers.some((l) => l.id && l.id !== 'root')) warnings.push('No <g id> layers found — extrusion will be uniform. Author the SVG with depth groups for higher fidelity.');
  if (layers.length > 24) warnings.push('Many layers (>24): consider merging for fewer draw calls.');

  return {
    layerCount: layers.length,
    pathCountTotal,
    complexity,
    layers,
    recommended: { scene, depthRange: [Math.min(...depths), Math.max(...depths)], curveSegments },
    warnings,
  };
}
