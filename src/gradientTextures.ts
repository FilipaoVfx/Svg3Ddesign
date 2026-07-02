/**
 * Gradient Intelligence — texture synthesis (Module 5 / C7, main thread).
 *
 * Turns a GradientSpec into:
 *   - `map`: the REAL gradient as a color texture (instead of the averaged
 *     flat hex), drawn in the layer's local space so ExtrudeGeometry's
 *     position-based UVs line up via texture offset/repeat, and
 *   - `normalMap`: relief derived from the gradient's luminance ramp (Sobel),
 *     giving "sculpted" surface shading at ~zero geometry cost (C7).
 *
 * Needs a canvas → never runs in the worker; returns null under SSR/tests.
 */
import * as THREE from 'three';
import type { GradientSpec } from './gradients';
import type { BBox } from './spatial';

const SIZE = 128; // gradients are smooth — small textures are plenty

export interface GradientTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

function drawGradient(ctx: CanvasRenderingContext2D, spec: GradientSpec, toStop: (c: string) => string): void {
  // objectBoundingBox coords are 0..1 fractions of the layer bbox — our canvas
  // IS the bbox, so both unit systems map to canvas space the same way here
  // (userSpaceOnUse coords are pre-normalized by the caller).
  const [a, b, c, d] = spec.coords;
  const grad =
    spec.type === 'linear'
      ? ctx.createLinearGradient(a * SIZE, b * SIZE, c * SIZE, d * SIZE)
      : ctx.createRadialGradient(a * SIZE, b * SIZE, 0, a * SIZE, b * SIZE, Math.max(1e-4, c) * SIZE);
  for (const s of spec.stops) {
    try {
      grad.addColorStop(s.offset, toStop(s.color));
    } catch {
      /* invalid color string — skip stop */
    }
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** CSS color → grayscale luminance color (for the height ramp). */
function lumColor(color: string, scratch: CanvasRenderingContext2D): string {
  scratch.fillStyle = '#000';
  scratch.fillStyle = color; // browser-normalizes any CSS color
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b] = scratch.getImageData(0, 0, 1, 1).data;
  const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return `rgb(${l},${l},${l})`;
}

/** Height (grayscale) image → tangent-space normal map via Sobel. */
function heightToNormal(height: ImageData): ImageData {
  const { width: w, height: h, data } = height;
  const out = new ImageData(w, h);
  const hAt = (x: number, y: number) => data[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  const strength = 2.0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1)) -
        (hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1));
      const dy =
        (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1)) -
        (hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1));
      // normalize (-dx, -dy, 1/strength)
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      out.data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Build color + normal textures for a layer gradient, aligned to the layer's
 * bbox in SVG space (ExtrudeGeometry UVs are raw shape coordinates, so
 * offset/repeat maps them into the texture). Returns null without a DOM.
 */
export function makeGradientTextures(spec: GradientSpec, bbox: BBox): GradientTextures | null {
  if (typeof document === 'undefined' || bbox.w <= 0 || bbox.h <= 0) return null;

  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE;
    return { cv, ctx: cv.getContext('2d', { willReadFrequently: true })! };
  };

  // userSpaceOnUse coords → normalize into bbox fractions once, here.
  const s: GradientSpec = spec.boundingBoxUnits
    ? spec
    : {
        ...spec,
        coords:
          spec.type === 'linear'
            ? [
                (spec.coords[0] - bbox.x) / bbox.w,
                (spec.coords[1] - bbox.y) / bbox.h,
                (spec.coords[2] - bbox.x) / bbox.w,
                (spec.coords[3] - bbox.y) / bbox.h,
              ]
            : [(spec.coords[0] - bbox.x) / bbox.w, (spec.coords[1] - bbox.y) / bbox.h, spec.coords[2] / Math.max(bbox.w, bbox.h)],
      };

  const scratch = mk().ctx;

  const color = mk();
  drawGradient(color.ctx, s, (c) => c);

  const heightC = mk();
  drawGradient(heightC.ctx, s, (c) => lumColor(c, scratch));
  const normal = mk();
  normal.ctx.putImageData(heightToNormal(heightC.ctx.getImageData(0, 0, SIZE, SIZE)), 0, 0);

  const wrap = (cv: HTMLCanvasElement, srgb: boolean) => {
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false; // UVs live in SVG (y-down) space; the mesh flip handles orientation
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    // Map raw SVG-space UVs into the bbox: uv' = uv * repeat + offset
    tex.repeat.set(1 / bbox.w, 1 / bbox.h);
    tex.offset.set(-bbox.x / bbox.w, -bbox.y / bbox.h);
    return tex;
  };

  return { map: wrap(color.cv, true), normalMap: wrap(normal.cv, false) };
}
