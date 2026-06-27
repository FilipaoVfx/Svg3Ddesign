import type { PresetName, SVG3DProps } from './types';

/** Curated CrackingWall looks (material + colour + light + motion). */
export const PRESETS: Record<PresetName, Partial<SVG3DProps>> = {
  neon:   { material: 'emissive',    color: '#00fff9', lightIntensity: 1.4, ambientIntensity: 0.4, intro: 'zoom', animate: 'float' },
  glitch: { material: 'holographic', color: '#ff0080', animate: 'wobble', animateSpeed: 1.4, intro: 'fade' },
  chrome: { material: 'chrome',      color: '#ffffff', metalness: 1, roughness: 0.1, animate: 'spin' },
  gold:   { material: 'gold',        color: '#ffd24a', animate: 'spinFloat' },
  glass:  { material: 'glass',       color: '#a0e9ff', opacity: 0.6, animate: 'float' },
};
