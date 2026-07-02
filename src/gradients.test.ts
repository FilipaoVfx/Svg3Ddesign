import { describe, it, expect } from 'vitest';
import { extractGradient } from './gradients';
import { analyzeSvg } from './intelligence';
import { makeGradientTextures } from './gradientTextures';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff0000"/>
      <stop offset="50%" stop-color="#00ff00"/>
      <stop offset="1" stop-color="#0000ff"/>
    </linearGradient>
    <radialGradient id="rg" cx="0.3" cy="0.4" r="0.6" gradientUnits="userSpaceOnUse">
      <stop offset="0" style="stop-color:#ffffff"/>
      <stop offset="1" stop-color="#000000"/>
    </radialGradient>
    <linearGradient id="stops-src">
      <stop offset="0" stop-color="#111111"/>
      <stop offset="1" stop-color="#eeeeee"/>
    </linearGradient>
    <linearGradient id="via-href" href="#stops-src" x1="0" y1="0" x2="0" y2="1"/>
  </defs>
  <rect x="10" y="10" width="80" height="80" fill="url(#lg)"/>
  <circle cx="50" cy="50" r="20" fill="url(#rg)"/>
</svg>`;

describe('extractGradient (Module 5, pure)', () => {
  it('linear: coords, ordered stops, % offsets', () => {
    const g = extractGradient('url(#lg)', svg)!;
    expect(g.type).toBe('linear');
    expect(g.coords).toEqual([0, 0, 1, 1]);
    expect(g.boundingBoxUnits).toBe(true);
    expect(g.stops).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 0.5, color: '#00ff00' },
      { offset: 1, color: '#0000ff' },
    ]);
  });

  it('radial: userSpaceOnUse + style-attribute stop-color', () => {
    const g = extractGradient('url(#rg)', svg)!;
    expect(g.type).toBe('radial');
    expect(g.boundingBoxUnits).toBe(false);
    expect(g.coords).toEqual([0.3, 0.4, 0.6]);
    expect(g.stops[0].color).toBe('#ffffff');
  });

  it('follows one href hop for stops (self-closing gradient)', () => {
    const g = extractGradient('url(#via-href)', svg)!;
    expect(g.stops.length).toBe(2);
    expect(g.coords).toEqual([0, 0, 0, 1]);
  });

  it('flat fills / unknown ids → null', () => {
    expect(extractGradient('#ff0000', svg)).toBeNull();
    expect(extractGradient('url(#nope)', svg)).toBeNull();
    expect(extractGradient(undefined, svg)).toBeNull();
  });
});

describe('analyzeSvg carries GradientSpec', () => {
  it('gradient layers get spec + averaged fallback fill', () => {
    const p = analyzeSvg(svg);
    const rect = p.layers[0];
    expect(rect.gradient?.type).toBe('linear');
    expect(rect.fill).toMatch(/^#[0-9a-f]{6}$/i); // averaged fallback still present
    const circle = p.layers[1];
    expect(circle.gradient?.type).toBe('radial');
  });

  it('profile stays structured-clone friendly (worker transport)', () => {
    const p = analyzeSvg(svg);
    expect(() => structuredClone(p)).not.toThrow();
  });
});

describe('makeGradientTextures (SSR guard)', () => {
  it('returns null without a DOM (never crashes in worker/tests)', () => {
    const g = extractGradient('url(#lg)', svg)!;
    expect(makeGradientTextures(g, { x: 10, y: 10, w: 80, h: 80 })).toBeNull();
  });
});
