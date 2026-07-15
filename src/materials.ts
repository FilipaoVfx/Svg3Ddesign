/**
 * Shared material factory — single source of truth for the preset → material
 * mapping, used by both the viewport (LayeredSvg3D) and the high-LOD GLB
 * export (exportModel), so the two can't drift apart.
 *
 * When gradient textures exist (Module 5), the REAL gradient becomes the color
 * map (base color → white to avoid tinting) and its luminance-derived normal
 * map adds relief shading at ~zero geometry cost (C7).
 */
import * as THREE from 'three';
import type { GradientTextures } from './gradientTextures';
import type { MaterialPreset } from './types';

export interface MaterialOptions {
  /**
   * Export-safe variant: glass becomes a plain standard material (transparent
   * opacity) instead of physical transmission, for maximum GLB viewer
   * compatibility (transmission renders black in env-less viewers).
   */
  forExport?: boolean;
}

export function makeMaterial(preset: MaterialPreset = 'default', fill?: string, textures?: GradientTextures | null, opts?: MaterialOptions): THREE.Material {
  const color = new THREE.Color(fill && /^#?[0-9a-f]{3,8}$/i.test(fill) ? fill : '#c8ccd2');
  const grad = textures
    ? { color: new THREE.Color('#ffffff'), map: textures.map, normalMap: textures.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }
    : {};
  switch (preset) {
    case 'glass':
      return opts?.forExport
        ? new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.6, ...grad })
        : new THREE.MeshPhysicalMaterial({ color, transmission: 1, thickness: 1.2, roughness: 0.06, ior: 1.5, transparent: true, metalness: 0, ...grad });
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
