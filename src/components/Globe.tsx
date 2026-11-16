import { useEffect, useRef, useState } from "react"

import { countryName } from "@/lib/countries"
import { LAND_BITS, LAND_H, LAND_W } from "@/lib/land"

/** The nodes of one country, at the point that stands for it. */
export type Marker = { code: string; lat: number; lon: number; count: number; online: number }

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

// One bit a cell, unpacked on first use: the page may never draw a globe.
let land: Uint8Array | null = null

/** 1 where the one-degree cell holding (lat, lon) is land. */
function isLand(lat: number, lon: number): number {
  land ??= Uint8Array.from(atob(LAND_BITS), (c) => c.charCodeAt(0))
  const i = Math.floor(((((lon + 180) % 360) + 360) % 360) * (LAND_W / 360))
  const j = clamp(Math.floor((90 - lat) * (LAND_H / 180)), 0, LAND_H - 1)
  const k = j * LAND_W + i
  return (land[k >> 3] >> (7 - (k & 7))) & 1
}

/** Degrees between neighbouring dots of land. */
const SPACING = 2.3

// The land as dots on the sphere, unit vectors in the Earth's own frame. Rows of
// latitude, each holding as many dots as its circumference has room for and
// every other row shifted by half a step, so the dots lie evenly over the whole
// globe in a loose hexagonal weave rather than crowding at the poles.
let dots: Float32Array | null = null
function landDots(): Float32Array {
  if (dots) return dots
  const out: number[] = []
  let row = 0
  for (let lat = -82; lat <= 82; lat += SPACING, row++) {
    const count = Math.max(1, Math.round((360 * Math.cos(lat * RAD)) / SPACING))
    for (let i = 0; i < count; i++) {
      const lon = -180 + ((i + (row % 2) * 0.5) * 360) / count
      if (!isLand(lat, lon)) continue
      out.push(Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD))
    }
  }
  return (dots = new Float32Array(out))
}

// Lit from the upper left, in front: the same corner a page is read from.
const LIGHT = (() => {
  const v = [-0.45, 0.5, 0.74]
  const n = Math.hypot(...v)
  return v.map((c) => c / n)
})()

/** Seconds the idle globe rests on one region before turning to the next. */
const DWELL = 9000

/**
 * The markers grouped into regions: sorted round the globe by longitude, and a
 * new region begun wherever two neighbours lie more than 60° apart. Each region's
 * centre is the node-weighted middle of its markers; the region with the most
 * nodes comes first.
 */
function regionsOf(markers: Marker[]): { lon: number; lat: number }[] {
  const sorted = [...markers].sort((a, b) => a.lon - b.lon)
  if (sorted.length === 0) return []
  // Start the sweep after the widest gap, so a region straddling 180° is not split.
  let widest = 0, at = 0
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length]
    const gap = (((next.lon - sorted[i].lon) % 360) + 360) % 360 || (sorted.length === 1 ? 360 : 0)
    if (gap > widest) { widest = gap; at = (i + 1) % sorted.length }
  }
  const ring = [...sorted.slice(at), ...sorted.slice(0, at)]
  const groups: Marker[][] = [[ring[0]]]
  for (let i = 1; i < ring.length; i++) {
    const gap = (((ring[i].lon - ring[i - 1].lon) % 360) + 360) % 360
    if (gap > 60) groups.push([ring[i]])
    else groups[groups.length - 1].push(ring[i])
  }
  return groups
    .map((g) => {
      let sx = 0, sy = 0, lat = 0, n = 0
      for (const m of g) {
        sx += Math.cos(m.lon * RAD) * m.count
        sy += Math.sin(m.lon * RAD) * m.count
        lat += m.lat * m.count
        n += m.count
      }
      return { lon: Math.atan2(sy, sx) * DEG, lat: clamp(lat / n, -25, 35), n }
    })
    .sort((a, b) => b.n - a.n)
}

