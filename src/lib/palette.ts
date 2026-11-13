import { setPondTheme, stir } from "@/lib/pond"

/**
 * The page's palette, and the gesture that changes it: a ring of water spreading
 * from the toggle, uncovering the new page as it goes.
 *
 * The page is not recoloured element by element. A view transition takes a
 * picture of the old page, switches everything at once underneath it, and the
 * new page is shown through a widening circle whose edge wavers like a real
 * wavefront. On that edge, and trailing it, a few thin rings ride outward --
 * the circles a stone leaves -- and in the pond itself the same moment drops
 * three rings of glyphs into the water. Everything moves on the compositor, so
 * the fish keep swimming and nothing stutters.
 *
 * Without view transitions the page switches at once and only the rings play.
 * With reduced motion it switches at once and nothing plays.
 */

const root = document.documentElement
const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** How long the new page takes to be uncovered. */
const DURATION = 1300
/** How long the rings outlast it, spreading off the screen and fading. */
const TAIL = 900
/** Points around the wavefront. */
const POINTS = 96

type Point = { x: number; y: number }

/** Switches the palette at once, with every transition held so nothing fades on its own. */
export function applyPalette(dark: boolean) {
  setPondTheme(dark)
  if (root.classList.contains("dark") === dark) return
  const hold = document.createElement("style")
  hold.textContent = "*,*::before,*::after{transition:none!important}"
  document.head.append(hold)
  root.classList.toggle("dark", dark)
  void document.body.offsetWidth
  hold.remove()
}

/** The wavefront's base radius at progress `t`: fast off the mark, easing out like a real ripple. */
function reach(t: number, far: number): number {
  if (t <= 1) return far * (1 - Math.pow(1 - t, 2.2))
  // Past the end, the rings drift on at the speed they were left with.
  return far + (t - 1) * far * 0.35
}

/**
 * The wavefront at progress `t` and angle `a`: a circle, wavering by a few
 * pixels in two slow interfering modes, never by more than a sliver of its own
 * size, so a small ring is round and a large one is water.
 */
function wave(t: number, a: number, far: number, seed: number): number {
  const r = reach(t, far)
  const wobble = Math.min(13, r * 0.06) * (1 - 0.55 * Math.min(t, 1))
  return Math.max(0, r + wobble * (0.62 * Math.sin(5 * a + seed + t * 8) + 0.38 * Math.sin(9 * a - seed * 1.7 - t * 13)))
}

function outline(t: number, at: Point, far: number, seed: number): Point[] {
  return Array.from({ length: POINTS }, (_, i) => {
    const a = (i / POINTS) * Math.PI * 2
    const r = wave(t, a, far, seed)
    return { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r }
  })
}

/**
 * The wave drawn as a halftone, the pond's own grain: a lattice of dots over the
 * whole window, still where the water is still. Just ahead of the wavefront the
 * dots swell in the new page's paper until they touch and close over the old
 * page, so the edge arrives as a dissolving screen of dots rather than a line.
 * Behind it, rings of small ink dots ride outward on the new page -- the circles
 * a stone leaves -- brightening and fading as each passes. Drawn on a canvas
 * above everything, which during a view transition is a layer of its own
 * (`ink-ripple`, see index.css) so the circle's clip does not cut it.
 */
