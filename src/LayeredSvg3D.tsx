import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows, OrbitControls } from '@react-three/drei';
import { layerTransforms, pickGranularity, applyOverrides, type AssetProfile, type SvgLayer } from './intelligence';
import { analyzeSvgAsync } from './analysisWorker';
import { hashSvg } from './hash';
import { geometryCache, geoKey } from './geometryCache';
import { makeGradientTextures, type GradientTextures } from './gradientTextures';
import { SCENE_PRESETS, type SceneName } from './scenes';
import type { MaterialPreset } from './types';

export interface LayeredSvg3DProps {
  svg: string;
  /** Extra spacing between layers (>0 → exploded view). */
  gap?: number;
  /** Scene preset; defaults to the one analyzeSvg recommends. */
  scene?: SceneName;
  /** Per-id overrides for sculpting each layer (optional). */
  overrides?: Record<string, { depth?: number; material?: MaterialPreset; color?: string; visible?: boolean }>;
  registerScene?: (scene: THREE.Scene) => void;
  registerCanvas?: (canvas: HTMLCanvasElement) => void;
}

type Overrides = LayeredSvg3DProps['overrides'];

/**
 * Build a Three material from a layer's material preset + fill colour.
 * When gradient textures exist (Module 5), the REAL gradient becomes the color
 * map (base color → white to avoid tinting) and its luminance-derived normal
 * map adds relief shading at ~zero geometry cost (C7).
 */
function makeMaterial(preset: MaterialPreset, fill?: string, textures?: GradientTextures | null): THREE.Material {
  const color = new THREE.Color(fill && /^#?[0-9a-f]{3,8}$/i.test(fill) ? fill : '#c8ccd2');
  const grad = textures
    ? { color: new THREE.Color('#ffffff'), map: textures.map, normalMap: textures.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }
    : {};
  switch (preset) {
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color, transmission: 1, thickness: 1.2, roughness: 0.06, ior: 1.5, transparent: true, metalness: 0, ...grad });
    case 'metal':
      return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.28, ...grad });
    case 'chrome':
      return new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffffff'), metalness: 1, roughness: 0.04, ...grad });
    case 'gold':
      return new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffd24a'), metalness: 1, roughness: 0.2 });
    case 'emissive':
      return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.4, ...grad });
    case 'plastic':
      return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55, ...grad });
    default:
      return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.45, ...grad });
  }
}

/** Top-level <g id> for an SVGLoader path node (outermost id wins). */
function layerIdForNode(node: Element | null): string {
  let id = '';
  let n: Element | null = node;
  while (n) {
    if (n.tagName?.toLowerCase() === 'g' && n.getAttribute('id')) id = n.getAttribute('id') || id;
    n = n.parentElement;
  }
  return id;
}

interface BuiltLayer {
  mesh: THREE.Mesh;
  shapes: THREE.Shape[];
  spec?: SvgLayer;
  /** Current geometry cache key the mesh holds a reference to. */
  geoKey: string;
  /** Gradient color/normal textures (built once per layer, reused on material swaps). */
  textures?: GradientTextures | null;
}

interface BuiltModel {
  wrapper: THREE.Group;
  byId: Map<string, BuiltLayer>;
  profile: AssetProfile;
  svgHash: string;
  depthScale: number;
  curveSegments: number;
  /** Overrides/gap already applied to the meshes (diff base for updates). */
  applied: { overrides?: Overrides; gap: number };
}

function extrude(shapes: THREE.Shape[], depth: number, bevel: number, depthScale: number, curveSegments: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: depth * depthScale,
    bevelEnabled: true,
    bevelThickness: bevel * depthScale * 0.4,
    bevelSize: bevel * depthScale * 0.4,
    // Cap segments hard: icon paths have many bezier curves, and curveSegments
    // multiplies per curve. 10/2 keeps vertices low (60fps) with no visible
    // loss at icon scale; bevel stays subtle.
    bevelSegments: 2,
    curveSegments,
  });
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build one centered, scaled group with one extruded mesh per layer.
 * Single parse → all layers share the SVG coordinate space, so they stay
 * aligned; one global transform centers/scales the whole assembly.
 */
