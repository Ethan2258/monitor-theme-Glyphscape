import { setPondTheme, stir } from "@/lib/pond"
import { setRealmTheme } from "@/lib/realm"
import { hush } from "@/lib/still"

/**
 * The page's palette, and how it changes: everything blends from one to the
 * other at once, and a few rings spread on the water from the toggle.
 *
 * No view transition, no mask, no wipe. The colour tokens are registered as colours
 * (`@property`, see index.css), so the root's own transition carries them from
 * the old values to the new over FADE, and every surface that reads them --
 * page, cards, text, charts -- follows in step. The pond cross-fades over the
 * same time and the same ease-in-out sine while the fish swim on (lib/pond.ts),
 * and the toggle drops a stone in it. Switching again mid-way turns round from
 * where it has got to.
 *
 * With reduced motion it switches at once.
 */

const root = document.documentElement
const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** How long the blend takes; index.css's `.palette-fade` matches it. */
export const FADE = 560

type Point = { x: number; y: number }

let fading: ReturnType<typeof setTimeout> | undefined

/** Switches the palette: blended over FADE when `animate`, otherwise at once. */
export function applyPalette(dark: boolean, animate = false) {
  // Already there (the page following a change it has just made): nothing to do.
  if (root.classList.contains("dark") === dark) return
  const blend = animate && !reduced.matches
  setPondTheme(dark, blend ? FADE : 0)
  setRealmTheme(dark, blend ? FADE : 0)
  if (!blend) {
    // At once: every transition held, so nothing fades on its own.
    clearTimeout(fading)
    root.classList.remove("palette-fade")
    const hold = document.createElement("style")
    hold.textContent = "*,*::before,*::after{transition:none!important}"
    document.head.append(hold)
    root.classList.toggle("dark", dark)
    void document.body.offsetWidth
    hold.remove()
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