/** Room around the sphere for a marker's ring to spread into. */
const PAD = 14
/** How far to either side the idle globe sways, in degrees, and how long one sway takes, in seconds. */
const SWAY = 28
const PERIOD = 36
/** How long after a touch the globe waits before turning by itself again. */
const REST = 2500

type Colors = { fg: string; globe: string; land: string; marker: string; offline: string; dark: boolean }

/** The palette the globe stands in. */
function readColors(el: Element): Colors {
  const style = getComputedStyle(el)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    fg: read("--foreground", "#262523"),
    globe: read("--globe", "#ece8e1"),
    land: read("--globe-land", "#3b3936"),
    marker: read("--marker", "#c8623f"),
    offline: read("--offline", "#9a958e"),
    dark: document.documentElement.classList.contains("dark"),
  }
}

/** A steady fraction per country code, so each marker's ring keeps its own beat. */
function phase(code: string): number {
  let h = 0
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 997
  return h / 997
}

/**
 * The fleet on a globe: a soft paper sphere lit from the upper left, the land a
 * weave of fine ink dots that shrink and fade towards the rim, and each country
 * with nodes a terracotta bead with a ring pulsing out of it. No WebGL and no
 * map tiles -- a thousand dots a frame on a 2D canvas, from a bitmap of the
 * coastlines that ships in the bundle.
 *
 * Drag to turn it; left alone it turns slowly by itself. A marker is one
 * country's nodes: hover names it, click filters the list to it, and the globe
 * turns to face whichever country is selected.
 */