function buildModel(svg: string, gap: number, overrides: Overrides, profile: AssetProfile): BuiltModel {
  const svgHash = hashSvg(svg);
  const specById = new Map(profile.layers.map((l) => [l.id, l]));
  // Stacking uses EFFECTIVE depths (sculpt overrides applied) so changing a
  // layer's depth restacks the levels above it instead of overlapping.
  const zById = new Map(layerTransforms(applyOverrides(profile, overrides), gap).map((t) => [t.id, t.z]));

  const mode = pickGranularity(svg);
  const parsed = new SVGLoader().parse(svg);

  // Skip non-rendered paths (inside <defs>/<mask>/<clipPath>)
  const isHidden = (node: Element | null): boolean => {
    let n: Element | null = node;
    while (n) {
      const t = n.tagName?.toLowerCase();
      if (t === 'defs' || t === 'mask' || t === 'clippath') return true;
      n = n.parentElement;
    }
    return false;
  };
  const renderPaths = parsed.paths.filter((p) => !isHidden((p.userData as { node?: Element })?.node ?? null));

  const maxDim = Math.max(1, ...renderPaths.flatMap((p) => {
    const box = new THREE.Box2();
    p.subPaths.forEach((sp) => sp.getPoints().forEach((pt) => box.expandByPoint(pt)));
    const s = new THREE.Vector2();
    box.getSize(s);
    return [s.x, s.y];
  }));
  const depthScale = maxDim * 0.004;
  const curveSegments = Math.min(profile.recommended.curveSegments, 10);

  // Segment into elements. 'shape' = one element per drawable (icons → captures
  // every part: pupils, rings, teeth…); 'group' = by authored <g id>.
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
      const arr = byLayer.get(id) ?? [];
      arr.push(...SVGLoader.createShapes(path));
      byLayer.set(id, arr);
    }
    for (const [id, shapes] of byLayer) elements.push({ id, shapes });
  }

  const root = new THREE.Group();
  const byId = new Map<string, BuiltLayer>();
  for (const { id, shapes } of elements) {
    if (!shapes.length) continue;
    const layer = specById.get(id);
    const ov = overrides?.[id];
    const depth = ov?.depth ?? layer?.depth ?? 20;
    const bevel = layer?.bevel ?? 2;
    // Real gradient → color texture + luminance normal map (Module 5). A user
    // color override means "flat color" → skip the gradient map.
    const textures = layer?.gradient && layer.bbox && !ov?.color ? makeGradientTextures(layer.gradient, layer.bbox) : null;
    const material = makeMaterial(ov?.material ?? layer?.material ?? 'default', ov?.color ?? layer?.fill, textures);
    // Geometry Cache: reuse the extruded geometry across re-mounts / depth
    // scrubbing. The mesh borrows a reference; only the cache disposes.
    const key = geoKey(svgHash, id, depth, bevel, curveSegments);
    const geometry = geometryCache.acquire(key, () => extrude(shapes, depth, bevel, depthScale, curveSegments));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = id;
    mesh.position.z = (zById.get(id) ?? 0) * depthScale;
    // Hidden layers are built but not rendered, so toggling visibility later
    // is an O(1) flag flip instead of a rebuild (Smart Regeneration).
    mesh.visible = ov?.visible !== false;
    root.add(mesh);
    byId.set(id, { mesh, shapes, spec: layer, textures, geoKey: key });
  }

  // SVG y-down → three y-up
  root.scale.y = -1;

  // One global center + fit-to-view scale for the whole assembly
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const fit = 4 / (Math.max(size.x, size.y, size.z) || 1);
  const wrapper = new THREE.Group();
  root.position.sub(center);
  wrapper.add(root);
  wrapper.scale.setScalar(fit);
  return { wrapper, byId, profile, svgHash, depthScale, curveSegments, applied: { overrides, gap } };
}

/**
 * Smart Regeneration (PRD v2.1): apply an overrides/gap change to an existing
 * built model IN PLACE — re-extrude only layers whose depth changed, swap only
 * changed materials, flip visibility flags, and restack z positions. The
 * global center/fit transform is intentionally kept stable while sculpting
 * (no visual jumps).
 */
function applyGranular(built: BuiltModel, overrides: Overrides, gap: number): void {
  const zById = new Map(layerTransforms(applyOverrides(built.profile, overrides), gap).map((t) => [t.id, t.z]));
  const prevAll = built.applied.overrides;

  for (const [id, entry] of built.byId) {
    const { mesh, shapes, spec } = entry;
    const prev = prevAll?.[id];
    const next = overrides?.[id];

    mesh.visible = next?.visible !== false;

    const baseDepth = spec?.depth ?? 20;
    const bevel = spec?.bevel ?? 2;
    const prevDepth = prev?.depth ?? baseDepth;
    const nextDepth = next?.depth ?? baseDepth;
    if (nextDepth !== prevDepth) {
      const newKey = geoKey(built.svgHash, id, nextDepth, bevel, built.curveSegments);
      if (newKey !== entry.geoKey) {
        // Acquire the new geometry (cache hit when scrubbing back to a prior
        // depth), then release the old ref. Never dispose directly.
        const geo = geometryCache.acquire(newKey, () => extrude(shapes, nextDepth, bevel, built.depthScale, built.curveSegments));
        geometryCache.release(entry.geoKey);
        mesh.geometry = geo;
        entry.geoKey = newKey;
      }
    }

    const prevMat = prev?.material ?? spec?.material ?? 'default';
    const nextMat = next?.material ?? spec?.material ?? 'default';
    const prevColor = prev?.color ?? spec?.fill;
    const nextColor = next?.color ?? spec?.fill;
    if (nextMat !== prevMat || nextColor !== prevColor) {
      (mesh.material as THREE.Material).dispose();
      // Color override → flat color (drop the gradient map); otherwise keep
      // the layer's gradient textures across material swaps.
      mesh.material = makeMaterial(nextMat, nextColor, next?.color ? null : entry.textures);
    }

    mesh.position.z = (zById.get(id) ?? 0) * built.depthScale;
  }

  built.applied = { overrides, gap };
}

