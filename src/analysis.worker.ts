/**
 * Analysis Worker (PRD v2.1, C6) — runs the whole SVG Intelligence + Spatial
 * Reconstruction pipeline off the main thread. The intelligence layer is pure
 * and DOM-free by design, so it bundles cleanly into a worker; the resulting
 * AssetProfile is plain JSON → structured-clone friendly.
 *
 * Geometry (SVGLoader/ExtrudeGeometry) stays on the main thread: SVGLoader
 * needs the DOM and BufferGeometry cannot be built in a worker (C6 split).
 */
import { analyzeSvg, type Granularity } from './intelligence';

interface AnalyzeRequest {
  id: number;
  svg: string;
  granularity?: Granularity;
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { id, svg, granularity } = e.data;
  try {
    const profile = analyzeSvg(svg, granularity ? { granularity } : undefined);
    (self as unknown as Worker).postMessage({ id, ok: true, profile });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
