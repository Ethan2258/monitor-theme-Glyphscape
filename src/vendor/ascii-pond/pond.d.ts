// Types for the parts of ascii-pond this theme touches. The engine itself is
// vendored from https://github.com/stqfdyr/ascii-pond with the [patch] changes
// listed in README.md beside this file; these declarations are this theme's.

export type Rgb = [number, number, number]

export type Palette = {
  page: Rgb
  fg: Rgb
  bg: Rgb
  water: Rgb
  shadow: Rgb
  shadowAlpha: number
  pellet: Rgb
  alpha: number
  depthFloor: number
  tile: [number, number]
  ink: number
}

/** A rectangle in the canvas's own CSS pixels. */
export type Box = { left: number; top: number; right: number; bottom: number }

/** A theme wipe in progress: a soft-edged circle growing from (x, y). */
export type Reveal = { x: number; y: number; radius: number; feather: number; maxRadius: number }

export class Pond {
  width: number
  height: number
  time: number
  avoid: Box[]
  /** Rings spreading on the water; `born` is in pond time, and may lie ahead. */
  ripples: { x: number; y: number; born: number; strength: number }[]
}

export class PondRenderer {
  reveal: Reveal | null
  cols: number
  rows: number
  setDimBoxes(boxes: Box[]): void
}

export type Species = string | { type: string; count?: number | "auto"; young?: number | "auto" }

export type MountOptions = {
  species?: Species[]
  theme?: "auto" | "dark" | "light"
  avoid?: string | null
  ignore?: string
  feed?: boolean
  fixed?: boolean
  speed?: number
  palette?: { dark?: Partial<Palette>; light?: Partial<Palette> }
  onFrame?: ((instance: PondInstance) => void) | null
  pond?: Pond | null
  /** [patch] Most frames drawn a second; 0 for every display frame. */
  fps?: number
  /** [patch] Highest device pixel ratio drawn at (default 2), or a function read on each resize. */
  maxDpr?: number | (() => number)
  /** [patch] false: no re-measuring on scroll or every 30 frames; the host calls measure(). */
  autoMeasure?: boolean
}

export type PondInstance = {
  pond: Pond
  renderer: PondRenderer
  canvas: HTMLCanvasElement
  feed(x: number, y: number): void
  measure(): void
  setTheme(isLight: boolean, at?: { x: number; y: number }): void
  destroy(): void
}

export function mount(target: Element, options?: MountOptions): PondInstance
