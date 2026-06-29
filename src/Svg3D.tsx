import { SVG3D } from '3dsvg';
import { PRESETS } from './presets';
import type { SVG3DProps, Svg3DProps } from './types';

// Brand defaults. Priority: brand < preset < explicit props.
const BRAND_DEFAULTS = { depth: 1, smoothness: 0.3, shadow: true, cursorOrbit: true } as const;

/**
 * CrackingWall's opinionated wrapper over 3dsvg's <SVG3D>.
 * Pass `preset` for an on-brand look, override any 3dsvg prop directly.
 */
export function Svg3D({ preset, ...props }: Svg3DProps) {
  const presetProps = preset ? PRESETS[preset] : {};
  // `registerScene` isn't in upstream SVG3DProps yet (added via patch); cast so
  // it flows through at runtime without a type error.
  const merged = { ...BRAND_DEFAULTS, ...presetProps, ...props } as SVG3DProps;
  return <SVG3D {...merged} />;
}
