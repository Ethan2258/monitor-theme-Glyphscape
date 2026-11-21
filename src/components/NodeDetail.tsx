import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react"
import {
  Area, Brush, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type DotItemDotProps,
} from "recharts"

import { Skeleton } from "@/components/ui/skeleton"
import { daysLeft, monthUsage } from "@/components/NodeCard"
import { api, type Node } from "@/lib/api"
import { convert, remaining, type Rates } from "@/lib/cost"
import {
  axisBytes, axisTop, bytes, clockFor, cycle, despike, quarters, cpuName, FOREVER, money, osName, pair, rate,
  RATE_FLOOR, rateAxis, sinceSeen, tickClock, timeTicks, windows, withGaps,
} from "@/lib/format"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  // The highest the agent measured over one report interval within the bucket,
  // never below the mean beside it. Absent from hubs predating them.
  cpu_max?: number
  net_rx_max?: number
  net_tx_max?: number
  // How many minutes of the bucket have data. Short of the bucket's length, the
  // node was away for the rest. Absent from hubs before 1.3.2.
  minutes?: number
  // Averages over the bucket. Hubs up to 1.4.0 carry these in the live metrics
  // only.
  swap_used?: number
  tcp?: number
  udp?: number
  procs?: number
}
// `latency` is the bucket's median round trip, null when every probe in it timed
// out. `band` is the range its answers spanned, absent when they spanned nothing.
// `loss` is the percentage that timed out, absent when none did.
type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  band?: [number, number]
  loss?: number
}
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>
/**
 * Proportion of the whole window each probe lost, by id, absent for probes that
 * lost nothing. Sent because it cannot be derived here: every bucket's `loss` is
 * already a percentage of that bucket, so the sample counts it was divided by are
 * unavailable. Averaging them would weight a bucket holding one sample equally
 * with one holding twelve, and the window's first and last buckets are partial
 * regardless of what the probe does.
 */
type Loss = Record<string, number>
/** `step` is the seconds one point covers. Absent from hubs before 1.3.2. */
type History = { metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss; step?: number }

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }

// A resource chart's series. A row with a gap on either side has no neighbour to
// draw a line to, so it is marked with a dot; without one, a node back for a
// single bucket after a stretch offline would not show at all.
const RESOURCE_SERIES = {
  ...SERIES,
  dot: ({ cx, cy, index, points, stroke }: DotItemDotProps) =>
    cy == null || points[index - 1]?.y != null || points[index + 1]?.y != null ? null : (
      <circle cx={cx} cy={cy} r={2} fill={stroke} />
    ),
}

// The range a bucket reached above its mean, drawn behind the line. Edged
// because a one-minute burst on a day's axis is narrower than a pixel, where a
// fill alone does not show, and dashed rather than faded: two series told apart
// by colour would have the faded edge of one take the shade of the other.
const PEAK_BAND = {
  strokeWidth: 1,
  strokeDasharray: "2 2",
  fillOpacity: 0.14,
  isAnimationActive: false,
  tooltipType: "none" as const,
  legendType: "none" as const,
}

// The CPU panel's band is alone in its panel, so its edge can fade without
// taking another series' shade; at full strength a busy day of one-minute
// bursts draws in ink as a fringe of white bristles on the dark palette.
const CPU_PEAK_BAND = { ...PEAK_BAND, strokeOpacity: 0.45 }

// Nor does the tooltip slide. Entering a chart at its right edge, it appears
// beside the cursor first and would glide 400 ms back within the chart,
// overhanging the page by up to 140 px and flashing a horizontal scrollbar.
// Drawn on the card's own ground: recharts' default is a white box in either
// palette.
const TOOLTIP = {
  isAnimationActive: false,
  labelFormatter: (ts: unknown) => new Date(Number(ts)).toLocaleString("zh-CN"),
  contentStyle: {
    fontSize: 12,
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 6px 20px rgb(0 0 0 / 14%)",
  },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: 2 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--ring)", strokeDasharray: "3 3" },
}

// One width for every stacked panel's value axis. Sized to their own labels --
// 40px under "100%", 68px under "172 MB" -- the plot areas would be offset by
// 28px, placing a CPU spike and the network spike that caused it at different x.
//
// Every listed tick is drawn: the lists are spaced to fit, while recharts' own
// collision pass would nudge the top label 5 px inward, drop the tick beneath it,
// and thin the gridlines separately -- the CPU axis would lose its 30% gridline,
// and a rate axis of 1 KB/s to 100 MB/s its 10 MB/s label and two gridlines.
const VALUE_AXIS = { ...AXIS, width: 68, interval: 0 }

// Five hues that hold apart on paper and on ink, and a dash pattern each as
// well: colour alone fails a reader who cannot tell two of them apart, and at
// the day range a dash alone reads as texture.
const PALETTE = [
  { stroke: "var(--color-chart-1)", dash: undefined },
  { stroke: "var(--color-chart-2)", dash: "6 3" },
  { stroke: "var(--color-chart-3)", dash: "2 3" },
  { stroke: "var(--color-chart-4)", dash: "10 4 2 4" },
  { stroke: "var(--color-chart-5)", dash: "1 4" },
]

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const
type TabKey = (typeof TABS)[number]["key"]

/**
 * A history response and what it was asked for. Kept per tab, so a new range or
 * a retry can leave the last answer on screen, dimmed, until the next one
 * arrives, instead of collapsing the page to a placeholder and clamping the
 * reader's scroll.
 */