/**
 * Release a built model: return each layer's geometry reference to the cache
 * (the cache owns geometry disposal) and dispose the per-mesh materials +
 * gradient textures (those are NOT cached). Prevents GPU leaks without ever
 * disposing a geometry that another live model might still be reusing.
 */
function disposeBuilt(built: BuiltModel | null): void {
  if (!built) return;
  for (const entry of built.byId.values()) {
    geometryCache.release(entry.geoKey);
    const mat = entry.mesh.material as THREE.Material | THREE.Material[];
    (Array.isArray(mat) ? mat : [mat]).forEach((m) => m?.dispose());
    entry.textures?.map.dispose();
    entry.textures?.normalMap.dispose();
  }
}

/**
 * Layered SVG → 3D renderer: extrudes each `<g id>` layer at its own depth and
 * material (from analyzeSvg or overrides), aligned and z-stacked. Client-only.
 */
export function LayeredSvg3D({ svg, gap = 0, scene, overrides, registerScene, registerCanvas }: LayeredSvg3DProps) {
  // Analysis runs OFF the main thread (Analysis Worker, C6) with a sync
  // fallback; geometry stays on main (SVGLoader needs the DOM) but is deferred
  // past first paint so the canvas/controls stay responsive.
  const [profile, setProfile] = useState<AssetProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    analyzeSvgAsync(svg).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [svg]);

  // Latest sculpt state, readable from the deferred build without re-triggering it.
  const editRef = useRef<{ overrides: Overrides; gap: number }>({ overrides, gap });
  editRef.current = { overrides, gap };

  // Full (re)build ONLY when the SVG/profile changes.
  const builtRef = useRef<BuiltModel | null>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    let built: BuiltModel | null = null;
    const t = setTimeout(() => {
      built = buildModel(svg, editRef.current.gap, editRef.current.overrides, profile);
      if (cancelled) {
        disposeBuilt(built);
      } else {
        builtRef.current = built;
        setModel(built.wrapper);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      disposeBuilt(built);
      builtRef.current = null;
    };
  }, [svg, profile]);

  // Sculpt edits (overrides/gap) update the existing model in place — only the
  // touched layer is re-extruded; material/visibility/z are O(changed layers).
  useEffect(() => {
    const built = builtRef.current;
    if (!built || !model) return;
    applyGranular(built, overrides, gap);
  }, [overrides, gap, model]);

  const sceneName: SceneName = scene ?? profile?.recommended.scene ?? 'studio';
  const preset = SCENE_PRESETS[sceneName];

  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 45 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: preset.exposure }}
      onCreated={({ gl, scene: s }) => {
        registerCanvas?.(gl.domElement);
        registerScene?.(s);
        if (preset.background !== 'transparent') s.background = new THREE.Color(preset.background);
      }}
    >
      <ambientLight intensity={preset.ambientIntensity} />
      <directionalLight position={preset.lightPosition} intensity={preset.lightIntensity} />
      <directionalLight position={[-5, 3, -3]} intensity={0.4} />
      <hemisphereLight args={['#b1e1ff', '#b97a20', 0.5]} />
      {model && <primitive object={model} />}
      <ContactShadows position={[0, -2.2, 0]} opacity={0.4} scale={10} blur={2} far={4} />
      {/* Self-contained environment (no network HDRI fetch) — mirrors the engine */}
      <Environment background={false} environmentIntensity={1.3} frames={1}>
        <mesh scale={50}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color="#0a0a12" side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 25, 0]}>
          <sphereGeometry args={[20, 32, 32]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, 30]}>
          <sphereGeometry args={[15, 32, 32]} />
          <meshBasicMaterial color="#444444" />
        </mesh>
      </Environment>
      <OrbitControls enablePan={false} />
    </Canvas>
  );
}
