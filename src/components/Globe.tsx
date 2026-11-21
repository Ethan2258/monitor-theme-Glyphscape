import { useEffect, useRef, useState } from "react"

import { countryName } from "@/lib/countries"
import {
  cruiseLat,
  type Region,
  regionsOf,
  shortestArc,
  springStep,
  wrapLon,
} from "@/lib/globe"
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

/** Room around the sphere for a marker's ring to spread into. */
const PAD = 14
/** Steady eastward rotation speed when idling (degrees per second). */
const CRUISE_SPEED = 14
/** How long after a drag the globe waits before resuming its cruise (ms). */
const REST = 1500
/** Critically damped spring frequency (rad/s) for turning to a picked country. */
const AIM_OMEGA = 7.5
/** Exponential damping rate (1/s) for flick inertia coasting. */
const COAST_DRAG = 2.4

type Colors = { fg: string; globe: string; land: string; marker: string; offline: string; dark: boolean; wraith: boolean }

/** The palette the globe stands in. */
function readColors(el: Element): Colors {
  const style = getComputedStyle(el)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const root = document.documentElement
  return {
    fg: read("--foreground", "#262523"),
    globe: read("--globe", "#ece8e1"),
    land: read("--globe-land", "#3b3936"),
    marker: read("--marker", "#c8623f"),
    offline: read("--offline", "#9a958e"),
    dark: root.classList.contains("dark"),
    wraith: root.classList.contains("wraith"),
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
    const view = { lon: 105, lat: 20, size: 0, fleet: "" }
    // Explicit target when turning towards a picked country or updated fleet.
    let goal: { lon: number; lat: number; omega: number } | null = null
    let aimed: string | null = null
    let regions: Region[] = []
    let spin = { lon: 0, lat: 0 }
    let coasting = false
    let drag: { x: number; y: number; moved: number; lastAt: number } | null = null
    let hover: string | null = null
    let lastTip: { code: string | null; x: number; y: number } = { code: null, x: 0, y: 0 }
    let pointerInside = false
    let cursor: { x: number; y: number } | null = null
    let restUntil = 0
    let colors = readColors(canvas)
    let hits: { code: string; x: number; y: number; reach: number }[] = []
    let raf = 0
    let last = performance.now()
    let inView = true

    const BUCKETS = 16
    const maxDots = points.length / 3
    const bucketBuf = Array.from({ length: BUCKETS }, () => new Float32Array(maxDots * 3))
    const bucketLen = new Int32Array(BUCKETS)
    let cachedGrad: { key: string; halo: CanvasGradient; shade: CanvasGradient } | null = null

    const resize = () => {
      const size = Math.floor(canvas.clientWidth)
      if (size < 40) return
      const dpr = Math.min(devicePixelRatio || 1, 2)
      view.size = size
      canvas.width = Math.round(size * dpr)
      canvas.height = Math.round(size * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cachedGrad = null
    }

    /** A place on the Earth in the view's own frame: x right, y up, z towards the reader. */
    const project = (lat: number, lon: number) => {
      const p = lat * RAD, l = (lon - view.lon) * RAD
      const x = Math.cos(p) * Math.sin(l), y0 = Math.sin(p), z0 = Math.cos(p) * Math.cos(l)
      const s = Math.sin(view.lat * RAD), c = Math.cos(view.lat * RAD)
      return { x, y: y0 * c - z0 * s, z: y0 * s + z0 * c }
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
      const moved =
        code !== null &&
        (Math.abs(x - lastTip.x) > 0.5 || Math.abs(y - lastTip.y) > 0.5)
      if (code === hover && !moved) return
      hover = code
      lastTip = { code, x, y }
      canvas.style.cursor = drag ? "grabbing" : code ? "pointer" : "grab"
      setTip(code ? { code, x, y, width: view.size } : null)
    }

    const draw = (now: number) => {
      const size = view.size
      const r = size / 2 - PAD
      const cx = size / 2, cy = size / 2
      ctx.clearRect(0, 0, size, size)

      // A faint halo round the sphere, then the sphere: paper, a little lighter
      // where the light falls and a little darker towards the rim.
      const gradKey = `${size}:${colors.dark ? 1 : 0}:${colors.wraith ? 1 : 0}`
      if (!cachedGrad || cachedGrad.key !== gradKey) {
        const haloColor = colors.dark
          ? colors.wraith ? "rgba(216,223,220,0.07)" : "rgba(255,247,240,0.07)"
          : colors.wraith ? "rgba(29,35,33,0.06)" : "rgba(38,37,35,0.06)"
        const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r + PAD)
        halo.addColorStop(0, haloColor)
        halo.addColorStop(1, "rgba(0,0,0,0)")

        const shadeColor = colors.dark
          ? "rgba(0,0,0,0.22)"
          : colors.wraith ? "rgba(29,35,33,0.07)" : "rgba(38,37,35,0.07)"
        const shade = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, r)
        shade.addColorStop(0, "rgba(0,0,0,0)")
        shade.addColorStop(1, shadeColor)
        cachedGrad = { key: gradKey, halo, shade }
      }
      ctx.fillStyle = cachedGrad.halo
      ctx.fillRect(0, 0, size, size)

      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = colors.globe
      ctx.fill()
      ctx.fillStyle = cachedGrad.shade
      ctx.fill()

      // The land, grouped into opacity buckets to cut draw calls from ~1200 to <= 10.
      const cl = Math.cos(view.lon * RAD), sl = Math.sin(view.lon * RAD)
      const st = Math.sin(view.lat * RAD), ct = Math.cos(view.lat * RAD)
      const dot = Math.max(0.9, r * SPACING * RAD * 0.34)
      bucketLen.fill(0)
      const baseAlpha = colors.dark ? 0.22 : 0.2
      const litScale = colors.dark ? 0.6 : 0.55
      for (let i = 0; i < points.length; i += 3) {
        const px = points[i], py = points[i + 1], pz = points[i + 2]
        // Turned to the view's longitude, then tilted to its latitude.
        const x = px * cl - pz * sl
        const z1 = px * sl + pz * cl
        const z = py * st + z1 * ct
        if (z <= 0.02) continue
        const y = py * ct - z1 * st
        const lit = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2])
        const rim = z < 0.35 ? (z / 0.35) ** 1.3 : 1
        const alpha = clamp((baseAlpha + litScale * lit) * rim, 0, 0.999)
        const b = (alpha * BUCKETS) | 0
        const idx = bucketLen[b]
        const buf = bucketBuf[b]
        buf[idx] = cx + x * r
        buf[idx + 1] = cy - y * r
        buf[idx + 2] = dot * (0.45 + 0.55 * z)
        bucketLen[b] = idx + 3
      }
      ctx.fillStyle = colors.land
      for (let b = 0; b < BUCKETS; b++) {
        const len = bucketLen[b]
        if (!len) continue
        const buf = bucketBuf[b]
        ctx.globalAlpha = (b + 0.5) / BUCKETS
        ctx.beginPath()
        for (let k = 0; k < len; k += 3) {
          const px = buf[k], py = buf[k + 1], pr = buf[k + 2]
          ctx.moveTo(px + pr, py)
          ctx.arc(px, py, pr, 0, Math.PI * 2)
        }
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
      if (cursor && !drag && pointerInside) {
        const h = hit(cursor.x, cursor.y)
        point(h?.code ?? null, h?.x, h?.y)
      }
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (!inView || !view.size) return
      const { markers, selected } = live.current

      // Cluster the fleet eastward and anchor on the largest group; on first load
      // face it (or the initially selected country) without an intro whip.
      const fleet = markers.map((m) => `${m.code}${m.count}`).join()
      if (fleet !== view.fleet && markers.length) {
        regions = regionsOf(markers)
        const pick = selected ? markers.find((m) => m.code === selected) : undefined
        const centre = pick
          ? { lon: wrapLon(pick.lon), lat: clamp(pick.lat, -50, 50) }
          : regions[0]
        if (!view.fleet) {
          view.lon = centre.lon
          view.lat = centre.lat
          aimed = selected
          goal = null
          coasting = false
        } else if (!selected) {
          goal = { lon: regions[0].lon, lat: regions[0].lat, omega: AIM_OMEGA }
          coasting = false
        }
        view.fleet = fleet
      }

      // Trigger a spring turn only when `selected` actually changes, so dragging
      // the globe while a country chip is active won't snap back on release.
      if (selected !== aimed) {
        aimed = selected
        const target = selected ? markers.find((m) => m.code === selected) : undefined
        if (target) {
          goal = { lon: wrapLon(target.lon), lat: clamp(target.lat, -50, 50), omega: AIM_OMEGA }
          coasting = false
        }
      }

      if (drag) {
        // Pointer drag directly drives the sphere; any previous target or coasting is void.
        goal = null
        coasting = false
      } else if (goal) {
        const nextLon = springStep(view.lon, spin.lon, goal.lon, goal.omega, dt, true)
        const nextLat = springStep(view.lat, spin.lat, goal.lat, goal.omega, dt, false)
        view.lon = nextLon.value
        view.lat = clamp(nextLat.value, -70, 70)
        spin = { lon: nextLon.velocity, lat: nextLat.velocity }
        if (
          Math.abs(shortestArc(view.lon, goal.lon)) < 0.15 &&
          Math.abs(goal.lat - view.lat) < 0.15 &&
          Math.hypot(spin.lon, spin.lat) < 0.35
        ) {
          view.lon = goal.lon
          view.lat = goal.lat
          spin = { lon: 0, lat: 0 }
          goal = null
        }
      } else if (coasting) {
        // Frame-rate-independent integral of exponential flick friction.
        const decay = Math.exp(-dt * COAST_DRAG)
        const avg = (1 - decay) / (COAST_DRAG * Math.max(dt, 1e-6))
        view.lon = wrapLon(view.lon + spin.lon * dt * avg)
        view.lat = clamp(view.lat + spin.lat * dt * avg, -70, 70)
        spin = { lon: spin.lon * decay, lat: spin.lat * decay }
        // Hand seamlessly back into continuous cruise when flick speed drops below it (or settles).
        if (
          (!selected && !pointerInside && !reduced.matches && now >= restUntil &&
            spin.lon > 0 && spin.lon <= CRUISE_SPEED && Math.abs(spin.lat) < 4) ||
          Math.hypot(spin.lon, spin.lat) <= 1.5
        ) {
          coasting = false
        }
      } else if (pointerInside || now < restUntil || reduced.matches || selected !== null) {
        // Hover, post-drag rest, reduced motion, or an active country filter gently
        // brakes residual motion rather than drifting away.
        const brake = Math.exp(-dt * 9)
        view.lon = wrapLon(view.lon + spin.lon * dt)
        view.lat = clamp(view.lat + spin.lat * dt, -70, 70)
        spin = {
          lon: Math.abs(spin.lon * brake) < 0.05 ? 0 : spin.lon * brake,
          lat: Math.abs(spin.lat * brake) < 0.05 ? 0 : spin.lat * brake,
        }
      } else {
        // Brisk, uninterrupted eastward cruise, gently tilting latitude towards
        // whichever fleet cluster faces front.
        spin.lon += (CRUISE_SPEED - spin.lon) * (1 - Math.exp(-dt * 2.4))
        view.lon = wrapLon(view.lon + spin.lon * dt)
        const targetLat = cruiseLat(regions, view.lon)
        const nextLat = springStep(view.lat, spin.lat, targetLat, 1.5, dt, false)
        view.lat = clamp(nextLat.value, -70, 70)
        spin.lat = nextLat.velocity
      }

      // The palette is read when it changes rather than listened for: at once
      // when light, dark or the scene flips, and every frame while it blends
      // (lib/palette.ts), so the globe changes with the page.
      const root = document.documentElement
      const blending = root.classList.contains("palette-fade")
      if (
        blending ||
        colors.dark !== root.classList.contains("dark") ||
        colors.wraith !== root.classList.contains("wraith")
      ) {
        colors = readColors(canvas)
      }
      draw(now)
    }

    const at = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      return { x: e.clientX - box.left, y: e.clientY - box.top }
    }

    const down = (e: PointerEvent) => {
      const p = at(e)
      const t = performance.now()
      drag = { ...p, moved: 0, lastAt: t }
      spin = { lon: 0, lat: 0 }
      goal = null
      coasting = false
      restUntil = Infinity
      if (e.pointerType !== "touch") cursor = p
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = "grabbing"
    }
    const move = (e: PointerEvent) => {
      const p = at(e)
      if (e.pointerType !== "touch") cursor = p
      if (!drag) {
        if (e.pointerType !== "touch") pointerInside = true
        const h = hit(p.x, p.y)
        point(h?.code ?? null, h?.x, h?.y)
        return
      }
      const now = performance.now()
      const radius = Math.max(20, view.size / 2 - PAD)
      const dx = p.x - drag.x
      const dy = p.y - drag.y
      const dtMove = Math.max(0.002, (now - drag.lastAt) / 1000)
      const lonScale = 1 / Math.max(0.45, Math.cos(view.lat * RAD))
      const dLon = (-dx / radius) * DEG * lonScale
      const dLat = (dy / radius) * DEG
      view.lon = wrapLon(view.lon + dLon)
      view.lat = clamp(view.lat + dLat, -70, 70)
      // Polling-rate-independent EMA velocity (tau = 30ms); a stationary pause zeroes inertia.
      if (dtMove < 0.08) {
        const alpha = 1 - Math.exp(-dtMove / 0.03)
        const instLon = clamp(dLon / dtMove, -360, 360)
        const instLat = clamp(dLat / dtMove, -240, 240)
        spin = {
          lon: spin.lon + (instLon - spin.lon) * alpha,
          lat: spin.lat + (instLat - spin.lat) * alpha,
        }
      } else {
        spin = { lon: 0, lat: 0 }
      }
      drag = { ...p, moved: drag.moved + Math.hypot(dx, dy), lastAt: now }
      if (drag.moved > 4) point(null)
    }
    const up = (e: PointerEvent) => {
      if (!drag) return
      const p = at(e)
      const age = (performance.now() - drag.lastAt) / 1000
      if (e.type !== "pointercancel" && drag.moved <= 4) {
        const h = hit(p.x, p.y)
        const { selected, onPick } = live.current
        if (h) onPick(h.code === selected ? null : h.code)
        else if (selected) onPick(null)
        spin = { lon: 0, lat: 0 }
        coasting = false
      } else {
        // Decay inertia if the user paused briefly before lifting the pointer.
        const holdDecay = age > 0.09 ? 0 : Math.exp(-Math.max(0, age - 0.016) / 0.03)
        spin = { lon: spin.lon * holdDecay, lat: spin.lat * holdDecay }
        coasting = Math.hypot(spin.lon, spin.lat) > 1.5
      }
      drag = null
      restUntil = performance.now() + REST
      canvas.style.cursor = hover ? "pointer" : "grab"
    }
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== "touch") pointerInside = true
    }
    const leave = () => {
      pointerInside = false
      cursor = null
      if (!drag) point(null)
    }

    const sized = new ResizeObserver(resize)
    sized.observe(canvas)
    // Off screen, and in a tab that is not showing, nothing is drawn.
    const seen = new IntersectionObserver(([entry]) => {
      const was = inView
      inView = entry.isIntersecting
      if (inView && !was) {
        last = performance.now()
      }
    })
    seen.observe(canvas)
    canvas.addEventListener("pointerdown", down)
    canvas.addEventListener("pointermove", move)
    canvas.addEventListener("pointerup", up)
    canvas.addEventListener("pointercancel", up)
    canvas.addEventListener("pointerenter", enter)
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
      canvas.removeEventListener("pointerenter", enter)
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
      className="relative mx-auto aspect-square w-full max-w-[12rem] sm:max-w-[17rem] lg:max-w-[19rem]"
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