type Loaded = { node: number; hours: number; attempt: number; history: History; failed: string }

const EMPTY: History = { metrics: [], ping: [], probes: {} }

type TipFormatter = NonNullable<ComponentProps<typeof Tooltip>["formatter"]>

// The tooltips' formatters live out here rather than inline, where each render
// would hand recharts a new function and have it redraw every panel for it.
const bytesTip: TipFormatter = (v) => bytes(Number(v))

const cpuTip: TipFormatter = (v, _name, item) => {
  const top = item?.payload?.cpu_max
  const mean = `${Number(v).toFixed(1)}%`
  return [top === undefined ? mean : `均值 ${mean} · 峰值 ${Number(top).toFixed(1)}%`, "CPU"]
}

// The hub's figures rather than `v`, which is lifted to the axis floor.
const rateTip: TipFormatter = (_, name, item) => {
  const mean = item?.payload?.[`net_${item.dataKey}`]
  const top = item?.payload?.[`net_${item.dataKey}_max`]
  return [top === undefined ? rate(mean) : `均值 ${rate(mean)} · 峰值 ${rate(top)}`, name]
}

// The line is drawn from what answered, so without the loss a bucket that lost
// most of its packets reads as normal. `dataKey` is `t7`/`s7`; the loss sits at
// `l7`. Rounded because a clipped sample carries the median of an even window,
// which falls between two of the whole milliseconds the hub stores.
const latencyTip: TipFormatter = (v, name, item) => {
  const loss = Number(item?.payload?.[`l${String(item.dataKey).slice(1)}`] ?? 0)
  return [`${Math.round(Number(v))} ms${loss > 0 ? ` · 丢 ${loss}%` : ""}`, name]
}

const countTick = (v: number) => (v % 1 ? v.toFixed(1) : String(v))

/**
 * A zero-anchored byte axis whose gridlines fall on a power of two: memory is
 * sold in them, so 7.6 GB reads 2, 4, 6, 8 GB rather than the 1.9, 3.8, 5.7 its
 * quarters would print. At most four steps, the top the first multiple of the
 * step at or above `max`.
 */
function binaryAxis(max: number): { domain: [number, number]; ticks: number[] } {
  if (!(max > 0)) return { domain: [0, 1], ticks: quarters(1) }
  const step = 2 ** Math.ceil(Math.log2(max / 4))
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  return { domain: [0, top], ticks }
}

// A real time axis rather than the category axis recharts defaults to: on a
// category axis ticks are selected by index, so a period the agent was offline
// for collapses to nothing. Built once per data and range by its callers, since
// fresh `ticks` and `tickFormatter` on each render redraw the whole chart.
function timeAxis(rows: { ts: number }[], hours: number, from = 0, to = rows.length - 1) {
  // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
  // are dropped by `minTickGap`.
  const ticks = rows.length ? timeTicks(rows[from].ts, rows[to].ts) : []
  return {
    dataKey: "ts",
    type: "number" as const,
    domain: ["dataMin", "dataMax"] as const,
    ticks,
    tickFormatter: tickClock(ticks, hours),
    minTickGap: hours > 24 ? 72 : 40,
    ...AXIS,
  }
}

/** How a plan counts traffic against its quota. */
const TRAFFIC_MODES: Record<string, string> = { sum: "双向", up: "仅上行", down: "仅下行", max: "取大" }

/** How many slices the availability strip is drawn in, at most. */
const UPTIME_SLICES = 96

type Key = { label: string; color: string; dash?: boolean }

