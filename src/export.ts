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

/**
 * Export the 3D model to a binary glTF (.glb). Pass the scene captured via the
 * `registerScene` prop on <Svg3D>. Exports the model group (the ExtrudeGeometry
 * mesh and its transform) and skips lights / contact shadows.
 *
 * GLTFExporter is dynamically imported so it only loads when GLB is used.
 */
export async function exportSceneGlb(scene: unknown, filename = 'svg3d.glb'): Promise<void> {
  const root = scene as { traverse: (cb: (o: any) => void) => void };
  if (!root || typeof root.traverse !== 'function') {
    throw new Error('No 3D scene available yet — try again once the model is visible.');
  }

  // Find the model mesh, then climb to its top-level group under the scene.
  // The engine merges the extrusion into a plain BufferGeometry, so we select
  // by excluding the contact-shadow plane rather than matching ExtrudeGeometry.
  let mesh: any = null;
  root.traverse((o: any) => {
    if (!mesh && o.isMesh && o.geometry && o.geometry.type !== 'PlaneGeometry') mesh = o;
  });
  if (!mesh) throw new Error('No 3D model to export yet.');

  let target: any = mesh;
  while (target.parent && target.parent !== root) target = target.parent;

  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      target,
      (gltf) => resolve(gltf as ArrayBuffer),
      (err) => reject(err),
      { binary: true },
    );
  });

  downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), filename);
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
