// Types for the part of ascii-ghost this theme touches. The engine is vendored
// unchanged from https://github.com/Ethan2258/ascii-ghost (see README.md beside
// this file); this declaration is the theme's.
export type Sky = {
  /** Re-reads the boxes the ghosts keep clear of (`[data-sky-avoid]`). */
  measure(): void
  /** Draws a frame at once. */
  redraw(): void
  /** With a duration (ms) the scene blends to the new palette while the ghosts keep moving. */
  setTheme(light: boolean, opts?: { duration?: number }): Promise<void>
  /** Paints a theme's static layers ahead of time, so switching never stalls. */
  warm(light: boolean): void
  /** Stops the loop, the observers and every listener. */
  destroy(): void
}
export function mount(canvas: HTMLCanvasElement, opts?: {
  theme?: "dark" | "light"
  leftTree?: boolean
  /** Most frames drawn a second; 0 or absent for every display frame. */
  fps?: number
  /** Highest device pixel ratio drawn at (default 2), or a function read on each resize. */
  maxDpr?: number | (() => number)
}): Sky
