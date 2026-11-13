import type { Box, PondInstance } from "@/vendor/ascii-pond/pond.js"

/**
 * The koi pond at the head of the page: started on a canvas that fills that
 * stretch, recoloured with the page, and stirred when the palette changes.
 */

let instance: PondInstance | null = null

const root = document.documentElement

/** The pond's palette follows the page's. */
export function setPondTheme(dark: boolean) {
  instance?.setTheme(!dark)
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
  const range = document.createRange()
  for (const el of document.querySelectorAll("[data-pond-dim]")) {
    // `box`: the whole block, for a block dense enough that a fish anywhere
    // under it would be under something to read.
    if (el.getAttribute("data-pond-dim") === "box") {
      const r = el.getBoundingClientRect()
      if (r.width > 1 && r.height > 1) boxes.push({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top })
      continue
    }
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
  void import("@/vendor/ascii-pond/pond.js").then(({ mount }) => {
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
    })
    const dim = started.renderer.setDimBoxes.bind(started.renderer)
    started.renderer.setDimBoxes = (boxes) => dim([...boxes, ...dimBoxes(canvas)])
    started.measure()
    instance = started
    stop = () => {
      if (instance === started) instance = null
      started.destroy()
    }
  })
  return () => {
    stopped = true
    stop()
  }
}