export function Globe({ markers, selected, onPick }: {
  markers: Marker[]
  /** The country the list is narrowed to, if any. */
  selected: string | null
  onPick: (code: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // What the pointer is on, for the label beside it; `width` is the globe's own.
  const [tip, setTip] = useState<{ code: string; x: number; y: number; width: number } | null>(null)

  // The loop below lives as long as the component and reads these each frame:
  // restarting it on every push of node data would reset the view.
  const live = useRef({ markers, selected, onPick })
  useEffect(() => {
    live.current = { markers, selected, onPick }
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const points = landDots()

    // The view: the longitude and latitude at the centre of the disc. `fleet`
    // is which countries it was last turned to face.
    const view = { lon: 105, lat: 20, size: 0, fleet: "", centre: { lon: 105, lat: 20 } }
    // Where the globe is turning to by itself, if anywhere.
    let home: { lon: number; lat: number } | null = null
    // The fleet's regions, most nodes first; which one the idle globe faces, and since when.
    let regions: { lon: number; lat: number }[] = []
    let tour = 0
    let tourAt = 0
    let spin = { lon: 0, lat: 0 }
    let drag: { x: number; y: number; moved: number } | null = null
    let hover: string | null = null
    let restUntil = 0
    let colors = readColors(canvas)
    let hits: { code: string; x: number; y: number; reach: number }[] = []
    let raf = 0
    let last = performance.now()
    let frame = 0
    let inView = true

    const resize = () => {
      const size = Math.floor(canvas.clientWidth)
      if (size < 40) return
      const dpr = Math.min(devicePixelRatio || 1, 2)
      view.size = size
      canvas.width = Math.round(size * dpr)
      canvas.height = Math.round(size * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    /** A place on the Earth in the view's own frame: x right, y up, z towards the reader. */
    const project = (lat: number, lon: number) => {
      const p = lat * RAD, l = (lon - view.lon) * RAD
      const x = Math.cos(p) * Math.sin(l), y0 = Math.sin(p), z0 = Math.cos(p) * Math.cos(l)
      const s = Math.sin(view.lat * RAD), c = Math.cos(view.lat * RAD)
      return { x, y: y0 * c - z0 * s, z: y0 * s + z0 * c }
    }

    const draw = (now: number) => {
      const size = view.size
      const r = size / 2 - PAD
      const cx = size / 2, cy = size / 2
      ctx.clearRect(0, 0, size, size)

      // A faint halo round the sphere, then the sphere: paper, a little lighter
      // where the light falls and a little darker towards the rim.
      const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r + PAD)
      halo.addColorStop(0, colors.dark ? "rgba(255,247,240,0.07)" : "rgba(38,37,35,0.06)")
      halo.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, size, size)

      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = colors.globe
      ctx.fill()
      const shade = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, r)
      shade.addColorStop(0, "rgba(0,0,0,0)")
      shade.addColorStop(1, colors.dark ? "rgba(0,0,0,0.22)" : "rgba(38,37,35,0.07)")
      ctx.fillStyle = shade
      ctx.fill()

      // The land.
      const cl = Math.cos(view.lon * RAD), sl = Math.sin(view.lon * RAD)
      const st = Math.sin(view.lat * RAD), ct = Math.cos(view.lat * RAD)
      const dot = Math.max(0.9, r * SPACING * RAD * 0.34)
      ctx.fillStyle = colors.land
      for (let i = 0; i < points.length; i += 3) {
        const px = points[i], py = points[i + 1], pz = points[i + 2]
        // Turned to the view's longitude, then tilted to its latitude.
        const x = px * cl - pz * sl
        const z1 = px * sl + pz * cl
        const z = py * st + z1 * ct
        if (z <= 0.02) continue
        const y = py * ct - z1 * st
        const lit = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2])
        ctx.globalAlpha = (colors.dark ? 0.22 + 0.6 * lit : 0.2 + 0.55 * lit) * Math.min(1, z * 3)
        ctx.beginPath()
        ctx.arc(cx + x * r, cy - y * r, dot * (0.45 + 0.55 * z), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // The rim.
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = colors.fg
      ctx.globalAlpha = colors.dark ? 0.16 : 0.12
      ctx.lineWidth = 1
      ctx.stroke()

      // Markers, the selected and the hovered last so they sit on top.
      const { markers, selected } = live.current
      const rank = (m: Marker) => Number(m.code === selected) * 2 + Number(m.code === hover)
      hits = []
      for (const m of [...markers].sort((a, b) => rank(a) - rank(b))) {
        const p = project(m.lat, m.lon)
        if (p.z < 0.08) continue
        const x = cx + p.x * r, y = cy - p.y * r
        const active = m.code === selected || m.code === hover
        const bead = 3.2 + Math.min(2.2, (m.count - 1) * 0.55) + (active ? 1 : 0)
        // Fading out towards the rim, where a marker is about to go behind.
        const near = Math.min(1, p.z * 3.5)
        const color = m.online > 0 ? colors.marker : colors.offline

        if (m.online > 0 && !reduced.matches) {
          const t = (now / 2800 + phase(m.code)) % 1
          ctx.globalAlpha = (1 - t) * (1 - t) * 0.65 * near
          ctx.strokeStyle = color
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.arc(x, y, bead + 1 + t * 14, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = near
        ctx.fillStyle = colors.globe
        ctx.beginPath()
        ctx.arc(x, y, bead + 1.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, bead, 0, Math.PI * 2)
        ctx.fill()
        // More than one node there: how many, beside the bead.
        if (m.count > 1) {
          ctx.font = `600 ${Math.round(10 + Math.min(2, size / 200))}px "Geist Mono Variable", ui-monospace, monospace`
          ctx.textBaseline = "middle"
          ctx.lineWidth = 3
          ctx.strokeStyle = colors.globe
          ctx.strokeText(String(m.count), x + bead + 3, y)
          ctx.fillStyle = colors.fg
          ctx.fillText(String(m.count), x + bead + 3, y)
        }
        if (active) {
          ctx.strokeStyle = colors.fg
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.arc(x, y, bead + 4.5, 0, Math.PI * 2)
          ctx.stroke()
        }
        hits.push({ code: m.code, x, y, reach: Math.max(12, bead + 6) })
      }
      ctx.globalAlpha = 1
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (!inView || !view.size) return
      const { markers, selected } = live.current

      // The globe faces the fleet: the middle of its longitudes, taken on the
      // circle so that Tokyo and Los Angeles meet over the Pacific rather than
      // over Africa. Set outright the first time, and turned to whenever the
      // countries shown change -- a group tab that holds only American nodes
      // would otherwise leave the globe showing an Asia with nothing on it.
      const fleet = markers.map((m) => `${m.code}${m.count}`).join()
      if (fleet !== view.fleet && markers.length) {
        regions = regionsOf(markers)
        tour = 0
        tourAt = now
        // The first region faced is the one with the most nodes.
        const centre = regions[0]
        view.centre = centre
        if (view.fleet) home = centre
        else Object.assign(view, { lon: centre.lon, lat: centre.lat })
        view.fleet = fleet
      }

      // Towards a place, the short way round; true once there.
      const turnTo = (lon: number, lat: number) => {
        const ease = 1 - Math.exp(-dt * 5)
        const around = (((lon - view.lon) % 360) + 540) % 360 - 180
        view.lon += around * ease
        view.lat += (lat - view.lat) * ease
        spin = { lon: 0, lat: 0 }
        return Math.abs(around) < 0.5 && Math.abs(lat - view.lat) < 0.5
      }

      const target = selected ? markers.find((m) => m.code === selected) : undefined
      if (drag) {
        // The pointer has the globe, and where it was heading no longer matters.
        home = null
      } else if (target) {
        // Face the selected country.
        turnTo(target.lon, clamp(target.lat, -50, 50))
        home = null
      } else if (home) {
        if (turnTo(home.lon, home.lat)) home = null
      } else {
        // What is left of a flick, then the slow turn of a globe left alone.
        view.lon += spin.lon * dt
        view.lat = clamp(view.lat + spin.lat * dt, -70, 70)
        const friction = Math.exp(-dt * 3)
        spin = { lon: spin.lon * friction, lat: spin.lat * friction }
        // Left alone, it faces each region of the fleet in turn -- Asia for a
        // while, then America -- swaying a little while it rests on one, rather
        // than settling on the empty ocean halfway between them.
        if (!reduced.matches && !hover && now > restUntil && Math.abs(spin.lon) < 1) {
          if (regions.length > 1 && now - tourAt > DWELL) {
            tour = (tour + 1) % regions.length
            tourAt = now
          }
          if (regions.length) view.centre = regions[tour]
          const amp = regions.length > 1 ? 10 : SWAY
          const sway = view.centre.lon + amp * Math.sin(now / 1000 / PERIOD * Math.PI * 2)
          const ease = 1 - Math.exp(-dt * 0.8)
          view.lon += ((((sway - view.lon) % 360) + 540) % 360 - 180) * ease
          view.lat += (view.centre.lat - view.lat) * ease * 0.5
        }
      }

      // The palette is looked up now and then rather than listened for.
      // At once when the palette has changed, so the globe turns with the page.
      // Every frame while the palette blends (lib/palette.ts), so the globe changes with the page.
      const blending = document.documentElement.classList.contains("palette-fade")
      if (blending || frame++ % 20 === 0 || colors.dark !== document.documentElement.classList.contains("dark")) colors = readColors(canvas)
      draw(now)
    }

    const at = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      return { x: e.clientX - box.left, y: e.clientY - box.top }
    }
    const hit = (x: number, y: number) => {
      let best: (typeof hits)[number] | null = null
      for (const h of hits) {
        const d = Math.hypot(h.x - x, h.y - y)
        if (d <= h.reach && (!best || d < Math.hypot(best.x - x, best.y - y))) best = h
      }
      return best
    }
    const point = (code: string | null, x = 0, y = 0) => {
      if (code === hover) return
      hover = code
      canvas.style.cursor = code ? "pointer" : "grab"
      setTip(code ? { code, x, y, width: view.size } : null)
    }

    const down = (e: PointerEvent) => {
      const p = at(e)
      drag = { ...p, moved: 0 }
      spin = { lon: 0, lat: 0 }
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = "grabbing"
    }
    const move = (e: PointerEvent) => {
      const p = at(e)
      if (!drag) {
        const h = hit(p.x, p.y)
        point(h?.code ?? null, h?.x, h?.y)
        return
      }
      const radius = view.size / 2 - PAD
      const dx = p.x - drag.x, dy = p.y - drag.y
      // The surface follows the pointer: a drag of one radius is one radian.
      const turn = { lon: (-dx / radius) * DEG, lat: (dy / radius) * DEG }
      view.lon += turn.lon
      view.lat = clamp(view.lat + turn.lat, -70, 70)
      // Kept as a speed, for the flick the release carries on with.
      spin = { lon: turn.lon * 60 * 0.6, lat: turn.lat * 60 * 0.6 }
      drag = { ...p, moved: drag.moved + Math.abs(dx) + Math.abs(dy) }
      if (drag.moved > 4) point(null)
    }
    const up = (e: PointerEvent) => {
      if (!drag) return
      const p = at(e)
      // A press that went nowhere is a click: on a marker it selects that
      // country, or lets go of it if it was selected; on the sea it lets go of
      // whichever was.
      if (drag.moved <= 4) {
        const h = hit(p.x, p.y)
        const { selected, onPick } = live.current
        if (h) onPick(h.code === selected ? null : h.code)
        else if (selected) onPick(null)
        spin = { lon: 0, lat: 0 }
      }
      drag = null
      restUntil = performance.now() + REST
      canvas.style.cursor = hover ? "pointer" : "grab"
    }
    const leave = () => {
      if (!drag) point(null)
    }

    const sized = new ResizeObserver(resize)
    sized.observe(canvas)
    // Off screen, and in a tab that is not showing, nothing is drawn.
    const seen = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
    })
    seen.observe(canvas)
    canvas.addEventListener("pointerdown", down)
    canvas.addEventListener("pointermove", move)
    canvas.addEventListener("pointerup", up)
    canvas.addEventListener("pointercancel", up)
    canvas.addEventListener("pointerleave", leave)
    resize()
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      sized.disconnect()
      seen.disconnect()
      canvas.removeEventListener("pointerdown", down)
      canvas.removeEventListener("pointermove", move)
      canvas.removeEventListener("pointerup", up)
      canvas.removeEventListener("pointercancel", up)
      canvas.removeEventListener("pointerleave", leave)
    }
  }, [])

  const pointed = tip && markers.find((m) => m.code === tip.code)

  return (
    // Smaller on a phone, where at full size it would be a screen of its own
    // between the summary and the nodes. A press on the globe turns it or picks
    // a country; it is not a throw of food into the pond behind.
    <div
      data-pond-ignore=""
      data-sky-ignore=""
      className="relative mx-auto aspect-square w-full max-w-[15rem] sm:max-w-[17rem] lg:max-w-[19rem]"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`节点分布：${markers.map((m) => `${countryName(m.code)} ${m.count} 台`).join("，") || "暂无节点"}`}
        // Sideways drags turn the globe; an up-and-down one still scrolls the
        // page, or a phone could not get past it.
        className="size-full cursor-grab touch-pan-y select-none"
      />
      {pointed && (
        <div
          // Above the marker, and kept from hanging over either side of the globe.
          style={{ left: clamp(tip.x, 56, Math.max(56, tip.width - 56)), top: tip.y }}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-sm"
        >
          <span className="font-medium">{countryName(pointed.code)}</span>
          <span className="tnum ml-1.5 text-muted-foreground">
            {pointed.count} 台{pointed.online < pointed.count ? ` · ${pointed.online} 在线` : ""}
          </span>
        </div>
      )}
    </div>
  )
}
