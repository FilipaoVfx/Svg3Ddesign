import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows, OrbitControls } from '@react-three/drei';
import { analyzeSvg, layerTransforms, pickGranularity } from './intelligence';
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

/** Build a Three material from a layer's material preset + fill colour. */
function makeMaterial(preset: MaterialPreset, fill?: string): THREE.Material {
  const color = new THREE.Color(fill && /^#?[0-9a-f]{3,8}$/i.test(fill) ? fill : '#c8ccd2');
  switch (preset) {
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color, transmission: 1, thickness: 1.2, roughness: 0.06, ior: 1.5, transparent: true, metalness: 0 });
    case 'metal':
      return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.28 });
    case 'chrome':
      return new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffffff'), metalness: 1, roughness: 0.04 });
    case 'gold':
      return new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffd24a'), metalness: 1, roughness: 0.2 });
    case 'emissive':
      return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.4 });
    case 'plastic':
      return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55 });
    default:
      return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.45 });
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

/**
 * Build one centered, scaled group with one extruded mesh per layer.
 * Single parse → all layers share the SVG coordinate space, so they stay
 * aligned; one global transform centers/scales the whole assembly.
 */
function buildModel(svg: string, gap: number, overrides: LayeredSvg3DProps['overrides']): THREE.Group {
  const profile = analyzeSvg(svg);
  const specById = new Map(profile.layers.map((l) => [l.id, l]));
  const zById = new Map(layerTransforms(profile, gap).map((t) => [t.id, t.z]));

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
  for (const { id, shapes } of elements) {
    if (!shapes.length) continue;
    const layer = specById.get(id);
    const ov = overrides?.[id];
    if (ov?.visible === false) continue; // hidden layer
    const depth = (ov?.depth ?? layer?.depth ?? 20) * depthScale;
    const material = makeMaterial(ov?.material ?? layer?.material ?? 'default', ov?.color ?? layer?.fill);
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: true,
      bevelThickness: (layer?.bevel ?? 2) * depthScale * 0.4,
      bevelSize: (layer?.bevel ?? 2) * depthScale * 0.4,
      // Cap segments hard: icon paths have many bezier curves, and curveSegments
      // multiplies per curve. 10/2 keeps vertices low (60fps) with no visible
      // loss at icon scale; bevel stays subtle.
      bevelSegments: 2,
      curveSegments: Math.min(profile.recommended.curveSegments, 10),
    });
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = id;
    mesh.position.z = (zById.get(id) ?? 0) * depthScale;
    root.add(mesh);
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
  return wrapper;
}

/** Free geometries/materials to avoid GPU memory leaks on rebuild/unmount. */
function disposeGroup(group: THREE.Group | null): void {
  group?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}

/**
 * Layered SVG → 3D renderer: extrudes each `<g id>` layer at its own depth and
 * material (from analyzeSvg or overrides), aligned and z-stacked. Client-only.
 */
export function LayeredSvg3D({ svg, gap = 0, scene, overrides, registerScene, registerCanvas }: LayeredSvg3DProps) {
  // Build off the initial render so the canvas/controls paint first and a large
  // SVG doesn't freeze the click→paint. (Geometry can't run in a Worker because
  // SVGLoader needs the DOM; this keeps the first frame responsive.)
  const [model, setModel] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let cancelled = false;
    let built: THREE.Group | null = null;
    const t = setTimeout(() => {
      built = buildModel(svg, gap, overrides);
      if (cancelled) disposeGroup(built);
      else setModel(built);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      disposeGroup(built);
    };
  }, [svg, gap, overrides]);

  const sceneName: SceneName = scene ?? analyzeSvg(svg).recommended.scene;
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
