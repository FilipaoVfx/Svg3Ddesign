import type { SVG3DProps, MaterialPreset } from '3dsvg/types';

export type { SVG3DProps, MaterialPreset };

export type PresetName = 'neon' | 'glitch' | 'chrome' | 'gold' | 'glass';

export interface Svg3DProps extends SVG3DProps {
  /** CrackingWall visual preset applied before your prop overrides. */
  preset?: PresetName;
}
