import * as react from 'react';
import { SVG3DProps, MaterialPreset } from '3dsvg/types';
export { MaterialPreset, SVG3DProps } from '3dsvg/types';
import * as THREE from 'three';

type PresetName = 'neon' | 'glitch' | 'chrome' | 'gold' | 'glass';
interface Svg3DProps extends SVG3DProps {
    /** CrackingWall visual preset applied before your prop overrides. */
    preset?: PresetName;
    /**
     * Callback with the Three.js scene once the canvas is created — used for GLB
     * export. Requires the engine to expose it (3dsvg `registerScene`, available
     * via the consumer-side patch until upstream merges it).
     */
    registerScene?: (scene: unknown) => void;
}

/**
 * CrackingWall's opinionated wrapper over 3dsvg's <SVG3D>.
 * Pass `preset` for an on-brand look, override any 3dsvg prop directly.
 */
declare function Svg3D({ preset, ...props }: Svg3DProps): react.JSX.Element;

type Quality = 'draft' | 'high';
interface LodOptions {
    /** 'draft' (default) for interactive viewport, 'high' for export. */
    quality?: Quality;
    /** Use the mobile budget + lower ceilings. */
    isMobile?: boolean;
    /** Override the triangle budget (defaults to desktop/mobile per isMobile). */
    budget?: number;
}
interface LodResult {
    curveSegments: number;
    bevelSegments: number;
    /** Triangle budget used for the decision. */
    budget: number;
    /** True if we had to drop below the quality ceiling to fit the budget. */
    reduced: boolean;
}
/**
 * Choose curve/bevel segments for an asset. Starts at the quality ceiling for
 * the device, then reduces curveSegments (down to MIN_CURVE) until the
 * estimated triangles fit the budget.
 */
declare function chooseLod(profile: {
    pathCountTotal: number;
    recommended: {
        curveSegments: number;
    };
}, opts?: LodOptions): LodResult;
/** SSR-safe coarse-pointer / small-screen check for auto mobile LOD. */
declare function detectMobile(): boolean;

/**
 * Scene presets — lighting/environment configs that `analyzeSvg` recommends and
 * a renderer can apply. Plain data; no Three.js dependency.
 */
type SceneName = 'studio' | 'cyberpunk' | 'industrial' | 'minimal';
interface ScenePreset {
    /** Canvas background ("transparent" or a hex). */
    background: string;
    ambientIntensity: number;
    lightIntensity: number;
    lightPosition: [number, number, number];
    /** ACES tone-mapping exposure. */
    exposure: number;
    /** drei <Environment> preset hint (or "neutral"). */
    environment: 'studio' | 'city' | 'warehouse' | 'night' | 'neutral';
}
declare const SCENE_PRESETS: Record<SceneName, ScenePreset>;

interface LayeredSvg3DProps {
    svg: string;
    /** Extra spacing between layers (>0 → exploded view). */
    gap?: number;
    /** Scene preset; defaults to the one analyzeSvg recommends. */
    scene?: SceneName;
    /**
     * Geometry LOD: 'draft' (default) = low-poly for a 60fps viewport;
     * 'high' = crisp (for export). Both auto-reduce to fit the triangle budget.
     */
    quality?: Quality;
    /** Per-id overrides for sculpting each layer (optional). */
    overrides?: Record<string, {
        depth?: number;
        material?: MaterialPreset;
        color?: string;
        visible?: boolean;
    }>;
    registerScene?: (scene: THREE.Scene) => void;
    registerCanvas?: (canvas: HTMLCanvasElement) => void;
}
/**
 * Layered SVG → 3D renderer: extrudes each `<g id>` layer at its own depth and
 * material (from analyzeSvg or overrides), aligned and z-stacked. Client-only.
 */
declare function LayeredSvg3D({ svg, gap, scene, quality, overrides, registerScene, registerCanvas }: LayeredSvg3DProps): react.JSX.Element;

/** Curated CrackingWall looks (material + colour + light + motion). */
declare const PRESETS: Record<PresetName, Partial<SVG3DProps>>;

/**
 * Client-side export helpers. Framework-agnostic; safe to tree-shake.
 *
 * PNG works because the engine's <Canvas> is created with
 * `preserveDrawingBuffer: true`, so the WebGL canvas can be read back.
 * Grab the canvas via the `registerCanvas` prop on <Svg3D>.
 */
