import type { SVG3DProps, MaterialPreset } from '3dsvg/types';

export type { SVG3DProps, MaterialPreset };

export type PresetName = 'neon' | 'glitch' | 'chrome' | 'gold' | 'glass';

export interface Svg3DProps extends SVG3DProps {
  /** CrackingWall visual preset applied before your prop overrides. */
  preset?: PresetName;
  /**
   * Callback with the Three.js scene once the canvas is created — used for GLB
   * export. Requires the engine to expose it (3dsvg `registerScene`, available
   * via the consumer-side patch until upstream merges it).
   */
  registerScene?: (scene: unknown) => void;
}
