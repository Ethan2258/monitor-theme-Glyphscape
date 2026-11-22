import type { Box, PondInstance } from "@/vendor/ascii-pond/pond.js"

/**
 * The koi pond at the head of the page: started on a canvas that fills that
 * stretch, recoloured with the page, and stirred when the palette changes.
 */

let instance: PondInstance | null = null

const root = document.documentElement

/**
 * How often the character scenes, the pond and the realm, are drawn: 30 frames
 * a second rather than the display's 60 or 120. Their fish and ghosts drift
 * slowly enough that 30 reads as smooth, and at full rate the realm alone kept
 * the main thread busy nearly all the time, slowing the globe and the live
 * figures beside it on a phone. The globe keeps the full rate.
 */
export const SCENE_FPS = 30

const COARSE = matchMedia("(pointer: coarse), (max-width: 639px)")

/**
 * The pixel density the character scenes are drawn at: 1x on a phone (a
 * finger for a pointer, or a narrow window), where the pond's canvas was
 * otherwise 780 by 2071 pixels, four times the work for glyphs that are
 * decoration behind the text. Read on each resize, so a window that narrows
 * drops to it too.
 */
export const sceneDpr = () => (COARSE.matches ? 1 : 2)

/**
 * Calls `measure` once a frame at most whenever the head of the page, `host`,
 * may have moved what lies over a scene: it changed size (the window, data
 * arriving, a filter, the globe's chips wrapping), its contents changed (each
 * push of figures), something inside it scrolled sideways (the chips on a
 * phone), or a font arrived. The scenes sit inside `host` and scroll with it,
 * so a scroll of the page never moves the text against them and needs no
 * measuring; before, the pond re-measured on every frame of a scroll and the
 * realm forced a layout every second. Returns what stops it.
 */
export function followLayout(host: Element, measure: () => void): () => void {
  let frame = 0
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0
      measure()
    })
  }
  const sized = new ResizeObserver(soon)
  sized.observe(host)
  const changed = new MutationObserver(soon)
  changed.observe(host, { childList: true, subtree: true, characterData: true })
  // Capture: a scroll event does not bubble, but an ancestor still sees it on the way down.
  host.addEventListener("scroll", soon, { capture: true, passive: true })
  document.fonts?.addEventListener("loadingdone", soon)
  return () => {
    sized.disconnect()
    changed.disconnect()
    host.removeEventListener("scroll", soon, { capture: true })
    document.fonts?.removeEventListener("loadingdone", soon)
    if (frame) cancelAnimationFrame(frame)
  }
}

// One request for the engine, shared by the idle prefetch, the scene menu and
// the pond itself. Let go of if it fails, so a later attempt tries again.
let engine: Promise<typeof import("@/vendor/ascii-pond/pond.js")> | null = null
const loadEngine = () =>
  (engine ??= import("@/vendor/ascii-pond/pond.js").catch((e: unknown) => {
    engine = null
    throw e
  }))

/**
 * Fetches the pond's engine ahead of need: on idle after the page has loaded,
 * and as the scene menu opens, so switching to it does not wait on the
 * network. A failure here is left for the real start to report.
 */
export function preloadPond() {
  loadEngine().catch(() => {})
}

/**
 * The pond's palette follows the page's. Over `duration` milliseconds it blends:
 * the pond is switched at once underneath, and a still of it as it was lies on
 * top and fades away in the page's own ease, so the water changes colour with
 * the paper while the fish swim on. Only opacity moves, on the compositor.
 */
export function setPondTheme(dark: boolean, duration = 0) {
  if (!instance) return
  const { canvas } = instance
  let still: HTMLCanvasElement | null = null
  if (duration > 0 && canvas.isConnected && canvas.width && canvas.offsetParent) {
    still = document.createElement("canvas")
    still.width = canvas.width
    still.height = canvas.height
    still.getContext("2d")?.drawImage(canvas, 0, 0)
    still.className = canvas.className
    still.setAttribute("aria-hidden", "true")
    canvas.after(still)
  }
  instance.setTheme(!dark)
  if (!still) return
  const fade = still.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration, easing: "cubic-bezier(0.37, 0, 0.63, 1)", fill: "forwards",
  })
  const done = () => still?.remove()
  fade.finished.then(done, done)
}

