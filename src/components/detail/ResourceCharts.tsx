import { memo, useEffect, useMemo, useState, type ComponentProps, type PointerEvent } from "react"
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Skeleton } from "@/components/ui/skeleton"
import { axisBytes, bytes, clockFor, rate } from "@/lib/format"
import {
  axisWidth, AXIS, CHART_MARGIN, decimalAxis, isDense, keepTogether, Panel, pct, readoutFor, SERIES, soloDot, sortBy, timeAxis,
  tooltipFor, unitTick,
} from "./chart"

// The range a bucket reached above its mean, drawn behind the line. Edged
// because a one-minute burst on a day's axis is narrower than a pixel, where a
// fill alone does not show; the edge is solid and faint rather than dashed, as a
// dash over hundreds of buckets drew the panel as a grey wall of dots. Never
// marked under the cursor: its dot sat on the band's edge with no label in the
// tooltip to say what it was.
const PEAK_BAND = {
  strokeWidth: 1,
  strokeOpacity: 0.3,
  fillOpacity: 0.12,
  activeDot: false as const,
  dot: false as const,
  isAnimationActive: false,
  tooltipType: "none" as const,
  legendType: "none" as const,
}

// Each panel's series in the order of its key, which is the order the tooltip
// lists them in too.
const MEM_ORDER = sortBy(["mem_used", "swap_used"])
const NET_ORDER = sortBy(["rx", "tx"])
const COUNT_ORDER = sortBy(["tcp", "udp", "procs"])
const NET_KEYS = [{ label: "下行", color: "var(--color-rx)" }, { label: "上行", color: "var(--color-tx)" }]

// The panels share one cursor, by row: their widths are unified so that a CPU
// spike and the network burst behind it sit at the same x, and the cursor in
// each then points at the same minute. Not on a phone, where the panels are a
// column taller than the screen and a tap opened a readout in all five.
const SYNC = "node-resources"
const syncOf = (narrow: boolean) => (narrow ? undefined : SYNC)

type TipFormatter = NonNullable<ComponentProps<typeof Tooltip>["formatter"]>

// The tooltips' formatters live out here rather than inline, where each render
// would hand recharts a new function and have it redraw every panel for it.
const bytesTip: TipFormatter = (v) => bytes(Number(v))

const cpuTip: TipFormatter = (v, _name, item) => {
  const top = item?.payload?.cpu_max
  const mean = pct(Number(v).toFixed(1))
  return [top === undefined ? mean : `均值 ${mean} · 峰值 ${pct(Number(top).toFixed(1))}`, "CPU"]
}

// The hub's figures rather than `v`, which is lifted to the axis floor.
const rateTip: TipFormatter = (_, name, item) => {
  const mean = item?.payload?.[`net_${item.dataKey}`]
  const top = item?.payload?.[`net_${item.dataKey}_max`]
  return [top === undefined ? rate(mean) : `均值 ${rate(mean)} · 峰值 ${rate(top)}`, name]
}

// A phone's one-line readouts (see `readoutFor`): the bucket's means, which is
// what the line draws, and its peaks where they fit beside them. A row the gaps
// put in carries no values.
const num = (v: unknown) => (typeof v === "number" ? v : undefined)
const cpuText = (r: Record<string, unknown>) => {
  const cpu = num(r.cpu)
  if (cpu === undefined) return "无数据"
  const top = num(r.cpu_max)
  return `CPU ${pct(cpu.toFixed(1))}${top === undefined ? "" : ` · 峰值 ${pct(top.toFixed(1))}`}`
}
const memText = (r: Record<string, unknown>) => {
  const used = num(r.mem_used)
  if (used === undefined) return "无数据"
  const swap = num(r.swap_used)
  return `内存 ${bytes(used)}${swap === undefined ? "" : ` · Swap ${bytes(swap)}`}`
}
const memTextNoSwap = (r: Record<string, unknown>) => {
  const used = num(r.mem_used)
  return used === undefined ? "无数据" : `内存 ${bytes(used)}`
}
const netText = (r: Record<string, unknown>) => {
  const rx = num(r.net_rx)
  const tx = num(r.net_tx)
  return rx === undefined || tx === undefined ? "无数据" : `网络 ↓ ${rate(rx)} ↑ ${rate(tx)}`
}
const diskText = (r: Record<string, unknown>) => {
  const used = num(r.disk_used)
  return used === undefined ? "无数据" : `硬盘 ${bytes(used)}`
}
const countText = (r: Record<string, unknown>) => {
  const [tcp, udp, procs] = [num(r.tcp), num(r.udp), num(r.procs)]
  return tcp === undefined && procs === undefined ? "无数据" : `TCP ${tcp ?? "—"} · UDP ${udp ?? "—"} · 进程 ${procs ?? "—"}`
}

