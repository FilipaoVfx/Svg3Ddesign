import { SVG3D } from '3dsvg';
import { PRESETS } from './presets';
import type { Svg3DProps } from './types';

// Brand defaults. Priority: brand < preset < explicit props.
const BRAND_DEFAULTS = { depth: 1, smoothness: 0.3, shadow: true, cursorOrbit: true } as const;

/**
 * CrackingWall's opinionated wrapper over 3dsvg's <SVG3D>.
 * Pass `preset` for an on-brand look, override any 3dsvg prop directly.
 */
export function Svg3D({ preset, ...props }: Svg3DProps) {
  const presetProps = preset ? PRESETS[preset] : {};
  return <SVG3D {...BRAND_DEFAULTS} {...presetProps} {...props} />;
}
