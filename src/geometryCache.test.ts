import { describe, it, expect, vi } from 'vitest';
import { createRefCache, geoKey } from './geometryCache';

const mk = (max: number) => {
  const dispose = vi.fn();
  const cache = createRefCache<{ id: number }>({ max, dispose });
  return { cache, dispose };
};

describe('createRefCache — hit / miss / refcount', () => {
  it('miss creates, hit reuses same value and bumps refs', () => {
    const { cache } = mk(10);
    const factory = vi.fn(() => ({ id: 1 }));
    const a = cache.acquire('k', factory);
    const b = cache.acquire('k', factory);
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1); // only built once
    expect(cache.refs('k')).toBe(2);
  });

  it('release decrements but keeps the entry cached (idle)', () => {
    const { cache, dispose } = mk(10);
    cache.acquire('k', () => ({ id: 1 }));
    cache.release('k');
    expect(cache.refs('k')).toBe(0);
    expect(cache.size()).toBe(1); // still cached for reuse
    expect(dispose).not.toHaveBeenCalled();
    // reuse after release → no rebuild
    const factory = vi.fn(() => ({ id: 2 }));
    const v = cache.acquire('k', factory);
    expect(v.id).toBe(1);
    expect(factory).not.toHaveBeenCalled();
  });

  it('release never goes below 0', () => {
    const { cache } = mk(10);
    cache.acquire('k', () => ({ id: 1 }));
    cache.release('k');
    cache.release('k');
    cache.release('k');
    expect(cache.refs('k')).toBe(0);
  });
});

describe('createRefCache — eviction (LRU, refs===0 only)', () => {
  it('evicts the least-recently-used idle entry when over budget', () => {
    const { cache, dispose } = mk(2);
    const a = cache.acquire('a', () => ({ id: 1 }));
    cache.release('a');
    cache.acquire('b', () => ({ id: 2 }));
    cache.release('b');
    // adding c exceeds max(2) → evict oldest idle (a)
    cache.acquire('c', () => ({ id: 3 }));
    expect(cache.size()).toBe(2);
    expect(dispose).toHaveBeenCalledWith(a);
    expect(cache.refs('a')).toBe(0);
    expect(cache.size()).toBe(2);
  });

  it('NEVER evicts an in-use entry (the safety invariant)', () => {
    const { cache, dispose } = mk(1);
    const a = cache.acquire('a', () => ({ id: 1 })); // refs=1, kept
    cache.acquire('b', () => ({ id: 2 })); // over budget but a is in use
    cache.release('b');
    // a still in use → not disposed even though over budget
    expect(dispose).not.toHaveBeenCalledWith(a);
    expect(cache.refs('a')).toBe(1);
    // once a is released, the next pressure can evict it
    cache.release('a');
    cache.acquire('c', () => ({ id: 3 }));
    expect(dispose).toHaveBeenCalled();
  });

  it('touch on hit updates recency (a becomes newest, b evicts first)', () => {
    const { cache, dispose } = mk(2);
    const a = cache.acquire('a', () => ({ id: 1 })); cache.release('a');
    const b = cache.acquire('b', () => ({ id: 2 })); cache.release('b');
    cache.acquire('a', () => ({ id: 1 })); cache.release('a'); // a now most-recent
    cache.acquire('c', () => ({ id: 3 })); // evict LRU idle → b
    expect(dispose).toHaveBeenCalledWith(b);
    expect(dispose).not.toHaveBeenCalledWith(a);
  });
});

describe('geoKey', () => {
  it('is stable and collapses depth micro-steps', () => {
    expect(geoKey('abc', 'eye', 20, 2, 10)).toBe('abc|eye|d20.00|b2|c10');
    expect(geoKey('abc', 'eye', 20.001, 2, 10)).toBe(geoKey('abc', 'eye', 20.004, 2, 10));
    expect(geoKey('abc', 'eye', 20, 2, 10)).not.toBe(geoKey('abc', 'eye', 21, 2, 10));
    expect(geoKey('abc', 'eye', 20, 2, 10)).not.toBe(geoKey('xyz', 'eye', 20, 2, 10));
  });
});
