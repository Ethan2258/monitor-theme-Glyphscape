import {
  memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent,
  type ReactNode,
} from "react"

/**
 * The page's charts, drawn as one SVG each: the resource panels and the
 * latency chart. In place of recharts, which was 330 kB of the node page for
 * what is here a time axis, a value axis, lines, filled areas and bands, a
 * cursor and a readout -- and which laid its charts out over the frames after
 * React's commit, five panels at once in frames of most of a second.
 *
 * The paths are built once per data and size; hovering redraws only the
 * cursor layer on top.
 */

export type Row = { ts: number } & Record<string, unknown>
export type Scale = "linear" | "log" | "sqrt"

export type Series =
  /** A line through `key`'s numbers. A missing value breaks it, unless `connect`. */
  | { kind: "line"; key: string; stroke: string; dash?: string; width?: number; opacity?: number; connect?: boolean; solo?: boolean; active?: boolean }
  /** A line filled down to the axis floor. */
  | { kind: "area"; key: string; stroke: string; fillOpacity: number; width?: number; solo?: boolean; active?: boolean }
  /** The range `key`'s `[low, high]` pairs span, filled, its upper edge drawn faintly. */
  | { kind: "band"; key: string; fill: string; fillOpacity: number; stroke?: string; strokeOpacity?: number; connect?: boolean }

export type TimeAxis = { domain: [number, number]; ticks: number[]; format: (ts: number) => string }
export type ValueAxis = { domain: [number, number]; ticks: number[]; format: (v: number) => string; scale?: Scale; width: number }

/** Room right of the plot for the last time label, centred on its tick, and above it for the top one. */
export const MARGIN = { top: 4, right: 16, bottom: 0, left: 0 }
/** The time labels' row under the plot. */
const X_AXIS = 30
const FONT = 11
/** About the width of a character of an axis label, in the page's monospace at 11 px. */
const CHAR = 6.6