/**
 * The tooltip a panel draws: its title row's readout, on a phone and on a
 * desktop alike. A floating box, wherever it was pinned, sat over some of the
 * lines -- the CPU's peak band runs along the plot's top. On a desktop the
 * panels stay in step (`syncId`), so each shows the same minute in its own row.
 */
function tipOf(d: Draw, key: string, text: (r: Record<string, unknown>) => string) {
  return { ...tooltipFor(d.hours), content: readoutFor(key, d.hours, text) }
}

const countTick = (v: number) => (v % 1 ? v.toFixed(1) : String(v))
const percentTick = (v: number) => pct(v)
const rateTick = (v: number) => keepTogether(`${axisBytes(v)}/s`)
const rateTickNarrow = (v: number) => keepTogether(axisBytes(v))

// The resource panels' grid, so the placeholder can take its shape.
export const RESOURCE_GRID = "grid gap-x-10 gap-y-7 lg:grid-cols-2 lg:[&>*:last-child:nth-child(even)]:col-span-2"

/**
 * What stands in for the resource panels on the first load, at their height: an
 * `h-40` bar in place of five panels moved the page by 530px when they arrived.
 * The strip and five panels, each a 20px title row over a 160px chart.
 */
export function ResourceSkeleton() {
  return (
    <div className={RESOURCE_GRID} aria-busy>
      <Skeleton className="h-[52px] lg:col-span-2" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-[188px]" />
      ))}
    </div>
  )
}

type Rows = { ts: number }[]
type Axis = { domain: number[]; ticks: number[] }
/** `up` is a slice's share of reporting, null for a slice before the node's history begins. */
export type Availability = { up: number; slices: { up: number | null; from: number; to: number }[] } | null

/**
 * One answer's worth of everything the panels draw, built once per change of
 * the props: the time axis and the dash decision are shared by all five, so
 * they are worked out here rather than once per panel per render.
 */
type Draw = {
  rows: Rows
  plot: number
  narrow: boolean
  solo: ReadonlySet<string>
  axes: { cpu: Axis; mem: Axis; counts: Axis; rate: Axis }
  peak: { cpu: number | null; net: { rx: number; tx: number } | null }
  has: { swap: boolean; counts: boolean }
  availability: Availability
  hours: number
  memTotal: number
  swapTotal: number
  diskTotal: number
  time: ReturnType<typeof timeAxis>
  // Where a dash would break into confetti, the second and third lines of a
  // panel are told apart by colour alone.
  dense: boolean
  // The time axis and dash decision for a last panel spanning both columns,
  // laid out across that width; null where the panels are one column.
  wide: { time: ReturnType<typeof timeAxis>; dense: boolean } | null
  // Which answer this is. A refresh of the same window keeps it.
  stage: string
}

/** The time axis and dash decision a panel draws with: the full-width ones for a last panel that spans. */
const across = (d: Draw, last: boolean) => (last && d.wide ? d.wide : d)

/** Whether `d`'s last panel spans both columns: the grid widens a last panel in an even place (see `RESOURCE_GRID`). */
const lastSpans = (d: Draw) => d.wide !== null && ((d.availability ? 1 : 0) + 4 + (d.has.counts ? 1 : 0)) % 2 === 0

