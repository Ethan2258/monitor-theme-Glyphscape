/**
 * The ghost realm behind the page: ascii-ghost's scene, started on a canvas that
 * fills the head of the page, behind the header and the overview. It paints its
 * own sky, graveyard and fog. Its wraiths fade as they pass under text marked
 * `data-sky-dim`, as the pond's koi do, re-measured whenever the head of the
 * page changes (lib/pond.ts, followLayout).
 */

import { followLayout, SCENE_FPS, sceneDpr } from "@/lib/pond"
import type { Sky } from "@/vendor/ascii-ghost/scene.js"

let sky: Sky | null = null

const root = document.documentElement

/**
 * The realm's palette follows the page's: over `duration` milliseconds it blends
 * from one to the other frame by frame, in the same ease as the page's colours.
 */
export function setRealmTheme(dark: boolean, duration = 0) {
  void sky?.setTheme(!dark, { duration })
}

// One request for the engine, shared by the idle prefetch, the scene menu and
// the realm itself. Let go of if it fails, so a later attempt tries again.
let engine: Promise<typeof import("@/vendor/ascii-ghost/scene.js")> | null = null
const loadEngine = () =>
  (engine ??= import("@/vendor/ascii-ghost/scene.js").catch((e: unknown) => {
    engine = null
    throw e
  }))

let warmed = false

/**
 * Draws every glyph the realm uses, once, in the font and at the size it will
 * draw them, on a scratch canvas, so the browser has looked the font up and
 * rasterised the glyphs before the first switch to the ghosts rather than in
 * its first frame. Measured on the first switch at 1440: that frame went from
 * 166 ms to 105 ms. The font and the size follow scene.js's `font()` and
 * `layout()` (cell width W/165, clamped to 6-10 px; height 1.35 times it; the
 * font 0.8 of the height); if they drift apart this only warms the wrong size.
 */
function warmGlyphs() {
  if (warmed) return
  warmed = true
  const width = document.querySelector(".scene-band")?.clientWidth || innerWidth
  const cw = Math.min(10, Math.max(6, Math.round(width / 165)))
  const size = Math.round(Math.round(cw * 1.35) * 0.8)
  const scratch = document.createElement("canvas")
  scratch.width = scratch.height = 64
  const ctx = scratch.getContext("2d")
  if (!ctx) return
  const scale = Math.min(sceneDpr(), devicePixelRatio || 1)
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.font = `600 ${size}px "Geist Mono", ui-monospace, Consolas, Menlo, monospace`
  for (const glyph of " .:-=+*#%@~,'\"") ctx.fillText(glyph, 4, 16)
  // Reading a pixel back makes the browser draw now, not at the next frame.
  ctx.getImageData(0, 0, 1, 1)
}

/**
 * Fetches the realm's engine ahead of need: on idle after the page has loaded,
 * and as the scene menu opens, and warms its glyphs once it is here. Fetched
 * on the click itself, as before, the first switch to the ghosts waited on the
 * network and the parse on top of setting the scene up. A failure here is left
 * for the real start to report.
 */
export function preloadRealm() {
  loadEngine()
    .then(() => {
      if (warmed) return
      if (typeof requestIdleCallback === "function") requestIdleCallback(warmGlyphs, { timeout: 2000 })
      else setTimeout(warmGlyphs, 200)
    })
    .catch(() => {})
}

/**
 * Starts the realm on `canvas`. Returns what stops it. The engine is fetched
 * apart from the page (see preloadRealm): the ghosts can arrive a moment after
 * the figures.
 *
 * Put away by the visitor, it is only hidden: brought back, it carries on where
 * it was. It sizes itself to the canvas and pauses while scrolled out of sight.
 */
export function startRealm(canvas: HTMLCanvasElement): () => void {
  let stopped = false
  let unfollow = () => {}
  void loadEngine().then(({ mount }) => {
    if (stopped) return
    sky = mount(canvas, {
      theme: root.classList.contains("dark") ? "dark" : "light",
      leftTree: false,
      fps: SCENE_FPS,
      maxDpr: sceneDpr,
    })
    const started = sky
    if (canvas.parentElement) unfollow = followLayout(canvas.parentElement, () => started.measure())
  })
  return () => {
    stopped = true
    unfollow()
    sky?.destroy()
    sky = null
  }
}
