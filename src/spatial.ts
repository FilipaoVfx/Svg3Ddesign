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

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

function nums(s: string): number[] {
  return (s.match(NUM) || []).map(Number);
}

function attr(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`));
  return m ? parseFloat(m[1]) : 0;
}

/** Conservative bbox of a path `d` attribute (tracks abs/rel commands). */
export function pathBBox(d: string): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cx = 0, cy = 0; // current point
  let sx = 0, sy = 0; // subpath start (for Z)
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const cmdRe = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(d))) {
    const cmd = m[1];
    const rel = cmd >= 'a' && cmd <= 'z';
    const v = nums(m[2]);
    let i = 0;
    switch (cmd.toUpperCase()) {
      case 'M':
      case 'L':
      case 'T':
        while (i + 1 < v.length + 1 && i + 1 <= v.length) {
          if (i + 1 > v.length - 1 && v.length % 2 !== 0) break;
          const x = rel ? cx + v[i] : v[i];
          const y = rel ? cy + v[i + 1] : v[i + 1];
          add(x, y);
          cx = x; cy = y;
          if (cmd.toUpperCase() === 'M' && i === 0) { sx = x; sy = y; }
          i += 2;
          if (i >= v.length) break;
        }
        break;
      case 'H':
        for (; i < v.length; i++) { cx = rel ? cx + v[i] : v[i]; add(cx, cy); }
        break;
      case 'V':
        for (; i < v.length; i++) { cy = rel ? cy + v[i] : v[i]; add(cx, cy); }
        break;
      case 'C':
        for (; i + 5 < v.length; i += 6) {
          const pts = rel
            ? [cx + v[i], cy + v[i + 1], cx + v[i + 2], cy + v[i + 3], cx + v[i + 4], cy + v[i + 5]]
            : v.slice(i, i + 6);
          add(pts[0], pts[1]); add(pts[2], pts[3]); add(pts[4], pts[5]);
          cx = pts[4]; cy = pts[5];
        }
        break;
      case 'S':
      case 'Q':
        for (; i + 3 < v.length; i += 4) {
          const pts = rel
            ? [cx + v[i], cy + v[i + 1], cx + v[i + 2], cy + v[i + 3]]
            : v.slice(i, i + 4);
          add(pts[0], pts[1]); add(pts[2], pts[3]);
          cx = pts[2]; cy = pts[3];
        }
        break;
      case 'A':
        // rx ry rot large sweep x y — endpoints only (conservative-enough v1)
        for (; i + 6 < v.length; i += 7) {
          cx = rel ? cx + v[i + 5] : v[i + 5];
          cy = rel ? cy + v[i + 6] : v[i + 6];
          add(cx, cy);
        }
        break;
      case 'Z':
        cx = sx; cy = sy;
        break;
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Bbox for any drawable tag from its attribute string (null if unknown). */
export function shapeBBox(tag: string, attrs: string): BBox | null {
  switch (tag.toLowerCase()) {
    case 'rect':
      return { x: attr(attrs, 'x'), y: attr(attrs, 'y'), w: attr(attrs, 'width'), h: attr(attrs, 'height') };
    case 'circle': {
      const r = attr(attrs, 'r');
      return { x: attr(attrs, 'cx') - r, y: attr(attrs, 'cy') - r, w: 2 * r, h: 2 * r };
    }
    case 'ellipse': {
      const rx = attr(attrs, 'rx'), ry = attr(attrs, 'ry');
      return { x: attr(attrs, 'cx') - rx, y: attr(attrs, 'cy') - ry, w: 2 * rx, h: 2 * ry };
    }
    case 'line': {
      const x1 = attr(attrs, 'x1'), y1 = attr(attrs, 'y1'), x2 = attr(attrs, 'x2'), y2 = attr(attrs, 'y2');
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    case 'polygon':
    case 'polyline': {
      const pts = nums((attrs.match(/points="([^"]+)"/) || [])[1] || '');
      if (pts.length < 4) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'path': {
      const d = (attrs.match(/\bd="([^"]+)"/) || [])[1];
      return d ? pathBBox(d) : null;
    }
    default:
      return null;
  }
}

/** Strict area overlap (shared edges/touching do NOT count). */
export function overlaps(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** `outer` fully contains `inner` (with a tiny tolerance). */
export function contains(outer: BBox, inner: BBox, eps = 1e-6): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

/**
 * Depth Graph v1 (C3 hybrid). Iterates in paint order; each element's level is
 * one above the highest earlier element it overlaps (or contains / is contained
 * by). Elements with no overlap below them sit at level 0 — so disjoint
 * siblings (two eyes, two ears) share a height instead of stacking endlessly.
 * Elements without a bbox fall back to pure painter stacking (prev level + 1).
 */
export function assignLevels(bboxes: (BBox | null)[]): number[] {
  const levels: number[] = [];
  for (let i = 0; i < bboxes.length; i++) {
    const bb = bboxes[i];
    if (!bb) {
      levels.push(i === 0 ? 0 : levels[i - 1] + 1);
      continue;
    }
    let lv = 0;
    for (let j = 0; j < i; j++) {
      const other = bboxes[j];
      if (other && overlaps(other, bb)) lv = Math.max(lv, levels[j] + 1);
    }
    levels.push(lv);
  }
  return levels;
}