/**
 * Runs `run` once the page is idle after the next frame, and returns how to
 * call it off. Where there is no idle callback (Safari), a frame and a task.
 */
function afterIdle(run: () => void): () => void {
  let idle = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    if (typeof requestIdleCallback === "function") idle = requestIdleCallback(run, { timeout: 300 })
    else timer = setTimeout(run, 16)
  })
  return () => {
    cancelAnimationFrame(frame)
    if (idle) cancelIdleCallback(idle)
    clearTimeout(timer)
  }
}

/**
 * `value` for each of `count` later stages, each taking it once the one before
 * has drawn it, or undefined for a stage that has yet to draw anything.
 *
 * A panel's draw is a few thousand SVG nodes, and recharts does most of it not
 * in React's commit but over the animation frames after it, where its store
 * tells its charts what changed: given a new answer together, five panels did
 * that work in the same frames, one of 0.8-1 s in development. Handed on one
 * at a time, each when the page has gone idle after the last, every panel
 * draws in frames of its own, and the page can answer a click between them.
 */
function useStages<T>(value: T, count: number): (T | undefined)[] {
  const [shown, setShown] = useState<(T | undefined)[]>(() => Array(count).fill(undefined))
  const next = shown.findIndex((v) => v !== value)
  useEffect(() => {
    if (next < 0) return
    return afterIdle(() =>
      setShown((all) => {
        const copy = [...all]
        copy[next] = value
        return copy
      }),
    )
  }, [next, value])
  return shown
}

/** What stands in a panel's place for the frames before its first draw: its title row and chart, at their height. */
function PanelSkeleton() {
  return <Skeleton className="h-[188px]" />
}

type Series = Omit<typeof SERIES, "dot"> & { dot: false | typeof soloDot }

// A dot only on the series that need one; see `soloDot`. One props object per
// series and answer, so a panel's re-render hands recharts the same object.
const seriesCache = new WeakMap<ReadonlySet<string>, Map<string, Series>>()
function seriesOf(solo: ReadonlySet<string>, key: string): Series {
  let byKey = seriesCache.get(solo)
  if (!byKey) seriesCache.set(solo, (byKey = new Map()))
  let s = byKey.get(key)
  if (!s) byKey.set(key, (s = solo.has(key) ? { ...SERIES, dot: soloDot } : SERIES))
  return s
}

const valueAxis = (narrow: boolean) => ({ ...AXIS, width: axisWidth(narrow), interval: 0 as const })

/**
 * The window as one strip, left to right: green where the node was reporting
 * throughout, amber where for part of the slice, a muted red where not at all
 * -- muted, or a node offline for the whole window is a wall of alarm on a page
 * already saying so -- and the grid's grey before its history begins. A slice
 * here is many of the chart's points, so an outage too short to break a line
 * below still leaves its mark.
 *
 * Sliced over the charts' own window, and inset by the value axis's width on
 * the left and the plot's margin on the right, so its ends are the times the
 * plots below begin and end at.
 *
 * The slice under the pointer, or under a finger on a phone, which has no
 * hover, is read out in the title row in place of the window's figure. A
 * finger's stays until the next tap, which on the same slice clears it.
 */
