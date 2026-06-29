/**
 * SVG Intelligence — interprets an SVG as a layered creative asset instead of a
 * flat list of paths. Pure, dependency-free and DOM-free (regex/scan based), so
 * it's fast and safe to run in a Web Worker. No GPU, no rendering.
 *
 * Reads top-level `<g id="...">` groups and infers, per layer, a role →
 * material + extrusion depth/bevel from the id AND the fill, plus a recommended
 * scene, a rough geometry budget and performance warnings.
 */

import type { MaterialPreset } from './types';
import type { SceneName } from './scenes';

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
  id: string;
  order: number;
  pathCount: number;
  fill?: string;
  /** 0..1 fill opacity if detected (else 1). */
  opacity: number;
  role: LayerRole;
  material: MaterialPreset;
  depth: number;
  bevel: number;
}

export interface AssetProfile {
  layerCount: number;
  pathCountTotal: number;
  complexity: 'low' | 'medium' | 'high';
  /** Rough estimate of extruded vertices (advisory, not exact). */
  estimatedVertices: number;
  withinBudget: boolean;
  layers: SvgLayer[];
  recommended: {
    scene: SceneName;
    depthRange: [number, number];
    curveSegments: number;
  };
  warnings: string[];
}

/** Max extruded vertices target (PRD geometry budget). */
export const VERTEX_BUDGET = 300_000;

const DRAWABLE = /<(path|rect|circle|ellipse|polygon|polyline|line)\b/g;

export interface RawGroup {
  id: string;
  attrs: string;
  content: string;
}

/** Extract top-level `<g>` groups via a depth-aware linear scan (handles nesting). */
export function topLevelGroups(svg: string): RawGroup[] {
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

/** Detect fill opacity from fill-opacity, rgba() alpha or 8-digit hex. */
function detectOpacity(attrs: string, content: string, fill?: string): number {
  const fo = (attrs + content).match(/fill-opacity="([0-9.]+)"/);
  if (fo) return Math.max(0, Math.min(1, parseFloat(fo[1])));
  if (fill) {
    const rgba = fill.match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/);
    if (rgba) return parseFloat(rgba[1]);
    const hex8 = fill.match(/^#?[0-9a-f]{6}([0-9a-f]{2})$/i);
    if (hex8) return parseInt(hex8[1], 16) / 255;
  }
  return 1;
}

/** Perceived brightness 0..1 from a hex color. */
function brightness(hex?: string): number | null {
  if (!hex) return null;
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}/i.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Saturation 0..1 from a hex color (for neon detection). */
function saturation(hex?: string): number {
  if (!hex) return 0;
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}/i.test(h)) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Material/role inference from the fill colour & opacity (used when id is ambiguous). */
function roleFromFill(fill: string | undefined, opacity: number): LayerRole {
  if (opacity < 0.6) return 'glass'; // translucent → glass
  const b = brightness(fill);
  const s = saturation(fill);
  if (b !== null && b > 0.6 && s > 0.5) return 'light'; // bright + saturated → neon/emissive
  if (b !== null && b < 0.25) return 'metal'; // dark grey → metal
  return 'unknown';
}