/**
 * Rings on the water spreading from `at` (viewport pixels), as from a stone
 * dropped there: three, a beat apart, the first the strongest. They are drawn
 * by the pond itself, in its own glyphs, so they lap round the fish.
 */
export function stir(at: { x: number; y: number }) {
  if (!instance) return
  const { pond, canvas } = instance
  const box = canvas.getBoundingClientRect()
  const x = at.x - box.left, y = at.y - box.top
  // A point well clear of the water would only ruffle the edge of it.
  if (x < -200 || y < -200 || x > box.width + 200 || y > box.height + 200) return
  ;[1, 0.75, 0.5].forEach((strength, i) => {
    pond.ripples.push({ x, y, born: pond.time + i * 0.28, strength })
  })
}

/**
 * What lies on the water with nothing behind it (`data-pond-dim`): fish fade as
 * they pass under it, but are not steered away, as they are from
 * `data-pond-avoid`. Text fades them line by line, so the water beside a short
 * line stays clear; `data-pond-dim="box"` fades them under the whole block. In
 * the canvas's own pixels.
 */
function dimBoxes(canvas: HTMLCanvasElement): Box[] {
  const origin = canvas.getBoundingClientRect()
  const boxes: Box[] = []
  let range: Range | null = null
  for (const el of document.querySelectorAll("[data-pond-dim]")) {
    // `box`: the whole block, for a block dense enough that a fish anywhere
    // under it would be under something to read.
    if (el.getAttribute("data-pond-dim") === "box") {
      const r = el.getBoundingClientRect()
      if (r.width > 1 && r.height > 1) boxes.push({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top })
      continue
    }
    range ??= document.createRange()
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node; (node = walk.nextNode()); ) {
      if (!node.nodeValue?.trim()) continue
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) {
        if (r.width > 1 && r.height > 1) {
          boxes.push({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top })
        }
      }
    }
  }
  return boxes
}

export type Fish = "auto" | "few" | "many"

/**
 * Starts the pond on `canvas`. Returns what stops it. The engine is fetched
 * here rather than with the page: the fish can arrive a moment after the
 * figures.
 */
export function startPond(canvas: HTMLCanvasElement, { feed, fish }: { feed: boolean; fish: Fish }): () => void {
  let stopped = false
  let stop = () => {}
  void loadEngine().then(({ mount }) => {
    if (stopped) return
    const started = mount(canvas, {
      // The page decides, through setPondTheme; the pond does not follow the
      // system on its own.
      theme: root.classList.contains("dark") ? "dark" : "light",
      // A head of the page, not a whole pond: three koi and a youngster by
      // default, rather than the engine's count for a window this wide.
      species: [{ type: "koi", ...(fish === "few" ? { count: 2, young: 0 } : fish === "many" ? { count: 5, young: 2 } : { count: 3, young: 1 }) }],
      feed,
      // A click on anything that answers a click is not a throw of food.
      ignore: 'a, button, input, textarea, select, label, [role="button"], [data-slot="card"], [data-pond-ignore]',
      fps: SCENE_FPS,
      maxDpr: sceneDpr,
      // Measured from followLayout below instead of on every scroll and every
      // thirtieth frame.
      autoMeasure: false,
    })
    const dim = started.renderer.setDimBoxes.bind(started.renderer)
    started.renderer.setDimBoxes = (boxes) => dim([...boxes, ...dimBoxes(canvas)])
    started.measure()
    instance = started
    const unfollow = canvas.parentElement ? followLayout(canvas.parentElement, () => started.measure()) : () => {}
    stop = () => {
      if (instance === started) instance = null
      unfollow()
      started.destroy()
    }
  })
  return () => {
    stopped = true
    stop()
  }
}