/** Convert a WebGL canvas to a PNG Blob. */
declare function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob>;
/** Trigger a browser download for any Blob. */
declare function downloadBlob(blob: Blob, filename: string): void;
/** Capture a canvas and download it as a PNG. */
declare function exportCanvasPng(canvas: HTMLCanvasElement, filename?: string): Promise<void>;
/**
 * Export the 3D model to a binary glTF (.glb). Pass the scene captured via the
 * `registerScene` prop on <Svg3D>. Exports the model group (the ExtrudeGeometry
 * mesh and its transform) and skips lights / contact shadows.
 *
 * GLTFExporter is dynamically imported so it only loads when GLB is used.
 */
declare function exportSceneGlb(scene: unknown, filename?: string): Promise<void>;
/** Strip scripts and inline event handlers from untrusted SVG markup. */
declare function sanitizeSvg(svg: string): string;
/** Read an uploaded SVG file into a sanitized SVG string. Rejects non-SVG. */
declare function readSvgFile(file: File): Promise<string>;

/**
 * Spatial Reconstruction v1 (PRD v2.1, Module 6 — correction C3).
 *
 * Replaces "depth = paint-order index" with a hybrid Depth Graph:
 *   - paint order stays the PRIOR (author intent),
 *   - refined with spatial signals from bounding boxes:
 *       · DISJOINT elements share a level (two eyes sit at the same height),
 *       · OVERLAPPING elements stack by paint order,
 *       · CONTAINED elements rise as relief above their container.
 *
 * Pure, DOM-free and dependency-free (regex/number scanning only), so it is
 * safe to run inside a Web Worker (C6). Bboxes are conservative: for paths we
 * bound over all command coordinates incl. Bézier control points (a cubic is
 * contained in its control hull). Arcs contribute endpoints only (documented
 * v1 approximation).
 */
