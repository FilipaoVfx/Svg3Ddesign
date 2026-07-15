import { SVG3D } from '3dsvg';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useState, useEffect, useRef } from 'react';
import * as THREE2 from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei';

// src/Svg3D.tsx

// src/presets.ts
var PRESETS = {
  neon: { material: "emissive", color: "#00fff9", lightIntensity: 1.4, ambientIntensity: 0.4, intro: "zoom", animate: "float" },
  glitch: { material: "holographic", color: "#ff0080", animate: "wobble", animateSpeed: 1.4, intro: "fade" },
  chrome: { material: "chrome", color: "#ffffff", metalness: 1, roughness: 0.1, animate: "spin" },
  gold: { material: "gold", color: "#ffd24a", animate: "spinFloat" },
  glass: { material: "glass", color: "#a0e9ff", opacity: 0.6, animate: "float" }
};
var BRAND_DEFAULTS = { depth: 1, smoothness: 0.3, shadow: true, cursorOrbit: true };
function Svg3D({ preset, ...props }) {
  const presetProps = preset ? PRESETS[preset] : {};
  const merged = { ...BRAND_DEFAULTS, ...presetProps, ...props };
  return /* @__PURE__ */ jsx(SVG3D, { ...merged });
}

// src/spatial.ts
var NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
function nums(s) {
  return (s.match(NUM) || []).map(Number);
}
function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`));
  return m ? parseFloat(m[1]) : 0;
}
function pathBBox(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cx = 0, cy = 0;
  let sx = 0, sy = 0;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const cmdRe = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m;
  while (m = cmdRe.exec(d)) {
    const cmd = m[1];
    const rel = cmd >= "a" && cmd <= "z";
    const v = nums(m[2]);
    let i = 0;
    switch (cmd.toUpperCase()) {
      case "M":
      case "L":
      case "T":
        while (i + 1 < v.length + 1 && i + 1 <= v.length) {
          if (i + 1 > v.length - 1 && v.length % 2 !== 0) break;
          const x = rel ? cx + v[i] : v[i];
          const y = rel ? cy + v[i + 1] : v[i + 1];
          add(x, y);
          cx = x;
          cy = y;
          if (cmd.toUpperCase() === "M" && i === 0) {
            sx = x;
            sy = y;
          }
          i += 2;
          if (i >= v.length) break;
        }
        break;
      case "H":
        for (; i < v.length; i++) {
          cx = rel ? cx + v[i] : v[i];
          add(cx, cy);
        }
        break;
      case "V":
        for (; i < v.length; i++) {
          cy = rel ? cy + v[i] : v[i];
          add(cx, cy);
        }
        break;
      case "C":
        for (; i + 5 < v.length; i += 6) {
          const pts = rel ? [cx + v[i], cy + v[i + 1], cx + v[i + 2], cy + v[i + 3], cx + v[i + 4], cy + v[i + 5]] : v.slice(i, i + 6);
          add(pts[0], pts[1]);
          add(pts[2], pts[3]);
          add(pts[4], pts[5]);
          cx = pts[4];
          cy = pts[5];
        }
        break;
      case "S":
      case "Q":
        for (; i + 3 < v.length; i += 4) {
          const pts = rel ? [cx + v[i], cy + v[i + 1], cx + v[i + 2], cy + v[i + 3]] : v.slice(i, i + 4);
          add(pts[0], pts[1]);
          add(pts[2], pts[3]);
          cx = pts[2];
          cy = pts[3];
        }
        break;
      case "A":
        for (; i + 6 < v.length; i += 7) {
          cx = rel ? cx + v[i + 5] : v[i + 5];
          cy = rel ? cy + v[i + 6] : v[i + 6];
          add(cx, cy);
        }
        break;
      case "Z":
        cx = sx;
        cy = sy;
        break;
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function shapeBBox(tag, attrs) {
  switch (tag.toLowerCase()) {
    case "rect":
      return { x: attr(attrs, "x"), y: attr(attrs, "y"), w: attr(attrs, "width"), h: attr(attrs, "height") };
    case "circle": {
      const r = attr(attrs, "r");
      return { x: attr(attrs, "cx") - r, y: attr(attrs, "cy") - r, w: 2 * r, h: 2 * r };
    }
    case "ellipse": {
      const rx = attr(attrs, "rx"), ry = attr(attrs, "ry");
      return { x: attr(attrs, "cx") - rx, y: attr(attrs, "cy") - ry, w: 2 * rx, h: 2 * ry };
    }
    case "line": {
      const x1 = attr(attrs, "x1"), y1 = attr(attrs, "y1"), x2 = attr(attrs, "x2"), y2 = attr(attrs, "y2");
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    case "polygon":
    case "polyline": {
      const pts = nums((attrs.match(/points="([^"]+)"/) || [])[1] || "");
      if (pts.length < 4) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]);
        maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]);
        maxY = Math.max(maxY, pts[i + 1]);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case "path": {
      const d = (attrs.match(/\bd="([^"]+)"/) || [])[1];
      return d ? pathBBox(d) : null;
    }
    default:
      return null;
  }
}
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function contains(outer, inner, eps = 1e-6) {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}
function assignLevels(bboxes) {
  const levels = [];
  for (let i = 0; i < bboxes.length; i++) {
    const bb = bboxes[i];
    if (!bb) {
      levels.push(i === 0 ? 0 : levels[i - 1] + 1);
      continue;
    }
    let lv = 0;
    for (let j = 0; j < i; j++) {
      const other = bboxes[j];
      if (other && overlaps(other, bb)) lv = Math.max(lv, levels[j] + 1);
    }
    levels.push(lv);
  }
  return levels;
}

// src/gradients.ts
function num(v, fallback) {
  if (v === void 0) return fallback;
  const f = parseFloat(v);
  if (Number.isNaN(f)) return fallback;
  return v.trim().endsWith("%") ? f / 100 : f;
}
function attr2(tag, name) {
  return (tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)) || [])[1];
}
function findGradient(svg, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<(linear|radial)Gradient([^>]*id="${esc}"[^>]*?)(/>|>([\\s\\S]*?)</\\1Gradient>)`
  );
  const m = svg.match(re);
  if (!m) return null;
  return { type: m[1], tag: m[2], inner: m[4] || "" };
}
function parseStops(inner) {
  const out = [];
  for (const m of inner.matchAll(/<stop\b([^>]*)>/g)) {
    const a = m[1];
    const color = attr2(a, "stop-color") || (a.match(/style="[^"]*stop-color:\s*([^;"]+)/) || [])[1];
    if (!color) continue;
    out.push({ offset: Math.max(0, Math.min(1, num(attr2(a, "offset"), 0))), color: color.trim() });
  }
  return out;
}
function extractGradient(fill, svg) {
  if (!fill) return null;
  const id = (fill.match(/url\(#([^)]+)\)/) || [])[1] ?? (fill.startsWith("#") ? void 0 : void 0);
  const gradId = id ?? (fill.match(/^#?([\w-]+)$/) && !/^#?[0-9a-f]{3,8}$/i.test(fill) ? fill.replace(/^#/, "") : void 0);
  if (!gradId) return null;
  const g = findGradient(svg, gradId);
  if (!g) return null;
  let stops = parseStops(g.inner);
  if (!stops.length) {
    const href = attr2(g.tag, "href") || attr2(g.tag, "xlink:href");
    if (href) {
      const ref = findGradient(svg, href.replace(/^#/, ""));
      if (ref) stops = parseStops(ref.inner);
    }
  }
  if (stops.length < 2) return null;
  const boundingBoxUnits = attr2(g.tag, "gradientUnits") !== "userSpaceOnUse";
  const coords = g.type === "linear" ? [num(attr2(g.tag, "x1"), 0), num(attr2(g.tag, "y1"), 0), num(attr2(g.tag, "x2"), 1), num(attr2(g.tag, "y2"), 0)] : [num(attr2(g.tag, "cx"), 0.5), num(attr2(g.tag, "cy"), 0.5), num(attr2(g.tag, "r"), 0.5)];
  return { type: g.type, stops, coords, boundingBoxUnits };
}

// src/intelligence.ts
var VERTEX_BUDGET = 3e5;
var TRIANGLE_BUDGET = { desktop: 25e4, mobile: 8e4 };
var DRAWABLE = /<(path|rect|circle|ellipse|polygon|polyline|line)\b/g;
function topLevelGroups(svg) {
  const out = [];
  const tagRe = /<(\/?)g\b([^>]*)>/g;
  let depth = 0;
  let current = null;
  let m;
  while (m = tagRe.exec(svg)) {
    const closing = m[1] === "/";
    const selfClosing = !closing && /\/\s*$/.test(m[2]);
    if (!closing) {
      if (depth === 0 && !selfClosing) current = { attrs: m[2], start: tagRe.lastIndex };
      if (!selfClosing) depth++;
    } else {
      depth--;
      if (depth === 0 && current) {
        out.push({
          id: (current.attrs.match(/id="([^"]+)"/) || [])[1] || "",
          attrs: current.attrs,
          content: svg.slice(current.start, m.index)
        });
        current = null;
      }
    }
  }
  return out;
}
function countDrawables(s) {
  return (s.match(DRAWABLE) || []).length;
}
function firstFill(attrs, content) {
  return (attrs.match(/fill="([^"]+)"/) || [])[1] || (content.match(/fill="(?!none)([^"]+)"/) || [])[1] || void 0;
}
function detectOpacity(attrs, content, fill) {
  const fo = (attrs + content).match(/fill-opacity="([0-9.]+)"/);
  if (fo) return Math.max(0, Math.min(1, parseFloat(fo[1])));
  if (fill) {
    const rgba = fill.match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/);
    if (rgba) return parseFloat(rgba[1]);
    const hex8 = fill.match(/^#?[0-9a-f]{6}([0-9a-f]{2})$/i);
    if (hex8) return parseInt(hex8[1], 16) / 255;
  }
  return 1;
}
var NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  gold: "#ffd700",
  cyan: "#00ffff",
  magenta: "#ff00ff"
};
function resolveFillColor(fill, svg) {
  if (!fill || fill === "none") return void 0;
  if (/^#|^rgb/i.test(fill)) return fill;
  const named = NAMED_COLORS[fill.toLowerCase()];
  if (named) return named;
  const ref = fill.match(/url\(#([^)]+)\)/);
  if (!ref) return void 0;
  const re = new RegExp(`<(?:radial|linear)Gradient[^>]*id="${ref[1]}"[\\s\\S]*?</(?:radial|linear)Gradient>`);
  const grad = svg.match(re)?.[0];
  if (!grad) return void 0;
  const stops = [...grad.matchAll(/stop-color="(#[0-9a-f]{3,8}|rgb[^"]+)"/gi)].map((m) => m[1]);
  if (!stops.length) return void 0;
  let r = 0, g = 0, b = 0, n = 0;
  for (const c of stops) {
    const h = c.replace("#", "");
    if (!/^[0-9a-f]{6}/i.test(h)) continue;
    r += parseInt(h.slice(0, 2), 16);
    g += parseInt(h.slice(2, 4), 16);
    b += parseInt(h.slice(4, 6), 16);
    n++;
  }
  if (!n) return void 0;
  const hx = (v) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
function roleFromFill(_fill, opacity) {
  if (opacity < 0.6) return "glass";
  return "unknown";
}
function roleFromId(id) {
  const s = id.toLowerCase();
  if (/\b(ring|bezel|trim)\b|_ring|_bezel/.test(s)) return "metal";
  if (/glass|lens|crystal|transparent/.test(s)) return "glass";
  if (/screen|display|lcd|panel|monitor/.test(s)) return "screen";
  if (/led|light|glow|emit|neon|beam|bulb/.test(s)) return "light";
  if (/metal|chrome|steel|alu|housing|mount|frame/.test(s)) return "metal";
  if (/yoke|arm|support|leg|stand|pillar/.test(s)) return "structure";
  if (/detail|screw|vent|port|button|knob|grill|logo|label|text/.test(s)) return "detail";
  if (/base|foot|feet|bottom|body|cover|case|shell|plastic/.test(s)) return "plastic";
  return "unknown";
}
var ROLE_SPEC = {
  glass: { material: "glass", depth: 8, bevel: 6 },
  metal: { material: "metal", depth: 18, bevel: 4 },
  plastic: { material: "plastic", depth: 44, bevel: 3 },
  screen: { material: "emissive", depth: 10, bevel: 2 },
  light: { material: "emissive", depth: 10, bevel: 3 },
  structure: { material: "metal", depth: 28, bevel: 3 },
  detail: { material: "metal", depth: 6, bevel: 1 },
  unknown: { material: "default", depth: 20, bevel: 2 }
};
function estimateVertices(pathCount, curveSegments) {
  return Math.round(pathCount * curveSegments * 8);
}
function estimateTriangles(pathCount, curveSegments) {
  return Math.round(estimateVertices(pathCount, curveSegments) * 1.5);
}
function stripNonRender(svg) {
  return svg.replace(/<defs[\s\S]*?<\/defs>/gi, "").replace(/<mask[\s\S]*?<\/mask>/gi, "").replace(/<clipPath[\s\S]*?<\/clipPath>/gi, "");
}
var DRAWABLE_TAG = /<(path|circle|rect|ellipse|polygon|polyline|line)\b([^>]*)>/gi;
function extractShapes(svg) {
  const body = stripNonRender(svg);
  const out = [];
  let m;
  DRAWABLE_TAG.lastIndex = 0;
  while (m = DRAWABLE_TAG.exec(body)) {
    const attrs = m[2] || "";
    out.push({
      id: (attrs.match(/id="([^"]+)"/) || [])[1] || "",
      tag: m[1].toLowerCase(),
      attrs,
      fill: (attrs.match(/fill="([^"]+)"/) || [])[1]
    });
  }
  return out;
}
function pickGranularity(svg) {
  return topLevelGroups(svg).some((g) => g.id) ? "group" : "shape";
}
function analyzeSvg(svg, opts) {
  const mode = !opts?.granularity || opts.granularity === "auto" ? pickGranularity(svg) : opts.granularity;
  let layers;
  if (mode === "shape") {
    const shapes = extractShapes(svg);
    const bboxes = shapes.map((s) => shapeBBox(s.tag, s.attrs));
    const levels = assignLevels(bboxes);
    layers = shapes.map((s, order) => {
      const opacity = detectOpacity(s.attrs, "", s.fill);
      const fill = resolveFillColor(s.fill, svg);
      let role = roleFromId(s.id);
      if (role === "unknown") role = roleFromFill(fill, opacity);
      const spec = ROLE_SPEC[role];
      return {
        id: s.id || `shape_${order}`,
        order,
        pathCount: 1,
        fill,
        opacity,
        role,
        ...spec,
        bbox: bboxes[order],
        level: levels[order],
        gradient: extractGradient(s.fill, svg)
      };
    });
  } else {
    const groups = topLevelGroups(svg).filter((g) => g.id || countDrawables(g.content) > 0);
    layers = groups.map((g, order) => {
      const pathCount = countDrawables(g.content);
      const rawFill = firstFill(g.attrs, g.content);
      const opacity = detectOpacity(g.attrs, g.content, rawFill);
      const fill = resolveFillColor(rawFill, svg);
      let role = roleFromId(g.id);
      if (role === "unknown") role = roleFromFill(fill, opacity);
      const spec = ROLE_SPEC[role];
      return { id: g.id || `layer_${order}`, order, pathCount, fill, opacity, role, ...spec, gradient: extractGradient(rawFill, svg) };
    });
  }
  if (layers.length === 0) {
    const pathCount = countDrawables(svg);
    layers.push({ id: "root", order: 0, pathCount, opacity: 1, role: "unknown", ...ROLE_SPEC.unknown });
  }
  const pathCountTotal = layers.reduce((n, l) => n + l.pathCount, 0);
  const complexity = pathCountTotal < 30 ? "low" : pathCountTotal < 120 ? "medium" : "high";
  const curveSegments = complexity === "high" ? 24 : 32;
  const estimatedVertices = estimateVertices(pathCountTotal, curveSegments);
  const estimatedTriangles = estimateTriangles(pathCountTotal, curveSegments);
  const withinBudget = estimatedTriangles <= TRIANGLE_BUDGET.desktop;
  const depths = layers.map((l) => l.depth);
  const roles = new Set(layers.map((l) => l.role));
  const scene = roles.has("light") || roles.has("screen") ? "cyberpunk" : roles.has("metal") || roles.has("structure") ? "studio" : "minimal";
  const warnings = [];
  if (!withinBudget) warnings.push(`Estimated ~${estimatedTriangles.toLocaleString()} triangles exceeds the ${TRIANGLE_BUDGET.desktop.toLocaleString()} desktop budget \u2014 lower curveSegments or simplify paths.`);
  if (pathCountTotal > 300) warnings.push("High path count (>300): keep curveSegments low for 60fps.");
  if (!layers.some((l) => l.id && l.id !== "root")) warnings.push("No <g id> layers found \u2014 extrusion will be uniform. Author the SVG with depth groups for higher fidelity.");
  if (layers.length > 24) warnings.push("Many layers (>24): consider merging for fewer draw calls.");
  return {
    layerCount: layers.length,
    pathCountTotal,
    complexity,
    estimatedVertices,
    estimatedTriangles,
    withinBudget,
    layers,
    recommended: { scene, depthRange: [Math.min(...depths), Math.max(...depths)], curveSegments },
    warnings
  };
}
function applyOverrides(profile, overrides) {
  if (!overrides) return profile;
  let changed = false;
  const layers = profile.layers.map((l) => {
    const d = overrides[l.id]?.depth;
    if (d === void 0 || d === l.depth) return l;
    changed = true;
    return { ...l, depth: d };
  });
  return changed ? { ...profile, layers } : profile;
}
function buildLayerSvgs(svg) {
  const viewBox = (svg.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 1024 1024";
  return topLevelGroups(svg).filter((g) => countDrawables(g.content) > 0).map((g, i) => ({
    id: g.id || `layer_${i}`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><g${g.attrs}>${g.content}</g></svg>`
  }));
}
function layerTransforms(profile, gap = 0) {
  const hasLevels = profile.layers.length > 0 && profile.layers.every((l) => typeof l.level === "number");
  if (hasLevels) {
    const maxDepthAt = [];
    for (const l of profile.layers) {
      const lv = l.level;
      maxDepthAt[lv] = Math.max(maxDepthAt[lv] ?? 0, l.depth);
    }
    const zAt = [];
    let z2 = 0;
    for (let lv = 0; lv < maxDepthAt.length; lv++) {
      if (lv > 0) z2 += (maxDepthAt[lv - 1] ?? 0) / 2 + (maxDepthAt[lv] ?? 0) / 2 + gap;
      zAt[lv] = z2;
    }
    return profile.layers.map((l) => ({ id: l.id, z: zAt[l.level] }));
  }
  let z = 0;
  return profile.layers.map((l, i) => {
    if (i > 0) z += profile.layers[i - 1].depth / 2 + l.depth / 2 + gap;
    return { id: l.id, z };
  });
}

// src/hash.ts
function hashSvg(svg) {
  let h = 2166136261;
  for (let i = 0; i < svg.length; i++) {
    h ^= svg.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
var profileCache = /* @__PURE__ */ new Map();
function analyzeSvgCached(svg) {
  const key = hashSvg(svg);
  let profile = profileCache.get(key);
  if (!profile) {
    profile = analyzeSvg(svg);
    profileCache.set(key, profile);
  }
  return profile;
}
function clearAnalysisCache() {
  profileCache.clear();
}

// src/analysisWorker.ts
var worker;
var nextId = 1;
var pending = /* @__PURE__ */ new Map();
var cache = /* @__PURE__ */ new Map();
function getWorker() {
  if (worker !== void 0) return worker;
  try {
    if (typeof Worker === "undefined") {
      worker = null;
      return worker;
    }
    worker = new Worker(new URL("./analysis.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok && e.data.profile) p.resolve(e.data.profile);
      else p.reject(new Error(e.data.error || "analysis worker failed"));
    };
    worker.onerror = () => {
      const all = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      all.forEach((p) => p.reject(new Error("analysis worker errored")));
    };
  } catch {
    worker = null;
  }
  return worker;
}
async function analyzeSvgAsync(svg, opts) {
  const key = `${hashSvg(svg)}:${opts?.granularity ?? "auto"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = getWorker();
  let profile;
  if (w) {
    try {
      profile = await new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, svg, granularity: opts?.granularity });
      });
    } catch {
      profile = analyzeSvg(svg, opts);
    }
  } else {
    profile = analyzeSvg(svg, opts);
  }
  cache.set(key, profile);
  return profile;
}
function disposeAnalysisWorker() {
  worker?.terminate();
  worker = void 0;
  pending.clear();
  cache.clear();
}

// src/geometryCache.ts
function createRefCache(opts) {
  const { max, dispose } = opts;
  const map = /* @__PURE__ */ new Map();
  const touch = (key, entry) => {
    map.delete(key);
    map.set(key, entry);
  };
  const evictIfNeeded = () => {
    if (map.size <= max) return;
    for (const [k, e] of [...map]) {
      if (map.size <= max) break;
      if (e.refs === 0) {
        dispose(e.value);
        map.delete(k);
      }
    }
  };
  return {
    acquire(key, factory) {
      const hit = map.get(key);
      if (hit) {
        hit.refs++;
        touch(key, hit);
        return hit.value;
      }
      const value = factory();
      map.set(key, { value, refs: 1 });
      evictIfNeeded();
      return value;
    },
    release(key) {
      const e = map.get(key);
      if (!e) return;
      if (e.refs > 0) e.refs--;
      evictIfNeeded();
    },
    size: () => map.size,
    refs: (key) => map.get(key)?.refs ?? 0,
    clear() {
      for (const e of map.values()) dispose(e.value);
      map.clear();
    }
  };
}
var geometryCache = createRefCache({
  max: 96,
  dispose: (g) => g.dispose()
});
function geoKey(svgHash, id, depth, bevel, curveSegments, bevelSegments) {
  return `${svgHash}|${id}|d${depth.toFixed(2)}|b${bevel}|c${curveSegments}|s${bevelSegments}`;
}

// src/lod.ts
var CEIL = {
  desktop: { draft: { curve: 10, bevel: 2 }, high: { curve: 32, bevel: 3 } },
  mobile: { draft: { curve: 6, bevel: 1 }, high: { curve: 16, bevel: 2 } }
};
var MIN_CURVE = 3;
function chooseLod(profile, opts = {}) {
  const quality = opts.quality ?? "draft";
  const device = opts.isMobile ? "mobile" : "desktop";
  const budget = opts.budget ?? (opts.isMobile ? TRIANGLE_BUDGET.mobile : TRIANGLE_BUDGET.desktop);
  const ceil = CEIL[device][quality];
  const ceilCurve = Math.min(profile.recommended.curveSegments, ceil.curve);
  let curveSegments = ceilCurve;
  while (curveSegments > MIN_CURVE && estimateTriangles(profile.pathCountTotal, curveSegments) > budget) {
    curveSegments--;
  }
  return { curveSegments, bevelSegments: ceil.bevel, budget, reduced: curveSegments < ceilCurve };
}
function detectMobile() {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768;
  } catch {
    return false;
  }
}
var SIZE = 128;
function drawGradient(ctx, spec, toStop) {
  const [a, b, c, d] = spec.coords;
  const grad = spec.type === "linear" ? ctx.createLinearGradient(a * SIZE, b * SIZE, c * SIZE, d * SIZE) : ctx.createRadialGradient(a * SIZE, b * SIZE, 0, a * SIZE, b * SIZE, Math.max(1e-4, c) * SIZE);
  for (const s of spec.stops) {
    try {
      grad.addColorStop(s.offset, toStop(s.color));
    } catch {
    }
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
}
function lumColor(color, scratch) {
  scratch.fillStyle = "#000";
  scratch.fillStyle = color;
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b] = scratch.getImageData(0, 0, 1, 1).data;
  const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return `rgb(${l},${l},${l})`;
}
function heightToNormal(height) {
  const { width: w, height: h, data } = height;
  const out = new ImageData(w, h);
  const hAt = (x, y) => data[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  const strength = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1) - (hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1));
      const dy = hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1) - (hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1));
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
function makeGradientTextures(spec, bbox) {
  if (typeof document === "undefined" || bbox.w <= 0 || bbox.h <= 0) return null;
  const mk = () => {
    const cv = document.createElement("canvas");
    cv.width = SIZE;
    cv.height = SIZE;
    return { cv, ctx: cv.getContext("2d", { willReadFrequently: true }) };
  };
  const s = spec.boundingBoxUnits ? spec : {
    ...spec,
    coords: spec.type === "linear" ? [
      (spec.coords[0] - bbox.x) / bbox.w,
      (spec.coords[1] - bbox.y) / bbox.h,
      (spec.coords[2] - bbox.x) / bbox.w,
      (spec.coords[3] - bbox.y) / bbox.h
    ] : [(spec.coords[0] - bbox.x) / bbox.w, (spec.coords[1] - bbox.y) / bbox.h, spec.coords[2] / Math.max(bbox.w, bbox.h)]
  };
  const scratch = mk().ctx;
  const color = mk();
  drawGradient(color.ctx, s, (c) => c);
  const heightC = mk();
  drawGradient(heightC.ctx, s, (c) => lumColor(c, scratch));
  const normal = mk();
  normal.ctx.putImageData(heightToNormal(heightC.ctx.getImageData(0, 0, SIZE, SIZE)), 0, 0);
  const wrap = (cv, srgb) => {
    const tex = new THREE2.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE2.ClampToEdgeWrapping;
    tex.flipY = false;
    if (srgb) tex.colorSpace = THREE2.SRGBColorSpace;
    tex.repeat.set(1 / bbox.w, 1 / bbox.h);
    tex.offset.set(-bbox.x / bbox.w, -bbox.y / bbox.h);
    return tex;
  };
  return { map: wrap(color.cv, true), normalMap: wrap(normal.cv, false) };
}

// src/scenes.ts
var SCENE_PRESETS = {
  studio: {
    background: "transparent",
    ambientIntensity: 0.6,
    lightIntensity: 1,
    lightPosition: [5, 5, 5],
    exposure: 1.2,
    environment: "studio"
  },
  cyberpunk: {
    background: "#05060a",
    ambientIntensity: 0.3,
    lightIntensity: 1.4,
    lightPosition: [3, 5, 2],
    exposure: 1.35,
    environment: "night"
  },
  industrial: {
    background: "#0c0e12",
    ambientIntensity: 0.4,
    lightIntensity: 0.9,
    lightPosition: [-4, 6, 3],
    exposure: 1.1,
    environment: "warehouse"
  },
  minimal: {
    background: "transparent",
    ambientIntensity: 0.75,
    lightIntensity: 0.8,
    lightPosition: [4, 6, 6],
    exposure: 1.15,
    environment: "neutral"
  }
};
function makeMaterial(preset, fill, textures) {
  const color = new THREE2.Color(fill && /^#?[0-9a-f]{3,8}$/i.test(fill) ? fill : "#c8ccd2");
  const grad = textures ? { color: new THREE2.Color("#ffffff"), map: textures.map, normalMap: textures.normalMap, normalScale: new THREE2.Vector2(0.6, 0.6) } : {};
  switch (preset) {
    case "glass":
      return new THREE2.MeshPhysicalMaterial({ color, transmission: 1, thickness: 1.2, roughness: 0.06, ior: 1.5, transparent: true, metalness: 0, ...grad });
    case "metal":
      return new THREE2.MeshStandardMaterial({ color, metalness: 1, roughness: 0.28, ...grad });
    case "chrome":
      return new THREE2.MeshStandardMaterial({ color: new THREE2.Color("#ffffff"), metalness: 1, roughness: 0.04, ...grad });
    case "gold":
      return new THREE2.MeshStandardMaterial({ color: new THREE2.Color("#ffd24a"), metalness: 1, roughness: 0.2 });
    case "emissive":
      return new THREE2.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.4, ...grad });
    case "plastic":
      return new THREE2.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55, ...grad });
    default:
      return new THREE2.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.45, ...grad });
  }
}
function layerIdForNode(node) {
  let id = "";
  let n = node;
  while (n) {
    if (n.tagName?.toLowerCase() === "g" && n.getAttribute("id")) id = n.getAttribute("id") || id;
    n = n.parentElement;
  }
  return id;
}
function extrude(shapes, depth, bevel, depthScale, curveSegments, bevelSegments) {
  const geo = new THREE2.ExtrudeGeometry(shapes, {
    depth: depth * depthScale,
    bevelEnabled: true,
    bevelThickness: bevel * depthScale * 0.4,
    bevelSize: bevel * depthScale * 0.4,
    // curveSegments / bevelSegments come from the LOD selector (chooseLod):
    // low in the draft viewport for 60fps, higher for export, and auto-reduced
    // to fit the triangle budget on complex/mobile assets.
    bevelSegments,
    curveSegments
  });
  geo.computeVertexNormals();
  return geo;
}
function buildModel(svg, gap, overrides, profile, quality) {
  const svgHash = hashSvg(svg);
  const lod = chooseLod(profile, { quality, isMobile: detectMobile() });
  const specById = new Map(profile.layers.map((l) => [l.id, l]));
  const zById = new Map(layerTransforms(applyOverrides(profile, overrides), gap).map((t) => [t.id, t.z]));
  const mode = pickGranularity(svg);
  const parsed = new SVGLoader().parse(svg);
  const isHidden = (node) => {
    let n = node;
    while (n) {
      const t = n.tagName?.toLowerCase();
      if (t === "defs" || t === "mask" || t === "clippath") return true;
      n = n.parentElement;
    }
    return false;
  };
  const renderPaths = parsed.paths.filter((p) => !isHidden(p.userData?.node ?? null));
  const maxDim = Math.max(1, ...renderPaths.flatMap((p) => {
    const box2 = new THREE2.Box2();
    p.subPaths.forEach((sp) => sp.getPoints().forEach((pt) => box2.expandByPoint(pt)));
    const s = new THREE2.Vector2();
    box2.getSize(s);
    return [s.x, s.y];
  }));
  const depthScale = maxDim * 4e-3;
  const { curveSegments, bevelSegments } = lod;
  const elements = [];
  if (mode === "shape") {
    renderPaths.forEach((path, i) => {
      const node = path.userData?.node ?? null;
      elements.push({ id: node?.id || `shape_${i}`, shapes: SVGLoader.createShapes(path) });
    });
  } else {
    const byLayer = /* @__PURE__ */ new Map();
    for (const path of renderPaths) {
      const id = layerIdForNode(path.userData?.node ?? null) || "root";
      const arr = byLayer.get(id) ?? [];
      arr.push(...SVGLoader.createShapes(path));
      byLayer.set(id, arr);
    }
    for (const [id, shapes] of byLayer) elements.push({ id, shapes });
  }
  const root = new THREE2.Group();
  const byId = /* @__PURE__ */ new Map();
  for (const { id, shapes } of elements) {
    if (!shapes.length) continue;
    const layer = specById.get(id);
    const ov = overrides?.[id];
    const depth = ov?.depth ?? layer?.depth ?? 20;
    const bevel = layer?.bevel ?? 2;
    const textures = layer?.gradient && layer.bbox && !ov?.color ? makeGradientTextures(layer.gradient, layer.bbox) : null;
    const material = makeMaterial(ov?.material ?? layer?.material ?? "default", ov?.color ?? layer?.fill, textures);
    const key = geoKey(svgHash, id, depth, bevel, curveSegments, bevelSegments);
    const geometry = geometryCache.acquire(key, () => extrude(shapes, depth, bevel, depthScale, curveSegments, bevelSegments));
    const mesh = new THREE2.Mesh(geometry, material);
    mesh.name = id;
    mesh.position.z = (zById.get(id) ?? 0) * depthScale;
    mesh.visible = ov?.visible !== false;
    root.add(mesh);
    byId.set(id, { mesh, shapes, spec: layer, textures, geoKey: key });
  }
  root.scale.y = -1;
  const box = new THREE2.Box3().setFromObject(root);
  const center = new THREE2.Vector3();
  const size = new THREE2.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const fit = 4 / (Math.max(size.x, size.y, size.z) || 1);
  const wrapper = new THREE2.Group();
  root.position.sub(center);
  wrapper.add(root);
  wrapper.scale.setScalar(fit);
  return { wrapper, byId, profile, svgHash, depthScale, curveSegments, bevelSegments, applied: { overrides, gap } };
}
function applyGranular(built, overrides, gap) {
  const zById = new Map(layerTransforms(applyOverrides(built.profile, overrides), gap).map((t) => [t.id, t.z]));
  const prevAll = built.applied.overrides;
  for (const [id, entry] of built.byId) {
    const { mesh, shapes, spec } = entry;
    const prev = prevAll?.[id];
    const next = overrides?.[id];
    mesh.visible = next?.visible !== false;
    const baseDepth = spec?.depth ?? 20;
    const bevel = spec?.bevel ?? 2;
    const prevDepth = prev?.depth ?? baseDepth;
    const nextDepth = next?.depth ?? baseDepth;
    if (nextDepth !== prevDepth) {
      const newKey = geoKey(built.svgHash, id, nextDepth, bevel, built.curveSegments, built.bevelSegments);
      if (newKey !== entry.geoKey) {
        const geo = geometryCache.acquire(newKey, () => extrude(shapes, nextDepth, bevel, built.depthScale, built.curveSegments, built.bevelSegments));
        geometryCache.release(entry.geoKey);
        mesh.geometry = geo;
        entry.geoKey = newKey;
      }
    }
    const prevMat = prev?.material ?? spec?.material ?? "default";
    const nextMat = next?.material ?? spec?.material ?? "default";
    const prevColor = prev?.color ?? spec?.fill;
    const nextColor = next?.color ?? spec?.fill;
    if (nextMat !== prevMat || nextColor !== prevColor) {
      mesh.material.dispose();
      mesh.material = makeMaterial(nextMat, nextColor, next?.color ? null : entry.textures);
    }
    mesh.position.z = (zById.get(id) ?? 0) * built.depthScale;
  }
  built.applied = { overrides, gap };
}
function disposeBuilt(built) {
  if (!built) return;
  for (const entry of built.byId.values()) {
    geometryCache.release(entry.geoKey);
    const mat = entry.mesh.material;
    (Array.isArray(mat) ? mat : [mat]).forEach((m) => m?.dispose());
    entry.textures?.map.dispose();
    entry.textures?.normalMap.dispose();
  }
}
function LayeredSvg3D({ svg, gap = 0, scene, quality = "draft", overrides, registerScene, registerCanvas }) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    let cancelled = false;
    analyzeSvgAsync(svg).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [svg]);
  const editRef = useRef({ overrides, gap });
  editRef.current = { overrides, gap };
  const builtRef = useRef(null);
  const [model, setModel] = useState(null);
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    let built = null;
    const t = setTimeout(() => {
      built = buildModel(svg, editRef.current.gap, editRef.current.overrides, profile, quality);
      if (cancelled) {
        disposeBuilt(built);
      } else {
        builtRef.current = built;
        setModel(built.wrapper);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      disposeBuilt(built);
      builtRef.current = null;
    };
  }, [svg, profile, quality]);
  useEffect(() => {
    const built = builtRef.current;
    if (!built || !model) return;
    applyGranular(built, overrides, gap);
  }, [overrides, gap, model]);
  const sceneName = scene ?? profile?.recommended.scene ?? "studio";
  const preset = SCENE_PRESETS[sceneName];
  return /* @__PURE__ */ jsxs(
    Canvas,
    {
      camera: { position: [0, 0, 8], fov: 45 },
      gl: { antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE2.ACESFilmicToneMapping, toneMappingExposure: preset.exposure },
      onCreated: ({ gl, scene: s }) => {
        registerCanvas?.(gl.domElement);
        registerScene?.(s);
        if (preset.background !== "transparent") s.background = new THREE2.Color(preset.background);
      },
      children: [
        /* @__PURE__ */ jsx("ambientLight", { intensity: preset.ambientIntensity }),
        /* @__PURE__ */ jsx("directionalLight", { position: preset.lightPosition, intensity: preset.lightIntensity }),
        /* @__PURE__ */ jsx("directionalLight", { position: [-5, 3, -3], intensity: 0.4 }),
        /* @__PURE__ */ jsx("hemisphereLight", { args: ["#b1e1ff", "#b97a20", 0.5] }),
        model && /* @__PURE__ */ jsx("primitive", { object: model }),
        /* @__PURE__ */ jsx(ContactShadows, { position: [0, -2.2, 0], opacity: 0.4, scale: 10, blur: 2, far: 4 }),
        /* @__PURE__ */ jsxs(Environment, { background: false, environmentIntensity: 1.3, frames: 1, children: [
          /* @__PURE__ */ jsxs("mesh", { scale: 50, children: [
            /* @__PURE__ */ jsx("sphereGeometry", { args: [1, 32, 32] }),
            /* @__PURE__ */ jsx("meshBasicMaterial", { color: "#0a0a12", side: THREE2.BackSide })
          ] }),
          /* @__PURE__ */ jsxs("mesh", { position: [0, 25, 0], children: [
            /* @__PURE__ */ jsx("sphereGeometry", { args: [20, 32, 32] }),
            /* @__PURE__ */ jsx("meshBasicMaterial", { color: "#ffffff" })
          ] }),
          /* @__PURE__ */ jsxs("mesh", { position: [0, 0, 30], children: [
            /* @__PURE__ */ jsx("sphereGeometry", { args: [15, 32, 32] }),
            /* @__PURE__ */ jsx("meshBasicMaterial", { color: "#444444" })
          ] })
        ] }),
        /* @__PURE__ */ jsx(OrbitControls, { enablePan: false })
      ]
    }
  );
}

// src/export.ts
function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export the canvas to PNG."));
    }, "image/png");
  });
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function exportCanvasPng(canvas, filename = "svg3d.png") {
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, filename);
}
async function exportSceneGlb(scene, filename = "svg3d.glb") {
  const root = scene;
  if (!root || typeof root.traverse !== "function") {
    throw new Error("No 3D scene available yet \u2014 try again once the model is visible.");
  }
  let mesh = null;
  root.traverse((o) => {
    if (!mesh && o.isMesh && o.geometry && o.geometry.type !== "PlaneGeometry") mesh = o;
  });
  if (!mesh) throw new Error("No 3D model to export yet.");
  let target = mesh;
  while (target.parent && target.parent !== root) target = target.parent;
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  const result = await new Promise((resolve, reject) => {
    exporter.parse(
      target,
      (gltf) => resolve(gltf),
      (err) => reject(err),
      { binary: true }
    );
  });
  downloadBlob(new Blob([result], { type: "model/gltf-binary" }), filename);
}
function sanitizeSvg(svg) {
  return svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*"[^"]*"/gi, "").replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}