/** A chart under its title, with a key to its lines on the right where there is more than one. */
function Panel({ title, keys, children }: { title: string; keys?: Key[]; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="truncate text-xs font-medium text-muted-foreground">{title}</h4>
        {keys && (
          <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
            {keys.map((k) => (
              <span key={k.label} className="inline-flex items-center gap-1.5">
                <svg width="14" height="4" aria-hidden>
                  <line x1="0" y1="2" x2="14" y2="2" stroke={k.color} strokeWidth="2" strokeDasharray={k.dash ? "3 2" : undefined} />
                </svg>
                {k.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="h-40 w-full text-muted-foreground">{children}</div>
    </div>
  )
}

// `narrow` tightens the padding on a phone, so the seven windows of a year of
// history fit one row of a 360px screen.
function Tab({ active, onClick, narrow = false, children }: {
  active: boolean
  onClick: () => void
  narrow?: boolean
  children: string
}) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md py-1 text-xs transition-colors ${narrow ? "px-1.5 sm:px-2.5" : "px-2.5"} ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

/**
 * How many samples of a probe's own series make up seven minutes of neighbours.
 *
 * The window the filter judges against has to be a duration, not a count: the
 * hub buckets a window to the `points` asked for below, so the same day arrives
 * as one-minute buckets on a desktop and two-minute ones on a phone, and a fixed
 * count would clip a five-minute stall on the first while keeping it on the
 * second. The smallest gap between the probe's samples is its spacing, the
 * bucket or its own interval if longer; a wider one is the node being offline.
 * Odd, so the window has a middle, and bounded so a sparse probe still has
 * neighbours and a dense one does not pay for a wide sort.
 */
function despikeWindow(points: { ts: number }[]): number {
  let step = Infinity
  for (let i = 1; i < points.length; i++) step = Math.min(step, points[i].ts - points[i - 1].ts)
  return Math.min(15, Math.max(3, Math.round(420 / step) | 1))
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-dashed py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="tnum min-w-0 text-right text-[13px] break-words">{value}</dd>
    </div>
  )
}

/** A column of facts under a small heading. */
function Facts({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{title}</h3>
      <dl>{children}</dl>
    </section>
  )
}

/**
 * `historyDays` is how far back the hub keeps history. Both tabs offer every
 * window within it: up to a day each ping is on the latency chart, and past it a
 * point is a bucket -- its median, the range its answers spanned and the share
 * lost -- which over a month shows a route's evening pattern a day cannot.
 *
 * `price` is the operator's `show_price` setting.
 */
export function NodeDetail({ node, historyDays, price, rates, primary }: {
  node: Node
  historyDays: number
  price: boolean
  rates: Rates
  primary: "CNY" | "USD"
}) {
  const ranges = useMemo(() => windows(historyDays), [historyDays])
  const [tab, setTab] = useState<TabKey>("resources")
  // Each tab keeps its own range: a 7-day trend and a 1-hour trace answer
  // different questions.
  const [picked, setPicked] = useState({ resources: 6, latency: 6 })
  const hours = picked[tab]
  const [smooth, setSmooth] = useState(false)
  // Probes switched off. Hiding a slow one is what makes the fast ones readable,
  // as the axis rescales to what remains.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  const [loaded, setLoaded] = useState<Partial<Record<TabKey, Loaded>>>({})
  const [attempt, setAttempt] = useState(0)
  const entry = loaded[tab]
  // Another node's history is never shown in this one's place, dimmed or not.
  const current = entry?.node === node.id ? entry : undefined
  const data = current?.history ?? null
  // Retained rather than folded into an empty result: a refused request and an
  // empty window are different answers, and the hub has reason to refuse this one
  // -- it caps how many history windows it builds concurrently. Rendered as an
  // empty window, a 503 would misdirect the reader.
  const failed = current?.failed ?? ""
  // What is on screen answers an earlier question, and the new answer is in
  // flight.
  const stale = !!current && (current.hours !== hours || current.attempt !== attempt)
  // Where the brush has been dragged, so the axis reticks for the visible span
  // rather than retaining the whole window's ticks.
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  // Where the chart begins on screen, so its height can occupy the remainder.
  const [chartTop, setChartTop] = useState(0)

  useEffect(() => {
    let active = true
    // The old range stays drawn, dimmed, while the new one is in flight: emptied,
    // the charts would fall to a placeholder half their height and back. The
    // brush is reset with the data it selects from, not before.
    const settle = (history: History, failed = "") => {
      if (!active) return
      setZoom(null)
      setLoaded((all) => ({ ...all, [tab]: { node: node.id, hours, attempt, history, failed } }))
    }
    // What this screen can resolve, in device pixels, which is the unit the line
    // is drawn in: a 1280-wide retina panel has 2560 of them for a day of minutes.
    // Read here rather than from a ref, since the hub only thins further, an
    // approximate figure suffices, and the viewport is known before layout. A
    // rotation keeps whatever it fetched with.
    //
    // The tab determines which half is requested; the other accounted for a third
    // to two thirds of every response and was never drawn.
    const points = Math.round(globalThis.innerWidth * (globalThis.devicePixelRatio || 1))
    const series = tab === "latency" ? "ping" : "metrics"
    api<History>(`/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=${series}`)
      .then((next) => settle(next))
      .catch((e: Error) => settle(EMPTY, e.message))
    return () => { active = false }
  }, [node.id, hours, tab, attempt])

  const m = node.metrics
  // One series per probe that reported, labelled from the names the samples
  // arrived with. Memoised, as are the two below: the node prop changes every few
  // seconds as live metrics arrive, and rebuilding the chart's data array on those
  // renders would reset the brush.
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => {
          // Timeouts are retained: dropping them would draw a probe losing half
          // its packets as an unbroken line, and one that never answered not at
          // all.
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          // Taken from the hub rather than summed from the buckets above, each of
          // which is already a percentage of its own bucket, so averaging them
          // would report one lost round in thirteen as 50%. Left unrounded, since
          // `Math.round` would render 0.28% and 0.00% as the same badge, and the
          // absence of a badge denotes no loss.
          const loss = data?.loss?.[id] ?? 0
          return { id, name: data?.probes?.[id] ?? `探测 ${id}`, points, loss }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  // The hub answers in seconds; the time axis requires milliseconds. CPU and
  // each rate also span from their mean to their peak, which is the band drawn
  // behind the line; without a peak the band has no height. The rates drawn are
  // lifted to the floor of their log axis, which has no zero, while `net_rx` and
  // `net_tx` keep the hub's figures for the tooltip.
  const metricRows = useMemo(() => {
    const lift = (v: number) => Math.max(v, RATE_FLOOR)
    return (data?.metrics ?? []).map((p) => ({
      ...p,
      ts: p.ts * 1_000,
      cpu_band: [p.cpu, p.cpu_max ?? p.cpu],
      rx: lift(p.net_rx),
      tx: lift(p.net_tx),
      rx_band: [lift(p.net_rx), lift(p.net_rx_max ?? p.net_rx)],
      tx_band: [lift(p.net_tx), lift(p.net_tx_max ?? p.net_tx)],
    }))
  }, [data])
  // What the panels draw: the rows above, broken where the node was silent. The
  // axes are fitted to the rows alone.
  const chartRows = useMemo(() => withGaps(metricRows), [metricRows])
  // The window's highest readings, or null from a hub that sends no peak: a
  // maximum of the means would be labelled a peak it is not.
  const peak = useMemo(() => {
    const rows = data?.metrics ?? []
    const max = (pick: (m: Point) => number | undefined) => rows.reduce((hi, m) => Math.max(hi, pick(m) ?? 0), 0)
    return {
      cpu: rows.some((m) => m.cpu_max !== undefined) ? max((m) => m.cpu_max) : null,
      net: rows.some((m) => m.net_rx_max !== undefined)
        ? { rx: max((m) => m.net_rx_max), tx: max((m) => m.net_tx_max) }
        : null,
    }
  }, [data])

  // Axes for the panels with no capacity to measure against. CPU and a transfer
  // rate do not express fullness: against a fixed 0-100, a machine sitting at
  // 0.4% draws as a line along the panel's floor. Memory and disk keep their
  // totals as tops, where fullness is the entire question.
  const axes = useMemo(() => {
    const max = (pick: (m: (typeof metricRows)[number]) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
    // 0-0.4 and render every scheduler blip as a peak. Capped at 100, and fitted
    // to the peaks, so the band stays within the panel.
    const cpu = axisTop(max((m) => m.cpu_band[1]), 4, 100)
    // Swap shares the memory panel. Its use is nearly always a fraction of the
    // memory's size; where it is not, the axis grows to hold it.
    const mem = Math.max(node.mem_total, max((m) => m.swap_used ?? 0))
    // Sockets and processes: counts, with nothing to be a fraction of either.
    const counts = axisTop(max((m) => Math.max(m.tcp ?? 0, m.udp ?? 0, m.procs ?? 0)), 8, Infinity)
    return {
      cpu: { domain: [0, cpu], ticks: quarters(cpu) },
      mem: binaryAxis(mem),
      counts: { domain: [0, counts], ticks: quarters(counts) },
      // From the slowest rate drawn to the highest peak, so the band stays
      // within the panel.
      rate: rateAxis(
        metricRows.reduce((lo, m) => Math.min(lo, m.rx, m.tx), Infinity),
        max((m) => Math.max(m.rx_band[1], m.tx_band[1])),
      ),
    }
  }, [metricRows, node.mem_total])
  // Which of the newer series this hub's history carries.
  const has = useMemo(() => {
    const rows = data?.metrics ?? []
    return {
      swap: node.swap_total > 0 && rows.some((m) => m.swap_used !== undefined),
      counts: rows.some((m) => m.tcp !== undefined || m.procs !== undefined),
    }
  }, [data, node.swap_total])

  // How long a node that is not reporting has been gone, in whole buckets of
  // the chart: its history stops at its last report, and the time since belongs
  // to the window as well. By the hub's count of the seconds, not the visitor's
  // clock. Whole buckets, so this changes once a bucket rather than with every
  // push of live data.
  const step = data?.step
  const gone = !node.online && step ? Math.floor(sinceSeen(node) / step) : 0

  // The share of the window the node was reporting, from how many minutes of
  // each bucket have data. Buckets the hub sent nothing for are minutes away as
  // well, and so is the time since a node that has stopped reporting was last
  // heard from. While it is reporting, the last bucket is still being filled, so
  // it is left out: short there does not mean offline. Counted from the first
  // bucket with data rather than from the window's start, before which the node
  // may simply not have existed.
  //
  // An agent reporting less often than once a minute fills fewer minutes than
  // it was up for, and reads low here; nothing in the response says so.
  const availability = useMemo(() => {
    const rows = data?.metrics ?? []
    if (!step || rows.length < 3 || rows.some((r) => r.minutes === undefined)) return null
    const first = rows[0].ts
    const buckets = Math.round((rows[rows.length - 1].ts - first) / step) + (node.online ? 0 : 1 + gone)
    if (buckets < 2) return null
    const share = new Float64Array(buckets)
    for (const r of rows) {
      const i = Math.round((r.ts - first) / step)
      if (i >= 0 && i < buckets) share[i] = Math.min(1, (r.minutes! * 60) / step)
    }
    const count = Math.min(UPTIME_SLICES, buckets)
    const slices = Array.from({ length: count }, (_, s) => {
      const from = Math.floor((s * buckets) / count)
      const to = Math.max(from + 1, Math.floor(((s + 1) * buckets) / count))
      let sum = 0
      for (let i = from; i < to; i++) sum += share[i]
      return { up: sum / (to - from), from: (first + from * step) * 1_000, to: (first + to * step) * 1_000 }
    })
    return { up: share.reduce((sum, v) => sum + v, 0) / buckets, slices }
  }, [data, step, node.online, gone])

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Whether the probes on screen sit far apart: a route at 300 ms beside two at
  // 3 ms. On a linear axis the slow one takes the whole panel and the fast ones
  // lie flat along its floor, so the axis is then drawn on a square-root scale,
  // which gives the low end room and, unlike a logarithm, has a zero.
  const spread = useMemo(() => {
    const typical = shownProbes.flatMap((s) => {
      const answered = s.points.flatMap((p) => (p.latency === null ? [] : [p.latency])).sort((a, b) => a - b)
      return answered.length ? [answered[answered.length >> 1]] : []
    })
    return typical.length > 1 && Math.max(...typical) >= 6 * Math.max(1, Math.min(...typical))
  }, [shownProbes])
  // Keyed on the full list, so a line keeps its colour when others are hidden.
  // Memoised with it, since the latency chart is redrawn when this changes.
  const style = useCallback(
    (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length],
    [pingSeries],
  )

  // The hub stamps every sample with its bucket rather than the second the probe
  // finished, so probes reporting at the bucket's rate share rows instead of each
  // contributing its own: a day of four probes is 717 rows rather than 2,868. A
  // slower probe leaves gaps in its own column, which is what `connectNulls`
  // addresses.
  //
  // Every probe and both versions of every sample are held here whether or not
  // they are on screen: recharts resets the brush when the data array changes
  // identity, and re-reads a controlled selection only when the index props
  // change, which they do not. Hiding a probe or enabling despiking therefore
  // selects a `dataKey` rather than rebuilding the array.
  const pingRows = useMemo(() => {
    type Row = { ts: number } & Record<string, number | [number, number] | null>
    const rows = new Map<number, Row>()
    for (const s of pingSeries) {
      const windowSize = despikeWindow(s.points)
      const smoothed = despike(s.points.map((p) => p.latency), windowSize)
      // The band spans the same outliers as the line, and with one probe on
      // screen it is what the axis is fitted to, so it is clipped alongside it
      // rather than left to pull the axis back open. The latency fills the
      // buckets that carry no band, keeping each filter's window dense.
      const lo = despike(s.points.map((p) => p.band?.[0] ?? p.latency), windowSize)
      const hi = despike(s.points.map((p) => p.band?.[1] ?? p.latency), windowSize)
      s.points.forEach((p, i) => {
        const row: Row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i]
        row[`l${s.id}`] = p.loss ?? 0
        // A bucket with a single answer carries no band and spans only that
        // answer. Left null, `connectNulls` would bridge the hours between the
        // few buckets that have one: 2 to 10 of 1,440 in a day, the widest gap
        // 803 minutes, drawn as one large wedge.
        row[`b${s.id}`] = p.band ?? (p.latency === null ? null : [p.latency, p.latency])
        // Taken as the span of three filtered series rather than a pair: the two
        // edges are filtered independently, so a bucket that answered slightly
        // faster than usual can trip the low edge alone and come back above the
        // high one -- [180, 178] against a line of 176, drawn backwards with the
        // line outside it.
        const [low, high] = [lo[i], hi[i]]
        row[`c${s.id}`] =
          low === null || high === null
            ? null
            : [Math.min(low, high, smoothed[i] ?? low), Math.max(low, high, smoothed[i] ?? high)]
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  // Where the latency column begins on screen, so its height can occupy the
  // remainder. Measured after layout whenever what is drawn above it can have
  // moved -- new data, the other tab, or a resize reflowing the facts above --
  // rather than in a ref callback, which ran on every render: a live node
  // re-renders every two seconds, and each one forced a layout to read a top that
  // had not changed. `+ scrollY`, since getBoundingClientRect is measured from
  // the viewport.
  const column = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = column.current
      if (el) setChartTop(el.getBoundingClientRect().top + scrollY)
    }
    measure()
    addEventListener("resize", measure)
    return () => removeEventListener("resize", measure)
  }, [data, tab])
  // Less the card's own padding and the gap under it, so the card ends within
  // the window.
  const columnStyle = chartTop ? { height: `calc(100svh - ${Math.round(chartTop)}px - 3rem)` } : undefined

  const days = daysLeft(node)
  const worth = price ? remaining(node, days) : null
  // An amount in both counting currencies, the operator's first; or as billed
  // where the rate is unknown.
  const both = (amount: number) => {
    const c = convert(amount, node.currency, rates)
    if (!c) return money(amount, node.currency)
    const pair = primary === "CNY" ? [money(c.cny, "CNY"), money(c.usd, "USD")] : [money(c.usd, "USD"), money(c.cny, "CNY")]
    return pair.join(" · ")
  }
  const billedIn = node.currency.toUpperCase()
  const used = monthUsage(node)

  return (
    <div className="space-y-4">
      {/* One flat grid of facts: one machine's spec sheet, where a box around
          a single topic would be just a box. Two across from md, one on a
          phone -- a kernel version or a CPU model needs about 270px to stay
          whole. The cost sits under the traffic rather than in a third column:
          two rows of its own beside the machine's seven left that column mostly
          empty, and the two short lists stacked come out about as tall as the
          machine's. */}
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
      <Facts title="机器">
        <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
        <Fact
          label="CPU"
          value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
        />
        <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Fact
          label="架构"
          value={[node.arch, node.virt !== "none" ? node.virt : "", m ? `${m.procs} 进程` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        <Fact label="负载" value={m ? m.load.map((n) => n.toFixed(2)).join(" · ") : null} />
        <Fact
          label="Swap / 连接"
          value={
            m
              ? [
                  node.swap_total > 0 ? pair(m.swap_used, node.swap_total) : "",
                  `TCP ${m.tcp} · UDP ${m.udp}`,
                ].filter(Boolean).join(" · ")
              : null
          }
        />
        <Fact label="主机名 / 地址" value={[node.hostname, node.ip].filter(Boolean).join(" · ")} />
      </Facts>
      <div className="min-w-0 space-y-6">
      <Facts title="流量">
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact
          label="本期流量"
          value={[
            node.traffic_limit > 0 ? pair(used, node.traffic_limit) : `${bytes(used)} / ${FOREVER}`,
            node.traffic_limit > 0 ? (TRAFFIC_MODES[node.traffic_mode] ?? "") : "",
          ].filter(Boolean).join(" · ")}
        />
        <Fact label="累计流量" value={`↓ ${bytes(node.total_rx)} · ↑ ${bytes(node.total_tx)}`} />
      </Facts>
      <Facts title={price ? "费用" : "到期"}>
        <Fact
          label={price ? "续费" : "到期"}
          value={[
            price
              ? node.price > 0
                ? `${money(node.price, node.currency)} / ${cycle(node.billing_cycle)}`
                  + (billedIn === "CNY" || billedIn === "USD" ? "" : `（≈ ${both(node.price)}）`)
                : "免费"
              : "",
            node.expires_at ? `${node.expires_at} 到期` : FOREVER,
          ].filter(Boolean).join(" · ")}
        />
        <Fact
          label="剩余价值"
          value={worth === null ? null : `${both(worth)} · 剩 ${days} 天`}
        />
      </Facts>
      </div>
      </div>

      {node.remark && (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          <div className="mb-0.5 text-xs text-muted-foreground">私有备注 · 仅登录后可见</div>
          <p className="break-words whitespace-pre-wrap">{node.remark}</p>
        </div>
      )}

      <div className="space-y-2 border-t pt-5">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Wraps on a screen narrower than the seven windows of a year. */}
          <div className="flex flex-wrap gap-1">
            {ranges.map((r) => (
              <Tab
                key={r.hours}
                narrow
                active={hours === r.hours}
                onClick={() => setPicked((all) => ({ ...all, [tab]: r.hours }))}
              >
                {r.label}
              </Tab>
            ))}
          </div>
          {tab === "latency" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => setSmooth(e.target.checked)}
                className="accent-foreground"
              />
              削峰
            </label>
          )}
        </div>
      </div>

      {!data ? (
        tab === "latency" ? (
          // Measured and sized as the chart's column is, so the chart lands in
          // the space it held.
          <Skeleton ref={column} style={columnStyle} className="min-h-72 w-full" aria-busy />
        ) : (
          <ResourceSkeleton />
        )
      ) : (
        // The last answer stays on screen while the next is in flight, dimmed
        // so the reader can tell it is about to change.
        <div aria-busy={stale} className={`transition-opacity duration-300 ${stale ? "opacity-60" : ""}`}>
          {failed ? (
            <p className="py-8 text-center text-sm text-destructive" role="alert">
              读取历史数据失败：{failed}
              <button className="ml-2 underline" onClick={() => setAttempt((n) => n + 1)}>重试</button>
            </p>
          ) : tab === "latency" ? (
            pingSeries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
            ) : (
              // An explicit pixel height on the column, so the chart can be
              // `flex-1` within it while the legend takes what it needs: four
              // probes are one row of chips on a desktop and two on a phone, so
              // any fixed reservation is wrong on one of them.
              <div
                ref={column}
                style={columnStyle}
                className="flex min-h-72 flex-col gap-3">
                {/* `min-h-0` is what makes `flex-1` a real number rather than
                    the content's own height: ResponsiveContainer reads its
                    parent, and a flex child not told it may shrink reports
                    whatever the SVG last was. The column above has a height in
                    pixels, so this resolves at layout instead of coming back 0. */}
                <div className="min-h-0 w-full flex-1 text-muted-foreground">
                  {shownProbes.length === 0 ? (
                    <p className="py-8 text-center text-sm">没有选中任何探测</p>
                  ) : (
                    <LatencyChart
                      rows={pingRows}
                      probes={shownProbes}
                      style={style}
                      spread={spread}
                      smooth={smooth}
                      zoom={zoom}
                      hours={hours}
                      onZoom={setZoom}
                    />
                  )}
                </div>

                {/* Under the chart: what it covers is picked at the top, what is
                    drawn in it is picked here. Recharts paints the brush into the
                    same SVG as the axis, so this is as close beneath as HTML
                    sits. */}
                {(pingSeries.length > 1 || pingSeries.some((s) => s.loss > 0)) && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {pingSeries.map((s) => {
                      const shown = !hiddenProbes.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          aria-pressed={shown}
                          onClick={() =>
                            setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
                          }
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity ${
                            shown ? "" : "opacity-40"
                          }`}
                        >
                          {/* The swatch carries the same colour and dash as the line. */}
                          <svg width="14" height="6" className="shrink-0" aria-hidden>
                            <line
                              x1="0"
                              y1="3"
                              x2="14"
                              y2="3"
                              stroke={style(s.id).stroke}
                              strokeDasharray={style(s.id).dash}
                              strokeWidth="2"
                            />
                          </svg>
                          {s.name}
                          {/* The line is only what answered, so a probe dropping
                              half its packets draws like a healthy one. */}
                          {s.loss > 0 && (
                            <span className="tnum opacity-60">
                              丢 {s.loss < 1 ? "<1" : Math.round(s.loss)}%
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          ) : data.metrics.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
          ) : (
            <ResourceCharts
              rows={chartRows}
              axes={axes}
              peak={peak}
              has={has}
              availability={availability}
              hours={hours}
              memTotal={node.mem_total}
              swapTotal={node.swap_total}
              diskTotal={node.disk_total}
            />
          )}
        </div>
      )}
    </div>
  )
}

// The resource panels' grid, so the placeholder can take its shape.
const RESOURCE_GRID = "grid gap-x-10 gap-y-7 lg:grid-cols-2 lg:[&>*:last-child:nth-child(even)]:col-span-2"

/**
 * What stands in for the resource panels on the first load, at their height: an
 * `h-40` bar in place of five panels moved the page by 530px when they arrived.
 * The strip and five panels, each a title line over a 160px chart.
 */
function ResourceSkeleton() {
  return (
    <div className={RESOURCE_GRID} aria-busy>
      <Skeleton className="h-[49px] lg:col-span-2" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-[187px]" />
      ))}
    </div>
  )
}

type Rows = { ts: number }[]
type Axis = { domain: number[]; ticks: number[] }
type Availability = { up: number; slices: { up: number; from: number; to: number }[] } | null

/**
 * The resource panels. Memoised, and given only values memoised on the history
 * and plain numbers, so the live push every two seconds -- a new `node` with the
 * same totals -- re-renders the facts above and not these: redrawn, the five
 * charts cost 85ms and then 300ms more inside recharts' own frame at six hours,
 * and twice that at a day, most of it the dot test run for every point.
 */
const ResourceCharts = memo(function ResourceCharts({
  rows, axes, peak, has, availability, hours, memTotal, swapTotal, diskTotal,
}: {
  rows: Rows
  axes: { cpu: Axis; mem: Axis; counts: Axis; rate: Axis }
  peak: { cpu: number | null; net: { rx: number; tx: number } | null }
  has: { swap: boolean; counts: boolean }
  availability: Availability
  hours: number
  memTotal: number
  swapTotal: number
  diskTotal: number
}) {
  const time = useMemo(() => timeAxis(rows, hours), [rows, hours])
  const disk = useMemo(() => ({ domain: [0, diskTotal], ticks: quarters(diskTotal) }), [diskTotal])
  const clock = clockFor(hours)

  return (
    <div className={RESOURCE_GRID}>
      {/* The window as one strip, left to right: green where the node was
          reporting throughout, amber where for part of the slice, a muted red
          where not at all -- muted, or a node offline for the whole window is
          a wall of alarm on a page already saying so. A slice here is many of
          the chart's points, so an outage too short to break a line below
          still leaves its mark. */}
      {availability && (
        <div className="lg:col-span-2">
          <h4 className="mb-2 flex items-baseline justify-between gap-3 text-xs font-medium text-muted-foreground">
            <span>在线率</span>
            <span className={`tnum ${availability.up < 0.99 ? "text-warn" : ""}`}>
              {/* Floored, never rounded up: a window with one minute away
                  must not read 100%. */}
              {(Math.floor(availability.up * 10000) / 100).toFixed(2)}%
            </span>
          </h4>
          <div className="flex h-6 gap-px">
            {availability.slices.map((s) => (
              <span
                key={s.from}
                title={`${clock(s.from)} – ${clock(s.to)} · ${(Math.floor(s.up * 1000) / 10).toFixed(1)}%`}
                className={`min-w-0 flex-1 rounded-[1px] ${
                  s.up >= 0.999 ? "bg-online/55" : s.up > 0 ? "bg-warn" : "bg-hot/35"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* The line is the bucket's mean. Behind it, the band reaches the
          highest reading within the bucket: a minute pinned at 100% is a
          sixtieth of an hour's mean, and would otherwise leave no trace on a
          month's chart. */}
      <Panel title={peak.cpu === null ? "CPU" : `CPU · 峰值 ${peak.cpu.toFixed(1)}%`}>
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis {...time} />
            <YAxis {...axes.cpu} unit="%" {...VALUE_AXIS} />
            <Tooltip {...TOOLTIP} formatter={cpuTip} />
            <Area dataKey="cpu_band" stroke="var(--color-ink)" fill="var(--color-ink)" {...CPU_PEAK_BAND} />
            <Area dataKey="cpu" name="CPU" stroke="var(--color-ink)" fill="var(--color-ink)" fillOpacity={0.12} {...RESOURCE_SERIES} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* The axis is anchored on the machine's memory, so the line's height is
          the fraction in use whatever range is picked. Tracking the window's
          own maximum, which is what an area chart does by default, puts 127 MB
          of a 457 MB box at the top of the panel. The top is the memory rounded
          up to the next gridline, so the ticks are whole sizes; the exact size
          is in the title. Swap is a line across the same panel: it matters
          when memory is short, which is where the two are read together. */}
      <Panel
        title={`内存 · ${bytes(memTotal)}${has.swap ? ` · Swap ${bytes(swapTotal)}` : ""}`}
        keys={has.swap ? [{ label: "内存", color: "var(--color-chart-1)" }, { label: "Swap", color: "var(--color-chart-3)", dash: true }] : undefined}
      >
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis {...time} />
            <YAxis {...axes.mem} tickFormatter={axisBytes} {...VALUE_AXIS} />
            <Tooltip {...TOOLTIP} formatter={bytesTip} />
            <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...RESOURCE_SERIES} />
            {has.swap && (
              <Line dataKey="swap_used" name="Swap" stroke="var(--color-chart-3)" strokeDasharray="5 3" {...RESOURCE_SERIES} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* A rate has no total to be a fraction of, and its range spans orders
          of magnitude: a week of one node runs from 0.2 KB/s idle to bursts
          of 70 MB/s. Fitted to the bursts, a linear axis would draw the
          median minute less than a pixel above the floor on seven of nine
          nodes at the day window, so this one is logarithmic, each tenfold
          step the same height.

          The line is the bucket's mean, so it integrates to the traffic
          totals, and a 15-second speed test averaged over its minute draws
          at a quarter of the rate it ran at. The band behind it reaches the
          highest rate measured within the bucket. Its lower edge lies under
          the line. */}
      <Panel
        title={peak.net ? `网络 · 峰值 ↓ ${rate(peak.net.rx)} ↑ ${rate(peak.net.tx)}` : "网络"}
        keys={[{ label: "下行", color: "var(--color-rx)" }, { label: "上行", color: "var(--color-tx)" }]}
      >
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis {...time} />
            <YAxis scale="log" {...axes.rate} tickFormatter={axisBytes} unit="/s" {...VALUE_AXIS} />
            <Tooltip {...TOOLTIP} formatter={rateTip} />
            {/* Water for what comes in, the koi's red for what goes out. */}
            <Area dataKey="rx_band" stroke="var(--color-rx)" fill="var(--color-rx)" {...PEAK_BAND} />
            <Area dataKey="tx_band" stroke="var(--color-tx)" fill="var(--color-tx)" {...PEAK_BAND} />
            <Line dataKey="rx" name="下行" stroke="var(--color-rx)" {...RESOURCE_SERIES} />
            <Line dataKey="tx" name="上行" stroke="var(--color-tx)" {...RESOURCE_SERIES} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* The disk it is filling, for the same reason as memory: a node
          using 2.7% of its disk draws along the top of the panel when the
          axis tracks the window's own maximum. */}
      <Panel title={`硬盘 · ${bytes(diskTotal)}`}>
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis {...time} />
            <YAxis {...disk} tickFormatter={axisBytes} {...VALUE_AXIS} />
            <Tooltip {...TOOLTIP} formatter={bytesTip} />
            <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-4)" fill="var(--color-chart-4)" fillOpacity={0.15} {...RESOURCE_SERIES} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* Open sockets and running processes, each bucket's average. Only a
          hub that keeps them in history has this panel. */}
      {has.counts && (
        <Panel
          title="连接与进程"
          keys={[{ label: "TCP", color: "var(--color-chart-1)" }, { label: "UDP", color: "var(--color-chart-3)", dash: true }, { label: "进程", color: "var(--color-ink)", dash: true }]}
        >
          <ResponsiveContainer>
            <ComposedChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis {...time} />
              <YAxis {...axes.counts} tickFormatter={countTick} {...VALUE_AXIS} />
              <Tooltip {...TOOLTIP} />
              <Line dataKey="tcp" name="TCP" stroke="var(--color-chart-1)" {...RESOURCE_SERIES} />
              <Line dataKey="udp" name="UDP" stroke="var(--color-chart-3)" strokeDasharray="5 3" {...RESOURCE_SERIES} />
              <Line dataKey="procs" name="进程" stroke="var(--color-ink)" strokeDasharray="2 3" {...RESOURCE_SERIES} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  )
})

type Probe = { id: number; name: string }

/**
 * The latency chart, memoised for the same reason as the resource panels: a
 * live push redraws it only when what it draws has changed. Dragging the brush
 * does change it, as the axis reticks for the span in view.
 */
const LatencyChart = memo(function LatencyChart({
  rows, probes, style, spread, smooth, zoom, hours, onZoom,
}: {
  rows: Rows
  probes: Probe[]
  style: (id: number) => (typeof PALETTE)[number]
  spread: boolean
  smooth: boolean
  zoom: [number, number] | null
  hours: number
  onZoom: (span: [number, number]) => void
}) {
  const last = rows.length - 1
  const time = useMemo(
    () => timeAxis(rows, hours, Math.min(zoom?.[0] ?? 0, last), Math.min(zoom?.[1] ?? last, last)),
    [rows, hours, zoom, last],
  )
  const brushed = useCallback(
    (r: { startIndex?: number; endIndex?: number }) => onZoom([r.startIndex ?? 0, r.endIndex ?? last]),
    [onZoom, last],
  )

  return (
    <ResponsiveContainer>
      <ComposedChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis {...time} />
        {/* Not anchored at zero: these lines live in a narrow band far from
            it, and zero flattens every wobble. */}
        {spread ? (
          <YAxis unit="ms" width={52} scale="sqrt" domain={[0, "auto"]} {...AXIS} />
        ) : (
          <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
        )}
        <Tooltip {...TOOLTIP} formatter={latencyTip} />
        {/* Behind the line, the range that bucket's answers spanned --
            Smokeping's "smoke". At the day window a bucket moves 63 ms at the
            90th percentile against the 25 ms the trend moves, so a line alone
            draws the smaller of the two.

            Only with one probe on screen: rendered for four, the bands overlap
            into a fog and their extremes drag the axis from 165-385 out to
            140-420. */}
        {probes.length === 1 &&
          probes.map((s) => (
            <Area
              key={`band${s.id}`}
              dataKey={`${smooth ? "c" : "b"}${s.id}`}
              stroke="none"
              fill={style(s.id).stroke}
              fillOpacity={0.16}
              isAnimationActive={false}
              tooltipType="none"
              legendType="none"
              connectNulls
            />
          ))}
        {probes.map((s) => (
          <Line
            key={s.id}
            dataKey={`${smooth ? "s" : "t"}${s.id}`}
            name={s.name}
            stroke={style(s.id).stroke}
            strokeDasharray={style(s.id).dash}
            {...SERIES}
            connectNulls
          />
        ))}
        {/* Drag either handle to zoom into a stretch of the trend. */}
        <Brush
          dataKey="ts"
          height={22}
          travellerWidth={8}
          tickFormatter={clockFor(hours)}
          fill="var(--muted)"
          stroke="var(--ring)"
          onChange={brushed}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
})
