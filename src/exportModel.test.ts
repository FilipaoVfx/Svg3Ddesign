// @vitest-environment jsdom
/**
 * High-LOD export builder tests. jsdom provides the DOMParser that SVGLoader
 * needs; SVGs here have NO gradients so the canvas-dependent texture path
 * (jsdom has no 2d context) is never hit.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildExportGroup } from './exportModel';
import { analyzeSvg, layerTransforms, applyOverrides } from './intelligence';
import { chooseLod } from './lod';

const TWO_CIRCLES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="#ff0000"/>
  <circle cx="50" cy="50" r="15" fill="#0000ff"/>
</svg>`;

function meshes(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

describe('buildExportGroup', () => {
  it('builds one mesh per layer with ids matching the analysis profile', () => {
    const group = buildExportGroup(TWO_CIRCLES);
    const ms = meshes(group);
    const profile = analyzeSvg(TWO_CIRCLES);
    expect(ms.length).toBe(profile.layers.length);
    const ids = new Set(profile.layers.map((l) => l.id));
    for (const m of ms) expect(ids.has(m.name)).toBe(true);
  });

  it('high quality carries more vertices than draft (crisper curves)', () => {
    const draft = meshes(buildExportGroup(TWO_CIRCLES, {}, 'draft'));
    const high = meshes(buildExportGroup(TWO_CIRCLES, {}, 'high'));
    const count = (ms: THREE.Mesh[]) => ms.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    expect(count(high)).toBeGreaterThan(count(draft));
    // Sanity: matches what chooseLod says for each tier.
    const p = analyzeSvg(TWO_CIRCLES);
    expect(chooseLod(p, { quality: 'high' }).curveSegments).toBeGreaterThan(chooseLod(p, { quality: 'draft' }).curveSegments);
  });

  it('z-stacking matches layerTransforms with overrides applied', () => {
    const profile = analyzeSvg(TWO_CIRCLES);
    const target = profile.layers[profile.layers.length - 1].id;
    const overrides = { [target]: { depth: 60 } };
    const zById = new Map(layerTransforms(applyOverrides(profile, overrides), 0).map((t) => [t.id, t.z]));
    const ms = meshes(buildExportGroup(TWO_CIRCLES, overrides, 'draft'));
    // Meshes store z * depthScale — same z ORDER as the transform table.
    const zOrder = (pairs: [string, number][]) => pairs.sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const fromMeshes = zOrder(ms.map((m) => [m.name, m.position.z] as [string, number]));
    const fromTable = zOrder(ms.map((m) => [m.name, zById.get(m.name) ?? 0] as [string, number]));
    expect(fromMeshes).toEqual(fromTable);
  });

  it('skips layers hidden via overrides', () => {
    const profile = analyzeSvg(TWO_CIRCLES);
    const hide = profile.layers[0].id;
    const ms = meshes(buildExportGroup(TWO_CIRCLES, { [hide]: { visible: false } }));
    expect(ms.length).toBe(profile.layers.length - 1);
    expect(ms.some((m) => m.name === hide)).toBe(false);
  });

  it('applies material and color overrides to the export material', () => {
    const profile = analyzeSvg(TWO_CIRCLES);
    const id = profile.layers[0].id;
    const ms = meshes(buildExportGroup(TWO_CIRCLES, { [id]: { material: 'metal', color: '#00ff00' } }));
    const m = ms.find((x) => x.name === id)!;
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.metalness).toBe(1);
    expect(mat.color.getHexString()).toBe('00ff00');
  });

  it('normalizes the assembly around the origin at a fitted scale', () => {
    const group = buildExportGroup(TWO_CIRCLES);
    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(Math.abs(center.x)).toBeLessThan(0.2);
    expect(Math.abs(center.y)).toBeLessThan(0.2);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(3.5);
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(4.5);
  });
});
