import { useSyncExternalStore, type ComponentProps, type ReactNode } from "react"
import type { DotItemDotProps, Tooltip } from "recharts"

import { clockFor, tickClock, timeTicks } from "@/lib/format"

// What the resource panels and the latency chart share: the axes' look, the
// tooltip, the series' defaults, and the time axis they all read against.

export const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

// Room right of the plot for the last time label, which is centred on its tick:
// at recharts' default 5 px a tick at the window's end printed as "14:0".
export const CHART_MARGIN = { top: 4, right: 16, bottom: 0, left: 0 }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
export const SERIES = { dot: false as const, activeDot: { r: 3 }, strokeWidth: 1.5, isAnimationActive: false }

/**
 * Whether a dash pattern would still read as a pattern: once the points sit
 * closer than about 4 px apart, its gaps fall between samples and the line
 * breaks into confetti -- on a phone, at the day range, or where an offline
 * node's one hour of points is packed into a sixth of the panel. Sparser, the
 * dash is what tells two lines apart to a reader who cannot tell their colours
 * apart. Measured over the stretch the rows cover within `window`, across a
 * plot `plot` pixels wide.
 */
export function isDense(rows: { ts: number }[], window: [number, number], plot: number): boolean {
  if (rows.length < 2) return false
  const covered = (rows[rows.length - 1].ts - rows[0].ts) / Math.max(1, window[1] - window[0])
  return (plot * Math.min(1, covered)) / rows.length < 4
}

// Five hues that hold apart on paper and on ink, and a dash pattern each for a
// sparse chart, where it reads as a line; a dense one is told apart by colour
// alone (see `isDense`).
export const PALETTE = [
  { stroke: "var(--color-chart-1)", dash: undefined },
  { stroke: "var(--color-chart-2)", dash: "6 3" },
  { stroke: "var(--color-chart-3)", dash: "2 3" },
  { stroke: "var(--color-chart-4)", dash: "10 4 2 4" },
  { stroke: "var(--color-chart-5)", dash: "1 4" },
]

/** One width for every value axis on the page, so all plot areas start at the same x. */
export function axisWidth(narrow: boolean) {
  // 68 px holds "100 KB/s"; on a phone that is a fifth of the chart, so the rate
  // axis drops its "/s" there and every axis shrinks to what "1.5 GB" needs.
  return narrow ? 52 : 68
}

type TooltipProps = ComponentProps<typeof Tooltip>
type SortItem = Parameters<Extract<NonNullable<TooltipProps["itemSorter"]>, (...a: never[]) => unknown>>[0]

/**
 * A tooltip sorter listing the series in `keys` order, which is the order of
 * the panel's key: recharts sorts by name otherwise, so 上行 came before 下行 and
 * Swap before 内存.
 */
export function sortBy(keys: string[]) {
  return (item: SortItem) => keys.indexOf(String(item.dataKey))
}

const tooltips = new Map<number, TooltipProps>()

/**
 * The tooltip for a window `hours` wide, one object per width so its identity
 * holds across renders: a fresh one would have recharts redraw every panel.
 *
 * Nor does it slide. Entering a chart at its right edge, it appears beside the
 * cursor first and would glide 400 ms back within the chart, overhanging the
 * page by up to 140 px and flashing a horizontal scrollbar. Drawn on the card's
 * own ground: recharts' default is a white box in either palette. Its label is
 * the axis's own clock -- the date only where the window spans days, and never
 * the seconds, which a bucket of a minute or more does not have.
 */
export function tooltipFor(hours: number): TooltipProps {
  let tip = tooltips.get(hours)
  if (!tip) {
    const clock = clockFor(hours)
    tip = {
      isAnimationActive: false,
      separator: " ",
      labelFormatter: (ts: unknown) => clock(Number(ts)),
      // Held within the plot on both axes, and never wider than a phone's chart:
      // a tooltip overhanging the panel widened the page by 42 px after a tap.
      allowEscapeViewBox: { x: false, y: false },
      wrapperStyle: { maxWidth: "100%", zIndex: 10 },
      contentStyle: {
        fontSize: 12,
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 6px 20px rgb(0 0 0 / 14%)",
        whiteSpace: "normal",
      },
      labelStyle: { color: "var(--muted-foreground)", marginBottom: 2 },
      itemStyle: { padding: 0 },
      cursor: { stroke: "var(--ring)", strokeDasharray: "3 3" },
    }
    tooltips.set(hours, tip)
  }
  return tip
}