interface BBox {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** Conservative bbox of a path `d` attribute (tracks abs/rel commands). */
declare function pathBBox(d: string): BBox | null;
/** Bbox for any drawable tag from its attribute string (null if unknown). */
declare function shapeBBox(tag: string, attrs: string): BBox | null;
/** Strict area overlap (shared edges/touching do NOT count). */
declare function overlaps(a: BBox, b: BBox): boolean;
/** `outer` fully contains `inner` (with a tiny tolerance). */
declare function contains(outer: BBox, inner: BBox, eps?: number): boolean;
/**
 * Depth Graph v1 (C3 hybrid). Iterates in paint order; each element's level is
 * one above the highest earlier element it overlaps (or contains / is contained
 * by). Elements with no overlap below them sit at level 0 — so disjoint
 * siblings (two eyes, two ears) share a height instead of stacking endlessly.
 * Elements without a bbox fall back to pure painter stacking (prev level + 1).
 */
declare function assignLevels(bboxes: (BBox | null)[]): number[];

/**
 * Gradient Intelligence — pure extraction (PRD v2.1, Module 5 / C7).
 *
 * Parses a layer's gradient definition into a plain-JSON GradientSpec so the
 * renderer can rebuild the REAL gradient as a color texture and derive a
 * normal-map relief from its luminance ramp — instead of collapsing stops to
 * one averaged flat color. DOM-free (regex) → worker-safe & clone-friendly.
 *
 * Per C7 the relief is normal-map based (≈0 extra geometry); real displacement
 * is reserved for high-LOD export, never the viewport.
 */
interface GradientStop {
    /** 0..1 position along the gradient axis. */
    offset: number;
    /** Resolved CSS color (hex/rgb/named as authored). */
    color: string;
}
interface GradientSpec {
    type: 'linear' | 'radial';
    stops: GradientStop[];
    /** linear: [x1, y1, x2, y2] · radial: [cx, cy, r]. */
    coords: number[];
    /** true = objectBoundingBox units (SVG default); false = userSpaceOnUse. */
    boundingBoxUnits: boolean;
}
/**
 * Extract a GradientSpec for a fill reference (`url(#id)` or a bare id).
 * Follows one `href`/`xlink:href` hop for stops (common in exported SVGs).
 * Returns null for flat fills / unknown ids.
 */
declare function extractGradient(fill: string | undefined, svg: string): GradientSpec | null;

/**
 * SVG Intelligence — interprets an SVG as a layered creative asset instead of a
 * flat list of paths. Pure, dependency-free and DOM-free (regex/scan based), so
 * it's fast and safe to run in a Web Worker. No GPU, no rendering.
 *
 * Reads top-level `<g id="...">` groups and infers, per layer, a role →
 * material + extrusion depth/bevel from the id AND the fill, plus a recommended
 * scene, a rough geometry budget and performance warnings.
 */

type LayerRole = 'glass' | 'metal' | 'plastic' | 'screen' | 'light' | 'structure' | 'detail' | 'unknown';
interface SvgLayer {
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
    /** Conservative bounding box in SVG coords (shape granularity only). */
    bbox?: BBox | null;
    /**
     * Depth-graph level (Spatial Reconstruction v1): 0 = base; overlapping
     * elements stack a level above what they cover; disjoint siblings share a
     * level. Absent in group granularity (painter stacking applies).
     */
    level?: number;
    /**
     * Real gradient definition when the fill is a gradient reference (Module 5).
     * `fill` still carries the averaged hex as a flat fallback color.
     */
    gradient?: GradientSpec | null;
}
interface AssetProfile {
    layerCount: number;
    pathCountTotal: number;
    complexity: 'low' | 'medium' | 'high';
    /** Rough estimate of extruded vertices (advisory, not exact). */
    estimatedVertices: number;
    /** Rough estimate of extruded triangles (advisory) — official budget unit (C2). */
    estimatedTriangles: number;
    withinBudget: boolean;
    layers: SvgLayer[];
    recommended: {
        scene: SceneName;
        depthRange: [number, number];
        curveSegments: number;
    };
    warnings: string[];
}
/** @deprecated Legacy vertex target — the official budget unit is triangles (C2). */
declare const VERTEX_BUDGET = 300000;
/** Official geometry budget in triangles (PRD v2.1, C2). */
declare const TRIANGLE_BUDGET: {
    readonly desktop: 250000;
    readonly mobile: 80000;
};
interface RawGroup {
    id: string;
    attrs: string;
    content: string;
}
/** Extract top-level `<g>` groups via a depth-aware linear scan (handles nesting). */
declare function topLevelGroups(svg: string): RawGroup[];
declare function resolveFillColor(fill: string | undefined, svg: string): string | undefined;
/** Rough vertex estimate for the whole asset (advisory). */
declare function estimateVertices(pathCount: number, curveSegments: number): number;
/**
 * Rough triangle estimate (advisory) — official budget unit (C2). Extrusion
 * yields ~2 cap fans + wall quads (2 tris each) + bevel rings per contour
 * point; ≈1.5 triangles per emitted vertex at icon scale.
 */
declare function estimateTriangles(pathCount: number, curveSegments: number): number;
type Granularity = 'auto' | 'group' | 'shape';
/** Each individual drawable as its own element (fine granularity). */
declare function extractShapes(svg: string): {
    id: string;
    tag: string;
    attrs: string;
    fill?: string;
}[];
/** Use authored groups when they have ids; otherwise fall to per-shape (icons). */
declare function pickGranularity(svg: string): 'group' | 'shape';
/**
 * Interpret an SVG string into an AssetProfile. Granularity 'auto' uses the
 * authored `<g id>` groups when present, else segments per individual shape
 * (best for icons — captures every element).
 */
declare function analyzeSvg(svg: string, opts?: {
    granularity?: Granularity;
}): AssetProfile;
/**
 * New profile with sculpt overrides applied to layer depths, so that
 * `layerTransforms` restacks correctly when the user changes a layer's depth
 * (previously the meshes changed but the z-offsets used the original depths).
 */
declare function applyOverrides(profile: AssetProfile, overrides?: Record<string, {
    depth?: number;
}>): AssetProfile;
/** Per-layer standalone SVGs (each `<g>` wrapped with the root viewBox). */
declare function buildLayerSvgs(svg: string): {
    id: string;
    svg: string;
}[];
/**
 * Z offset per layer.
 *
 * With Spatial Reconstruction levels (shape granularity): layers stack by
 * depth-graph LEVEL, so disjoint siblings (two eyes, two ears) share a height
 * and only true overlaps rise — paint order stays the prior for ties (C3).
 *
 * Without levels (group granularity / fallback): the painter's model — SVG
 * draw order = stacking height, each later element pushed forward above the
 * previous one. `gap` adds extra spacing (>0 → exploded view).
 */
declare function layerTransforms(profile: AssetProfile, gap?: number): {
    id: string;
    z: number;
}[];

/**
 * Client for the analysis worker (PRD v2.1, C6) with graceful degradation.
 *
 * `analyzeSvgAsync` resolves an AssetProfile:
 *   1. from the in-memory hash cache (instant),
 *   2. else in the Analysis Worker (keeps the main thread <4ms budget),
 *   3. else — no Worker support (SSR, test env, worker-src CSP, legacy
 *      bundler) — synchronously on the main thread, exactly as before.
 *
 * The worker is a lazy singleton created via
 * `new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' })`,
 * the pattern Vite/webpack5/Astro resolve at build time. Any construction or
 * runtime error permanently flips to the sync fallback (never breaks callers).
 */

/**
 * Analyze an SVG without blocking the main thread when possible.
 * Same result as `analyzeSvg` (cached by content hash + granularity).
 */
declare function analyzeSvgAsync(svg: string, opts?: {
    granularity?: Granularity;
}): Promise<AssetProfile>;
/** Terminate the worker and clear the async cache (tests/unmount). */
declare function disposeAnalysisWorker(): void;

/**
 * Sync, dependency-free hashing + memoization for caching analysis/geometry/GLB
 * by SVG content. Use the hash as a key for IndexedDB (client) or R2 (server).
 */

/** FNV-1a 32-bit hash of a string → 8-char hex. Stable and fast. */
declare function hashSvg(svg: string): string;
/** analyzeSvg memoized by content hash (in-memory). */
declare function analyzeSvgCached(svg: string): AssetProfile;
/** Clear the in-memory analysis cache. */
declare function clearAnalysisCache(): void;

/**
 * Gradient Intelligence — texture synthesis (Module 5 / C7, main thread).
 *
 * Turns a GradientSpec into:
 *   - `map`: the REAL gradient as a color texture (instead of the averaged
 *     flat hex), drawn in the layer's local space so ExtrudeGeometry's
 *     position-based UVs line up via texture offset/repeat, and
 *   - `normalMap`: relief derived from the gradient's luminance ramp (Sobel),
 *     giving "sculpted" surface shading at ~zero geometry cost (C7).
 *
 * Needs a canvas → never runs in the worker; returns null under SSR/tests.
 */

interface GradientTextures {
    map: THREE.CanvasTexture;
    normalMap: THREE.CanvasTexture;
}
/**
 * Build color + normal textures for a layer gradient, aligned to the layer's
 * bbox in SVG space (ExtrudeGeometry UVs are raw shape coordinates, so
 * offset/repeat maps them into the texture). Returns null without a DOM.
 */
declare function makeGradientTextures(spec: GradientSpec, bbox: BBox): GradientTextures | null;

/**
 * Geometry cache (PRD v2.1, Phase 3 — "Geometry Cache").
 *
 * A reference-counted LRU so re-mounting the same SVG or scrubbing a depth
 * slider back to a previous value REUSES the extruded geometry instead of
 * re-triangulating it. Extrusion (ExtrudeGeometry) is the heaviest step, so
 * cache hits make those interactions instant.
 *
 * Safety invariant (avoids GPU leaks & disposed-geometry render errors):
 *   - callers NEVER dispose a cached value directly — they `acquire`/`release`;
 *   - only the cache disposes, and only on eviction of an entry with refs === 0.
 * An in-use entry (refs > 0) is never evicted, so a live mesh can never end up
 * pointing at a disposed geometry.
 *
 * The core is generic (no Three dependency) so it is unit-testable in Node;
 * the exported `geometryCache` binds it to THREE.BufferGeometry.
 */

interface RefCache<V> {
    /** Return the cached value for `key`, or create+store it. Increments refs. */
    acquire(key: string, factory: () => V): V;
    /** Signal a holder no longer needs `key`. Decrements refs (never below 0). */
    release(key: string): void;
    /** Current number of entries (in-use + idle). */
    size(): number;
    /** For diagnostics/tests. */
    refs(key: string): number;
    /** Dispose every entry (idle and in-use) and empty the cache. */
    clear(): void;
}
declare function createRefCache<V>(opts: {
    max: number;
    dispose: (v: V) => void;
}): RefCache<V>;
/** Shared geometry cache for the renderer (bounded by entry count). */
declare const geometryCache: RefCache<THREE.BufferGeometry>;
/** Stable cache key for an extruded layer geometry (same shapes ⇒ same id per SVG). */
declare function geoKey(svgHash: string, id: string, depth: number, bevel: number, curveSegments: number, bevelSegments: number): string;

export { type AssetProfile, type BBox, type GradientSpec, type GradientStop, type GradientTextures, type Granularity, type LayerRole, LayeredSvg3D, type LayeredSvg3DProps, type LodOptions, type LodResult, PRESETS, type PresetName, type Quality, type RawGroup, type RefCache, SCENE_PRESETS, type SceneName, type ScenePreset, Svg3D, type Svg3DProps, type SvgLayer, TRIANGLE_BUDGET, VERTEX_BUDGET, analyzeSvg, analyzeSvgAsync, analyzeSvgCached, applyOverrides, assignLevels, buildLayerSvgs, canvasToPngBlob, chooseLod, clearAnalysisCache, contains, createRefCache, detectMobile, disposeAnalysisWorker, downloadBlob, estimateTriangles, estimateVertices, exportCanvasPng, exportSceneGlb, extractGradient, extractShapes, geoKey, geometryCache, hashSvg, layerTransforms, makeGradientTextures, overlaps, pathBBox, pickGranularity, readSvgFile, resolveFillColor, sanitizeSvg, shapeBBox, topLevelGroups };
