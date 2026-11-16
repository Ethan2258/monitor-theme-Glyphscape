// A ghost's head and face, as a density field: shape space is in head radii, origin at the
// centre of the head, y down. 1 is solid, 0 empty. The head is a hooded wisp of smoke, narrower
// at the crown, flowing seamlessly into the shroud spine. The face is cut out as deep hollows.
import { clamp, smoothstep } from "./util.js";

// [eye x, eye y, eye half-width, eye half-height, eye slant, mouth y, mouth half-width, mouth half-height]
// slant > 0 droops the outer corner (sorrow), < 0 lifts it (anger)
const FACES = [
  [0.32, -0.14, 0.17, 0.27, 0.16, 0.42, 0.18, 0.24], // terror: tall hollow eyes, wide wailing mouth
  [0.33, -0.10, 0.22, 0.13, -0.52, 0.34, 0.13, 0.15], // anger: sharp slanted eyes, tense hollow mouth
  [0.31, -0.12, 0.19, 0.16, 0.55, 0.40, 0.12, 0.22], // sorrow: drooping eyes, long hollow moan
];

/** pose: { wave, gape, eye, lookX, lookY, reach, face (false, or 0..2), slim, asym }
 *  Returns the density; `wraithAt.hole` is how much eye or mouth was cut out at that point. */
export function wraithAt(p, x, y) {
  // Hooded cranium: slightly peaked at the crown, widening gently into the upper shroud
  const hood = p.hood ?? 0.06, st = p.stretch || 0; // st > 0 draws the head out tall, < 0 squashes it
  const crown = y < 0 ? 1 - hood * smoothstep(0, -1.05, y) : 1 + 0.18 * smoothstep(0, 0.85, y);
  const hx = x / (0.84 * p.slim * crown);
  const hy = (y + 0.08) / (1.08 * (1 + 0.2 * st) + (y < 0 ? hood * 0.15 : 0));
  const r2 = hx * hx + hy * hy;
  let d = smoothstep(1.06, 0.48, Math.sqrt(r2));

  // Curved spectral sleeves lifting from the cloak when reaching toward a nearby cursor
  if (p.reach > 0.12) {
    const rch = Math.min(1, p.reach * 1.35);
    for (let s = -1; s <= 1; s += 2) {
      const ax0 = s * 0.52 * p.slim, ay0 = 0.58;
      const ax1 = s * (1.12 + 0.3 * rch), ay1 = 0.5 - 0.6 * rch + 0.12 * Math.sin(p.wave * 0.85 + s); // a short, soft sleeve, not a stick
      const vx = ax1 - ax0, vy = ay1 - ay0, ll = vx * vx + vy * vy || 1;
      const t = clamp(((x - ax0) * vx + (y - ay0) * vy) / ll, 0, 1);
      const bow = -Math.sin(t * Math.PI) * (0.18 + 0.1 * rch);
      const qx = ax0 + vx * t - x;
      const qy = ay0 + vy * t + bow - y;
      const th = (0.24 * (1 - t * 0.65) + 0.05) * p.slim;
      const arm = smoothstep(th * 1.75, th * 0.42, Math.hypot(qx, qy)) * (0.8 - 0.55 * t * t) * smoothstep(1, 0.7, t) * rch; // thins away to nothing at the tip
      if (arm > d) d = arm;
    }
  }

  wraithAt.hole = 0; wraithAt.keep = 1;
  if (d < 0.02 || p.face === false) return d;
  const F = FACES[p.face | 0];
  const before = d;
  let keep = 1;

  const A = p.asym || 0;
  for (let s = -1; s <= 1; s += 2) {
    const big = 1.18 * (1 + 0.16 * A * s);
    const cx = s * F[0] + p.lookX * 0.09;
    const cy = F[1] + p.lookY * 0.07 + 0.04 * A * s;
    const ex = x - cx, ey = y - cy;
    const a = s * F[4], ca = Math.cos(a), sa = Math.sin(a);
    const u = (ex * ca + ey * sa) / (F[2] * big);
    const v = (-ex * sa + ey * ca) / (F[3] * big * p.eye * (1 + 0.45 * Math.max(0, st)) + 0.035); // eyes go long in a wail
    const e = u * u + v * v;
    if (e < 1.55) keep *= smoothstep(0.42, 1.55, e);
    // the hollow runs a little way down the face, as if it were melting
    const len = 0.32 + 0.14 * A * s, t = ey / len;
    if (t > 0 && t < 1) {
      const w = 0.055 * (1 - 0.65 * t), off = Math.abs(ex + 0.025 * Math.sin(ey * 9 + s));
      keep *= 1 - 0.45 * (1 - t) * smoothstep(w, w * 0.4, off);
    }
  }

  // Hollow mouth: always present, gaping wider in fright or when haunting the cursor
  const mw = F[6] * 1.16 * (1 + 0.38 * p.gape);
  const mh = F[7] * 1.22 * (1 + 0.52 * p.gape);
  const mx = (x - p.lookX * 0.06) / mw;
  const my = (y - F[5] - p.lookY * 0.04) / mh;
  const m = mx * mx + my * my;
  if (m < 1.55) keep *= smoothstep(0.42, 1.55, m);
  // and the mouth sags, dripping downward into the shroud
  const mt = (y - F[5] - mh * 0.6) / 0.42;
  if (mt > 0 && mt < 1) {
    const w = mw * 0.42 * (1 - mt);
    keep *= 1 - 0.55 * (1 - mt) * smoothstep(w, w * 0.45, Math.abs(x - p.lookX * 0.06));
  }

  d *= keep;
  wraithAt.keep = keep; // the scene cuts the same hollows out of the shroud where it overlaps the face
  wraithAt.hole = before > 0.24 ? (1 - keep) * before : 0;
  return d;
}