async function readSvgFile(file) {
  const isSvg = /svg/i.test(file.type) || file.name.toLowerCase().endsWith(".svg");
  if (!isSvg) throw new Error("Please upload an .svg file.");
  const text = await file.text();
  if (!text.includes("<svg")) throw new Error("That file does not contain valid SVG.");
  return sanitizeSvg(text);
}
function flatMaterial(preset, fill) {
  const color = new THREE2.Color(fill && /^#?[0-9a-f]{3,8}$/i.test(fill) ? fill : "#c8ccd2");
  switch (preset) {
    case "metal":
      return new THREE2.MeshStandardMaterial({ color, metalness: 1, roughness: 0.28 });
    case "chrome":
      return new THREE2.MeshStandardMaterial({ color: new THREE2.Color("#ffffff"), metalness: 1, roughness: 0.04 });
    case "gold":
      return new THREE2.MeshStandardMaterial({ color: new THREE2.Color("#ffd24a"), metalness: 1, roughness: 0.2 });
    case "emissive":
      return new THREE2.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, roughness: 0.4 });
    case "glass":
      return new THREE2.MeshStandardMaterial({ color, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.6 });
    case "plastic":
      return new THREE2.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55 });
    default:
      return new THREE2.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.45 });
  }
}
function layerIdForNode2(node) {
  let id = "", n = node;
  while (n) {
    if (n.tagName?.toLowerCase() === "g" && n.getAttribute("id")) id = n.getAttribute("id") || id;
    n = n.parentElement;
  }
  return id;
}
function buildExportGroup(svg, overrides = {}, quality = "high", gap = 0) {
  const profile = analyzeSvg(svg);
  const lod = chooseLod(profile, { quality });
  const specById = new Map(profile.layers.map((l) => [l.id, l]));
  const zById = new Map(layerTransforms(applyOverrides(profile, overrides), gap).map((t) => [t.id, t.z]));
  const mode = pickGranularity(svg);
  const parsed = new SVGLoader().parse(svg);
  const isHidden = (node) => {
    let n = node;
    while (n) {
      const t = n.tagName?.toLowerCase();
      if (t === "defs" || t === "mask" || t === "clippath") return true;
      n = n.parentElement;
    }
    return false;
  };
  const renderPaths = parsed.paths.filter((p) => !isHidden(p.userData?.node ?? null));
  const maxDim = Math.max(1, ...renderPaths.flatMap((p) => {
    const box2 = new THREE2.Box2();
    p.subPaths.forEach((sp) => sp.getPoints().forEach((pt) => box2.expandByPoint(pt)));
    const s = new THREE2.Vector2();
    box2.getSize(s);
    return [s.x, s.y];
  }));
  const depthScale = maxDim * 4e-3;
  const elements = [];
  if (mode === "shape") {
    renderPaths.forEach((path, i) => {
      const node = path.userData?.node ?? null;
      elements.push({ id: node?.id || `shape_${i}`, shapes: SVGLoader.createShapes(path) });
    });
  } else {
    const byLayer = /* @__PURE__ */ new Map();
    for (const path of renderPaths) {
      const id = layerIdForNode2(path.userData?.node ?? null) || "root";
      const arr = byLayer.get(id) ?? [];
      arr.push(...SVGLoader.createShapes(path));
      byLayer.set(id, arr);
    }
    for (const [id, shapes] of byLayer) elements.push({ id, shapes });
  }
  const root = new THREE2.Group();
  for (const { id, shapes } of elements) {
    if (!shapes.length) continue;
    const layer = specById.get(id);
    const ov = overrides?.[id];
    if (ov?.visible === false) continue;
    const depth = (ov?.depth ?? layer?.depth ?? 20) * depthScale;
    const bevel = (layer?.bevel ?? 2) * depthScale * 0.4;
    const geo = new THREE2.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: lod.bevelSegments,
      curveSegments: lod.curveSegments
    });
    geo.computeVertexNormals();
    const mesh = new THREE2.Mesh(geo, flatMaterial(ov?.material ?? layer?.material ?? "default", ov?.color ?? layer?.fill));
    mesh.name = id;
    mesh.position.z = (zById.get(id) ?? 0) * depthScale;
    root.add(mesh);
  }
  root.scale.y = -1;
  const box = new THREE2.Box3().setFromObject(root);
  const center = new THREE2.Vector3();
  const size = new THREE2.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const fit = 4 / (Math.max(size.x, size.y, size.z) || 1);
  const wrapper = new THREE2.Group();
  root.position.sub(center);
  wrapper.add(root);
  wrapper.scale.setScalar(fit);
  return wrapper;
}
function disposeGroup(g) {
  g.traverse((o) => {
    const m = o;
    m.geometry?.dispose();
    (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => x?.dispose());
  });
}
async function exportHighLodGlb(svg, filename = "svg3d.glb", opts) {
  const group = buildExportGroup(svg, opts?.overrides ?? {}, opts?.quality ?? "high", opts?.gap ?? 0);
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const result = await new Promise((resolve, reject) => {
      exporter.parse(group, (g) => resolve(g), (e) => reject(e), { binary: true });
    });
    downloadBlob(new Blob([result], { type: "model/gltf-binary" }), filename);
  } finally {
    disposeGroup(group);
  }
}

export { LayeredSvg3D, PRESETS, SCENE_PRESETS, Svg3D, TRIANGLE_BUDGET, VERTEX_BUDGET, analyzeSvg, analyzeSvgAsync, analyzeSvgCached, applyOverrides, assignLevels, buildExportGroup, buildLayerSvgs, canvasToPngBlob, chooseLod, clearAnalysisCache, contains, createRefCache, detectMobile, disposeAnalysisWorker, downloadBlob, estimateTriangles, estimateVertices, exportCanvasPng, exportHighLodGlb, exportSceneGlb, extractGradient, extractShapes, geoKey, geometryCache, hashSvg, layerTransforms, makeGradientTextures, overlaps, pathBBox, pickGranularity, readSvgFile, resolveFillColor, sanitizeSvg, shapeBBox, topLevelGroups };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map