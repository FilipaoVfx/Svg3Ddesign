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

export interface GradientStop {
  /** 0..1 position along the gradient axis. */
  offset: number;
  /** Resolved CSS color (hex/rgb/named as authored). */
  color: string;
}

export interface GradientSpec {
  type: 'linear' | 'radial';
  stops: GradientStop[];
  /** linear: [x1, y1, x2, y2] · radial: [cx, cy, r]. */
  coords: number[];
  /** true = objectBoundingBox units (SVG default); false = userSpaceOnUse. */
  boundingBoxUnits: boolean;
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const f = parseFloat(v);
  if (Number.isNaN(f)) return fallback;
  return v.trim().endsWith('%') ? f / 100 : f;
}

function attr(tag: string, name: string): string | undefined {
  return (tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)) || [])[1];
}

/** Opening tag + inner content of a gradient element by id (self-closing ok). */
function findGradient(svg: string, id: string): { type: 'linear' | 'radial'; tag: string; inner: string } | null {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<(linear|radial)Gradient([^>]*id="${esc}"[^>]*?)(/>|>([\\s\\S]*?)</\\1Gradient>)`,
  );
  const m = svg.match(re);
  if (!m) return null;
  return { type: m[1] as 'linear' | 'radial', tag: m[2], inner: m[4] || '' };
}

/** `<stop>` list from gradient inner markup (attribute or style syntax). */
function parseStops(inner: string): GradientStop[] {
  const out: GradientStop[] = [];
  for (const m of inner.matchAll(/<stop\b([^>]*)>/g)) {
    const a = m[1];
    const color =
      attr(a, 'stop-color') ||
      (a.match(/style="[^"]*stop-color:\s*([^;"]+)/) || [])[1];
    if (!color) continue;
    out.push({ offset: Math.max(0, Math.min(1, num(attr(a, 'offset'), 0))), color: color.trim() });
  }
  return out;
}

/**
 * Extract a GradientSpec for a fill reference (`url(#id)` or a bare id).
 * Follows one `href`/`xlink:href` hop for stops (common in exported SVGs).
 * Returns null for flat fills / unknown ids.
 */
export function extractGradient(fill: string | undefined, svg: string): GradientSpec | null {
  if (!fill) return null;
  const id = (fill.match(/url\(#([^)]+)\)/) || [])[1] ?? (fill.startsWith('#') ? undefined : undefined);
  const gradId = id ?? (fill.match(/^#?([\w-]+)$/) && !/^#?[0-9a-f]{3,8}$/i.test(fill) ? fill.replace(/^#/, '') : undefined);
  if (!gradId) return null;

  const g = findGradient(svg, gradId);
  if (!g) return null;

  let stops = parseStops(g.inner);
  if (!stops.length) {
    const href = attr(g.tag, 'href') || attr(g.tag, 'xlink:href');
    if (href) {
      const ref = findGradient(svg, href.replace(/^#/, ''));
      if (ref) stops = parseStops(ref.inner);
    }
  }
  if (stops.length < 2) return null;

  const boundingBoxUnits = attr(g.tag, 'gradientUnits') !== 'userSpaceOnUse';
  const coords =
    g.type === 'linear'
      ? [num(attr(g.tag, 'x1'), 0), num(attr(g.tag, 'y1'), 0), num(attr(g.tag, 'x2'), 1), num(attr(g.tag, 'y2'), 0)]
      : [num(attr(g.tag, 'cx'), 0.5), num(attr(g.tag, 'cy'), 0.5), num(attr(g.tag, 'r'), 0.5)];

  return { type: g.type, stops, coords, boundingBoxUnits };
}