function rings(
  at: Point,
  far: number,
  seed: number,
  colours: { old: string; new: string; paper: string },
  start: Promise<unknown>,
  /** Called with the progress before each frame is drawn, to move the clip in step. */
  tick: (t: number) => void = () => {},
) {
  const canvas = document.createElement("canvas")
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const w = innerWidth, h = innerHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "2147483000",
    viewTransitionName: "ink-ripple",
  })
  canvas.setAttribute("aria-hidden", "true")
  document.body.append(canvas)
  const ctx = canvas.getContext("2d")!
  ctx.scale(dpr, dpr)

  // The lattice: rows a step apart, every other one shifted half a step, so the
  // dots lie in the same loose hexagonal weave as the globe's. Each dot keeps
  // its distance from the centre and its angle, worked out once.
  const STEP = 11
  const lattice: { x: number; y: number; d: number; a: number }[] = []
  for (let row = 0, y = STEP / 2; y < h + STEP; y += STEP * 0.87, row++) {
    for (let x = (row % 2) * (STEP / 2); x < w + STEP; x += STEP) {
      lattice.push({ x, y, d: Math.hypot(x - at.x, y - at.y), a: Math.atan2(y - at.y, x - at.x) })
    }
  }
  /** How far ahead of the front the dots begin to swell. */
  const SWELL = 120
  /** Pixels between neighbouring dots along a ring. */
  const DOT_STEP = 9
  /**
   * The rings behind the front: how far back each sits. The gaps open as the
   * wave spreads, as real ripples' do.
   */
  const RINGS = [0, 1, 2, 3, 4].map((k) => ({ back: (t: number) => 6 + k * (20 + 26 * Math.min(t, 1.4)) }))

  let began = 0
  const frame = (now: number) => {
    began ||= now
    const t = (now - began) / DURATION
    tick(t)
    const fade = t <= 1 ? 1 : Math.max(0, 1 - ((t - 1) * DURATION) / TAIL)
    ctx.clearRect(0, 0, w, h)
    if (fade <= 0) {
      canvas.remove()
      return
    }
    for (const p of lattice) {
      const front = wave(t, p.a, far, seed)
      const ahead = p.d - front
      if (t <= 1 && ahead > 0 && ahead < SWELL) {
        // The new paper, swelling from a speck to a dot wider than the step,
        // where neighbours overlap into a solid edge.
        const k = 1 - ahead / SWELL
        ctx.globalAlpha = 1
        ctx.fillStyle = colours.paper
        ctx.beginPath()
        ctx.arc(p.x, p.y, STEP * 0.72 * k * k, 0, Math.PI * 2)
        ctx.fill()
        // A faint ink dot riding the very crest, over the old page.
        if (ahead > SWELL * 0.55) {
          ctx.globalAlpha = 0.28 * (1 - (ahead - SWELL * 0.55) / (SWELL * 0.45))
          ctx.fillStyle = colours.old
          ctx.beginPath()
          ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2)
          ctx.fill()
        }
        continue
      }
    }

    // The rings: circles of dots spreading from the centre, one behind
    // another, each dot set an even step along its circle -- the circles a stone
    // leaves, drawn in the pond's grain. The first rides the front, the largest
    // and brightest; each after it trails further back, smaller and fainter.
    // One faint ring runs just ahead of the front, over the old page.
    const ringsNow = [
      { back: -26, size: 1.1, alpha: 0.32, colour: colours.old },
      ...RINGS.map((r, k) => ({ back: r.back(t), size: 2.3 - k * 0.32, alpha: 0.85 - k * 0.15, colour: colours.new })),
    ]
    for (const ring of ringsNow) {
      const base = reach(t, far) - ring.back
      if (base < 6) continue
      const alpha = ring.alpha * fade * Math.min(1, base / 60)
      if (alpha <= 0.02) continue
      ctx.globalAlpha = alpha
      ctx.fillStyle = ring.colour
      // A dot every DOT_STEP pixels round the circle.
      const count = Math.max(12, Math.round((Math.PI * 2 * base) / DOT_STEP))
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        const r = wave(t, a, far, seed) - ring.back
        const x = at.x + Math.cos(a) * r, y = at.y + Math.sin(a) * r
        if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue
        ctx.beginPath()
        ctx.arc(x, y, ring.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    requestAnimationFrame(frame)
  }
  void start.then(() => requestAnimationFrame(frame), () => canvas.remove())
}

let busy = false

/**
 * Changes the palette as a ripple spreading from `at` (viewport pixels).
 * `update` brings the rest of the page into the new state -- the toggle's own
 * icon among it -- and has to finish before it returns.
 */
export function transitionPalette(dark: boolean, at: Point | undefined, update: () => void) {
  const commit = () => {
    update()
    applyPalette(dark)
  }
  if (!at || reduced.matches) return commit()

  stir(at)
  const far = Math.hypot(Math.max(at.x, innerWidth - at.x), Math.max(at.y, innerHeight - at.y)) + 28
  const seed = Math.random() * Math.PI * 2
  const ink = () => getComputedStyle(root).getPropertyValue("--foreground").trim()
  const old = ink()
  const paper = () => getComputedStyle(root).getPropertyValue("--background").trim()

  if (busy || typeof document.startViewTransition !== "function") {
    commit()
    rings(at, far, seed, { old, new: ink(), paper: paper() }, Promise.resolve())
    return
  }

  busy = true
  let ready: () => void = () => {}
  const started = new Promise<void>((resolve) => (ready = resolve))
  // The new page's clip, moved by the dots' own frame loop rather than run on
  // its own: the halftone edge and the clip's edge then stay on one clock.
  let clip: Animation | null = null
  const shape = (t: number, ahead = 0) =>
    `polygon(${outline(Math.min(t, 1), at, far, seed)
      .map((p) => {
        const d = Math.hypot(p.x - at.x, p.y - at.y) || 1
        const k = (d + ahead) / d
        return `${(at.x + (p.x - at.x) * k).toFixed(1)}px ${(at.y + (p.y - at.y) * k).toFixed(1)}px`
      })
      .join(",")})`
  const tick = (t: number) => {
    if (!clip || clip.playState === "finished") return
    if (t >= 1) return clip.finish()
    const effect = clip.effect as KeyframeEffect
    // A little ahead of the dots' front: the clip lands a frame after it is set,
    // and the swelling paper dots, drawn over both pages, cover the margin.
    const lead = shape(t, 18)
    effect.setKeyframes([{ clipPath: lead }, { clipPath: lead }])
  }
  const transition = document.startViewTransition(() => {
    commit()
    rings(at, far, seed, { old, new: ink(), paper: paper() }, started, tick)
  })
  transition.ready
    .then(() => {
      const zero = shape(0)
      // Long enough that it never ends before the loop finishes it.
      clip = root.animate([{ clipPath: zero }, { clipPath: zero }], {
        duration: DURATION * 3, fill: "forwards", pseudoElement: "::view-transition-new(root)",
      })
      ready()
    })
    .catch(() => ready())
  void transition.finished.finally(() => (busy = false))
}
