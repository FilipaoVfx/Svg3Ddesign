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
import { analyzeSvg, type AssetProfile, type Granularity } from './intelligence';
import { hashSvg } from './hash';

type Pending = { resolve: (p: AssetProfile) => void; reject: (e: Error) => void };

let worker: Worker | null | undefined; // undefined = not tried yet · null = unavailable
let nextId = 1;
const pending = new Map<number, Pending>();
const cache = new Map<string, AssetProfile>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') {
      worker = null;
      return worker;
    }
    worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; profile?: AssetProfile; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok && e.data.profile) p.resolve(e.data.profile);
      else p.reject(new Error(e.data.error || 'analysis worker failed'));
    };
    worker.onerror = () => {
      // Worker broke (bad bundle path, CSP…): fail pending over to sync and
      // never use the worker again this session.
      const all = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      all.forEach((p) => p.reject(new Error('analysis worker errored')));
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Analyze an SVG without blocking the main thread when possible.
 * Same result as `analyzeSvg` (cached by content hash + granularity).
 */
export async function analyzeSvgAsync(svg: string, opts?: { granularity?: Granularity }): Promise<AssetProfile> {
  const key = `${hashSvg(svg)}:${opts?.granularity ?? 'auto'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = getWorker();
  let profile: AssetProfile;
  if (w) {
    try {
      profile = await new Promise<AssetProfile>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, svg, granularity: opts?.granularity });
      });
    } catch {
      profile = analyzeSvg(svg, opts); // worker failed → sync fallback
    }
  } else {
    profile = analyzeSvg(svg, opts);
  }
  cache.set(key, profile);
  return profile;
}

/** Terminate the worker and clear the async cache (tests/unmount). */
export function disposeAnalysisWorker(): void {
  worker?.terminate();
  worker = undefined;
  pending.clear();
  cache.clear();
}