const UptimeStrip = memo(function UptimeStrip({ availability, hours, narrow }: {
  availability: NonNullable<Availability>
  hours: number
  narrow: boolean
}) {
  const clock = clockFor(hours)
  const [at, setAt] = useState<number | null>(null)
  const slices = availability.slices
  const shown = at === null ? undefined : slices[at]
  const share = (up: number) => pct((Math.floor(up * 1000) / 10).toFixed(1))
  const indexOf = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return Math.min(slices.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * slices.length)))
  }
  return (
    <div className="lg:col-span-2">
      <h4 className="mb-2 flex h-5 items-center justify-between gap-3 text-xs leading-4 font-medium text-muted-foreground">
        <span className="shrink-0">在线率</span>
        {shown ? (
          <span className="tnum truncate text-foreground">
            {clock(shown.from)} – {clock(shown.to)} · {shown.up === null ? "无记录" : share(shown.up)}
          </span>
        ) : (
          <span className={`tnum ${availability.up < 0.99 ? "text-warn" : ""}`}>
            {/* Floored, never rounded up: a window with one minute away must
                not read 100 %. */}
            {pct((Math.floor(availability.up * 10000) / 100).toFixed(2))}
          </span>
        )}
      </h4>
      <div
        className="flex h-6 gap-px"
        style={{ marginLeft: CHART_MARGIN.left + axisWidth(narrow), marginRight: CHART_MARGIN.right }}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse") setAt(indexOf(e))
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setAt(null)
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return
          const i = indexOf(e)
          setAt((was) => (was === i ? null : i))
        }}
      >
        {slices.map((s, i) => (
          <span
            key={s.from}
            className={`min-w-0 flex-1 rounded-[1px] ${
              // Partial at three fifths: one amber slice at full strength in a
              // row of muted green drew the eye before the figure did.
              s.up === null ? "bg-muted" : s.up >= 0.999 ? "bg-online/55" : s.up > 0 ? "bg-warn/60" : "bg-hot/35"
            } ${i === at ? "outline outline-1 outline-foreground/60" : ""}`}
          />
        ))}
      </div>
    </div>
  )
})

/**
 * The line is the bucket's mean. Behind it, the band reaches the highest
 * reading within the bucket: a minute pinned at 100 % is a sixtieth of an
 * hour's mean, and would otherwise leave no trace on a month's chart. The mean
 * is a line without a fill of its own, which over the band's fill made the
 * panel one grey slab. The one panel reachable by keyboard: the others share
 * its cursor, and five tab stops of a bucket per arrow press were five ways to
 * get lost.
 */
const CpuPanel = memo(function CpuPanel({ d }: { d: Draw }) {
  return (
    <Panel title={d.peak.cpu === null ? "CPU" : `CPU · 峰值 ${pct(d.peak.cpu.toFixed(1))}`}>
      <ResponsiveContainer>
        <ComposedChart data={d.rows} syncId={syncOf(d.narrow)} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...d.time} />
          <YAxis {...d.axes.cpu} tickFormatter={percentTick} {...valueAxis(d.narrow)} />
          <Tooltip {...tipOf(d, "cpu", cpuText)} formatter={cpuTip} />
          <Area dataKey="cpu_band" stroke="var(--color-ink)" fill="var(--color-ink)" {...PEAK_BAND} />
          <Line dataKey="cpu" name="CPU" stroke="var(--color-ink)" {...seriesOf(d.solo, "cpu")} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
})

/**
 * The axis is anchored on the machine's memory, so the line's height is the
 * fraction in use whatever range is picked. Tracking the window's own maximum,
 * which is what an area chart does by default, puts 127 MB of a 457 MB box at
 * the top of the panel. The top is the memory rounded up to the next gridline,
 * so the ticks are whole sizes, all in one unit; the exact size is in the
 * title. Swap is a line across the same panel: it matters when memory is
 * short, which is where the two are read together.
 */