/** Role from the group id (strong signal). */
function roleFromId(id: string): LayerRole {
  const s = id.toLowerCase();
  if (/\b(ring|bezel|trim)\b|_ring|_bezel/.test(s)) return 'metal';
  if (/glass|lens|crystal|transparent/.test(s)) return 'glass';
  if (/screen|display|lcd|panel|monitor/.test(s)) return 'screen';
  if (/led|light|glow|emit|neon|beam|bulb/.test(s)) return 'light';
  if (/metal|chrome|steel|alu|housing|mount|frame/.test(s)) return 'metal';
  if (/yoke|arm|support|leg|stand|pillar/.test(s)) return 'structure';
  if (/detail|screw|vent|port|button|knob|grill|logo|label|text/.test(s)) return 'detail';
  if (/base|foot|feet|bottom|body|cover|case|shell|plastic/.test(s)) return 'plastic';
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

/** Rough vertex estimate for the whole asset (advisory). */
export function estimateVertices(pathCount: number, curveSegments: number): number {
  // ~caps + walls + bevel per path, scaled by curve resolution.
  return Math.round(pathCount * curveSegments * 8);
}

/**
 * Interpret an SVG string into an AssetProfile. If the SVG has no `<g id>`
 * groups it is treated as a single "unknown" layer (graceful fallback).
 */
export function analyzeSvg(svg: string): AssetProfile {
  const groups = topLevelGroups(svg).filter((g) => g.id || countDrawables(g.content) > 0);

  const layers: SvgLayer[] = groups.map((g, order) => {
    const pathCount = countDrawables(g.content);
    const fill = firstFill(g.attrs, g.content);
    const opacity = detectOpacity(g.attrs, g.content, fill);
    let role = roleFromId(g.id);
    if (role === 'unknown') role = roleFromFill(fill, opacity); // #8: fill-based fallback
    const spec = ROLE_SPEC[role];
    return { id: g.id || `layer_${order}`, order, pathCount, fill, opacity, role, ...spec };
  });

  if (layers.length === 0) {
    const pathCount = countDrawables(svg);
    layers.push({ id: 'root', order: 0, pathCount, opacity: 1, role: 'unknown', ...ROLE_SPEC.unknown });
  }

  const pathCountTotal = layers.reduce((n, l) => n + l.pathCount, 0);
  const complexity = pathCountTotal < 30 ? 'low' : pathCountTotal < 120 ? 'medium' : 'high';
  const curveSegments = complexity === 'high' ? 24 : 32;
  const estimatedVertices = estimateVertices(pathCountTotal, curveSegments);
  const withinBudget = estimatedVertices <= VERTEX_BUDGET;

  const depths = layers.map((l) => l.depth);
  const roles = new Set(layers.map((l) => l.role));
  const scene: SceneName = roles.has('light') || roles.has('screen')
    ? 'cyberpunk'
    : roles.has('metal') || roles.has('structure')
      ? 'studio'
      : 'minimal';

  const warnings: string[] = [];
  if (!withinBudget) warnings.push(`Estimated ~${estimatedVertices.toLocaleString()} verts exceeds the ${VERTEX_BUDGET.toLocaleString()} budget — lower curveSegments or simplify paths.`);
  if (pathCountTotal > 300) warnings.push('High path count (>300): keep curveSegments low for 60fps.');
  if (!layers.some((l) => l.id && l.id !== 'root')) warnings.push('No <g id> layers found — extrusion will be uniform. Author the SVG with depth groups for higher fidelity.');
  if (layers.length > 24) warnings.push('Many layers (>24): consider merging for fewer draw calls.');

  return {
    layerCount: layers.length,
    pathCountTotal,
    complexity,
    estimatedVertices,
    withinBudget,
    layers,
    recommended: { scene, depthRange: [Math.min(...depths), Math.max(...depths)], curveSegments },
    warnings,
  };
}

/** Per-layer standalone SVGs (each `<g>` wrapped with the root viewBox). */
export function buildLayerSvgs(svg: string): { id: string; svg: string }[] {
  const viewBox = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 1024 1024';
  return topLevelGroups(svg)
    .filter((g) => countDrawables(g.content) > 0)
    .map((g, i) => ({
      id: g.id || `layer_${i}`,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><g${g.attrs}>${g.content}</g></svg>`,
    }));
}

/**
 * Z offset per layer for depth stacking (#3): order 0 sits at the front (z=0),
 * each subsequent layer is pushed back behind the previous one's thickness.
 * `gap` adds extra spacing (>0 → exploded view).
 */
export function layerTransforms(profile: AssetProfile, gap = 0): { id: string; z: number }[] {
  let z = 0;
  return profile.layers.map((l, i) => {
    if (i > 0) z -= profile.layers[i - 1].depth / 2 + l.depth / 2 + gap;
    return { id: l.id, z };
  });
}
