/**
 * Scene presets — lighting/environment configs that `analyzeSvg` recommends and
 * a renderer can apply. Plain data; no Three.js dependency.
 */

export type SceneName = 'studio' | 'cyberpunk' | 'industrial' | 'minimal';

export interface ScenePreset {
  /** Canvas background ("transparent" or a hex). */
  background: string;
  ambientIntensity: number;
  lightIntensity: number;
  lightPosition: [number, number, number];
  /** ACES tone-mapping exposure. */
  exposure: number;
  /** drei <Environment> preset hint (or "neutral"). */
  environment: 'studio' | 'city' | 'warehouse' | 'night' | 'neutral';
}

export const SCENE_PRESETS: Record<SceneName, ScenePreset> = {
  studio: {
    background: 'transparent',
    ambientIntensity: 0.6,
    lightIntensity: 1.0,
    lightPosition: [5, 5, 5],
    exposure: 1.2,
    environment: 'studio',
  },
  cyberpunk: {
    background: '#05060a',
    ambientIntensity: 0.3,
    lightIntensity: 1.4,
    lightPosition: [3, 5, 2],
    exposure: 1.35,
    environment: 'night',
  },
  industrial: {
    background: '#0c0e12',
    ambientIntensity: 0.4,
    lightIntensity: 0.9,
    lightPosition: [-4, 6, 3],
    exposure: 1.1,
    environment: 'warehouse',
  },
  minimal: {
    background: 'transparent',
    ambientIntensity: 0.75,
    lightIntensity: 0.8,
    lightPosition: [4, 6, 6],
    exposure: 1.15,
    environment: 'neutral',
  },
};
