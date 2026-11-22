// ASCII ghost realm: a graveyard horizon in low fog, and wraiths drifting over it.
// Everything moving is glyphs on one canvas grid. The wraiths are density fields with their
// faces cut out, lit by a soft glow that follows their shape and leaving fading afterimages.
// Static layers (sky, graves, vignette) are painted once per theme and size.
//
//   mount(canvas, { theme: "dark" | "light" })                    live page
//
// The canvas may sit anywhere on the page and at any size: it is laid out to its
// own box, follows that box as it changes, and stops drawing while it is scrolled
// out of sight. Ghosts keep clear of [data-sky-avoid] elements and fade, without
// being pushed away, under the text of [data-sky-dim] ones. destroy() stops it.
// leftTree: false leaves out the small tree at the left, for a page whose text
// runs down that side.
//   mount(canvas, { record: { width, height, frames, fps } })     deterministic seamless loop,
//                                                                 drive it with frame(i)

import { TAU, clamp, lerp, smoothstep, mixRgb, rgba, rng, hash3, valueNoise, fbm, lineGlyph } from "./util.js";
import { wraithAt } from "./wraith.js";

const CHARS = " .:-=+*#%@~"; // 1..9 is the density ramp, 10 is fog
const GL = 32, FL = 16, SPINE = 12; // ghost / fog colour levels, shroud links

// Dark: a black night, pale glowing ghosts. Light: an overcast grey dusk, white ghosts with
// dark hollow faces. Each has a variant for the README recording, drawn on GitHub's own page
// colour (#0d1117 / #ffffff), where a white ghost would vanish.
const THEMES = {
  // dark: a moonless, overcast night; nothing in the sky, only a sickly grey-green fog glow
  // low on the horizon, and the ghosts' cold phosphor light
  dark: {
    key: "dark",
    page: [6, 8, 8], skyTop: [3, 4, 4], edge: [0, 0, 0, 0.92], sky: [34, 48, 43],
    fog: [108, 128, 118], ground: [3, 4, 4], groundEdge: [76, 94, 86],
    ghostLo: [66, 76, 74], ghostHi: [232, 240, 238], glow: [138, 154, 148], glowA: 0.46, blend: "lighter",
    socket: [4, 6, 6], ripple: [170, 196, 186], flashC: [178, 198, 194], mist: [90, 112, 104, 0.46], whisper: [150, 168, 160],
  },
  // light: a dead, overcast day; low grey-green light, darker overhead, near-black graves
  // under a heavy vignette, pale fog lying on the ground, and the ghosts as dark shadow
  light: {
    key: "light",
    page: [184, 191, 189], skyTop: [118, 128, 127], sky: [226, 231, 228], edge: [26, 32, 31, 0.5],
    fog: [236, 241, 238], ground: [26, 31, 31], groundEdge: [92, 102, 100], noGroundFog: true, smoothGround: true, mistAbove: true,
    // dark smoke, the page glowing through its hollow face
    ghostLo: [56, 64, 64], ghostHi: [8, 11, 11], glow: [78, 88, 88], glowA: 0.34, blend: "source-over", // a soft body of smoke under the glyphs
    socket: [238, 243, 240], ripple: [24, 30, 30], mist: [242, 246, 244, 0.6], whisper: [40, 48, 47],
  },
};
// The README on GitHub's dark page: a blue-grey mist on the horizon that the graves and the tree
// stand out against (picked out with a pale rim), fading into the page colour at every edge.
THEMES.dark.embed = {
  ...THEMES.dark, key: "dark-embed", page: [13, 17, 23], skyTop: null, edge: [13, 17, 23, 1], sky: [44, 55, 68],
  mist: [78, 94, 108, 0.42], ground: [4, 6, 9], groundEdge: [136, 150, 166], socket: [10, 14, 19],
  glow: [150, 168, 184], glowA: 0.52,
};
// The README on GitHub's white: no grey panel (it read as a smudge), just the ghosts as dark
// smoke on white with the page showing through their faces, faint mist low down, and the graves
// in dark glyphs, everything fading to white at the edges.
THEMES.light.embed = {
  ...THEMES.light, key: "light-embed", glyphGround: true,
  page: [255, 255, 255], skyTop: null, sky: [218, 224, 223], edge: [255, 255, 255, 1],
  fog: [138, 146, 146], mist: [140, 150, 150, 0.2], ground: [34, 39, 40], groundEdge: [112, 120, 122],
  ghostLo: [86, 94, 96], ghostHi: [10, 13, 14], glow: [120, 128, 130], glowA: 0.3, blend: "source-over",
  socket: [252, 254, 253],
};
for (const t of [THEMES.dark, THEMES.light, THEMES.dark.embed, THEMES.light.embed]) {
  t.cssN = []; // [r, g, b, a] of each glyph colour
  const darkSmoke = t.ghostHi[0] < t.ghostLo[0];
  for (let i = 0; i < GL; i++) {
    const k = i / (GL - 1);
    const alpha = darkSmoke ? 0.28 + 0.72 * Math.pow(k, 0.7) : 0.18 + 0.82 * k;
    t.cssN.push([...mixRgb(t.ghostLo, t.ghostHi, Math.pow(k, 0.75)), alpha]);
  }
  for (let i = 0; i < FL; i++) t.cssN.push([...t.fog, 0.04 + (i / (FL - 1)) * 0.5]);
  t.cssN.push(t.socket ? [...t.socket, 0.92] : [0, 0, 0, 0]);
  t.css = t.cssN.map((c) => rgba(c, c[3]));
}
const SOCKET = GL + FL;

// A theme part-way to another: every colour blended, so a theme switch can play inside the scene
// itself (the ghosts drift on, nothing is snapshotted or masked). Reuses one object per frame.
const MIX_KEYS = ["sky", "fog", "ground", "groundEdge", "ghostLo", "ghostHi", "glow", "mist", "socket", "ripple", "flashC", "whisper"];
const mixPal = { css: [], key: "mix" };
function blendThemes(A, B, k) {
  const m = mixPal;
  for (const key of MIX_KEYS) {
    const a = A[key], b = B[key];
    if (!a || !b) { m[key] = (k < 0.5 ? a : b) || a || b; continue; }
    const o = m[key] && m[key].length === a.length ? m[key] : (m[key] = a.slice());
    for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] - a[i]) * k;
  }
  m.glowA = A.glowA + (B.glowA - A.glowA) * k;
  m.mistAbove = (A.mistAbove ? 1 : 0) * (1 - k) + (B.mistAbove ? 1 : 0) * k;
  m.noGroundFog = k < 0.5 ? A.noGroundFog : B.noGroundFog;
  m.ink = false;
  for (let i = 0; i < A.cssN.length; i++) {
    const a = A.cssN[i], b = B.cssN[i];
    m.css[i] = `rgba(${(a[0] + (b[0] - a[0]) * k) | 0},${(a[1] + (b[1] - a[1]) * k) | 0},${(a[2] + (b[2] - a[2]) * k) | 0},${+(a[3] + (b[3] - a[3]) * k).toFixed(3)})`;
  }
  m.from = A; m.to = B; m.k = k;
  return m;
}
const easeInOutSine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x); // CSS: cubic-bezier(.37, 0, .63, 1)