// One cursor for every chart sharing a `sync` name: the resource panels sit in
// a grid of the same width, so the minute under the pointer in one is shown in
// all of them.
type Shared = { ts: number | null; listeners: Set<() => void> }
const shared = new Map<string, Shared>()
function sharedOf(name: string): Shared {
  let s = shared.get(name)
  if (!s) shared.set(name, (s = { ts: null, listeners: new Set() }))
  return s
}
function setShared(name: string, ts: number | null) {
  const s = sharedOf(name)
  if (s.ts === ts) return
  s.ts = ts
  s.listeners.forEach((fn) => fn())
}
const noSync = () => () => {}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize((was) => (was.w === el.clientWidth && was.h === el.clientHeight ? was : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

function yScale(axis: ValueAxis, top: number, bottom: number) {
  const f = axis.scale === "log" ? Math.log10 : axis.scale === "sqrt" ? Math.sqrt : (v: number) => v
  const [d0, d1] = axis.domain
  const a = f(axis.scale === "log" ? Math.max(d0, 1e-9) : Math.max(d0, axis.scale === "sqrt" ? 0 : d0))
  const b = f(d1)
  const span = b - a || 1
  return (v: number) => {
    const c = axis.scale === "log" ? Math.max(v, d0, 1e-9) : axis.scale === "sqrt" ? Math.max(v, 0) : v
    return bottom - ((f(c) - a) / span) * (bottom - top)
  }
}

/** The index of the row nearest `ts`, by binary search over rows ordered in time. */
function nearest(rows: Row[], ts: number): number {
  let lo = 0
  let hi = rows.length - 1
  if (hi < 0) return -1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (rows[mid].ts < ts) lo = mid
    else hi = mid
  }
  return Math.abs(rows[lo].ts - ts) <= Math.abs(rows[hi].ts - ts) ? lo : hi
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

type Geometry = { w: number; h: number; left: number; right: number; top: number; bottom: number; x: (ts: number) => number; y: (v: number) => number }

function paths(rows: Row[], series: Series[], g: Geometry) {
  return series.map((s) => {
    const segs: string[] = []
    const lower: string[] = []
    const dots: [number, number][] = []
    let run: [number, number][] = []
    let runLow: [number, number][] = []
    const flush = () => {
      if (run.length) {
        if (s.kind === "line") segs.push("M" + run.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L"))
        else if (s.kind === "area") {
          const line = run.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")
          segs.push(`M${line}`)
          lower.push(`M${line}L${fmt(run[run.length - 1][0])},${fmt(g.bottom)}L${fmt(run[0][0])},${fmt(g.bottom)}Z`)
        } else {
          const up = run.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")
          const down = runLow.slice().reverse().map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")
          segs.push(`M${up}`)
          lower.push(`M${up}L${down}Z`)
        }
      }
      run = []
      runLow = []
    }
    for (const r of rows) {
      const v = r[s.key]
      const x = g.x(r.ts)
      if (s.kind === "band") {
        if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") {
          run.push([x, g.y(v[1])])
          runLow.push([x, g.y(v[0])])
        } else if (!s.connect) flush()
        continue
      }
      if (typeof v === "number") {
        run.push([x, g.y(v)])
        if (s.solo && (r.solo as Record<string, true> | undefined)?.[s.key]) dots.push([x, g.y(v)])
      } else if (!(s.kind === "line" && s.connect)) flush()
    }
    flush()
    return { line: segs.join(""), fill: lower.join(""), dots }
  })
}

/** Which ticks fit: those whose label clears the one before it by a few pixels, and the plot's ends. */
function fitTicks(axis: TimeAxis, g: Geometry): number[] {
  const kept: number[] = []
  let end = -Infinity
  for (const t of axis.ticks) {
    const x = g.x(t)
    const half = (axis.format(t).length * CHAR) / 2
    if (x - half < end + 12) continue
    if (x - half < g.left - 2 || x + half > g.w) continue
    kept.push(t)
    end = x + half
  }
  return kept
}

export type PlotProps = {
  rows: Row[]
  time: TimeAxis
  value: ValueAxis
  series: Series[]
  /** Charts with the same name share one cursor. */
  sync?: string
  /** Reached by Tab, its cursor moved with the arrow keys. */
  focusable?: boolean
  /** The hovered row, for a readout drawn elsewhere (the panel's title row). */
  onActive?: (row: Row | null) => void
  /** A box pinned to the plot's top beside the cursor, for the hovered row. */
  tip?: (row: Row) => ReactNode
  label?: string
}

/**
 * A chart over `rows`, filling its container. The cursor follows a mouse,
 * a finger (until a tap elsewhere), or the arrow keys where `focusable`.
 */
export const Plot = memo(function Plot({ rows, time, value, series, sync, focusable = false, onActive, tip, label }: PlotProps) {
  const [box, { w, h }] = useWidth()
  const clip = "plot" + useId().replace(/[^\w-]/g, "")
  const g = useMemo((): Geometry | null => {
    if (!w || !h) return null
    const left = MARGIN.left + value.width
    const right = w - MARGIN.right
    const top = MARGIN.top
    const bottom = h - X_AXIS
    const [t0, t1] = time.domain
    const span = t1 - t0 || 1
    return { w, h, left, right, top, bottom, x: (ts) => left + ((ts - t0) / span) * (right - left), y: yScale(value, top, bottom) }
  }, [w, h, value, time.domain])

  const drawn = useMemo(() => (g ? paths(rows, series, g) : []), [rows, series, g])
  const ticks = useMemo(() => (g ? fitTicks(time, g) : []), [time, g])

  // The hovered row: this chart's own, or the one its sync group points at.
  const [own, setOwn] = useState<number | null>(null)
  const group = useSyncExternalStore(
    sync
      ? (fn) => {
          const s = sharedOf(sync)
          s.listeners.add(fn)
          return () => s.listeners.delete(fn)
        }
      : noSync,
    () => (sync ? sharedOf(sync).ts : null),
  )
  const active = sync ? (group === null ? -1 : nearest(rows, group)) : own === null ? -1 : own
  const row = active >= 0 ? rows[active] : null

  const point = useCallback(
    (i: number | null) => {
      if (sync) setShared(sync, i === null ? null : rows[i]?.ts ?? null)
      else setOwn(i)
    },
    [sync, rows],
  )
  useEffect(() => () => {
    if (sync) setShared(sync, null)
  }, [sync])

  useEffect(() => onActive?.(row), [row, onActive])

  const at = (e: PointerEvent<SVGSVGElement>) => {
    if (!g || !rows.length) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < g.left - 8 || x > g.right + 8) return null
    const [t0, t1] = time.domain
    const ts = t0 + ((x - g.left) / (g.right - g.left)) * (t1 - t0)
    return nearest(rows, ts)
  }
  // A finger's cursor stays until a tap anywhere else.
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) return
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) {
        touched.current = false
        point(null)
      }
    }
    addEventListener("pointerdown", away)
    return () => removeEventListener("pointerdown", away)
  })

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!rows.length) return
    const now = active < 0 ? rows.length - 1 : active
    const go = (i: number) => {
      e.preventDefault()
      point(Math.max(0, Math.min(rows.length - 1, i)))
    }
    if (e.key === "ArrowLeft") go(active < 0 ? now : now - 1)
    else if (e.key === "ArrowRight") go(active < 0 ? now : now + 1)
    else if (e.key === "Home") go(0)
    else if (e.key === "End") go(rows.length - 1)
    else if (e.key === "Escape" && active >= 0) {
      e.preventDefault()
      point(null)
    }
  }

  return (
    <div ref={box} className="relative h-full w-full">
      {g && (
        <svg
          width={w}
          height={h}
          className="plot block touch-pan-y select-none"
          role={focusable ? "application" : "img"}
          aria-label={label}
          tabIndex={focusable ? 0 : undefined}
          onKeyDown={focusable ? onKey : undefined}
          onBlur={focusable ? () => point(null) : undefined}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse" || touched.current) point(at(e))
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") return
            touched.current = true
            point(at(e))
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") point(null)
          }}
        >
          <Frame g={g} value={value} time={time} ticks={ticks} />
          <defs>
            <clipPath id={clip}>
              <rect x={g.left} y={g.top - 4} width={g.right - g.left} height={g.bottom - g.top + 8} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clip})`}>
            {series.map((s, i) => {
              const p = drawn[i]
              if (!p) return null
              if (s.kind === "band")
                return (
                  <g key={s.key}>
                    <path d={p.fill} fill={s.fill} fillOpacity={s.fillOpacity} stroke="none" />
                    {s.stroke && <path d={p.line} fill="none" stroke={s.stroke} strokeOpacity={s.strokeOpacity ?? 1} strokeWidth={1} />}
                  </g>
                )
              return (
                <g key={s.key}>
                  {s.kind === "area" && <path d={p.fill} fill={s.stroke} fillOpacity={s.fillOpacity} stroke="none" />}
                  <path
                    d={p.line}
                    fill="none"
                    stroke={s.stroke}
                    strokeWidth={s.width ?? 1.5}
                    strokeOpacity={s.kind === "line" ? s.opacity ?? 1 : 1}
                    strokeDasharray={s.kind === "line" ? s.dash : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {p.dots.map(([x, y]) => (
                    <circle key={x} cx={x} cy={y} r={2} fill={s.stroke} />
                  ))}
                </g>
              )
            })}
          </g>
          {row && <Cursor g={g} row={row} series={series} />}
        </svg>
      )}
      {g && row && tip && <Tip g={g} x={g.x(row.ts)}>{tip(row)}</Tip>}
    </div>
  )
})

/** The grid and both axes' labels. */
const Frame = memo(function Frame({ g, value, time, ticks }: { g: Geometry; value: ValueAxis; time: TimeAxis; ticks: number[] }) {
  return (
    <g className="tnum" fontSize={FONT} fill="currentColor">
      {value.ticks.map((v) => {
        const y = g.y(v)
        return (
          <g key={v}>
            <line x1={g.left} x2={g.right} y1={y} y2={y} className="stroke-border" strokeDasharray="3 3" />
            <text x={g.left - 8} y={y} textAnchor="end" dominantBaseline="central">
              {value.format(v)}
            </text>
          </g>
        )
      })}
      {ticks.map((t) => (
        <text key={t} x={g.x(t)} y={g.bottom + 16} textAnchor="middle" dominantBaseline="central">
          {time.format(t)}
        </text>
      ))}
    </g>
  )
})

/** The hovered minute: a dashed line down the plot and a dot on each line at it. */
function Cursor({ g, row, series }: { g: Geometry; row: Row; series: Series[] }) {
  const x = g.x(row.ts)
  if (x < g.left - 1 || x > g.right + 1) return null
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={g.top} y2={g.bottom} stroke="var(--ring)" strokeDasharray="3 3" />
      {series.map((s) => {
        if (s.kind === "band" || s.active === false) return null
        const v = row[s.key]
        if (typeof v !== "number") return null
        return <circle key={s.key} cx={x} cy={g.y(v)} r={3} fill={s.stroke} stroke="var(--card)" strokeWidth={2} />
      })}
    </g>
  )
}

/**
 * The hovered minute's box, pinned to the plot's top beside the cursor, on
 * whichever side it fits, and never wider than the plot: a box overhanging the
 * panel widened a phone's page after a tap.
 */
function Tip({ g, x, children }: { g: Geometry; x: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth)
  }, [children])
  const room = g.right - g.left
  let left = x + 10
  if (left + width > g.right) left = x - 10 - width
  left = Math.max(g.left, Math.min(left, g.right - width))
  return (
    <div
      ref={ref}
      className="tnum pointer-events-none absolute z-10 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-[0_6px_20px_rgb(0_0_0/0.14)]"
      style={{ top: g.top, left, maxWidth: room, visibility: width ? "visible" : "hidden" }}
    >
      {children}
    </div>
  )
}