/**
 * A dot for a point with no neighbour to draw a line to, read off a flag the
 * rows carry (`solo`) rather than tested against the neighbours per point on
 * every render. Passed only to a series that has such a point at all, so the
 * common case draws no dots and creates no elements for them.
 */
export function soloDot({ cx, cy, payload, dataKey, stroke }: DotItemDotProps) {
  const solo = (payload as { solo?: Record<string, true> } | undefined)?.solo
  return cy == null || !solo?.[String(dataKey)] ? null : <circle cx={cx} cy={cy} r={2} fill={stroke} />
}

const DAY = 86_400_000
// Day steps for a window of weeks to months, phased from the first midnight in
// it rather than from the epoch: a weekly tick on Thursdays left a month's axis
// blank for its first hundred pixels.
const DAY_STEPS = [1, 2, 3, 4, 5, 7, 10, 14, 15, 30]

function dayTicks(from: number, to: number, count: number): number[] {
  const every = DAY_STEPS.find((d) => (to - from) / (d * DAY) <= count) ?? 30
  const day = new Date(from)
  if (day.getHours() || day.getMinutes() || day.getSeconds() || day.getMilliseconds()) day.setHours(24, 0, 0, 0)
  const ticks: number[] = []
  // By the calendar rather than in fixed milliseconds, so a daylight-saving
  // change does not move every later tick off midnight.
  for (; day.getTime() <= to; day.setDate(day.getDate() + every)) ticks.push(day.getTime())
  return ticks
}

/**
 * A real time axis over `[from, to]` rather than the category axis recharts
 * defaults to: on a category axis ticks are selected by index, so a period the
 * agent was offline for collapses to nothing. The span is the window asked for,
 * not the first and last rows, so a node away for five of six hours draws its
 * one hour where it fell and leaves the rest empty.
 *
 * `width` is the plot's approximate width in pixels, which sets how many ticks
 * fit. Built once per data, range and width by its callers, since fresh `ticks`
 * and `tickFormatter` on each render redraw the whole chart.
 */
export function timeAxis(from: number, to: number, hours: number, width: number) {
  const count = Math.max(3, Math.min(8, Math.floor(width / 90)))
  const span = to - from
  // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
  // are dropped by `minTickGap`.
  let ticks = span > 7 * DAY && span <= 120 * DAY ? dayTicks(from, to, count) : timeTicks(from, to, count)
  const format = tickClock(ticks, hours)
  // A label is centred on its tick, so one near the end would overhang the
  // margin and be cut off; it is dropped instead. About 3.3 px a character at 11 px.
  const px = width / Math.max(1, span)
  ticks = ticks.filter((t) => (to - t) * px + CHART_MARGIN.right >= format(t).length * 3.3)
  return {
    dataKey: "ts",
    type: "number" as const,
    domain: [from, to],
    // Rows a bucket before the window's start, or past a zoomed span, are drawn
    // clipped rather than widening the axis to hold them.
    allowDataOverflow: true,
    ticks,
    tickFormatter: tickClock(ticks, hours),
    minTickGap: hours > 24 ? 72 : 40,
    ...AXIS,
  }
}

export { pct } from "@/lib/format"

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

/**
 * An axis label with its unit held to the figure. Recharts wraps a tick at its
 * spaces once the label is wider than the axis allows, and on a phone's 52 px
 * axis "100 MB" broke into two lines with the first cut off by the plot's top.
 */
export const keepTogether = (label: string) => label.replace(" ", "\u00a0")

/**
 * A byte axis printed in one unit throughout, chosen from its top: 0.5 GB under
 * 2 GB rather than 512 MB, and 0 GB at the floor rather than 0 B.
 */
