import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { daysLeft, monthUsage } from "@/components/NodeCard"
import { LatencyChart, type PingRow } from "@/components/detail/LatencyChart"
import { ResourceCharts, ResourceSkeleton } from "@/components/detail/ResourceCharts"
import {
  CHART_MARGIN, isDense, PALETTE, pct, Placeholder, RING, Swatch, axisWidth, binaryAxis, useNarrow,
} from "@/components/detail/chart"
import { history, type Node } from "@/lib/api"
import { PingConfig, PingSummaryLines, probeLines, useNodePing } from "@/components/CardPing"
import { convert, remaining, type Rates } from "@/lib/cost"
import {
  axisTop, bytes, cycle, despike, quarters, rollingMean, cpuName, FOREVER, money, osName, pair,
  RATE_FLOOR, sinceSeen, snugRateAxis, windows, withGaps,
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

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const
type TabKey = (typeof TABS)[number]["key"]

/**
 * A history response and what it was asked for. Kept per tab, so a new range or
 * a retry can leave the last answer on screen, dimmed, until the next one
 * arrives, instead of collapsing the page to a placeholder and clamping the
 * reader's scroll; and so going back to a tab draws what it already has rather
 * than asking the hub for the same window again. `at` is when it arrived, by the
 * visitor's clock, which only times the next refresh.
 */
type Loaded = { node: number; hours: number; attempt: number; history: History; failed: string; at: number }

const EMPTY: History = { metrics: [], ping: [], probes: {} }

/** How many slices the availability strip is drawn in, at most: half on a phone, where 96 read as a barcode. */
const UPTIME_SLICES = 96
const UPTIME_SLICES_NARROW = 48

// The latency chart's height: tall enough to read on a laptop and to keep the
// probe chips beneath it within a 900 px window, and bounded on a tall screen.
// Fixed rather than measured from where the chart starts, which left it 288 px
// high at 1440 x 900 and pushed the chips below the fold.
const LATENCY_HEIGHT = "h-[clamp(18rem,45svh,28rem)]"

/**
 * The span of time the charts cover: the window asked for, ending where the
 * history does, or for a node not reporting, where it would have -- the time
 * since its last report belongs to the window too, and drawn to the data alone
 * an hour of six stretched across the panel as if it were all of them. Counted
 * in whole buckets by the hub's clock (see `gone`), so a live push does not move
 * it.
 */
function windowOf(last: number | undefined, hours: number, step: number | undefined, gone: number): [number, number] {
  const end = last === undefined ? 0 : last + gone * (step ?? 0) * 1_000
  return [end - hours * 3_600_000, end]
}

/**
 * How many samples of a probe's own series make up seven minutes of neighbours.
 *
 * The window the filter judges against has to be a duration, not a count: the
 * hub buckets a window to the `points` asked for below, so the same day arrives
 * as two-minute buckets on a desktop and four-minute ones on a phone, and a fixed
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

function Fact({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-dashed py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="tnum min-w-0 text-right text-[13px] break-words">{value}</dd>
    </div>
  )
}

/**
 * A fact's parts joined by " · ", each kept whole: a narrow column breaks
 * between them, never inside one -- not "TCP 15 · UDP" over "4", nor a kernel
 * name split at its hyphen. Null when every part is empty.
 */
function parts(...items: (string | undefined | null)[]): React.ReactNode {
  const kept = items.filter((s): s is string => !!s)
  if (!kept.length) return null
  return kept.map((s, i) => (
    <span key={i}>
      {i > 0 && " · "}
      <span className="whitespace-nowrap">{s}</span>
    </span>
  ))
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

// The series of a resource row a dot can mark, by key.
const RESOURCE_KEYS = ["cpu", "mem_used", "swap_used", "rx", "tx", "disk_used", "tcp", "udp", "procs"] as const

/**
 * `historyDays` is how far back the hub keeps history. Both tabs offer every
 * window within it: up to a day each ping is on the latency chart, and past it a
 * point is a bucket -- its median, the range its answers spanned and the share
 * lost -- which over a month shows a route's evening pattern a day cannot.
 *
 * `price` is the operator's `show_price` setting.
 */
export function NodeDetail({ node, historyDays, price, rates, primary, tab: controlledTab, onTab }: {
  node: Node
  historyDays: number
  price: boolean
  rates: Rates
  primary: "CNY" | "USD"
  tab?: TabKey
  onTab?: (tab: TabKey) => void
}) {
  const ranges = useMemo(() => windows(historyDays), [historyDays])
  const [localTab, setLocalTab] = useState<TabKey>(controlledTab ?? "resources")
  const tab = controlledTab ?? localTab
  const setTab = useCallback((next: TabKey) => {
    setLocalTab(next)
    onTab?.(next)
  }, [onTab])
  // Defer mounting heavy Recharts trees until one frame after initial route
  // commit so the facts card & cross-fade land without a long frame.
  const [chartsMounted, setChartsMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setChartsMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  // Each tab keeps its own range: a 7-day trend and a 1-hour trace answer
  // different questions.
  const [picked, setPicked] = useState({ resources: 6, latency: 6 })
  const hours = picked[tab]
  const [smooth, setSmooth] = useState(false)
  // Probes switched off. Hiding a slow one is what makes the fast ones readable,
  // as the axis rescales to what remains.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  // What has arrived, per tab. The ref is what the fetch reads, so a refresh
  // does not have to list the state among its dependencies and run again on
  // every answer; the state is what renders.
  const cache = useRef<Partial<Record<TabKey, Loaded>>>({})
  const [loaded, setLoaded] = useState<Partial<Record<TabKey, Loaded>>>({})
  const [attempt, setAttempt] = useState(0)
  // Counts the timed refreshes, each of which runs the fetch again.
  const [tick, setTick] = useState(0)
  // New history is drawn in a transition: five charts of several hundred points
  // each take long enough to drop frames, and the old ones stay on screen
  // meanwhile -- dimmed for a new window (see `stale`), as they are for a
  // refresh of the same one.
  const [, startDrawing] = useTransition()
  const narrow = useNarrow()
  const entry = loaded[tab]
  // Another node's history is never shown in this one's place, dimmed or not.
  const current = entry?.node === node.id ? entry : undefined
  const data = current?.history ?? null
  // The range the history on screen was asked for. The charts are given this
  // rather than the range just picked, or a click would first redraw all five
  // with the old rows on the new range's axis, which is a long frame spent on a
  // picture nobody sees.
  const shownHours = current?.hours ?? hours
  // Retained rather than folded into an empty result: a refused request and an
  // empty window are different answers, and the hub has reason to refuse this one
  // -- it caps how many history windows it builds concurrently. Rendered as an
  // empty window, a 503 would misdirect the reader.
  const failed = current?.failed ?? ""
  // What is on screen answers an earlier question, and the new answer is in
  // flight.
  const stale = !!current && (current.hours !== hours || current.attempt !== attempt)

  // The width the charts are drawn across, which sets how many points to ask
  // for and how many time labels fit. Rounded to 8 px so a scrollbar's arrival
  // does not redraw the charts for a label count that cannot have changed.
  const area = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.clientWidth / 8) * 8)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  // The resource panels sit two across from `lg`, 40 px apart. Read from the
  // viewport as the breakpoint is; `width` changing is what re-renders this.
  const panelWidth = tab === "resources" && innerWidth >= 1024 ? (width - 40) / 2 : width
  const plot = Math.max(120, panelWidth - axisWidth(narrow) - CHART_MARGIN.right)
  // A panel spanning both columns, as the last one in an even place does.
  const widePlot = panelWidth === width ? null : Math.max(120, width - axisWidth(narrow) - CHART_MARGIN.right)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const cached = cache.current[tab]
    const same = cached?.node === node.id && cached.hours === hours && cached.attempt === attempt
    // A refused window waits for the reader's retry rather than being asked for
    // again on a timer.
    if (same && cached.failed) return
    // Refreshed every bucket, and at most once a minute, the hub's own rate:
    // fetched only on a change of range, a page left open showed the morning's
    // history all afternoon. Paused while the tab is hidden and caught up on return.
    const every = Math.max(60, cached?.history.step ?? 60) * 1_000
    let onVisible: (() => void) | undefined
    const cleanup = () => {
      active = false
      clearTimeout(timer)
      if (onVisible) {
        document.removeEventListener("visibilitychange", onVisible)
        onVisible = undefined
      }
    }
    const later = (ms: number) => {
      clearTimeout(timer)
      if (onVisible) {
        document.removeEventListener("visibilitychange", onVisible)
        onVisible = undefined
      }
      timer = setTimeout(() => {
        if (!active) return
        if (document.hidden) {
          onVisible = () => {
            if (!document.hidden && active) {
              document.removeEventListener("visibilitychange", onVisible!)
              onVisible = undefined
              setTick((n) => n + 1)
            }
          }
          document.addEventListener("visibilitychange", onVisible)
        } else {
          setTick((n) => n + 1)
        }
      }, ms)
    }
    if (same && Date.now() - cached.at < every) {
      later(cached.at + every - Date.now())
      return cleanup
    }
    // A refresh replaces the window in place, undimmed; a failed one keeps
    // what is drawn and tries again at the next bucket.
    const refresh = same
    const settle = (answer: History, failed = "") => {
      if (!active) return
      // An answer no different from the one drawn keeps the one drawn, whose
      // rows the charts already hold: handed an equal copy, all five would
      // redraw for nothing.
      const history = refresh && cached && JSON.stringify(answer) === JSON.stringify(cached.history) ? cached.history : answer
      const next = { ...cache.current, [tab]: { node: node.id, hours, attempt, history, failed, at: Date.now() } }
      cache.current = next
      startDrawing(() => setLoaded(next))
      if (!failed) later(Math.max(60, history.step ?? 60) * 1_000)
    }
    // About one point per pixel of the plot. Asked for in device pixels, a
    // retina laptop drew 1,440 points a panel, five panels at once, for detail
    // finer than a line's own width; and the hub's band carries every peak a
    // coarser bucket would otherwise average away.
    //
    // The tab determines which half is requested; the other accounted for a third
    // to two thirds of every response and was never drawn.
    //
    // Half that for the resources over a day or more, which arrive as five
    // panels, each redrawn whole with every answer: at a point a pixel, a day's
    // five took 1.8-2.2 s of long frames in development. Two pixels a point
    // still draws every swing a reader can see at that span, and the peaks a
    // coarser bucket averages away are in its band.
    const across = area.current?.clientWidth || innerWidth - 64
    const panel = tab === "resources" && innerWidth >= 1024 ? (across - 40) / 2 : across
    const per = tab === "resources" && hours >= 24 ? 2 : 1
    const points = Math.min(1440, Math.max(60, Math.round(panel / per)))
    const series = tab === "latency" ? "ping" : "metrics"
    history<History>(`/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=${series}`, true)
      .then((next) => settle(next))
      .catch((e: Error) => {
        if (!active) return
        if (refresh) later(every)
        else settle(EMPTY, e.message)
      })
    return cleanup
  }, [node.id, hours, tab, attempt, tick])

  // What the screen shows, and when it was last painted. The charts stay
  // dimmed until a frame after the new ones are committed: recharts lays out in
  // its own effects after React's commit, and undimmed at the commit, the old
  // picture brightened for the length of that layout before it changed.
  const shownKey = current ? `${tab}:${current.node}:${current.hours}:${current.attempt}` : ""
  const [painted, setPainted] = useState("")
  useEffect(() => {
    if (!shownKey) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPainted(shownKey))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [shownKey])
  // The resource panels take a new answer one at a time, and report which
  // once the last of them holds it; until then the picture is part old and
  // part new, and stays dimmed. Reported by its key rather than its rows: a
  // refresh brings new rows for the same window, which the panels take in the
  // same way but which is no reason to dim -- it did, for 1-1.6 s a minute.
  const [drawnStage, setDrawnStage] = useState("")
  // Where the latency chart puts its zoom's controls, in the row above.
  const [zoomSlot, setZoomSlot] = useState<HTMLElement | null>(null)

  // The tallest the chart area has been during this visit to this node, which
  // it is not drawn shorter than. The latency tab is some 250 px shorter than
  // the resources, and the placeholders shorter again: switching to it at the
  // foot of the page shrank the page under the reader, the browser clamped the
  // scroll, and everything jumped. Forgotten for another node, or another
  // width, at which the tabs' heights are different ones.
  const floorKey = `${node.id}:${width}`
  const [floor, setFloor] = useState({ key: "", height: 0 })
  const region = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = content.current
    if (!el) return
    const watch = new ResizeObserver(() => {
      const height = el.offsetHeight
      // As far as the page runs on below the window, the floor can go when
      // the content shrinks: the page then shortens by no more than it can
      // without the browser clamping the scroll, so nothing jumps. At the top
      // of the page that is all of it, which left 280 px of blank under the
      // latency chart at 1440 x 900; scrolled to the foot, none of it.
      const room = Math.max(0, document.documentElement.scrollHeight - innerHeight - scrollY)
      setFloor((f) => {
        const held = f.key === floorKey ? f.height : 0
        if (height >= held) return height === held ? f : { key: floorKey, height }
        const next = Math.max(height, held - room)
        return next === held ? f : { key: floorKey, height: next }
      })
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [floorKey])
  // Let go of as the reader scrolls back up, down to what still reaches the
  // bottom of the window: the page then shortens only out of sight, which
  // moves nothing on screen, and a phone, where the resources are a column of
  // five panels, is not left with a screen of blank under the latency chart.
  useEffect(() => {
    let frame = 0
    const relax = () => {
      frame = 0
      const outer = region.current
      const inner = content.current
      if (!outer || !inner) return
      const reach = Math.ceil(innerHeight - outer.getBoundingClientRect().top)
      setFloor((f) => {
        if (f.key !== floorKey || f.height <= inner.offsetHeight) return f
        const height = Math.max(inner.offsetHeight, Math.min(f.height, reach))
        return height === f.height ? f : { key: floorKey, height }
      })
    }
    const scrolled = () => {
      frame ||= requestAnimationFrame(relax)
    }
    addEventListener("scroll", scrolled, { passive: true })
    return () => {
      removeEventListener("scroll", scrolled)
      cancelAnimationFrame(frame)
    }
  }, [floorKey])
  const minHeight = floor.key === floorKey ? floor.height : 0

  const m = node.metrics
  // One series per probe that reported, labelled from the names the samples
  // arrived with. Memoised, as are the ones below: the node prop changes every
  // few seconds as live metrics arrive, and rebuilding the charts' data on those
  // renders would redraw them.
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
  const probeOrder = useMemo(() => pingSeries.map((s) => s.id), [pingSeries])

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
  // What the panels draw: the rows above, broken where the node was silent, and
  // each row with a gap on either side flagged per series. Such a row has no
  // neighbour to draw a line to, so it is marked with a dot; without one, a node
  // back for a single bucket after a stretch offline would not show at all.
  // Flagged here, once per answer, rather than tested by a dot callback recharts
  // ran for every point of every series on every draw.
  const { chartRows, solo } = useMemo(() => {
    const rows = withGaps(metricRows) as Record<string, unknown>[]
    const solo = new Set<string>()
    const has = (r: Record<string, unknown> | undefined, k: string) => r?.[k] !== undefined && r[k] !== null
    rows.forEach((r, i) => {
      for (const k of RESOURCE_KEYS) {
        if (has(r, k) && !has(rows[i - 1], k) && !has(rows[i + 1], k)) {
          r.solo = { ...(r.solo as object), [k]: true }
          solo.add(k)
        }
      }
    })
    return { chartRows: rows as { ts: number }[], solo }
  }, [metricRows])
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
      rate: snugRateAxis(
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

  // The span each tab's chart covers, from the end of its own history.
  const lastMetric = metricRows.length ? metricRows[metricRows.length - 1].ts : undefined
  const resourceWindow = useMemo(
    () => windowOf(lastMetric, shownHours, step, gone),
    [lastMetric, shownHours, step, gone],
  )

  // The share of the window the node was reporting, from how many minutes of
  // each bucket have data. Buckets the hub sent nothing for are minutes away as
  // well, and so is the time since a node that has stopped reporting was last
  // heard from. While it is reporting, the last bucket is still being filled, so
  // it is left out: short there does not mean offline. Counted from the first
  // bucket with data rather than from the window's start, before which the node
  // may simply not have existed.
  //
  // The strip's slices cover the charts' own window, so a slice sits over the
  // stretch of the plots it describes; one before the first bucket has no
  // record rather than an outage.
  //
  // An agent reporting less often than once a minute fills fewer minutes than
  // it was up for, and reads low here; nothing in the response says so.
  const slicesMax = narrow ? UPTIME_SLICES_NARROW : UPTIME_SLICES
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
    const [from, to] = resourceWindow
    const count = Math.max(1, Math.min(slicesMax, Math.round((to - from) / 1_000 / step)))
    // The bucket a moment falls in, by its start.
    const at = (ms: number) => (ms / 1_000 - first) / step
    const slices = Array.from({ length: count }, (_, s) => {
      const a = from + ((to - from) * s) / count
      const b = from + ((to - from) * (s + 1)) / count
      let lo = Math.ceil(at(a) - 1e-9)
      let hi = Math.ceil(at(b) - 1e-9)
      // A slice narrower than a bucket takes the one it lies in.
      if (hi <= lo) [lo, hi] = [Math.floor(at((a + b) / 2)), Math.floor(at((a + b) / 2)) + 1]
      lo = Math.max(0, lo)
      hi = Math.min(buckets, hi)
      let sum = 0
      for (let i = lo; i < hi; i++) sum += share[i]
      return { up: hi > lo ? sum / (hi - lo) : null, from: a, to: b }
    })
    return { up: share.reduce((sum, v) => sum + v, 0) / buckets, slices }
  }, [data, step, node.online, gone, slicesMax, resourceWindow])

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
  // they are on screen, so hiding a probe or enabling despiking selects a
  // `dataKey` rather than rebuilding the array, which recharts would take as new
  // data and reset the brush for.
  const pingRows = useMemo(() => {
    const rows = new Map<number, PingRow>()
    for (const s of pingSeries) {
      const windowSize = despikeWindow(s.points)
      const smoothed = despike(s.points.map((p) => p.latency), windowSize)
      // The trend: a mean of the despiked samples over about a thirtieth of the
      // window, so a series swinging 35-57 ms from one bucket to the next still
      // reads as a level.
      const trend = rollingMean(smoothed, Math.max(5, Math.round(s.points.length / 30)) | 1)
      // The band spans the same outliers as the line, and with one probe on
      // screen it is what the axis is fitted to, so it is clipped alongside it
      // rather than left to pull the axis back open. The latency fills the
      // buckets that carry no band, keeping each filter's window dense.
      const lo = despike(s.points.map((p) => p.band?.[0] ?? p.latency), windowSize)
      const hi = despike(s.points.map((p) => p.band?.[1] ?? p.latency), windowSize)
      s.points.forEach((p, i) => {
        const row: PingRow = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i]
        row[`m${s.id}`] = trend[i]
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
  const lastPing = pingRows.length ? pingRows[pingRows.length - 1].ts : undefined
  const latencyWindow = useMemo(
    () => windowOf(lastPing, shownHours, step, gone),
    [lastPing, shownHours, step, gone],
  )
  // The chips' swatches follow the lines: dashed only where the lines are.
  const denseProbes = useMemo(() => isDense(pingRows, latencyWindow, plot), [pingRows, latencyWindow, plot])

  const staging = tab === "resources" && !failed && !!data && data.metrics.length > 0 && drawnStage !== shownKey
  // Dimmed for a new node, range, tab or retry only: the key is the same
  // across a refresh, which is redrawn in place.
  const dim = !!data && (stale || painted !== shownKey || staging)

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
  // The latest round trip to each chosen probe, a line among the facts; the
  // same history the node's card draws its strips from (CardPing.tsx).
  const pingSettings = useContext(PingConfig)
  const pingEntry = useNodePing(node.id, pingSettings.hours, pingSettings.show)
  const pingLines = useMemo(
    () => (pingSettings.show ? probeLines(pingEntry?.data, pingSettings.probes, pingSettings.hours) : []),
    [pingSettings.show, pingEntry?.data, pingSettings.probes, pingSettings.hours],
  )
  const openLatencyTab = useCallback(() => {
    setTab("latency")
    area.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [setTab])
  const pingNow = pingLines.length ? <PingSummaryLines lines={pingLines} onClick={openLatencyTab} /> : null
  const expired = days !== null && days < 0
  // The renewal line in parts, each kept whole on a line of its own: wrapped
  // anywhere, "到期" broke across two lines. A part after full-width
  // punctuation is set off by "· " alone, as "）" carries its own space.
  const renewal: { text: string; tone?: string }[] = [
    ...(price
      ? node.price > 0
        ? [
            { text: `${money(node.price, node.currency)} / ${cycle(node.billing_cycle)}` },
            ...(billedIn === "CNY" || billedIn === "USD" ? [] : [{ text: `（≈ ${both(node.price)}）` }]),
          ]
        : [{ text: "免费" }]
      : []),
    !node.expires_at
      ? { text: "长期" }
      : expired
        ? { text: `${node.expires_at} 已过期 ${-days} 天`, tone: "text-warn" }
        : { text: `${node.expires_at} 到期` },
  ]

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
        <Fact label="系统" value={parts(osName(node.os), node.kernel)} />
        <Fact
          label="CPU"
          value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
        />
        <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Fact
          label="架构"
          value={parts(node.arch, node.virt !== "none" ? node.virt : "", m ? `${m.procs} 进程` : "")}
        />
        <Fact label="负载" value={m ? m.load.map((n) => n.toFixed(2)).join(" · ") : null} />
        <Fact
          label="Swap / 连接"
          value={
            m
              ? parts(node.swap_total > 0 ? pair(m.swap_used, node.swap_total) : "", `TCP ${m.tcp}`, `UDP ${m.udp}`)
              : null
          }
        />
        <Fact label="主机名 / 地址" value={parts(node.hostname, node.ip)} />
      </Facts>
      <div className="min-w-0 space-y-6">
      <Facts title="流量">
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact
          label="本期流量"
          value={[
            node.traffic_limit > 0 ? pair(used, node.traffic_limit) : `${bytes(used)} · ${FOREVER}`,
            node.traffic_limit > 0 ? (TRAFFIC_MODES[node.traffic_mode] ?? "") : "",
          ].filter(Boolean).join(" · ")}
        />
        <Fact label="累计流量" value={`↓ ${bytes(node.total_rx)} · ↑ ${bytes(node.total_tx)}`} />
        <Fact label="延迟" value={pingNow} />
      </Facts>
      <Facts title={price ? "费用" : "到期"}>
        <Fact
          label={price ? "续费" : "到期"}
          value={renewal.map((part, i) => (
            <span key={i}>
              {i > 0 && (part.text.startsWith("（") ? "" : renewal[i - 1].text.endsWith("）") ? "· " : " · ")}
              <span className={`whitespace-nowrap ${part.tone ?? ""}`}>{part.text}</span>
            </span>
          ))}
        />
        {/* Said when the term runs out today or has run out, rather than the
            line going without a word: what is left of such a plan is nothing. */}
        <Fact
          label="剩余价值"
          value={
            worth !== null ? (
              `${both(worth)} · 剩 ${days} 天`
            ) : price && days !== null && days <= 0 && node.price > 0 ? (
              <span className="text-warn">{days === 0 ? "今天到期" : `已过期 ${-days} 天`}</span>
            ) : null
          }
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

      {/* What the charts show, then over how long: the two read as different
          kinds of control. The tabs are underlined headings across the card,
          the ranges smaller pills beneath -- drawn alike, the two rows read as
          one control wrapped onto a second line. */}
      <div ref={area} id="node-charts" className="space-y-3 scroll-mt-4 border-t pt-3">
        {/* A tablist as the pattern has it: one tab stop, the arrows, Home and
            End moving between the tabs and choosing as they go. */}
        <div
          role="tablist"
          aria-label="图表"
          className="flex gap-5 border-b"
          onKeyDown={(e) => {
            const at = TABS.findIndex((t) => t.key === tab)
            const to =
              e.key === "ArrowRight" ? (at + 1) % TABS.length
              : e.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length
              : e.key === "Home" ? 0
              : e.key === "End" ? TABS.length - 1
              : -1
            if (to < 0) return
            e.preventDefault()
            setTab(TABS[to].key)
            // Without scrolling: the next tab is in the row the reader is on,
            // and focus's own scroll moved the page 21 px at its foot.
            document.getElementById(`node-tab-${TABS[to].key}`)?.focus({ preventScroll: true })
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              id={`node-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls="node-tabpanel"
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`-mb-px inline-flex min-h-9 items-center border-b-2 px-0.5 text-sm transition-colors sm:min-h-8 ${RING} ${
                tab === t.key
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Seven equal columns on a phone, so 1 年 does not drop to a row of
              its own; spaced pills above it. */}
          <div role="group" aria-label="时间范围" className="grid w-full grid-cols-7 gap-0.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-1">
            {ranges.map((r) => (
              <button
                key={r.hours}
                type="button"
                aria-pressed={hours === r.hours}
                onClick={() => setPicked((all) => ({ ...all, [tab]: r.hours }))}
                className={`inline-flex min-h-9 items-center justify-center rounded-full px-0 text-xs whitespace-nowrap transition-colors sm:min-h-6 sm:px-2.5 ${RING} ${
                  hours === r.hours
                    ? "bg-muted text-foreground ring-1 ring-border"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {tab === "latency" && (
            // A switch rather than the browser's own checkbox, which drew in the
            // system's colours at 13 px, too small to tap on a phone.
            <button
              type="button"
              role="switch"
              aria-checked={smooth}
              onClick={() => setSmooth((s) => !s)}
              data-tip="滤掉偶发的单点尖峰"
              className={`inline-flex min-h-9 items-center gap-2 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground sm:min-h-6 ${RING}`}
            >
              <span
                aria-hidden
                className={`relative h-4 w-7 rounded-full transition-colors ${smooth ? "bg-primary" : "bg-muted ring-1 ring-border ring-inset"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-3 rounded-full shadow-sm transition-transform ${
                    smooth ? "translate-x-3 bg-primary-foreground" : "bg-muted-foreground/70"
                  }`}
                />
              </span>
              削峰
            </button>
          )}
          {/* The latency chart's zoom, when there is one: its span and the
              button that resets it, here rather than over the plot. */}
          {tab === "latency" && <span ref={setZoomSlot} className="contents" />}
        </div>
      </div>

      {/* The floor is held by an outer box and measured on an inner one, which
          is the content's own height. */}
      <div
        ref={region}
        id="node-tabpanel"
        role="tabpanel"
        aria-labelledby={`node-tab-${tab}`}
        style={minHeight ? { minHeight } : undefined}
      >
      <div ref={content}>
        {!data || !chartsMounted ? (
          tab === "latency" ? (
            // The chart's height and a row of chips, so the chart lands in the
            // space it held.
            <div className="space-y-3" aria-busy>
              <Skeleton className={`${LATENCY_HEIGHT} w-full`} />
              <Skeleton className="mx-auto h-7 w-64" />
            </div>
          ) : (
            <ResourceSkeleton />
          )
        ) : (
          // The last answer stays on screen while the next is in flight and
          // being drawn, dimmed so the reader can tell it is about to change.
          <div aria-busy={dim} className={`transition-opacity duration-300 ${dim ? "opacity-60" : ""}`}>
            {failed ? (
              <Placeholder className={LATENCY_HEIGHT} tone="error">
                <span>读取历史数据失败：{failed}</span>
                <button
                  type="button"
                  className={`rounded-md border px-2.5 py-1 text-xs text-foreground hover:bg-muted ${RING}`}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  重试
                </button>
              </Placeholder>
            ) : tab === "latency" ? (
              pingSeries.length === 0 ? (
                <Placeholder className={LATENCY_HEIGHT}>这段时间没有延迟数据</Placeholder>
              ) : (
                <div className="space-y-3">
                  <div className={`w-full text-muted-foreground ${LATENCY_HEIGHT}`}>
                    {shownProbes.length === 0 ? (
                      <Placeholder className="h-full">没有选中任何探测</Placeholder>
                    ) : (
                      <LatencyChart
                        // A new node or range starts unzoomed.
                        key={`${node.id}:${shownHours}`}
                        rows={pingRows}
                        window={latencyWindow}
                        plot={plot}
                        narrow={narrow}
                        probes={shownProbes}
                        order={probeOrder}
                        style={style}
                        spread={spread}
                        smooth={smooth}
                        hours={shownHours}
                        controls={zoomSlot}
                      />
                    )}
                  </div>

                  {/* Under the chart: what it covers is picked at the top, what
                      is drawn in it is picked here. */}
                  {(pingSeries.length > 1 || pingSeries.some((s) => s.loss > 0)) && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {pingSeries.map((s) => {
                        const shown = !hiddenProbes.includes(s.id)
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={shown}
                            onClick={() =>
                              setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
                            }
                            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-xs transition-opacity sm:min-h-7 ${RING} ${
                              shown ? "" : "opacity-40"
                            }`}
                          >
                            {/* The swatch carries the same colour and dash as the line. */}
                            <Swatch color={style(s.id).stroke} dash={denseProbes ? undefined : style(s.id).dash} />
                            {s.name}
                            {/* The line is only what answered, so a probe dropping
                                half its packets draws like a healthy one. */}
                            {s.loss > 0 && (
                              <span className="tnum opacity-60">
                                丢 {pct(s.loss < 1 ? "<1" : Math.round(s.loss))}
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
              <Placeholder className={LATENCY_HEIGHT}>这段时间没有历史数据</Placeholder>
            ) : (
              <ResourceCharts
                rows={chartRows}
                window={resourceWindow}
                plot={plot}
                widePlot={widePlot}
                narrow={narrow}
                solo={solo}
                axes={axes}
                peak={peak}
                has={has}
                availability={availability}
                hours={shownHours}
                memTotal={node.mem_total}
                swapTotal={node.swap_total}
                diskTotal={node.disk_total}
                stage={shownKey}
                onDrawn={setDrawnStage}
              />
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

/** How a plan counts traffic against its quota. */
const TRAFFIC_MODES: Record<string, string> = { sum: "双向", up: "仅上行", down: "仅下行", max: "上下行取大" }
