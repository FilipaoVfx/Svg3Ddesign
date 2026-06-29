/**
 * Sync, dependency-free hashing + memoization for caching analysis/geometry/GLB
 * by SVG content. Use the hash as a key for IndexedDB (client) or R2 (server).
 */

import { analyzeSvg, type AssetProfile } from './intelligence';

/** FNV-1a 32-bit hash of a string → 8-char hex. Stable and fast. */
export function hashSvg(svg: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) {
    h ^= svg.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const profileCache = new Map<string, AssetProfile>();

/** analyzeSvg memoized by content hash (in-memory). */
export function analyzeSvgCached(svg: string): AssetProfile {
  const key = hashSvg(svg);
  let profile = profileCache.get(key);
  if (!profile) {
    profile = analyzeSvg(svg);
    profileCache.set(key, profile);
  }
  return profile;
}

/** Clear the in-memory analysis cache. */
export function clearAnalysisCache(): void {
  profileCache.clear();
}