export function unitTick(top: number) {
  const i = top >= 1 ? Math.min(Math.floor(Math.log(top) / Math.log(1024)), UNITS.length - 1) : 0
  return (v: number) => `${Number((v / 1024 ** i).toFixed(2))}\u00a0${UNITS[i]}`
}

/**
 * A zero-anchored byte axis whose gridlines fall on a power of two: memory is
 * sold in them, so 7.6 GB reads 2, 4, 6, 8 GB rather than the 1.9, 3.8, 5.7 its
 * quarters would print. At most four steps, the top the first multiple of the
 * step at or above `max`.
 */
export function binaryAxis(max: number): { domain: [number, number]; ticks: number[] } {
  if (!(max > 0)) return { domain: [0, 1], ticks: [0, 1] }
  const step = 2 ** Math.ceil(Math.log2(max / 4))
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  return { domain: [0, top], ticks }
}

/**
 * A zero-anchored byte axis for a disk, whose sizes are not powers of two: the
 * step is 1, 2, 2.5 or 5 of a power of ten in the disk's own unit, at most five
 * of them, so 106 GB reads 0, 25 ... 125 GB rather than the 26.5, 53, 79.5 of
 * its quarters. Five rather than four, or the top could sit half as high again
 * as the disk -- 150 GB over 106 -- and a full disk would draw two thirds up.
 * The exact size is in the panel's title.
 */
export function decimalAxis(max: number): { domain: [number, number]; ticks: number[] } {
  if (!(max > 0)) return { domain: [0, 1], ticks: [0, 1] }
  const unit = 1024 ** Math.max(0, Math.floor(Math.log(max) / Math.log(1024)))
  const target = max / unit / 5
  const scale = 10 ** Math.floor(Math.log10(target))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * scale >= target)! * scale * unit
  const top = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(i * step)
  return { domain: [0, top], ticks }
}

const narrowQuery = "(max-width: 639px)"
const subscribe = (change: () => void) => {
  const media = matchMedia(narrowQuery)
  media.addEventListener("change", change)
  return () => media.removeEventListener("change", change)
}

/** Whether the screen is below Tailwind's `sm`, where the charts tighten their axes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(narrowQuery).matches, () => false)
}

export type Key = { label: string; color: string; dash?: string }

/** A short line in a series' colour and dash, as a key or a chip's swatch. */
export function Swatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="14" height="4" className="shrink-0" aria-hidden>
      <line x1="0" y1="2" x2="14" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  )
}

/**
 * A chart under its title, with a key to its lines on the right where there is
 * more than one. The title row is one fixed height whether or not it carries a
 * key: sized by its content, a row with a key was 3 px taller and the plots
 * beside each other in the grid sat out of line.
 */
export function Panel({ title, keys, children }: { title: string; keys?: Key[]; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex h-5 items-center justify-between gap-3">
        <h4 className="truncate text-xs leading-4 font-medium text-muted-foreground">{title}</h4>
        {keys && (
          <div className="flex shrink-0 items-center gap-3 text-[11px] leading-4 text-muted-foreground">
            {keys.map((k) => (
              <span key={k.label} className="inline-flex items-center gap-1.5">
                <Swatch color={k.color} dash={k.dash} />
                {k.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Clipped sideways: the tooltip is held within the plot, but its box
          can still be wider than a phone's panel for a moment. */}
      <div className="h-40 w-full text-muted-foreground [overflow-x:clip] [overflow-clip-margin:4px]">{children}</div>
    </div>
  )
}

/**
 * What stands where a chart would, when there is nothing to draw: the chart's
 * own height, edged in dashes, with the reason in the middle. A single line of
 * text in its place collapsed the card and moved everything below it.
 */
export function Placeholder({ className, tone = "muted", children }: {
  className: string
  tone?: "muted" | "error"
  children: ReactNode
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center text-sm ${
        tone === "error" ? "text-destructive" : "text-muted-foreground"
      } ${className}`}
    >
      {children}
    </div>
  )
}

/** The focus ring every control on the page draws, after the theme's own buttons. */
export const RING = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
