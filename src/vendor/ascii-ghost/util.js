// Small maths helpers for the scene: clamping, colour ramps, a seeded RNG and value noise.

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const ramp = (stops, t) => {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixRgb(stops[i], stops[i + 1], x - i);
};
export const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${+a.toFixed(3)})`;

/** mulberry32: a tiny seeded RNG, so a recording is the same every run. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash to [0, 1). */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let u = x - xi, v = y - yi;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const a = hash3(xi, yi, seed), b = hash3(xi + 1, yi, seed);
  const c = hash3(xi, yi + 1, seed), d = hash3(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in [0, 1]; each octave is rotated so the grid never lines up. */
export function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 131);
    norm += amp;
    const nx = x * 1.6 - y * 1.2 + 3.1;
    y = x * 1.2 + y * 1.6 + 1.7;
    x = nx;
    amp *= 0.5;
  }
  return sum / norm;
}

/** The ASCII stroke that best follows a direction. */
export function lineGlyph(dx, dy) {
  const a = Math.atan2(dy, dx);
  const k = ((Math.round(a / (Math.PI / 4)) % 4) + 4) % 4;
  return k === 0 ? "-" : k === 1 ? "\\" : k === 2 ? "|" : "/";
}
