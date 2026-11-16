/**
 * The ghost realm behind the page: ascii-ghost's scene, started on a canvas that
 * fills the window. It paints its own sky, graveyard and fog, and keeps its
 * at the head of the page behind the header and the overview. Its wraiths fade
 * as they pass under text marked `data-sky-dim`, as Inkpond's koi do,
 * re-measured as the page scrolls.
 */

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

/**
 * Starts the realm on `canvas`. Returns what stops it. The engine is fetched
 * here rather than with the page: the ghosts can arrive a moment after the
 * figures.
 *
 * Put away by the visitor, it is only hidden: brought back, it carries on where
 * it was. It sizes itself to the canvas and pauses while scrolled out of sight.
 */
export function startRealm(canvas: HTMLCanvasElement): () => void {
  let stopped = false
  let frame = 0
  let poll: ReturnType<typeof setInterval> | undefined
  const remeasure = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      sky?.measure()
    })
  }
  void import("@/vendor/ascii-ghost/scene.js").then(({ mount }) => {
    if (stopped) return
    sky = mount(canvas, { theme: root.classList.contains("dark") ? "dark" : "light", leftTree: false })
    addEventListener("scroll", remeasure, { passive: true })
    // Layout moves without a scroll too: data arriving, a filter, the globe's chips.
    poll = setInterval(remeasure, 1000)
    remeasure()
  })
  return () => {
    stopped = true
    removeEventListener("scroll", remeasure)
    clearInterval(poll)
    sky?.destroy()
    sky = null
    if (frame) cancelAnimationFrame(frame)
  }
}