const MemoryPanel = memo(function MemoryPanel({ d }: { d: Draw }) {
  const tick = useMemo(() => unitTick(d.axes.mem.domain[1]), [d.axes.mem])
  const dash = d.dense ? undefined : "5 3"
  return (
    <Panel
      title={`内存 · ${bytes(d.memTotal)}${d.has.swap ? ` · Swap ${bytes(d.swapTotal)}` : ""}`}
      keys={d.has.swap ? [
        { label: "内存", color: "var(--color-chart-1)" },
        { label: "Swap", color: "var(--color-chart-3)", dash },
      ] : undefined}
    >
      <ResponsiveContainer>
        <ComposedChart data={d.rows} syncId={syncOf(d.narrow)} margin={CHART_MARGIN} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...d.time} />
          <YAxis {...d.axes.mem} tickFormatter={tick} {...valueAxis(d.narrow)} />
          <Tooltip {...tipOf(d, d.has.swap ? "mem" : "mem-", d.has.swap ? memText : memTextNoSwap)} formatter={bytesTip} itemSorter={MEM_ORDER} />
          <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...seriesOf(d.solo, "mem_used")} />
          {d.has.swap && (
            <Line dataKey="swap_used" name="Swap" stroke="var(--color-chart-3)" strokeDasharray={dash} {...seriesOf(d.solo, "swap_used")} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
})

/**
 * A rate has no total to be a fraction of, and its range spans orders of
 * magnitude: a week of one node runs from 0.2 KB/s idle to bursts of 70 MB/s.
 * Fitted to the bursts, a linear axis would draw the median minute less than a
 * pixel above the floor on seven of nine nodes at the day window, so this one
 * is logarithmic, each tenfold step the same height.
 *
 * The line is the bucket's mean, so it integrates to the traffic totals, and a
 * 15-second speed test averaged over its minute draws at a quarter of the rate
 * it ran at. The band behind it reaches the highest rate measured within the
 * bucket. Its lower edge lies under the line.
 */
const NetworkPanel = memo(function NetworkPanel({ d }: { d: Draw }) {
  return (
    <Panel
      title={d.peak.net ? `网络 · 峰值 ↓ ${rate(d.peak.net.rx)} ↑ ${rate(d.peak.net.tx)}` : "网络"}
      keys={NET_KEYS}
    >
      <ResponsiveContainer>
        <ComposedChart data={d.rows} syncId={syncOf(d.narrow)} margin={CHART_MARGIN} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...d.time} />
          {/* "/s" left off on a phone, where the axis is narrower and the
              title's peak already says it is a rate. */}
          <YAxis scale="log" {...d.axes.rate} tickFormatter={d.narrow ? rateTickNarrow : rateTick} {...valueAxis(d.narrow)} />
          <Tooltip {...tipOf(d, "net", netText)} formatter={rateTip} itemSorter={NET_ORDER} />
          {/* Water for what comes in, the koi's red for what goes out. */}
          <Area dataKey="rx_band" stroke="var(--color-rx)" fill="var(--color-rx)" {...PEAK_BAND} />
          <Area dataKey="tx_band" stroke="var(--color-tx)" fill="var(--color-tx)" {...PEAK_BAND} />
          <Line dataKey="rx" name="下行" stroke="var(--color-rx)" {...seriesOf(d.solo, "rx")} />
          <Line dataKey="tx" name="上行" stroke="var(--color-tx)" {...seriesOf(d.solo, "tx")} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
})

/**
 * The disk it is filling, for the same reason as memory: a node using 2.7 % of
 * its disk draws along the top of the panel when the axis tracks the window's
 * own maximum.
 */
const DiskPanel = memo(function DiskPanel({ d }: { d: Draw }) {
  const { time } = across(d, !d.has.counts && lastSpans(d))
  const disk = useMemo(() => decimalAxis(d.diskTotal), [d.diskTotal])
  const tick = useMemo(() => unitTick(disk.domain[1]), [disk])
  return (
    <Panel title={`硬盘 · ${bytes(d.diskTotal)}`}>
      <ResponsiveContainer>
        <ComposedChart data={d.rows} syncId={syncOf(d.narrow)} margin={CHART_MARGIN} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...time} />
          <YAxis {...disk} tickFormatter={tick} {...valueAxis(d.narrow)} />
          <Tooltip {...tipOf(d, "disk", diskText)} formatter={bytesTip} />
          <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-4)" fill="var(--color-chart-4)" fillOpacity={0.15} {...seriesOf(d.solo, "disk_used")} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
})

