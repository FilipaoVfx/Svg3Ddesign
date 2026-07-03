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
import type * as THREE from 'three';

export interface RefCache<V> {
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

export function createRefCache<V>(opts: { max: number; dispose: (v: V) => void }): RefCache<V> {
  const { max, dispose } = opts;
  // Map iteration order = insertion order → we treat the FRONT as least-recent.
  const map = new Map<string, { value: V; refs: number }>();

  const touch = (key: string, entry: { value: V; refs: number }) => {
    map.delete(key);
    map.set(key, entry); // re-insert at the back → most-recent
  };

  const evictIfNeeded = () => {
    if (map.size <= max) return;
    for (const [k, e] of [...map]) {
      if (map.size <= max) break;
      if (e.refs === 0) {
        dispose(e.value);
        map.delete(k);
      }
    }
  };

  return {
    acquire(key, factory) {
      const hit = map.get(key);
      if (hit) {
        hit.refs++;
        touch(key, hit);
        return hit.value;
      }
      const value = factory();
      map.set(key, { value, refs: 1 });
      evictIfNeeded();
      return value;
    },
    release(key) {
      const e = map.get(key);
      if (!e) return;
      if (e.refs > 0) e.refs--;
      evictIfNeeded();
    },
    size: () => map.size,
    refs: (key) => map.get(key)?.refs ?? 0,
    clear() {
      for (const e of map.values()) dispose(e.value);
      map.clear();
    },
  };
}

/** Shared geometry cache for the renderer (bounded by entry count). */
export const geometryCache: RefCache<THREE.BufferGeometry> = createRefCache<THREE.BufferGeometry>({
  max: 96,
  dispose: (g) => g.dispose(),
});

/** Stable cache key for an extruded layer geometry (same shapes ⇒ same id per SVG). */
export function geoKey(
  svgHash: string,
  id: string,
  depth: number,
  bevel: number,
  curveSegments: number,
  bevelSegments: number,
): string {
  // Round depth so slider micro-steps collapse to shared entries.
  return `${svgHash}|${id}|d${depth.toFixed(2)}|b${bevel}|c${curveSegments}|s${bevelSegments}`;
}