export function mount(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const rec = opts.record || null;
  // embed: the site's look recorded on GitHub's README background (#0d1117 / #ffffff), its edges
  // fading into that colour so the animation melts into the profile page
  const embed = !!(rec && rec.embed);
  const loopT = rec ? rec.frames / rec.fps : 0;
  const seed = rec ? 2258 : (Math.random() * 1e6) | 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  let P = THEMES[opts.theme === "light" ? "light" : "dark"];

  let W = 0, H = 0, S = 0, dpr = 1, cw = 9, ch = 12, cols = 0, rows = 0, horizon = 0;
  let dens, trail, hole, ground, hillRow, avoid, gcols = 0, grows = 0, fogGrid;
  let opB, opK, opC, counts, starts, order;
  let ghosts = [];
  const ripples = [];
  let avoidRects = [];
  const WHISPERS = ["behind you", "do not look", "we never left", "stay", "it is cold here", "who is there", "come closer", "you can see us"];
  let whisper = null, nextWhisper = 12 + Math.random() * 14;
  const ptr = { x: -1e5, y: -1e5, lastMove: -1e9, light: 0 };
  let time = 0, flash = 0, nextFlash = 20 + Math.random() * 20;
  let caches = {};
  const fogC = document.createElement("canvas"); // one pixel per fog node, scaled up smooth
  const fctx = fogC.getContext("2d", { willReadFrequently: true }); // CPU canvas: putImageData every frame is ~0.1 ms here vs ~9 ms on a GPU canvas
  let fogImg = null;
  const glowC = document.createElement("canvas");
  const gctx = glowC.getContext("2d", { willReadFrequently: true });
  let glowImg = null;

  // --------------------------------------------------------------- layout

  function layout(w, h, ratio) {
    W = w; H = h; dpr = ratio; S = Math.min(W, H);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cw = embed ? 9 : clamp(Math.round(W / 165), 6, 10);
    ch = Math.round(cw * 1.35);
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);
    horizon = H * (H > W ? 0.92 : 0.9);
    const n = cols * rows;
    dens = new Float32Array(n); trail = new Float32Array(n); hole = new Float32Array(n); avoid = new Float32Array(n);
    opB = new Uint8Array(n); opK = new Uint32Array(n); opC = new Uint8Array(n); order = new Uint32Array(n);
    counts = new Uint32Array(GL + FL + 1); starts = new Uint32Array(GL + FL + 1);
    gcols = Math.ceil(cols / 2) + 2; grows = Math.ceil(rows / 2) + 2;
    fogGrid = new Float32Array(gcols * grows);
    fogC.width = gcols; fogC.height = grows; fogImg = fctx.createImageData(gcols, grows);
    glowC.width = cols; glowC.height = rows;
    glowImg = gctx.createImageData(cols, rows);
    buildGround();
    caches = {};
    prewarm();

    if (rec) ghosts = recordCast();
    else if (!ghosts.length) {
      ghosts.push(spawnGhost("emerge", Math.random, "wraith"));
      ghosts.push(spawnGhost("materialize", Math.random, "wisp"));
      const bg = makeGhost("shade", Math.random); bg.age = 3; bg.fadeIn = 1.2; ghosts.push(bg);
      ghosts.push(spawnGhost("side", Math.random, "wraith"));
    }
    measure();
  }

  /** Graves, crosses and a dead tree on a low rise, drawn once and read back per cell. */
  const hill = (x) => horizon + Math.sin(x / W * 5.1 + 1.3) * S * 0.018 + Math.sin(x / W * 13.7) * S * 0.008;
  let groundHi = null; // the same silhouette at full resolution, for themes that draw it smooth

  function buildGround() {
    const m = document.createElement("canvas");
    m.width = cols; m.height = rows;
    const g = m.getContext("2d");
    g.scale(1 / cw, 1 / ch);
    paintGround(g);
    groundHi = document.createElement("canvas");
    groundHi.width = canvas.width; groundHi.height = canvas.height;
    const gh = groundHi.getContext("2d");
    gh.scale(dpr, dpr);
    paintGround(gh);
    const a = g.getImageData(0, 0, cols, rows).data;
    ground = new Float32Array(cols * rows);
    for (let k = 0; k < ground.length; k++) ground[k] = a[k * 4 + 3] / 255;
    hillRow = new Int16Array(cols);
    for (let i = 0; i < cols; i++) hillRow[i] = Math.floor(hill((i + 0.5) * cw) / ch);
  }

  function paintGround(g) {
    g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round";
    const r = rng(seed + 5);
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, hill(x));
    g.lineTo(W, H); g.closePath(); g.fill();
    const u = S * (embed ? 0.1 : 0.075);
    let x = W * 0.03;
    while (x < W * 0.84) {
      const kind = r(), hgt = u * (0.7 + r() * 0.9), wid = hgt * (0.5 + r() * 0.25), lean = (r() - 0.5) * 0.25;
      g.save(); g.translate(x, hill(x) + u * 0.15); g.rotate(lean);
      if (kind < 0.55) {
        g.beginPath(); g.moveTo(-wid / 2, 0); g.lineTo(-wid / 2, -hgt + wid / 2);
        g.arc(0, -hgt + wid / 2, wid / 2, Math.PI, 0); g.lineTo(wid / 2, 0); g.closePath(); g.fill();
      } else if (kind < 0.85) {
        const t = wid * 0.28;
        g.fillRect(-t / 2, -hgt * 1.15, t, hgt * 1.15);
        g.fillRect(-wid * 0.45, -hgt * 0.85, wid * 0.9, t);
      } else {
        g.fillRect(-wid * 0.7, -hgt * 0.35, wid * 1.4, hgt * 0.35);
      }
      g.restore();
      x += u * (1.3 + r() * 2.4);
    }
    const tx = W * (H > W ? 0.86 : 0.9);
    const branch = (x0, y0, ang, len, wdt, depth) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.lineWidth = Math.max(wdt, embed ? cw * 0.9 : 0);
      g.beginPath(); g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * len * 0.3, (y0 + y1) / 2, x1, y1); g.stroke();
      if (depth <= 0 || wdt < cw * 0.5) return;
      const n2 = 2 + (r() < 0.35 ? 1 : 0);
      for (let i = 0; i < n2; i++) branch(x1, y1, ang + (r() - 0.5) * 1.3 - 0.08, len * (0.62 + r() * 0.15), wdt * 0.62, depth - 1);
    };
    branch(tx, hill(tx) + 4, -Math.PI / 2 - 0.12, S * 0.22, S * 0.035, 5);
    if (!embed) {
      const t2 = W * 0.06; // a smaller, bent tree on the other side
      if (opts.leftTree !== false) branch(t2, hill(t2) + 4, -Math.PI / 2 + 0.3, S * 0.13, S * 0.022, 4);
      // a broken iron fence along part of the crest: leaning pickets and a sagging rail
      const f0 = W * 0.34, f1 = W * 0.62, step = S * 0.022;
      g.lineWidth = Math.max(1.5, cw * 0.35);
      for (let x = f0, n = 0; x < f1; x += step, n++) {
        if (r() < 0.14) continue; // missing pickets
        const hy = hill(x), lean = (r() - 0.5) * 0.35, hgt = S * (0.05 + r() * 0.014);
        g.beginPath(); g.moveTo(x, hy + 3); g.lineTo(x + Math.sin(lean) * hgt, hy - Math.cos(lean) * hgt); g.stroke();
      }
      g.beginPath();
      for (let x = f0; x <= f1; x += step) { const y = hill(x) - S * 0.034 + Math.sin(x / W * 40) * S * 0.004; x === f0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
  }

  function font() { return `600 ${Math.round(ch * 0.8)}px "Geist Mono", ui-monospace, Consolas, Menlo, monospace`; }

  /** Sky, graves and the vignette never move: paint them once per theme. */
  /** Break up 8-bit gradient steps (they show as rings on a dark screen) with a little noise. */
  // A small tile of faint black and white specks, laid over the cached gradients: it breaks
  // up their 8-bit steps (which show as rings on a dark screen) at almost no cost.
  let noiseTile = null;
  function dither(c) {
    if (!noiseTile) {
      noiseTile = document.createElement("canvas");
      noiseTile.width = noiseTile.height = 128;
      const nx = noiseTile.getContext("2d"), im = nx.createImageData(128, 128), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i + 1] = d[i + 2] = Math.random() < 0.5 ? 0 : 255;
        d[i + 3] = (Math.random() * 7) | 0;
      }
      nx.putImageData(im, 0, 0);
    }
    const x = c.getContext("2d");
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = x.createPattern(noiseTile, "repeat");
    x.fillRect(0, 0, c.width, c.height);
    x.restore();
  }

  /** Paint both themes' static layers while the page is idle, so the first theme switch never stalls. */
  function prewarm() {
    if (embed) return;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(() => cache(THEMES.dark));
    idle(() => cache(THEMES.light));
  }

  function cache(pal) {
    const key = pal.key;
    if (caches[key]) return caches[key];
    const mk = () => { const c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; const x = c.getContext("2d"); x.scale(dpr, dpr); return [c, x]; };
    const [bg, b] = mk();
    b.fillStyle = rgba(pal.page); b.fillRect(0, 0, W, H);
    if (pal.skyTop) { // light: a cooler sky overhead, warming toward the horizon
      const up = b.createLinearGradient(0, 0, 0, horizon);
      up.addColorStop(0, rgba(pal.skyTop)); up.addColorStop(1, rgba(pal.skyTop, 0));
      b.fillStyle = up; b.fillRect(0, 0, W, horizon);
    }
    const sky = b.createLinearGradient(0, horizon - S * 0.55, 0, horizon + S * 0.05);
    sky.addColorStop(0, rgba(pal.sky, 0)); sky.addColorStop(1, rgba(pal.sky, 1));
    b.fillStyle = sky; b.fillRect(0, horizon - S * 0.55, W, S * 0.6);
    b.font = font(); b.textAlign = "center"; b.textBaseline = "middle";
    if (pal.smoothGround && groundHi) {
      const [tc, t] = mk();
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.fillStyle = rgba(pal.ground); t.fillRect(0, 0, tc.width, tc.height);
      t.globalCompositeOperation = "destination-in"; t.drawImage(groundHi, 0, 0);
      b.save(); b.setTransform(1, 0, 0, 1, 0, 0); b.drawImage(tc, 0, 0); b.restore();
    }
    for (let k = 0; k < ground.length; k++) {
      const gd = ground[k];
      if (gd < 0.15) continue;
      const i = k % cols, j = (k / cols) | 0;
      if (pal.ink || pal.glyphGround) {
        const fade = 1 - smoothstep(0, 5, j - hillRow[i]);
        if (fade < 0.03) continue;
        const edge = gd < 0.75, h = hash3(i, j, 4);
        b.fillStyle = rgba(edge ? pal.groundEdge : pal.ground, (edge ? 0.85 : 0.95) * fade);
        b.fillText(edge ? (gd < 0.45 ? ":" : "%") : h < 0.7 ? "#" : "@", (i + 0.5) * cw, (j + 0.5) * ch); // solid, so the graves read
        continue;
      }
      if (!pal.smoothGround) {
        b.fillStyle = rgba(pal.ground, Math.min(1, gd * 1.3));
        b.fillRect(i * cw - 0.3, j * ch - 0.3, cw + 0.6, ch + 0.6);
      } else if (gd > 0.6 && j < hillRow[i]) { // the stones and the tree keep a faint grain of glyphs, cut into them
        const h = hash3(i, j, 33);
        if (h < 0.55) { b.fillStyle = rgba(pal.groundEdge, 0.22 + 0.12 * h); b.fillText(h < 0.2 ? "%" : h < 0.4 ? "#" : "=", (i + 0.5) * cw, (j + 0.5) * ch); }
      }
      if (gd < 0.75) { b.fillStyle = rgba(pal.groundEdge, 0.7); b.fillText(gd < 0.45 ? "." : ":", (i + 0.5) * cw, (j + 0.5) * ch); continue; }
      // earth: a sparse scatter of glyphs, thicker near the crest, so the ground is not a flat slab
      const depthBelow = j - hillRow[i], h = hash3(i, j, 21);
      if (depthBelow >= 0 && h < 0.5 - Math.min(0.32, depthBelow * 0.05)) {
        b.fillStyle = rgba(pal.groundEdge, 0.16 + 0.22 * Math.max(0, 1 - depthBelow / 6));
        b.fillText(depthBelow < 2 && h < 0.18 ? (h < 0.09 ? "\"" : ",") : h < 0.2 ? "." : h < 0.32 ? ":" : h < 0.42 ? "-" : "'", (i + 0.5) * cw, (j + 0.5) * ch);
      }
    }
    const [vg, v] = mk();
    const grad = embed ? v.createRadialGradient(W / 2, H * 0.48, S * 0.35, W / 2, H * 0.48, W * 0.5)
      : v.createRadialGradient(W / 2, H * 0.45, S * 0.3, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
    grad.addColorStop(0, rgba(pal.edge, 0)); grad.addColorStop(1, rgba(pal.edge, pal.edge[3]));
    v.fillStyle = grad; v.fillRect(0, 0, W, H);
    if (embed) { // melt into the README: the bottom (ground) and top edges fade out completely
      const bot = v.createLinearGradient(0, H * 0.84, 0, H * 0.995);
      bot.addColorStop(0, rgba(pal.edge, 0)); bot.addColorStop(1, rgba(pal.edge, 1));
      v.fillStyle = bot; v.fillRect(0, H * 0.84, W, H * 0.16);
      const top = v.createLinearGradient(0, H * 0.02, 0, H * 0.2);
      top.addColorStop(0, rgba(pal.edge, 1)); top.addColorStop(1, rgba(pal.edge, 0));
      v.fillStyle = top; v.fillRect(0, 0, W, H * 0.2);
    }
    if (!embed) { dither(bg); dither(vg); } // grain on the README would show GitHub's flat colour as a frame
    return (caches[key] = { bg, vg });
  }

  // Three kinds, all unmistakably ghosts: wraiths with arms, small quick ones, and big faint
  // shades far back that barely move. They lean into their motion but stay upright.
  const KINDS = {
    wraith: { size: 1, face: true, arms: true, slim: 1, tail: 1, speed: [24, 44], follow: 0.8, maxTilt: 0.3, z: [0.55, 1] },
    wisp: { size: 0.7, face: true, arms: false, slim: 0.88, tail: 1.3, speed: [45, 80], follow: 1.0, maxTilt: 0.4, z: [0.35, 0.85] },
    // a big, faint one that sweeps past close to the viewer and is gone
    passer: { size: 1.9, face: true, arms: true, slim: 1, tail: 1.1, speed: [70, 90], follow: 0.6, maxTilt: 0.25, z: [1, 1], alpha: 0.5, passer: true },
    shade: { size: 1.45, face: true, arms: true, slim: 1.1, tail: 1.25, speed: [10, 18], follow: 0.4, maxTilt: 0.3, z: [0.08, 0.3] },
  };
  let nextId = 0;

  function makeGhost(kind, r) {
    const K = KINDS[kind];
    return {
      id: nextId++, kind, K, z: lerp(K.z[0], K.z[1], r()),
      x: W * r(), y: H * (0.1 + r() * 0.55),
      vx: 0, vy: 0, hd: r() * TAU, speed: lerp(K.speed[0], K.speed[1], r()),
      ph: r() * TAU, ph2: r() * TAU, ph3: r(),
      lean: 0, tilt: 0, wave: r() * 10, startle: 0, blink: 0, blinkAt: 3 + r() * 5, gape: 0.2,
      lookX: 0, lookY: 0, reach: 0, vis: 0, flick: 0, glitch: 0,
      age: 0, life: 12 + r() * 18, leaving: false, gone: false, out: 0, fadeIn: 1.5 + r() * 2,
      // temperament: how curious, how easily frightened, how restless, how much it keeps company
      cur: r(), shy: r(), rest: r(), soc: r(),
      face: (r() * 3) | 0, // terror, anger or sorrow
      loll: (r() - 0.5) * 0.5, asym: (r() - 0.5) * 1.6, // a head held crooked, uneven eyes
      mood: "wander", moodT: 3 + r() * 6, hd2: r() * TAU, listen: 0, lsx: 0, lsy: 0, pvx: 0,
      // build: no two alike -- a taller or rounder hood, a fuller or leaner shroud, a ragged or clean hem
      hood: 0.02 + r() * 0.1, girth: 0.86 + r() * 0.28, tatter: 0.45 + r() * 0.55, droop: 0.45 + r() * 0.3,
      stretch: 0, flare: 0, curl: 0,
    };
  }

  const radius = (g) => clamp(S * (0.055 + 0.03 * g.z), 22, 72) * g.K.size * (embed ? 1.45 : rec ? 1.15 : 1);

  // --------------------------------------------------------------- motion

  /** Record mode: four figures on paths whose periods divide the loop, so it closes seamlessly. */
  function recordCast() {
    const r = rng(seed);
    const cast = [makeGhost("shade", r), makeGhost("wisp", r), makeGhost("wraith", r)];
    if (!embed) cast.push(makeGhost("passer", r)); // the README keeps to three, well apart
    cast[0].z = 0.2; cast[1].z = 0.6; cast[2].z = 0.9;
    cast[0].face = 2; cast[1].face = 1; cast[2].face = 0; if (cast[3]) cast[3].face = 2;
    return cast;
  }

  function poseLoop(g, idx, t) {
    const w = TAU / loopT, u = t / loopT;
    let x, y, vx, vy;
    if (g.kind === "passer") { // sweeps left to right, close and faint, once a loop
      const span = W * 1.9, f = ((u + 0.15) % 1 + 1) % 1;
      x = -W * 0.45 + f * span; y = H * 0.4 + H * 0.05 * Math.sin(TAU * f * 2 + g.ph);
      vx = span / loopT; vy = H * 0.05 * TAU * 2 / loopT * Math.cos(TAU * f * 2 + g.ph);
    } else if (g.kind === "wisp") { // a slow loop left of centre: never fast enough to stream flat
      x = W * 0.38 + W * 0.09 * Math.sin(w * t + g.ph);
      y = H * 0.3 + H * 0.07 * Math.sin(2 * w * t + g.ph2);
      vx = W * 0.09 * w * Math.cos(w * t + g.ph); vy = H * 0.07 * 2 * w * Math.cos(2 * w * t + g.ph2);
    } else if (g.kind === "wraith") { // a wide, slow figure eight right of centre, clear of the others
      x = W * 0.68 + W * 0.13 * Math.sin(w * t + g.ph);
      y = H * 0.3 + H * 0.08 * Math.sin(2 * w * t + g.ph2);
      vx = W * 0.2 * w * Math.cos(w * t + g.ph); vy = H * 0.08 * 2 * w * Math.cos(2 * w * t + g.ph2);
    } else { // far back on the left, barely moving
      x = W * 0.2 + W * 0.05 * Math.sin(w * t + g.ph);
      y = H * 0.26 + H * 0.04 * Math.sin(w * t + g.ph2);
      vx = W * 0.05 * w * Math.cos(w * t + g.ph); vy = H * 0.04 * w * Math.cos(w * t + g.ph2);
    }
    g.x = x; g.y = y; g.vx = vx; g.vy = vy;
    g.lean = clamp(vx / 40, -1, 1) * 0.3;
    g.wave = TAU * 4 * t / loopT + g.ph;
    const sp = Math.hypot(vx, vy) || 1;
    g.lookX = (vx / sp) * 0.7; g.lookY = 0.2;
    g.reach = 0; // no arms in the recording: they only reach for a cursor
    g.gape = 0;
    const v = ((u + g.ph3) % 1 + 1) % 1;
    g.blink = v > 0.5 && v < 0.52 ? 1 : 0;
    g.glitch = 0;
    g.vis = 1;
  }

  function spawnGhost(how, rfn = Math.random, kindOverride = null) {
    const roll = rfn();
    const kind = kindOverride || (roll < 0.44 ? "wraith" : roll < 0.82 ? "wisp" : roll < 0.94 ? "shade" : "passer");
    const g = makeGhost(kind, rfn);
    const r = radius(g);
    const left = ghosts.filter((o) => o.x < W / 2).length, right = ghosts.length - left;
    const side = left === right ? (rfn() < 0.5 ? -1 : 1) : left < right ? -1 : 1;
    const mode = g.K.passer ? "side" : how;
    if (mode === "emerge") { // climbs straight out of a grave on the horizon
      g.x = W * (0.08 + rfn() * 0.82);
      const hi = clamp(Math.floor(g.x / cw), 0, cols - 1);
      const hy = hillRow ? hillRow[hi] * ch : horizon;
      g.y = hy + r * 0.25;
      g.vx = 0; g.vy = -g.speed * 1.4; g.hd = -Math.PI / 2;
      g.fadeIn = 0.35;
      g.mood = "emerge"; g.moodT = 2.8 + rfn() * 1.2;
      g.reach = 0.45;
    } else if (mode === "materialize") { // condenses out of thin air in mid-sky
      g.x = W * (0.12 + rfn() * 0.76);
      g.y = H * (0.16 + rfn() * 0.44);
      g.vx = 0; g.vy = -6; g.hd = -Math.PI / 2;
      g.fadeIn = 1.4;
      g.mood = "materialize"; g.moodT = 2.2;
      const seg = r * 0.52 * g.K.tail;
      g.spine = [];
      for (let i = 0; i < SPINE; i++) g.spine.push([g.x, g.y + r * 0.48 + i * seg]);
    } else { // sweeps in from the side
      g.x = side < 0 ? -r * 2 : W + r * 2;
      g.y = H * (0.1 + rfn() * 0.55);
      g.vx = -side * g.speed * 1.5;
      g.hd = side < 0 ? 0 : Math.PI;
      g.fadeIn = 0.4;
    }
    return g;
  }

  /** Live: how many there are drifts over time; they come and go on their own. */
  function population(dt) {
    const max = clamp(Math.round((W * H) / 190000), 3, 7);
    const resting = time - ptr.lastMove > 0.6 && ptr.x > -1e4;
    const want = resting ? Math.min(Math.max(max, 4), (ptr.cap || 3) + 2) : Math.round(lerp(2, max, smoothstep(0.25, 0.75, valueNoise(time * 0.035, 3.7, seed)))); // a resting cursor fills the page
    const alive = ghosts.filter((g) => !g.leaving).length;
    if (alive < want && Math.random() < dt * (resting ? 1.5 : 0.75)) {
      const p = Math.random();
      const how = p < 0.45 ? "emerge" : p < 0.85 ? "materialize" : "side"; // out of a grave, out of the mist, or in from the side: never dropping from the sky
      ghosts.push(spawnGhost(how, Math.random));
    }
    if (alive > want && Math.random() < dt * 0.25) {
      const c = ghosts.filter((g) => !g.leaving);
      c[(Math.random() * c.length) | 0].leaving = true;
    }
    ghosts = ghosts.filter((g) => !g.gone);
    ghosts.sort((a, b) => a.z - b.z);
  }

  const CALM = new Set(["wander", "drift", "hover", "follow", "circle", "sink", "wail"]);

  /** A new mood when the old one runs out, weighted by temperament. */
  function pickMood(g, r) {
    const others = ghosts.filter((o) => o !== g && !o.K.passer && !o.leaving);
    const w = {
      wander: 3, drift: 2, hover: 0.4 + 2.2 * (1 - g.rest), circle: 1,
      follow: others.length ? 2.6 * g.soc : 0, sink: g.K.face ? 1 : 0,
      wail: g.K.face && !embed ? 0.35 + 0.5 * (1 - g.shy) : 0, // rare: it stops, rises and screams without a sound
    };
    let roll = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
    let m = "wander";
    for (const [k, v] of Object.entries(w)) { if ((roll -= v) <= 0) { m = k; break; } }
    g.mood = m;
    g.moodT = { wander: 5 + Math.random() * 6, drift: 4 + Math.random() * 5, hover: 3 + Math.random() * 4,
      circle: 6 + Math.random() * 5, follow: 6 + Math.random() * 7, sink: 12, wail: 2.6 + Math.random() * 1.4 }[m];
    if (m === "follow") { // keep company with the nearest one
      others.sort((a, b) => Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y));
      g.leader = others[0]; g.side = Math.random() < 0.5 ? -1 : 1;
    }
    if (m === "circle") { // slowly round a grave
      g.cx = W * (0.15 + Math.random() * 0.7); g.cy = horizon - r * (1.6 + Math.random() * 1.4);
      g.ca = Math.atan2(g.y - g.cy, g.x - g.cx); g.cdir = Math.random() < 0.5 ? -1 : 1;
    }
    if (m === "sink") g.phase = "down"; // down among the graves, and up again
  }

  function step(dt) {
    const idle = time - ptr.lastMove;
    ptr.light += ((idle < 3 && ptr.x > -1e4 ? 1 : 0) - ptr.light) * Math.min(1, dt * 2);
    population(dt);
    // A cursor that rests draws them in, a few at a time: how many come this time is left to
    // chance (two to six), the first one or two soon, more the longer it rests. Each comes from
    // its own side to a place of its own, near or far, and the timid hang back before they come.
    if (idle > 0.6 && ptr.x > -1e4) {
      if (ptr.restAt !== ptr.lastMove) { ptr.restAt = ptr.lastMove; ptr.cap = Math.random() < 0.12 ? 2 : 3 + Math.floor(Math.random() * 4); ptr.nextJoin = 0; } // usually three to six, now and then just two
      const busy = ghosts.filter((g) => g.mood === "approach" || g.mood === "linger");
      const allowed = Math.min(ptr.cap, 2 + Math.floor((idle - 0.6) / 1.3));
      if (busy.length < allowed && idle >= ptr.nextJoin) {
        const free = ghosts.filter((g) => g.K.face && !g.K.passer && !g.leaving && (CALM.has(g.mood) || g.mood === "investigate") && !(g.cool > 0));
        free.sort((a, b) => (Math.hypot(a.x - ptr.x, a.y - ptr.y) * (1.6 - a.cur)) - (Math.hypot(b.x - ptr.x, b.y - ptr.y) * (1.6 - b.cur)));
        const g = free[0];
        if (g) {
          // its own place: roughly on its side of the cursor, kept clear of the others', at its own distance
          let ang = Math.atan2(g.y - ptr.y, g.x - ptr.x) + (Math.random() - 0.5) * 0.9;
          for (let tries = 0; tries < 8; tries++) {
            const clash = busy.some((o) => Math.abs(Math.atan2(Math.sin(o.slot - ang), Math.cos(o.slot - ang))) < 0.75);
            if (!clash) break;
            ang += (tries % 2 ? -1 : 1) * 0.5 * (tries + 1);
          }
          g.mood = "approach"; g.slot = ang;
          g.slotR = (0.45 + 0.55 * Math.random()) * (1 + 0.5 * g.shy); // the shy keep further back
          g.slotY = (Math.random() - 0.5) * 0.5;
          g.slotDrift = (Math.random() - 0.5) * 0.18;
          g.hesitate = 0.15 + 1.6 * g.shy * Math.random(); // the shy ones watch a while before drifting in
          ptr.nextJoin = idle + 0.35 + Math.random() * 1.1;
        }
      }
    }
    for (const g of ghosts) {
      const r = radius(g);
      g.age += dt;
      if (g.age > g.life && !g.K.passer) g.leaving = true;
      // a slow current runs through the whole page; each one also wanders on its own
      const fa = valueNoise(g.x / S * 1.3 + time * 0.04, g.y / S * 1.3, seed + 77) * TAU * 2;
      g.hd += (valueNoise(time * 0.15, g.id * 7.31, seed) - 0.5) * dt * 3.2;
      const sp = g.speed * (0.55 + 0.45 * Math.sin(time * 0.33 + g.ph));
      let tx = (Math.cos(g.hd) * 0.6 + Math.cos(fa) * 0.4) * sp;
      let ty = (Math.sin(g.hd) * 0.6 + Math.sin(fa) * 0.4) * sp * 0.75;
      // now and then a short smooth surge onto a new course, then it drifts again
      if (CALM.has(g.mood) && g.mood !== "sink" && g.mood !== "wail" && !(g.surgeT > 0) && Math.random() < dt * (0.025 + 0.09 * g.rest) * (g.mood === "hover" ? 0.15 : 1)) {
        g.surgeA = g.hd + (Math.random() - 0.5) * 1.4;
        g.surgeD = 1.0 + Math.random() * 0.6;
        g.surgeT = g.surgeD;
        g.surgeP = 32 + Math.random() * 30;
        g.hd = g.surgeA;
        if (Math.random() < 0.4) g.flick = 0.35;
      }
      if (g.surgeT > 0) {
        g.surgeT = Math.max(0, g.surgeT - dt);
        const sBell = Math.sin((1 - g.surgeT / g.surgeD) * Math.PI);
        tx += Math.cos(g.surgeA) * g.surgeP * sBell;
        ty += Math.sin(g.surgeA) * g.surgeP * 0.7 * sBell;
      }
      const seek = (x, y, v) => {
        const ex = x - g.x, ey = y - g.y, ed = Math.hypot(ex, ey) || 1, s2 = Math.min(v, ed * 0.9);
        tx = (ex / ed) * s2; ty = (ey / ed) * s2;
        return ed;
      };
      if (!g.K.passer && CALM.has(g.mood)) {
        if ((g.moodT -= dt) <= 0) pickMood(g, r);
        if (g.mood === "drift") { // a long, slow glide
          g.hd2 += (valueNoise(time * 0.08, g.id * 3.1, seed + 5) - 0.5) * dt;
          tx = Math.cos(g.hd2) * sp * 0.5; ty = Math.sin(g.hd2) * sp * 0.2;
        } else if (g.mood === "hover") { // hangs in the air, bobbing, looking about
          tx *= 0.06; ty = ty * 0.06 + Math.sin(time * 1.3 + g.ph) * 6;
        } else if (g.mood === "follow") {
          const L = g.leader;
          if (!L || L.gone || L.leaving) g.moodT = 0;
          else {
            const lv = Math.hypot(L.vx, L.vy) || 1;
            seek(L.x - (L.vx / lv) * r * 2.6 + g.side * r * 1.3, L.y - (L.vy / lv) * r * 1.2, sp * 1.7);
          }
        } else if (g.mood === "circle") {
          g.ca += g.cdir * dt * (0.3 + 0.35 * g.rest);
          seek(g.cx + Math.cos(g.ca) * r * 2.4, g.cy + Math.sin(g.ca) * r * 1.0, sp * 1.5);
        } else if (g.mood === "wail") { // stops dead, draws itself up tall, and wails
          tx *= 0.08; ty = ty * 0.08 - 10 * Math.sin(Math.PI * clamp(g.moodT / 2.6, 0, 1));
        } else if (g.mood === "sink") {
          if (g.phase === "down") { if (seek(g.x + Math.sin(time * 0.3 + g.ph) * r, horizon + r * 0.6, sp * 0.9) < r * 0.5) g.phase = "up"; }
          else if (seek(g.x, H * (0.22 + 0.2 * g.ph3), sp * 0.8) < r) g.moodT = 0;
        }
      } else if (g.mood === "investigate") { // heard something: goes to have a look
        if (seek(g.invX, g.invY, sp * 1.5) < r * 1.2 || (g.moodT -= dt) <= 0) { g.mood = "hover"; g.moodT = 2.5 + Math.random() * 2; }
      } else if (g.mood === "emerge") { // climbing out of the earth
        tx = Math.sin(time * 2.2 + g.ph) * 16;
        ty = -g.speed * (1.15 + 0.6 * (g.moodT / 3.5));
        if ((g.moodT -= dt) <= 0 || g.y < H * 0.52) pickMood(g, r);
      } else if (g.mood === "materialize") { // condensing out of swirling sky mist
        tx = Math.sin(time * 1.8 + g.ph) * 8;
        ty = -6 + Math.cos(time * 1.4 + g.ph2) * 6;
        if ((g.moodT -= dt) <= 0) pickMood(g, r);
      }
      if (g.K.passer) { // straight across, then gone
        tx = Math.sign(g.vx || 1) * g.speed; ty *= 0.3;
        if (g.x < -r * 3 || g.x > W + r * 3) g.gone = g.age > 2;
      }
      // keep clear of the text: the head and the hanging shroud both stay off it
      for (const b of avoidRects) {
        const l = b.left - r * 1.3, rt = b.right + r * 1.3, tp = b.top - r * 3.2, bt = b.bottom + r * 1.1;
        if (g.x > l && g.x < rt && g.y > tp && g.y < bt) {
          const pushX = g.x - l < rt - g.x ? -(g.x - l) : rt - g.x, pushY = g.y - tp < bt - g.y ? -(g.y - tp) : bt - g.y;
          const soft = g.mood === "approach" || g.mood === "linger" ? 0.12 : 1.5;
          if (Math.abs(pushX) < Math.abs(pushY)) tx += pushX * soft; else ty += pushY * soft;
        }
      }
      if (!g.leaving && !g.K.passer) { // soft edges: they may brush past, but turn back
        const m = -r * 0.5;
        if (g.x < m) tx += (m - g.x) * 1.2;
        if (g.x > W - m) tx -= (g.x - (W - m)) * 1.2;
        if (g.y < r * 0.8) ty += (r * 0.8 - g.y) * 0.4;
        if (g.mood !== "sink" && g.mood !== "emerge" && g.y > horizon - r * 0.6) ty -= (g.y - (horizon - r * 0.6)) * 0.4;
      }
      if (g.leaving && !g.K.passer) { // sink back into a grave or dissolve upward into ash
        if (!g.leaveHow) g.leaveHow = Math.random() < 0.5 ? "sink" : "dissolve";
        if (g.leaveHow === "sink") { tx *= 0.2; ty = g.speed * 1.1; }
        else { tx *= 0.15; ty = -18; }
      }
      // curiosity: drawn to a cursor that rests, it comes close, lingers, then turns and goes
      const dx = ptr.x - g.x, dy = ptr.y - g.y, d = Math.hypot(dx, dy);
      g.cool = Math.max(0, (g.cool || 0) - dt);
      if (g.mood === "approach" || g.mood === "linger") {
        if (idle < 0.15 || ptr.x < -1e4) { g.mood = "retreat"; g.moodT = 2.0; g.cool = 2.5; } // the cursor moved away: it shies off
      }
      if (g.mood === "approach" || g.mood === "linger") {
        // its own place near the cursor, drifting a little; first it may just stare, then it comes
        g.slot += dt * g.slotDrift;
        const dist = r * 1.15 + S * (0.045 + 0.065 * g.slotR);
        const ox = ptr.x + Math.cos(g.slot) * dist, oy = ptr.y + Math.sin(g.slot) * dist * 0.7 - r * 0.5 + g.slotY * r;
        const ex = ox - g.x, ey = oy - g.y, ed = Math.hypot(ex, ey) || 1;
        g.hesitate = Math.max(0, (g.hesitate || 0) - dt);
        const pace = 95 + 110 * g.cur; // the curious come fast, the timid slowly
        const want = g.hesitate > 0 ? 0 : g.mood === "approach" ? Math.min(pace, 30 + ed * 1.2) : Math.min(30, ed * 1.4);
        tx = tx * (g.hesitate > 0 ? 0.05 : 0.12) + (ex / ed) * want; ty = ty * (g.hesitate > 0 ? 0.05 : 0.12) + (ey / ed) * want;
        if (g.mood === "approach" && ed < r * 1.1) { g.mood = "linger"; g.moodT = 8 + 12 * g.cur * Math.random() + 4 * Math.random(); }
        // it stays a good while, then drifts off, and is soon drawn back if the cursor is still there
        if (g.mood === "linger" && (g.moodT -= dt) <= 0) { g.mood = "retreat"; g.moodT = 2.2; g.cool = 4; }
      } else if (g.mood === "retreat") { // turns away and drifts off, a little fainter
        const ad = d || 1;
        tx = tx * 0.3 - (dx / ad) * 60; ty = ty * 0.3 - (dy / ad) * 40 - 12;
        if ((g.moodT -= dt) <= 0) g.mood = "wander";
      }
      const near = g.mood === "approach" || g.mood === "linger";
      const wailing = g.mood === "wail" ? Math.sin(Math.PI * clamp(1 - g.moodT / 2.8, 0, 1)) : 0;
      const wantReach = Math.max(wailing * 0.75, g.mood === "linger" ? 1 : g.mood === "emerge" ? 0.5 * clamp(g.moodT / 2.5, 0, 1) : near && d < r * 4.5 ? 0.7 : 0);
      g.reach += (wantReach - g.reach) * Math.min(1, dt * 1.8);
      for (const o of ghosts) {
        if (o === g) continue;
        const ox = g.x - o.x, oy = g.y - o.y, od = Math.hypot(ox, oy) || 1, room = (r + radius(o)) * 1.6;
        const give = (g.mood === "approach" || g.mood === "linger") ? 0.55 : 0.8; // they keep apart round the ring
        if (od < room) { tx += (ox / od) * (room - od) * give; ty += (oy / od) * (room - od) * give; }
      }
      const turn = g.mood === "approach" ? 1.2 + 1.4 * g.cur : 0.7; // called, the curious turn at once
      g.vx += (tx - g.vx) * Math.min(1, dt * turn);
      g.vy += (ty - g.vy) * Math.min(1, dt * turn);
      g.x += g.vx * dt; g.y += g.vy * dt;
      const ax = (g.vx - g.pvx) / Math.max(dt, 1e-3); g.pvx = g.vx;
      g.lean += (clamp(g.vx / 40, -1, 1) * 0.3 - clamp(ax / 260, -0.45, 0.45) - g.lean) * Math.min(1, dt * 2.5);
      // body language: drawn out long when it moves fast or wails, squashed when it recoils; the
      // shroud flares when it wails or lingers, pulls in tight when frightened; it curls when idle
      const spd = Math.hypot(g.vx, g.vy);
      const wantStretch = clamp(spd / 160, 0, 0.45) + wailing * 0.4 - g.startle * 0.35;
      g.stretch += (wantStretch - g.stretch) * Math.min(1, dt * 4);
      const wantFlare = wailing * 0.35 + (g.mood === "linger" ? 0.12 : 0) - g.startle * 0.3 + (g.mood === "retreat" ? -0.1 : 0);
      g.flare += (wantFlare - g.flare) * Math.min(1, dt * 3);
      const wantCurl = g.mood === "hover" || g.mood === "linger" ? 1 : g.mood === "circle" ? 0.6 : 0.2;
      g.curl += (wantCurl - g.curl) * Math.min(1, dt * 1.2);
      g.startle *= Math.exp(-dt * 0.9);
      g.scatter = (g.scatter || 0) * Math.exp(-dt * 0.7);
      g.wave += dt * (1.6 + g.startle * 5 + Math.hypot(g.vx, g.vy) * 0.012);
      let lx = g.vx, ly = g.vy * 0.3 + 4, ll = Math.hypot(lx, ly) || 1;
      g.listen = Math.max(0, g.listen - dt);
      if (g.listen > 0) { lx = g.lsx - g.x; ly = g.lsy - g.y; ll = Math.hypot(lx, ly) || 1; }
      else if (near || g.mood === "retreat") { lx = dx; ly = dy; ll = d || 1; } // even going, it looks back
      else if (g.mood === "emerge") { lx = Math.sin(time * 1.4 + g.ph) * 0.35; ly = -0.75; ll = 1; }
      else if (g.mood === "hover") { lx = Math.sin(time * 0.7 + g.ph); ly = 0.3 * Math.sin(time * 0.43 + g.ph2); ll = 1; }
      g.lookX += ((lx / ll) * 0.9 - g.lookX) * Math.min(1, dt * 2);
      g.lookY += ((ly / ll) * 0.6 - g.lookY) * Math.min(1, dt * 2);
      const targetGape = Math.max(g.startle * 1.1, wailing * 1.3, g.mood === "linger" ? 0.35 + 0.15 * Math.sin(time * 2 + g.ph) : g.mood === "materialize" ? 0.4 * clamp(g.moodT / 2.2, 0, 1) : 0);
      g.gape += (targetGape - g.gape) * Math.min(1, dt * 6); // opens slightly when haunting the cursor, wider in fright
      g.blinkAt -= dt;
      if (g.blinkAt <= 0) { g.blink = 1; g.blinkAt = 4 + Math.random() * 7; }
      g.blink = Math.max(0, g.blink - dt * 5);
      if (Math.random() < dt * 0.015) g.flick = 0.8;
      g.flick = Math.max(0, g.flick - dt);
      // fade in on arrival; dissolve when leaving, or simply drift off the page
      let life = smoothstep(0, g.fadeIn, g.age);
      if (g.leaving) {
        g.out += dt;
        life *= 1 - smoothstep(0, 2.5, g.out);
        if (g.leaveHow === "dissolve") g.scatter = Math.max(g.scatter || 0, smoothstep(0, 2.5, g.out) * 0.7);
        const off = g.x < -r * 3 || g.x > W + r * 3 || g.y < -r * 4 || g.y > H + r * 2;
        if (g.out > 2.6 || off) g.gone = true;
      }
      const flickering = g.flick > 0; // arrivals simply fade in
      g.glitch = g.startle > 0.32 ? (g.startle - 0.32) * 1.1 : 0; // rows slip only when a click startles it
      // a flicker is a slow waver in strength, never a hard on/off strobe
      g.fadeMood = (g.fadeMood ?? 1) + ((g.mood === "retreat" ? 0.55 : 1) - (g.fadeMood ?? 1)) * Math.min(1, dt * 1.5);
      g.vis = life * (flickering ? 0.72 + 0.28 * Math.cos(time * 9 + g.id) : 1) * (1 - 0.85 * (g.scatter || 0)) * g.fadeMood;
    }
    // now and then a silent sheet of lightning lights the graves from behind; the ghosts flinch
    if (!embed && (nextFlash -= dt) <= 0) {
      flash = 1; nextFlash = 24 + Math.random() * 30;
      if (P === THEMES.dark) for (const g of ghosts) g.startle = Math.max(g.startle, 0.25);
    }
    flash = Math.max(0, flash - dt * 1.1);
    // now and then a few words surface in the fog, letter by letter, and sink again
    if (!embed && (nextWhisper -= dt) <= 0) {
      const text = WHISPERS[(Math.random() * WHISPERS.length) | 0];
      whisper = { text, t0: time, i: Math.floor(cols * (0.15 + Math.random() * 0.6)), j: Math.floor(rows * (0.12 + Math.random() * 0.5)) };
      nextWhisper = 22 + Math.random() * 26;
    }
    if (whisper && time - whisper.t0 > 7) whisper = null;
    for (let i = ripples.length - 1; i >= 0; i--) if (time - ripples[i].t0 > 2.6) ripples.splice(i, 1);
  }

  // --------------------------------------------------------------- fog

  function fogField(px, py, t) {
    const x = px / S, y = py / S;
    const q = fbm(x * 1.1 + t * 0.025, y * 2.0 - t * 0.01, seed + 3, 3);
    return fbm(x * 1.4 + q * 1.5 - t * 0.02, y * 2.6 + q, seed + 9, 3);
  }

  function computeFog(t) {
    const w = loopT ? t / loopT : 0;
    const norm = loopT ? 1 / Math.sqrt((1 - w) ** 2 + w * w) : 1;
    for (let gj = 0; gj < grows; gj++) for (let gi = 0; gi < gcols; gi++) {
      const px = gi * 2 * cw, py = gj * 2 * ch;
      let d = fogField(px, py, t);
      if (loopT) d = 0.5 + ((1 - w) * d + w * fogField(px, py, t - loopT) - 0.5) * norm;
      fogGrid[gj * gcols + gi] = d;
    }
  }

  const lowFog = (j) => smoothstep(horizon - S * 0.28, horizon + S * 0.02, (j + 0.5) * ch);

  // --------------------------------------------------------------- wraiths

  // The shroud hangs from a spine of 12 links, like a rope: the head drags it, gravity pulls it
  // down, so it trails along the path just travelled and swings out on every turn.
  const segVx = new Float32Array(SPINE), segVy = new Float32Array(SPINE), segInv = new Float32Array(SPINE), segLenInv = new Float32Array(SPINE), widthAt = new Float32Array(SPINE + 1);
  function updateSpine(g, dt) {
    const r = radius(g), seg = r * 0.52 * g.K.tail;
    const bob = Math.sin(g.wave * 0.5 + g.ph2) * r * 0.16;
    // the head leans the way its shroud trails (plus its crooked set and a slow sway), so head and
    // body always read as one figure: no stiff upright head on a body streaming off sideways
    let tilt = g.tilt || 0;
    if (g.spine) {
      const tdx = g.spine[3][0] - g.spine[0][0], tdy = g.spine[3][1] - g.spine[0][1];
      const cock = g.mood === "linger" ? 0.16 * Math.sin(time * 0.6 + g.ph) : 0; // lingering, it cocks its head this way and that
      const want = clamp(Math.atan2(-tdx, Math.max(1e-3, tdy)) * 0.6 + g.loll * 0.35 + Math.sin(g.wave * 0.25 + g.ph) * 0.05 + cock, -0.42, 0.42);
      tilt += (want - tilt) * Math.min(1, dt * 3);
    }
    g.tilt = tilt;
    const ax = -Math.sin(tilt), ay = Math.cos(tilt); // the head's own "down"
    const nx = g.x + ax * r * 0.48, ny = g.y + bob + ay * r * 0.48; // upper shroud below the head
    if (!g.spine) { g.spine = []; for (let i = 0; i < SPINE; i++) g.spine.push([nx, ny + i * seg]); }
    const sp = g.spine;
    sp[0][0] = nx; sp[0][1] = ny;
    for (let i = 1; i < SPINE; i++) {
      const p = sp[i], q = sp[i - 1], f = i / SPINE;
      p[1] += (1.7 + 1.1 * f) * r * dt; // gravity: the cloth hangs and only sweeps back so far, never streams flat
      // a ripple runs down the cloth, quicker the faster it goes, and curls its end when idle
      const ux = q[1] - p[1], uy = p[0] - q[0], ul = Math.hypot(ux, uy) || 1; // across the cloth
      const amp = r * f * (0.45 + 0.9 * f) * (0.55 + 0.6 * (g.curl || 0) + Math.min(0.8, Math.hypot(g.vx, g.vy) / 90));
      const wv = Math.sin(g.wave * 1.25 - i * 0.62 + g.ph) * amp * dt;
      p[0] += (ux / ul) * wv; p[1] += (uy / ul) * wv;
      if (i < 4) { // the shoulders carry on along the head's axis before the cloth swings free
        const k = 0.3 * (1 - i / 4);
        p[0] += (q[0] + ax * seg - p[0]) * k; p[1] += (q[1] + ay * seg - p[1]) * k;
      }
      const dx = p[0] - q[0], dy = p[1] - q[1], d = Math.hypot(dx, dy) || 1;
      p[0] = q[0] + (dx / d) * seg; p[1] = q[1] + (dy / d) * seg;
    }
  }

  function stampGhost(g, t) {
    const r = radius(g), K = g.K, sp = g.spine;
    if (!sp) return;
    const bob = Math.sin(g.wave * 0.5 + g.ph2) * r * 0.16;
    const hx = g.x, hy = g.y + bob;
    const pose = {
      lean: 0, wave: g.wave, gape: g.gape, reach: g.reach,
      eye: Math.max(0.08, 1 - g.blink), lookX: g.lookX, lookY: g.lookY,
      face: K.face ? g.face : false, slim: K.slim * (g.girth || 1) * (1 - 0.1 * Math.max(0, g.stretch || 0)), asym: g.asym,
      hood: g.hood ?? 0.06, stretch: g.stretch || 0,
    };
    // the head leans with the shoulders (worked out in updateSpine)
    const tilt = g.tilt || 0, ct = Math.cos(tilt), st = Math.sin(tilt);
    const depth = ((embed ? 0.62 : 0.45) + (embed ? 0.38 : 0.55) * g.z) * g.vis * (K.alpha || 1); // the README is small: keep far ones readable
    if (depth < 0.02) return;
    const tick = Math.floor(t * 18);
    // bounds: the head, the arms and every link of the spine, padded by the shroud's width
    let x0 = hx - r * 2.1, x1 = hx + r * 2.1, y0 = hy - r * 1.3, y1 = hy + r * 2.4;
    for (const [px, py] of sp) { x0 = Math.min(x0, px - r * 1.2); x1 = Math.max(x1, px + r * 1.2); y0 = Math.min(y0, py - r); y1 = Math.max(y1, py + r); }
    const i0 = Math.max(0, Math.floor(x0 / cw)), i1 = Math.min(cols - 1, Math.floor(x1 / cw));
    const j0 = Math.max(0, Math.floor(y0 / ch)), j1 = Math.min(rows - 1, Math.floor(y1 / ch));
    const N = SPINE - 1, slim = K.slim * (g.girth || 1) * (1 + (g.flare || 0)) * (1 + 0.04 * Math.sin(g.wave * 0.4 + g.ph3 * 6)); // and it breathes
    // per-link values, worked out once instead of for every cell
    for (let n = 0; n < N; n++) {
      const vx = sp[n + 1][0] - sp[n][0], vy = sp[n + 1][1] - sp[n][1], ll = vx * vx + vy * vy || 1;
      segVx[n] = vx; segVy[n] = vy; segInv[n] = 1 / ll; segLenInv[n] = 1 / Math.sqrt(ll);
    }
    for (let n = 0; n <= N; n++) {
      const s = n / N;
      const swell = 1 + 0.22 * Math.sin(Math.min(1, s * 2.6) * Math.PI);
      widthAt[n] = r * slim * swell * (0.92 * Math.pow(1 - s, g.droop ?? 0.58) + 0.06);
    }
    const emerging = g.mood === "emerge" ? clamp(g.moodT / 2.2, 0, 1) : 0;
    const form = g.mood === "materialize" ? clamp(g.moodT / 2.0, 0, 1) : 0;
    const reach2 = (r * slim * 1.35) ** 2;
    for (let j = j0; j <= j1; j++) {
      const cy = (j + 0.5) * ch;
      const sink = 1 - (0.85 - 0.72 * emerging) * lowFog(j);
      const slip = g.glitch > 0 && hash3(j, tick, g.id) < 0.35 * g.glitch ? (hash3(tick, j, 9) - 0.5) * 5 * cw : 0;
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * cw - slip;
        const dx = (cx - hx) / r, dy = (cy - hy) / r;
        const x = dx * ct + dy * st, y = -dx * st + dy * ct;
        let sx = x, sy = y;
        if (form > 0.01) {
          const swirl = form * 0.65;
          const ang = swirl * (1.8 - Math.min(1.5, Math.hypot(x, y)));
          const ca = Math.cos(ang), sa = Math.sin(ang);
          sx = x * ca - y * sa + Math.sin(y * 3 + t * 4) * swirl * 0.35;
          sy = x * sa + y * ca + Math.cos(x * 3 - t * 3.5) * swirl * 0.35;
        }
        let d = wraithAt(pose, sx, sy); // head, face and arms
        if (wraithAt.hole > 0.05) {
          const hk = j * cols + i, hv = Math.min(1, wraithAt.hole * 1.5) * depth * depth * sink;
          if (hv > hole[hk]) hole[hk] = hv;
        }
        // the shroud: distance to the spine, with a width that tapers from the shoulders
        let body = 0, bs = 1;
        for (let n = 0; n < N; n++) {
          const ax = sp[n][0], ay = sp[n][1], vx = segVx[n], vy = segVy[n];
          const px = cx - ax, py = cy - ay;
          let u = (px * vx + py * vy) * segInv[n];
          if (n === 0 && u < 0) continue; // nothing above the neck: that is the face
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = px - vx * u, qy = py - vy * u, q2 = qx * qx + qy * qy;
          if (q2 > reach2) continue; // too far from this link to matter
          const sN = (n + u) / N;
          let wd = widthAt[n] + (widthAt[n + 1] - widthAt[n]) * u;
          if (sN > 0.35) { // the hem tears into strands that sway
            const side = (vx * qy - vy * qx) * segLenInv[n];
            wd *= 1 - 0.8 * (g.tatter ?? 0.75) * smoothstep(0.35, 1, sN) * (0.5 - 0.5 * Math.cos(side / r * 7.5 + sN * 5 + g.wave * 0.75));
          }
          const q = Math.sqrt(q2);
          const v = smoothstep(wd * 1.25, wd * 0.4, q) * (1 - 0.2 * smoothstep(0, 0.3, sN) - 0.38 * sN); // as dense as the head at the neck, thinning down the hem
          if (v > body) { body = v; bs = sN; }
        }
        body *= wraithAt.keep;
        d = d + body - d * body; // soft union of head and shroud: no seam where they overlap
        if (d < 0.02) continue;
        const nz = fbm(x * 1.7 + g.id * 13 - g.wave * 0.2, y * 1.4 - g.wave * 0.35, seed + 61, 3);
        if (!(embed ? P.embed : P).ink) d *= 1 - (1 - d) * (1 - d) * 0.95 * clamp(1.7 - nz * 2.4, 0, 1) * (0.3 + (body > 0 ? bs : 0));
        const k = j * cols + i;
        const vv = clamp(d, 0, 1) * depth * sink;
        if (vv > dens[k]) dens[k] = vv;
      }
    }
    // specks of the shroud lifting off and fading, from along its length
    for (let s2 = 0; s2 < 8; s2++) {
      const rate = rec ? 2 / loopT : 0.35;
      const u = (((t * rate + s2 / 8 + g.ph3) % 1) + 1) % 1;
      const p = sp[4 + ((hash3(g.id, s2, 2) * (SPINE - 5)) | 0)];
      const sx = p[0] + (hash3(g.id, s2, 1) - 0.5) * r * 1.2 + Math.sin(u * 4 + s2) * r * 0.3;
      const sy = p[1] - u * r * 1.4;
      const i = Math.floor(sx / cw), j = Math.floor(sy / ch);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      dens[k] = Math.max(dens[k], (1 - u) * 0.3 * depth);
    }
    if (form > 0.02) { // converging spiral mist when condensing in mid-air
      for (let p2 = 0; p2 < 14; p2++) {
        const ang = (p2 / 14) * TAU + t * 2.4 + form * 5 + g.ph;
        const rad = r * (0.3 + 1.9 * form) * (0.7 + 0.5 * hash3(g.id, p2, 7));
        const px = hx + Math.cos(ang) * rad, py = hy + Math.sin(ang) * rad * 0.85;
        const ci = Math.floor(px / cw), cj = Math.floor(py / ch);
        if (ci >= 0 && cj >= 0 && ci < cols && cj < rows) {
          const ck = cj * cols + ci;
          dens[ck] = Math.max(dens[ck], (0.25 + 0.45 * (1 - form)) * depth);
        }
      }
    }
    if (emerging > 0.02) { // rising grave-mist specks around the base when climbing out of the earth
      for (let p2 = 0; p2 < 10; p2++) {
        const u = (((t * 0.8 + p2 / 10 + g.ph3) % 1) + 1) % 1;
        const px = g.x + (hash3(g.id, p2, 11) - 0.5) * r * 2.2;
        const py = g.y + r * 0.9 - u * r * 1.8;
        const ci = Math.floor(px / cw), cj = Math.floor(py / ch);
        if (ci >= 0 && cj >= 0 && ci < cols && cj < rows) {
          const ck = cj * cols + ci;
          dens[ck] = Math.max(dens[ck], (1 - u) * 0.45 * emerging * depth);
        }
      }
    }
    if (g.leaving && g.leaveHow === "dissolve") { // upward ash specks when dissolving in mid-air
      const dis = clamp(g.out / 2.5, 0, 1);
      for (let p2 = 0; p2 < 10; p2++) {
        const u = (((t * 0.7 + p2 / 10 + g.ph2) % 1) + 1) % 1;
        const px = hx + (hash3(g.id, p2, 15) - 0.5) * r * (1.2 + dis * 1.6);
        const py = hy - u * r * (1.2 + dis * 1.5);
        const ci = Math.floor(px / cw), cj = Math.floor(py / ch);
        if (ci >= 0 && cj >= 0 && ci < cols && cj < rows) {
          const ck = cj * cols + ci;
          dens[ck] = Math.max(dens[ck], (1 - u) * (1 - dis * 0.7) * 0.35 * depth);
        }
      }
    }
  }

  /** Stamp this frame's wraiths, then let last frame's fade behind them as an afterimage. */
  function updateGhosts(t, dt) {
    dens.fill(0); hole.fill(0);
    for (const g of ghosts) { updateSpine(g, dt); stampGhost(g, t); }
    const keep = Math.exp(-dt * 7);
    for (let k = 0; k < trail.length; k++) {
      const a = trail[k] * keep * (1 - 0.88 * hole[k]);
      trail[k] = dens[k] > a ? dens[k] : a;
    }
  }

  // --------------------------------------------------------------- drawing

  function buildBuckets(pal) {
    counts.fill(0);
    let n = 0;
    const lx = ptr.x, ly = ptr.y, lr2 = (S * 0.22) ** 2, lit = ptr.light;
    for (let j = 0; j < rows; j++) {
      const lf = lowFog(j);
      const cy = (j + 0.5) * ch;
      const fy = j / 2, fyi = fy | 0, ffy = fy - fyi;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const dim = 1 - 0.8 * avoid[k];
        const v = trail[k];
        let b, ch2;
        if (pal.socket && hole[k] > 0.18) { // the hollow face
          b = SOCKET; ch2 = hole[k] > 0.5 ? 9 : hole[k] > 0.34 ? 8 : 7;
        } else if (v >= 0.05) {
          if (pal.ink) {
            const T = 0.06, at = (ii, jj) => (ii < 0 || jj < 0 || ii >= cols || jj >= rows ? 0 : trail[jj * cols + ii]);
            const ring1 = at(i - 1, j) < T || at(i + 1, j) < T || at(i, j - 1) < T || at(i, j + 1) < T;
            const ring2 = !ring1 && (at(i - 2, j) < T || at(i + 2, j) < T || at(i, j - 2) < T || at(i, j + 2) < T);
            const ink = ring1 ? 0.95 : ring2 ? 0.5 : 0.1 + 0.12 * v;
            b = Math.round(clamp(ink * Math.min(1, v * 2.2) * dim, 0, 1) * (GL - 1));
            ch2 = ring1 ? (hash3(i, j, 3) < 0.5 ? 7 : 8) : ring2 ? 5 : v > 0.45 ? 2 : 1;
          } else {
            b = Math.round(clamp(v * dim, 0, 1) * (GL - 1));
            ch2 = clamp(Math.round(v * 9.4), 1, 9);
          }
        } else {
          const fx = i / 2, fxi = fx | 0, ffx = fx - fxi, q = fyi * gcols + fxi;
          const raw = lerp(lerp(fogGrid[q], fogGrid[q + 1], ffx), lerp(fogGrid[q + gcols], fogGrid[q + gcols + 1], ffx), ffy);
          let f = smoothstep(0.48, 0.76, raw) * (0.35 + 0.65 * lf);
          if (ground[k] > 0.15 && (f < 0.55 || pal.socket || pal.noGroundFog)) continue;
          let boost = 0;
          if (lit > 0.01) { const dx = (i + 0.5) * cw - lx, dy = cy - ly; boost = lit * Math.exp(-(dx * dx + dy * dy) / lr2); }
          f = Math.min(1, f + boost * 0.35);
          if (f < 0.1 || hash3(i, j, 17) > f * 1.4) continue;
          b = GL + Math.round(clamp((0.15 + 0.6 * f + boost * 0.5) * dim, 0, 1) * (FL - 1));
          ch2 = f > 0.62 ? 10 : f > 0.36 ? 3 : 1;
        }
        opB[n] = b; opK[n] = k; opC[n] = ch2; counts[b]++; n++;
      }
    }
    let acc = 0;
    for (let b = 0; b <= SOCKET; b++) { starts[b] = acc; acc += counts[b]; }
    for (let m = 0; m < n; m++) order[starts[opB[m]]++] = m;
  }

  function paintTheme(targetCtx, pal, t) {
    const mixing = pal === mixPal, k = mixing ? pal.k : 1;
    const c = cache(mixing ? pal.to : pal), c0 = mixing ? cache(pal.from) : null;
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = "source-over";
    if (c0) { targetCtx.drawImage(c0.bg, 0, 0); targetCtx.globalAlpha = k; }
    targetCtx.drawImage(c.bg, 0, 0);
    targetCtx.globalAlpha = 1;
    targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (flash > 0 && pal === THEMES.dark) { // two quick pulses, then a long, soft fade
      const a = flash > 0.86 ? (flash - 0.86) / 0.14 : flash > 0.72 ? 0.25 : flash > 0.62 ? (flash - 0.62) * 6 : flash * 0.55;
      const lg = targetCtx.createLinearGradient(0, 0, 0, horizon);
      lg.addColorStop(0, rgba(pal.flashC, a * 0.08)); lg.addColorStop(1, rgba(pal.flashC, a * 0.42));
      targetCtx.fillStyle = lg; targetCtx.fillRect(0, 0, W, horizon + ch);
    }

    // fog banks rolling low over the graves
    {
      const fd = fogImg.data, fc = pal.mist;
      for (let gj = 0; gj < grows; gj++) {
        let low = 0.12 + 0.88 * lowFog(gj * 2);
        if (pal.mistAbove) low *= 1 - (+pal.mistAbove) * smoothstep(horizon - ch, horizon + ch * 2, gj * 2 * ch);
        for (let gi = 0; gi < gcols; gi++) {
          const o = (gj * gcols + gi) * 4;
          fd[o] = fc[0]; fd[o + 1] = fc[1]; fd[o + 2] = fc[2];
          fd[o + 3] = 255 * fc[3] * smoothstep(0.4, 0.78, fogGrid[gj * gcols + gi]) * low;
        }
      }
      fctx.putImageData(fogImg, 0, 0);
      targetCtx.imageSmoothingEnabled = true; targetCtx.imageSmoothingQuality = "high";
      targetCtx.drawImage(fogC, -cw, -ch, gcols * 2 * cw, grows * 2 * ch);
    }

    // soft light that follows each wraith's exact shape
    const gd = glowImg.data, gl = pal.glow;
    for (let k = 0, n = trail.length; k < n; k++) {
      const o = k * 4, v = trail[k] * (1 - 0.88 * avoid[k]) * (1 - 0.65 * hole[k]);
      gd[o] = gl[0]; gd[o + 1] = gl[1]; gd[o + 2] = gl[2];
      gd[o + 3] = v > 0.02 ? Math.min(255, v * 255 * pal.glowA) : 0;
    }
    gctx.putImageData(glowImg, 0, 0);
    targetCtx.save();
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = "high";
    if (mixing && pal.from.blend !== pal.to.blend) { // each theme lights its ghosts its own way: fade one into the other
      targetCtx.globalCompositeOperation = pal.from.blend; targetCtx.globalAlpha = 1 - k;
      targetCtx.drawImage(glowC, -cw * 0.5, -ch * 0.5, (cols + 1) * cw, (rows + 1) * ch);
      targetCtx.globalAlpha = k;
    }
    targetCtx.globalCompositeOperation = mixing ? pal.to.blend : pal.blend;
    targetCtx.drawImage(glowC, -cw * 0.5, -ch * 0.5, (cols + 1) * cw, (rows + 1) * ch);
    targetCtx.restore();

    // collect every glyph into colour buckets, then draw bucket by bucket
    buildBuckets(pal);
    targetCtx.font = font();
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";
    let m = 0;
    for (let b = 0; b <= SOCKET; b++) {
      const cnt = counts[b];
      if (!cnt) continue;
      targetCtx.fillStyle = pal.css[b];
      for (let e = 0; e < cnt; e++, m++) {
        const o = order[m], k = opK[o];
        targetCtx.fillText(CHARS[opC[o]], ((k % cols) + 0.5) * cw, (((k / cols) | 0) + 0.5) * ch);
      }
    }

    if (whisper) {
      const age = t - whisper.t0;
      for (let n = 0; n < whisper.text.length; n++) {
        const a = smoothstep(0, 1.2, age - n * 0.09) * (1 - smoothstep(4.2, 6.8, age)) * (0.75 + 0.25 * Math.sin(t * 3 + n));
        const k = whisper.j * cols + whisper.i + n * 2;
        if (a <= 0.02 || whisper.text[n] === " " || trail[k] > 0.1) continue;
        targetCtx.fillStyle = rgba(pal.whisper, 0.42 * a * (1 - 0.8 * (avoid[k] || 0)));
        targetCtx.fillText(whisper.text[n], (whisper.i + n * 2 + 0.5) * cw, (whisper.j + 0.5) * ch + Math.sin(t * 1.3 + n * 0.7) * 1.5);
      }
    }
    for (const rp of ripples) {
      const age = t - rp.t0, rad = 14 + age * 90, a = 1 - age / 2.6;
      if (a <= 0) continue;
      targetCtx.fillStyle = rgba(pal.ripple, a * 0.6);
      const i0 = Math.max(0, Math.floor((rp.x - rad - cw) / cw)), i1 = Math.min(cols - 1, Math.floor((rp.x + rad + cw) / cw));
      const j0 = Math.max(0, Math.floor((rp.y - rad - ch) / ch)), j1 = Math.min(rows - 1, Math.floor((rp.y + rad + ch) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cw - rp.x, dy = (j + 0.5) * ch - rp.y, d = Math.hypot(dx, dy);
        if (Math.abs(d - rad) < ch * 0.55) targetCtx.fillText(lineGlyph(-dy, dx), (i + 0.5) * cw, (j + 0.5) * ch);
      }
    }

    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (c0 && c0.vg) { targetCtx.globalAlpha = 1 - k; targetCtx.drawImage(c0.vg, 0, 0); }
    if (c.vg) { targetCtx.globalAlpha = k; targetCtx.drawImage(c.vg, 0, 0); }
    targetCtx.globalAlpha = 1;
  }

  // a theme change in progress: { from, to, t0, dur, done } (performance.now() milliseconds)
  let fade = null;
  function themeAt() {
    if (embed) return P.embed;
    if (!fade) return P;
    const x = clamp((performance.now() - fade.t0) / fade.dur, 0, 1);
    if (x >= 1) { const f = fade; fade = null; f.done(); return P; }
    return blendThemes(fade.from, fade.to, easeInOutSine(x));
  }
  function drawScene(t) {
    paintTheme(ctx, themeAt(), t);
  }
  /** Switch theme; with a duration the scene blends from the old palette to the new one, frame by
   *  frame, while everything keeps moving. Resolves once the new theme is fully in. */
  function changeTheme(light, o = {}) {
    const to = THEMES[light ? "light" : "dark"];
    const dur = reducedMotion.matches ? 0 : o.duration || 0;
    if (fade) { // switched again mid-way: turn round from where it has got to
      const x = clamp((performance.now() - fade.t0) / fade.dur, 0, 1);
      const f = fade; fade = null; f.done();
      if (to === f.from && dur > 0) {
        P = to;
        return new Promise((done) => { fade = { from: f.to, to, t0: performance.now() - (1 - x) * dur, dur, done }; setTimeout(() => { if (fade && fade.to === to) themeAt(); }, dur + 120); });
      }
    }
    const from = P;
    P = to;
    if (!dur || from === to || embed || !dens) { if (dens) drawScene(time); return Promise.resolve(); }
    cache(to); // ready before the first blended frame
    return new Promise((done) => {
      fade = { from, to, t0: performance.now(), dur, done };
      setTimeout(() => { if (fade && fade.to === to) { themeAt(); drawScene(time); } }, dur + 120); // a hidden tab still settles
    });
  }

  /** Mark the cells under a box (canvas pixels) as dimmed, feathering 2 cells round the edge. */
  function dimCells(r, padX, padY) {
    const f = 2;
    const i0 = Math.max(0, Math.floor((r.left - padX) / cw) - f), i1 = Math.min(cols - 1, Math.floor((r.right + padX) / cw) + f);
    const j0 = Math.max(0, Math.floor((r.top - padY) / ch) - f), j1 = Math.min(rows - 1, Math.floor((r.bottom + padY) / ch) + f);
    const ci0 = Math.floor((r.left - padX) / cw), ci1 = Math.floor((r.right + padX) / cw);
    const cj0 = Math.floor((r.top - padY) / ch), cj1 = Math.floor((r.bottom + padY) / ch);
    for (let j = j0; j <= j1; j++) {
      const dy = j < cj0 ? cj0 - j : j > cj1 ? j - cj1 : 0;
      for (let i = i0; i <= i1; i++) {
        const dx = i < ci0 ? ci0 - i : i > ci1 ? i - ci1 : 0;
        const w = 1 - Math.hypot(dx, dy) / (f + 1);
        if (w > avoid[j * cols + i]) avoid[j * cols + i] = w;
      }
    }
  }

  /**
   * Read the page: [data-sky-avoid] boxes the ghosts steer clear of (and fade
   * under), [data-sky-dim] text they may cross but fade beneath, line by line, so
   * the empty space beside a short line stays clear. Boxes are taken relative to
   * the canvas, which need not sit at the window's corner.
   */
  function measure() {
    if (!avoid) return;
    avoid.fill(0);
    avoidRects = [];
    const o = canvas.getBoundingClientRect();
    const local = (r) => ({ left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top, width: r.width, height: r.height });
    const range = document.createRange();
    for (const el of document.querySelectorAll("[data-sky-dim]")) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t; (t = walk.nextNode());) {
        if (!t.nodeValue.trim()) continue;
        range.selectNodeContents(t);
        for (const rr of range.getClientRects()) if (rr.width > 1 && rr.height > 1) dimCells(local(rr), 6, 3);
      }
    }
    // Avoid and dim by the text actually on screen, line by line: an element's own box can be far
    // wider than its words (a full-width nav), and a hidden view still has a box.
    for (const el of document.querySelectorAll("[data-sky-avoid]")) {
      if (el.closest(".view:not([data-active])")) continue;
      let l = Infinity, t0 = Infinity, rt = -Infinity, bt = -Infinity;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t; (t = walk.nextNode());) {
        if (!t.nodeValue.trim()) continue;
        range.selectNodeContents(t);
        for (const rr of range.getClientRects()) {
          if (rr.width <= 1 || rr.height <= 1) continue;
          const r = local(rr);
          dimCells(r, 8, 4);
          l = Math.min(l, r.left); t0 = Math.min(t0, r.top); rt = Math.max(rt, r.right); bt = Math.max(bt, r.bottom);
        }
      }
      if (rt > l) avoidRects.push({ left: l, right: rt, top: t0, bottom: bt, width: rt - l, height: bt - t0 });
    }
  }

  // --------------------------------------------------------------- record mode

  if (rec) {
    canvas.style.width = rec.width + "px";
    canvas.style.height = rec.height + "px";
    layout(rec.width, rec.height, 1);
    const dt = 1 / rec.fps;
    const advance = (i) => {
      const t = (((i % rec.frames) + rec.frames) % rec.frames) / rec.fps;
      ghosts.forEach((g, n) => poseLoop(g, n, t));
      const u = t / loopT;
      computeFog(t);
      updateGhosts(t, dt);
      return t;
    };
    for (let i = -30; i < 0; i++) advance(i); // fill the afterimages so frame 0 follows the last frame
    return {
      frame(i) { const t = advance(i); drawScene(t); return canvas.toDataURL("image/png"); },
      setTheme(light) { P = THEMES[light ? "light" : "dark"]; },
    };
  }

  // --------------------------------------------------------------- live

  // Laid out to the canvas's own box, and again whenever that box changes size --
  // the window resizing, or the page around an embedded canvas reflowing.
  let sized = "";
  const resize = () => {
    // [patch] The cap is an option (opts.maxDpr, a number or a function read on each resize): a
    // phone draws the realm at 1x. Upstream always allowed 2x.
    const cap = typeof opts.maxDpr === "function" ? opts.maxDpr() : opts.maxDpr ?? 2;
    const w = canvas.clientWidth, h = canvas.clientHeight, r = Math.min(cap, devicePixelRatio || 1);
    if (w < 1 || h < 1 || `${w}x${h}@${r}` === sized) return;
    sized = `${w}x${h}@${r}`;
    layout(w, h, r);
  };
  resize();
  let resizeTimer = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 80); };
  const boxObserver = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  if (boxObserver) boxObserver.observe(canvas);
  addEventListener("resize", onResize); // devicePixelRatio changes (zoom) do not resize the box
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { caches = {}; prewarm(); });

  // Out of sight -- scrolled away, or display:none -- it neither steps nor draws.
  let inView = true;
  const sight = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) measure(); })
    : null;
  if (sight) sight.observe(canvas);

  /** A pointer event's position in the canvas's own pixels. */
  const at = (e) => { const o = canvas.getBoundingClientRect(); return { x: e.clientX - o.left, y: e.clientY - o.top }; };
  const onMove = (e) => {
    const p = at(e);
    ptr.x = p.x; ptr.y = p.y;
    // a hand resting on the mouse jitters; only a real move resets the stillness
    if (Math.hypot(p.x - (ptr.rx ?? -1e5), p.y - (ptr.ry ?? -1e5)) > 72) { ptr.rx = p.x; ptr.ry = p.y; ptr.lastMove = time; }
  };
  const onLeave = () => { ptr.x = ptr.y = -1e5; };
  const onDown = (e) => {
    if (e.target.closest && e.target.closest("a, button, input, textarea, [data-sky-ignore]")) return;
    if (String(getSelection && getSelection())) return;
    const p = at(e);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return; // a click outside the canvas
    ripples.push({ x: p.x, y: p.y, t0: time });
    for (const g of ghosts) {
      const dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < S * 1.1) { g.listen = 1.4; g.lsx = p.x; g.lsy = p.y; } // every one in earshot turns to it
      const reach = S * (0.3 + 0.45 * g.shy); // the timid take fright from further off
      if (d > reach) {
        if (g.cur > 0.5 && g.K.face && !g.K.passer && CALM.has(g.mood) && d < S * 1.1) { // the curious come to see
          g.mood = "investigate"; g.moodT = 6; g.invX = p.x + (dx / d) * radius(g) * 2; g.invY = p.y - radius(g);
        }
        continue;
      }
      const k = 1 - d / reach;
      g.startle = Math.max(g.startle, 0.5 + 0.5 * k);
      g.scatter = Math.max(g.scatter || 0, k); // they all but vanish, then drift back
      g.vx += (dx / d) * 260 * k; g.vy += (dy / d) * 200 * k;
      g.hd = Math.atan2(dy, dx);
      g.flick = 0.5;
    }
  };
  addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", onLeave);
  addEventListener("pointerdown", onDown);

  let lastNow = performance.now();
  const frameTimes = [];
  function advance(dt, draw = true) {
    if (!dens) return; // not laid out yet (the canvas has no size)
    time += dt;
    step(dt);
    computeFog(time);
    updateGhosts(time, dt);
    if (draw) drawScene(time);
  }
  function frame(now) {
    // rAF timestamps can land just before the last one; never step backwards
    const dt = clamp((now - lastNow) / 1000, 0, 0.05) * (reducedMotion.matches ? 0.2 : 1);
    lastNow = now;
    const t0 = performance.now();
    advance(dt);
    frameTimes.push(performance.now() - t0);
    if (frameTimes.length > 120) frameTimes.shift();
  }
  let raf = 0;
  // [patch] opts.fps caps the frames drawn a second: one that comes too soon after the last drawn is
  // skipped, its time carried into the next step. 2 ms of slack keeps a 60 Hz display at an even 30.
  let drawnAt = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!inView) { lastNow = now; return; } // and no catching up on return
    if (opts.fps > 0 && now - drawnAt < 1000 / opts.fps - 2) return; // [patch]
    drawnAt = now; // [patch]
    frame(now);
  }
  raf = requestAnimationFrame(tick);

  return {
    /** Testing: run the live simulation for `sec` seconds at once (also when the tab is hidden). */
    simulate(sec, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) advance(dt, false); drawScene(time); },
    debug() { return ghosts.map((g) => ({ k: g.kind, x: g.x | 0, y: g.y | 0, mood: g.mood || "wander", vis: +g.vis.toFixed(2) })); },
    measure,
    /** Draw right now, so a view transition captures the new theme. */
    redraw() { drawScene(time); },
    /** setTheme(light, { duration }) → Promise: with a duration (ms) the scene itself blends to the new
     *  palette (ease-in-out sine; CSS cubic-bezier(.37, 0, .63, 1)) while the ghosts keep moving. */
    setTheme: changeTheme,
    /** Paint a theme's static layers now (if the idle prewarm has not yet), so switching never stalls. */
    warm(light) { if (dens && !embed) cache(THEMES[light ? "light" : "dark"]); },
    /** Stop for good: the loop, the observers and every listener. */
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      boxObserver?.disconnect();
      sight?.disconnect();
      removeEventListener("resize", onResize);
      removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      removeEventListener("pointerdown", onDown);
    },
    stats() { const a = [...frameTimes].sort((x, y) => x - y); return { median: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)] }; },
  };
}