/** Open sockets and running processes, each bucket's average. Only a hub that keeps them in history has this panel. */
const CountsPanel = memo(function CountsPanel({ d }: { d: Draw }) {
  // Two columns wide where it is last in an even place, so its axis is laid
  // out across that width rather than one column's.
  const { time, dense } = across(d, lastSpans(d))
  const udp = dense ? undefined : "5 3"
  const procs = dense ? undefined : "2 3"
  return (
    <Panel
      title="连接与进程"
      keys={[
        { label: "TCP", color: "var(--color-chart-1)" },
        { label: "UDP", color: "var(--color-chart-3)", dash: udp },
        { label: "进程", color: "var(--color-ink)", dash: procs },
      ]}
    >
      <ResponsiveContainer>
        <ComposedChart data={d.rows} syncId={syncOf(d.narrow)} margin={CHART_MARGIN} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis {...time} />
          <YAxis {...d.axes.counts} tickFormatter={countTick} {...valueAxis(d.narrow)} />
          <Tooltip {...tipOf(d, "counts", countText)} itemSorter={COUNT_ORDER} />
          <Line dataKey="tcp" name="TCP" stroke="var(--color-chart-1)" {...seriesOf(d.solo, "tcp")} />
          <Line dataKey="udp" name="UDP" stroke="var(--color-chart-3)" strokeDasharray={udp} {...seriesOf(d.solo, "udp")} />
          <Line dataKey="procs" name="进程" stroke="var(--color-ink)" strokeDasharray={procs} {...seriesOf(d.solo, "procs")} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
})

/**
 * The resource panels. Memoised, and given only values memoised on the history
 * and plain numbers, so the live push every two seconds -- a new `node` with the
 * same totals -- re-renders the facts above and not these.
 *
 * Drawn in stages (see `useStages`): the strip and CPU in the commit that
 * brings the answer, then memory, network, disk and the counts, one at a time. Until its turn a panel keeps the previous answer, or on its
 * first draw a skeleton of its size, so nothing below it moves. `onDrawn`
 * hears once the last panel holds the answer, which is when the page undims.
 *
 * `window` is the span the history was asked for, `plot` the width in pixels of
 * one panel's plot, which decides how many time labels fit, `widePlot` that of
 * a panel spanning both columns, null where the panels are one column, and
 * `solo` the series with a point no line reaches. `stage` names the answer:
 * `onDrawn` hears it once every panel holds it, and a refresh of the same
 * window keeps it, which is how the page knows not to dim for one.
 */
export const ResourceCharts = memo(function ResourceCharts({
  rows, window, plot, widePlot, narrow, solo, axes, peak, has, availability, hours, memTotal, swapTotal, diskTotal, stage,
  onDrawn,
}: Omit<Draw, "time" | "dense" | "wide"> & {
  window: [number, number]
  widePlot: number | null
  onDrawn?: (stage: string) => void
}) {
  const draw = useMemo(
    (): Draw => ({
      rows, plot, narrow, solo, axes, peak, has, availability, hours, memTotal, swapTotal, diskTotal, stage,
      time: timeAxis(window[0], window[1], hours, plot),
      dense: isDense(rows, window, plot),
      wide: widePlot === null
        ? null
        : { time: timeAxis(window[0], window[1], hours, widePlot), dense: isDense(rows, window, widePlot) },
    }),
    [rows, window, plot, widePlot, narrow, solo, axes, peak, has, availability, hours, memTotal, swapTotal, diskTotal, stage],
  )
  const [memory, network, disk, counts] = useStages(draw, 4)

  // A frame after the last stage's commit, by when recharts has laid it out.
  useEffect(() => {
    if (counts !== draw || !onDrawn) return
    const id = requestAnimationFrame(() => onDrawn(draw.stage))
    return () => cancelAnimationFrame(id)
  }, [counts, draw, onDrawn])

  return (
    <div className={RESOURCE_GRID}>
      {draw.availability && <UptimeStrip availability={draw.availability} hours={draw.hours} narrow={draw.narrow} />}
      <CpuPanel d={draw} />
      {memory ? <MemoryPanel d={memory} /> : <PanelSkeleton />}
      {network ? <NetworkPanel d={network} /> : <PanelSkeleton />}
      {disk ? <DiskPanel d={disk} /> : <PanelSkeleton />}
      {/* Whether there is a fifth panel at all follows the answer it would
          draw, so the grid does not change shape a stage early. */}
      {(counts ?? draw).has.counts && (counts ? <CountsPanel d={counts} /> : <PanelSkeleton />)}
    </div>
  )
})
