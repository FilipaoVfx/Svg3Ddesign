/**
 * High-LOD export (PRD v2.1, Phase 3 — export high-LOD).
 *
 * The viewport renders at 'draft' LOD for 60fps. This builds a headless,
 * one-off THREE.Group at 'high' LOD (crisp curves/bevels) purely for the GLB
 * download, then exports and disposes it — the interactive scene is never
 * touched. GLB carries geometry only (flat per-layer material colors, no
 * gradient textures) to keep the file lean and portable.
 *
 * Needs the DOM (SVGLoader) → browser only.
 */
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { analyzeSvg, layerTransforms, applyOverrides, pickGranularity } from './intelligence';
import { chooseLod, type Quality } from './lod';
import { downloadBlob } from './export';
import { makeGradientTextures, type GradientTextures } from './gradientTextures';
import type { MaterialPreset } from './types';

export interface ExportOverride {
  depth?: number;
  material?: MaterialPreset;
  color?: string;
  visible?: boolean;
}
export type ExportOverrides = Record<string, ExportOverride>;

function exportMaterial(preset: MaterialPreset | undefined, fill?: string, textures?: GradientTextures | null): THREE.MeshStandardMaterial {
  const color = new THREE.Color(fill && /^#?[0-9a-f]{3,8}$/i.test(fill) ? fill : '#c8ccd2');
  // Real gradient baked into the GLB: gradient as the color map + Sobel normal
  // map. GLTFExporter writes the offset/repeat as KHR_texture_transform (the
  // textures are flipY=false, glTF-native orientation).
  const grad = textures
    ? { color: new THREE.Color('#ffffff'), map: textures.map, normalMap: textures.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }
    : {};
  switch (preset) {
    case 'metal': return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.28, ...grad });
    case 'chrome': return new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffffff'), metalness: 1, roughness: 0.04, ...grad });
    case 'gold': return new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffd24a'), metalness: 1, roughness: 0.2 });
    case 'emissive': return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, roughness: 0.4, ...grad });
    case 'glass': return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.6, ...grad });
    case 'plastic': return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55, ...grad });
    default: return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.45, ...grad });
  }
}

function layerIdForNode(node: Element | null): string {
  let id = '', n: Element | null = node;
  while (n) { if (n.tagName?.toLowerCase() === 'g' && n.getAttribute('id')) id = n.getAttribute('id') || id; n = n.parentElement; }
  return id;
}

/**
 * Headless build of the layered model at a chosen LOD. Caller owns disposal.
 * Mirrors the viewport builder's geometry/stacking, minus cache & textures.
 */
export function buildExportGroup(svg: string, overrides: ExportOverrides = {}, quality: Quality = 'high', gap = 0): THREE.Group {
  const profile = analyzeSvg(svg);
  const lod = chooseLod(profile, { quality });
  const specById = new Map(profile.layers.map((l) => [l.id, l]));
  const zById = new Map(layerTransforms(applyOverrides(profile, overrides), gap).map((t) => [t.id, t.z]));

  const mode = pickGranularity(svg);
  const parsed = new SVGLoader().parse(svg);
  const isHidden = (node: Element | null) => {
    let n: Element | null = node;
    while (n) { const t = n.tagName?.toLowerCase(); if (t === 'defs' || t === 'mask' || t === 'clippath') return true; n = n.parentElement; }
    return false;
  };
  const renderPaths = parsed.paths.filter((p) => !isHidden((p.userData as { node?: Element })?.node ?? null));

  const maxDim = Math.max(1, ...renderPaths.flatMap((p) => {
    const box = new THREE.Box2();
    p.subPaths.forEach((sp) => sp.getPoints().forEach((pt) => box.expandByPoint(pt)));
    const s = new THREE.Vector2(); box.getSize(s); return [s.x, s.y];
  }));
  const depthScale = maxDim * 0.004;

  const elements: { id: string; shapes: THREE.Shape[] }[] = [];
  if (mode === 'shape') {
    renderPaths.forEach((path, i) => {
      const node = (path.userData as { node?: Element })?.node ?? null;
      elements.push({ id: node?.id || `shape_${i}`, shapes: SVGLoader.createShapes(path) });
    });
  } else {
    const byLayer = new Map<string, THREE.Shape[]>();
    for (const path of renderPaths) {
      const id = layerIdForNode((path.userData as { node?: Element })?.node ?? null) || 'root';
      const arr = byLayer.get(id) ?? []; arr.push(...SVGLoader.createShapes(path)); byLayer.set(id, arr);
    }
    for (const [id, shapes] of byLayer) elements.push({ id, shapes });
  }

  const root = new THREE.Group();
  for (const { id, shapes } of elements) {
    if (!shapes.length) continue;
    const layer = specById.get(id);
    const ov = overrides?.[id];
    if (ov?.visible === false) continue;
    const depth = (ov?.depth ?? layer?.depth ?? 20) * depthScale;
    const bevel = (layer?.bevel ?? 2) * depthScale * 0.4;
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: lod.bevelSegments, curveSegments: lod.curveSegments,
    });
    geo.computeVertexNormals();
    // Same rule as the viewport: real gradient unless the user overrode color.
    const textures = layer?.gradient && layer.bbox && !ov?.color ? makeGradientTextures(layer.gradient, layer.bbox) : null;
    const mesh = new THREE.Mesh(geo, exportMaterial(ov?.material ?? layer?.material ?? 'default', ov?.color ?? layer?.fill, textures));
    mesh.name = id;
    mesh.position.z = (zById.get(id) ?? 0) * depthScale;
    root.add(mesh);
  }
  root.scale.y = -1;

  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3(); const size = new THREE.Vector3();
  box.getCenter(center); box.getSize(size);
  const fit = 4 / (Math.max(size.x, size.y, size.z) || 1);
  const wrapper = new THREE.Group();
  root.position.sub(center); wrapper.add(root); wrapper.scale.setScalar(fit);
  return wrapper;
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => {
      const s = x as THREE.MeshStandardMaterial;
      s.map?.dispose();
      s.normalMap?.dispose();
      x?.dispose();
    });
  });
}

/**
 * Build a HIGH-LOD version of the layered SVG and download it as .glb — crisp
 * output independent of the (draft) viewport. Off-screen; disposes after.
 */
export async function exportHighLodGlb(svg: string, filename = 'svg3d.glb', opts?: { overrides?: ExportOverrides; quality?: Quality; gap?: number }): Promise<void> {
  const group = buildExportGroup(svg, opts?.overrides ?? {}, opts?.quality ?? 'high', opts?.gap ?? 0);
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(group, (g) => resolve(g as ArrayBuffer), (e) => reject(e), { binary: true });
    });
    downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), filename);
  } finally {
    disposeGroup(group);
  }
}
