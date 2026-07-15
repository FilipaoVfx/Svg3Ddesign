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
import { makeGradientTextures } from './gradientTextures';
import { makeMaterial } from './materials';
import type { MaterialPreset } from './types';

export interface ExportOverride {
  depth?: number;
  material?: MaterialPreset;
  color?: string;
  visible?: boolean;
}
export type ExportOverrides = Record<string, ExportOverride>;

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
    // GLTFExporter writes the textures' offset/repeat as KHR_texture_transform
    // (they are flipY=false, glTF-native orientation).
    const textures = layer?.gradient && layer.bbox && !ov?.color ? makeGradientTextures(layer.gradient, layer.bbox) : null;
    const mesh = new THREE.Mesh(geo, makeMaterial(ov?.material ?? layer?.material ?? 'default', ov?.color ?? layer?.fill, textures, { forExport: true }));
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
 * Shrink a GLB with weld + quantize (KHR_mesh_quantization): pure JS, no WASM,
 * decodable by Blender/three/Babylon without extra decoders. High-LOD meshes
 * are vertex-heavy, so 16/10-bit attributes cut the file roughly in half.
 * Best-effort: any failure returns the original buffer.
 */
async function compressGlb(glb: ArrayBuffer): Promise<Uint8Array | ArrayBuffer> {
  try {
    const [{ WebIO }, { ALL_EXTENSIONS }, { weld, quantize }] = await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/extensions'),
      import('@gltf-transform/functions'),
    ]);
    const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.readBinary(new Uint8Array(glb));
    await doc.transform(weld(), quantize());
    return await io.writeBinary(doc);
  } catch {
    return glb; // uncompressed beats a failed download
  }
}

/**
 * Build a HIGH-LOD version of the layered SVG and download it as .glb — crisp
 * output independent of the (draft) viewport. Off-screen; disposes after.
 * Compressed by default (weld + quantize); pass `compress: false` to skip.
 */
export async function exportHighLodGlb(svg: string, filename = 'svg3d.glb', opts?: { overrides?: ExportOverrides; quality?: Quality; gap?: number; compress?: boolean }): Promise<void> {
  const group = buildExportGroup(svg, opts?.overrides ?? {}, opts?.quality ?? 'high', opts?.gap ?? 0);
  let result: ArrayBuffer;
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    result = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(group, (g) => resolve(g as ArrayBuffer), (e) => reject(e), { binary: true });
    });
  } finally {
    disposeGroup(group);
  }
  const bytes = opts?.compress === false ? result : await compressGlb(result);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }), filename);
}
