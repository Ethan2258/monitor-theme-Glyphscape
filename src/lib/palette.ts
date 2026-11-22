import { setPondTheme, stir } from "@/lib/pond"
import { setRealmTheme } from "@/lib/realm"
import { hush } from "@/lib/still"

/**
 * The page's palette, and how it changes: the page switches at once under a
 * snapshot of how it looked, and the snapshot fades away over FADE -- opacity
 * only, on the compositor (`.palette-swap`, index.css) -- while a few rings
 * spread on the water from the toggle.
 *
 * Measured against blending the colour tokens themselves (registered with
 * `@property`, see index.css), which restyles the whole page on every frame:
 * on a laptop with a discrete GPU the blend ran at 97-106 fps against 155 for
 * the snapshot, whose one longer frame comes before anything moves; on a phone
 * the blend ran at about 8 fps. The blend remains where view transitions do not
 * exist; there the pond cross-fades over the same time and ease (lib/pond.ts).
 *
 * With reduced motion it switches at once.
 */

const root = document.documentElement
const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** How long the blend takes; index.css's `.palette-fade` matches it. */
export const FADE = 560

type Point = { x: number; y: number }

let fading: ReturnType<typeof setTimeout> | undefined


/** Switches `toggle` in at once, everything held still. */
function atOnce(toggle: () => void) {
  clearTimeout(fading)
  root.classList.remove("palette-fade")
  const hold = document.createElement("style")
  hold.textContent = "*,*::before,*::after{transition:none!important}"
  document.head.append(hold)
  toggle()
  void document.body.offsetWidth
  hold.remove()
}

/**
 * The snapshot way: `toggle` applied at once inside a view transition, so the
 * old page fades out over the new one. False where it does not apply, and the
 * caller blends instead.
 */
function crossFade(toggle: () => void): boolean {
  if (typeof document.startViewTransition !== "function") return false
  root.classList.add("palette-swap")
  const swap = document.startViewTransition(() => atOnce(toggle))
  void swap.finished.finally(() => root.classList.remove("palette-swap"))
  return true
}

/** Switches the palette: blended over FADE when `animate`, otherwise at once. */
export function applyPalette(dark: boolean, animate = false) {
  // Already there (the page following a change it has just made): nothing to do.
  if (root.classList.contains("dark") === dark) return
  const blend = animate && !reduced.matches
  const toggle = () => root.classList.toggle("dark", dark)
  // The snapshot fades on its own; the scenes then switch at once beneath it.
  if (blend && crossFade(() => {
    setPondTheme(dark, 0)
    setRealmTheme(dark, 0)
    toggle()
  })) return
  setPondTheme(dark, blend ? FADE : 0)
  setRealmTheme(dark, blend ? FADE : 0)
  if (!blend) {
    // At once: every transition held, so nothing fades on its own.
    atOnce(toggle)
    return
  }
  // The root's transition carries the tokens (index.css, `.palette-fade`).
  root.classList.add("palette-fade")
  root.classList.toggle("dark", dark)
  clearTimeout(fading)
  fading = setTimeout(() => root.classList.remove("palette-fade"), FADE + 80)
}

/**
 * Puts the page in a scene's own palette -- the pond's warm paper and ink, or
 * the realm's grey-green (the root's `wraith` class, index.css) -- blended over
 * FADE when `animate`, as a change of light and dark is.
 */
export function applyScene(wraith: boolean, animate = false) {
  if (root.classList.contains("wraith") === wraith) return
  if (!animate || reduced.matches) {
    root.classList.toggle("wraith", wraith)
    return
  }
  hush(FADE + 80)
  if (crossFade(() => root.classList.toggle("wraith", wraith))) return
  root.classList.add("palette-fade")
  root.classList.toggle("wraith", wraith)
  clearTimeout(fading)
  fading = setTimeout(() => root.classList.remove("palette-fade"), FADE + 80)
}

/**
 * Changes the palette with a blend. `update` brings the rest of the page into
 * the new state -- the toggle's own icon among it. Live figures that arrive
 * meanwhile wait until the blend is done, so no long frame lands in it.
 */
export function transitionPalette(dark: boolean, at: Point | undefined, update: () => void) {
  hush(FADE + 80)
  // The blend first: the page then re-renders into a palette already on its way.
  applyPalette(dark, true)
  update()
  if (at && !reduced.matches) stir(at)
}
