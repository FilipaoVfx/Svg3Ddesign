/**
 * Client-side export helpers. Framework-agnostic; safe to tree-shake.
 *
 * PNG works because the engine's <Canvas> is created with
 * `preserveDrawingBuffer: true`, so the WebGL canvas can be read back.
 * Grab the canvas via the `registerCanvas` prop on <Svg3D>.
 */

/** Convert a WebGL canvas to a PNG Blob. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export the canvas to PNG.'));
    }, 'image/png');
  });
}

/** Trigger a browser download for any Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Capture a canvas and download it as a PNG. */
export async function exportCanvasPng(canvas: HTMLCanvasElement, filename = 'svg3d.png'): Promise<void> {
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, filename);
}

/** Strip scripts and inline event handlers from untrusted SVG markup. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}

/** Read an uploaded SVG file into a sanitized SVG string. Rejects non-SVG. */
export async function readSvgFile(file: File): Promise<string> {
  const isSvg = /svg/i.test(file.type) || file.name.toLowerCase().endsWith('.svg');
  if (!isSvg) throw new Error('Please upload an .svg file.');
  const text = await file.text();
  if (!text.includes('<svg')) throw new Error('That file does not contain valid SVG.');
  return sanitizeSvg(text);
}
