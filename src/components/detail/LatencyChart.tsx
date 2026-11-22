import { memo, startTransition, useCallback, useEffect, useMemo, useState, type ComponentProps } from "react"
import { createPortal } from "react-dom"
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { clockFor } from "@/lib/format"
import {
  AXIS, axisWidth, CHART_MARGIN, isDense, niceAxis, PALETTE, pct, RING, SERIES, sortBy, timeAxis, tooltipFor,
} from "./chart"
import { RangeControl, type Range } from "./RangeControl"

export type Probe = { id: number; name: string }
export type PingRow = { ts: number } & Record<string, number | [number, number] | null>

type TipFormatter = NonNullable<ComponentProps<typeof Tooltip>["formatter"]>

// The line is drawn from what answered, so without the loss a bucket that lost
// most of its packets reads as normal. `dataKey` is `t7`/`s7`; the loss sits at
// `l7`. Rounded because a clipped sample carries the median of an even window,
// which falls between two of the whole milliseconds the hub stores.
//
// A bucket where every probe timed out is listed as such rather than left out:
// dropped, the tooltip lost a row and changed height under the cursor, and the
// one bucket that most needed explaining said nothing. A probe with no sample in
// the bucket at all -- one slower than the bucket -- is a dash.
const latencyTip: TipFormatter = (v, name, item) => {
  const id = String(item?.dataKey).slice(1)
  const row = item?.payload as Record<string, unknown> | undefined
  if (v === null || v === undefined) return [row && row[`t${id}`] === null ? "超时" : "—", name]
  const loss = Number(row?.[`l${id}`] ?? 0)
  const ms = Number(v)
  return [`${ms < 1 ? "<1" : Math.round(ms)} ms${loss > 0 ? ` · 丢 ${pct(loss)}` : ""}`, name]
}

// With a space, as every other figure on the page prints its unit.
const msTick = (v: number) => `${v}\u00a0ms`

/**
 * The rows a zoomed chart draws: those within `[from, to]` and one either side,
 * so the lines run on to the plot's edges, where they are clipped, rather than
 * stopping short of them. All seven hundred points a probe, drawn and clipped,
 * cost a drag frame for lines nobody sees.
 */
function within(rows: PingRow[], [from, to]: Range): PingRow[] {
  let lo = 0
  while (lo < rows.length && rows[lo].ts < from) lo++
  let hi = rows.length - 1
  while (hi >= 0 && rows[hi].ts > to) hi--
  return rows.slice(Math.max(0, lo - 1), Math.min(rows.length, hi + 2))
}

/**
 * The latency chart, and the zoom it keeps. The zoom is held as times rather
 * than rows, so the minute-by-minute refresh keeps the span in view as rows
 * arrive; it sets the time axis's domain, and the range control beneath the
 * plot draws itself from it, so a reset by the button or by Esc, and a refresh
 * while zoomed, update the chart in place. The page remounts this chart for a
 * new node or range, and unmounts it when every probe is hidden, which is what
 * starts it unzoomed.
 *
 * `window` is the span the history was asked for, `plot` the plot's width in
 * pixels, `order` every probe in the order of the chips beneath, so the tooltip
 * lists them alike. `controls` is a place in the page's controls row, beside
 * 削峰, where the zoomed span and the button resetting it are drawn: set over
 * the plot's top corner, they covered the highest line.
 */
export const LatencyChart = memo(function LatencyChart({
  rows, window, plot, narrow, probes, order, style, spread, smooth, hours, controls,
}: {
  rows: PingRow[]
  window: [number, number]
  plot: number
  narrow: boolean
  probes: Probe[]
  order: number[]
  style: (id: number) => (typeof PALETTE)[number]
  spread: boolean
  smooth: boolean
  hours: number
  controls: HTMLElement | null
}) {
  const [zoom, setZoom] = useState<Range | null>(null)

  // The stretch in view, or null for the whole window. Held within the window,
  // which a refresh moves on by a bucket at a time, so a zoom on its first
  // minutes narrows as they pass out of it, and goes once they have. A phone
  // has no range control, so no zoom.
  const view = useMemo((): Range | null => {
    if (!zoom || narrow) return null
    const from = Math.max(zoom[0], window[0])
    const to = Math.min(zoom[1], window[1])
    return to - from < (window[1] - window[0]) / 100 ? null : [from, to]
  }, [zoom, narrow, window])

  const drawn = useMemo(() => (view ? within(rows, view) : rows), [rows, view])
  const time = useMemo(
    () => timeAxis(view?.[0] ?? window[0], view?.[1] ?? window[1], hours, plot),
    [view, window, hours, plot],
  )

  // While a handle moves, the chart follows in a transition, which yields to
  // the next pointer move; where the handle comes to rest, directly, so the
  // last range is the one drawn. An edge of the zoom left at the window's own
  // is held there as the refresh moves the window on, so a zoom on the last
  // hours keeps showing the newest minute.
  const zoomTo = useCallback((range: Range | null, final: boolean) => {
    const next: Range | null = range && [
      range[0] <= window[0] ? -Infinity : range[0],
      range[1] >= window[1] ? Infinity : range[1],
    ]
    if (final) setZoom(next)
    else startTransition(() => setZoom(next))
  }, [window])
  const reset = useCallback(() => setZoom(null), [])
  const zoomed = view !== null
  useEffect(() => {
    if (!zoomed) return
    // Reset zoom on Esc even when panning with the middle bar or clicking elsewhere on the page.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      e.stopPropagation()
      reset()
    }
    addEventListener("keydown", onKeyDown)
    return () => removeEventListener("keydown", onKeyDown)
  }, [zoomed, reset])

  const keys = useMemo(() => order.map((id) => `${smooth ? "s" : "t"}${id}`), [order, smooth])

  // The value axis, fitted to what is drawn -- the lines, and the band where
  // there is one -- on a round step with a gridline above the highest point.
  // Left to recharts, the top tick could fall below the data, and a probe at
  // 45-50 ms ran along the plot's top edge above a last label of 40 ms. On the
  // square-root scale it starts at zero, which that scale has and needs.
  const yAxis = useMemo(() => {
    const series = probes.map((p) => `${smooth ? "s" : "t"}${p.id}`)
    const band = probes.length === 1 ? `${smooth ? "c" : "b"}${probes[0].id}` : null
    let lo = Infinity
    let hi = -Infinity
    for (const r of drawn) {
      for (const k of series) {
        const v = r[k]
        if (typeof v === "number") {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
      const b = band && r[band]
      if (Array.isArray(b)) {
        lo = Math.min(lo, b[0])
        hi = Math.max(hi, b[1])
      }
    }
    return niceAxis(spread ? 0 : Math.max(0, lo), hi)
  }, [drawn, probes, smooth, spread])
  const sorter = useMemo(() => sortBy(keys), [keys])
  const tip = tooltipFor(hours)
  // Where a dash would break into confetti, the probes are told apart by
  // colour alone. Judged on the whole window, so zooming does not restyle the
  // lines and their chips beneath.
  const dense = useMemo(() => isDense(rows, window, plot), [rows, window, plot])
  const clock = clockFor(hours)
  const inset = useMemo(() => ({ left: CHART_MARGIN.left + axisWidth(narrow), right: CHART_MARGIN.right }), [narrow])

  return (
    <div
      className="flex h-full flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && view) {
          e.stopPropagation()
          reset()
        }
      }}
    >
      {view &&
        controls &&
        createPortal(
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tnum hidden sm:inline">
              {clock(view[0])} – {clock(view[1])}
            </span>
            <button
              type="button"
              onClick={reset}
              data-tip="重置缩放 (Esc)"
              className={`inline-flex min-h-6 items-center rounded-md border px-2 text-xs text-foreground hover:bg-muted ${RING}`}
            >
              重置缩放
            </button>
          </span>,
          controls,
        )}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer>
          <ComposedChart data={drawn} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis {...time} />
            {/* Not anchored at zero: these lines live in a narrow band far from
                it, and zero flattens every wobble. As wide as the resource
                panels' axes, so the two tabs' plots begin at the same x. */}
            {spread ? (
              <YAxis tickFormatter={msTick} width={axisWidth(narrow)} scale="sqrt" {...yAxis} interval={0} {...AXIS} />
            ) : (
              <YAxis tickFormatter={msTick} width={axisWidth(narrow)} {...yAxis} interval={0} {...AXIS} />
            )}
            <Tooltip {...tip} formatter={latencyTip} itemSorter={sorter} filterNull={false} />
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
                  activeDot={false}
                  tooltipType="none"
                  legendType="none"
                  connectNulls
                />
              ))}
            {/* Dense, each series is drawn twice: its samples faint, and their
                trend over them, so a probe swinging from one bucket to the next
                reads as a level rather than a wall. The tooltip reads the samples. */}
            {probes.map((s) => (
              <Line
                key={s.id}
                dataKey={`${smooth ? "s" : "t"}${s.id}`}
                name={s.name}
                stroke={style(s.id).stroke}
                strokeDasharray={dense ? undefined : style(s.id).dash}
                {...SERIES}
                strokeOpacity={dense ? 0.3 : 1}
                strokeWidth={dense ? 1 : SERIES.strokeWidth}
                connectNulls
              />
            ))}
            {dense &&
              probes.map((s) => (
                <Line
                  key={`m${s.id}`}
                  dataKey={`m${s.id}`}
                  stroke={style(s.id).stroke}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  tooltipType="none"
                  legendType="none"
                  connectNulls
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Drag either handle, or the window between them, to zoom into a
          stretch of the trend. Left off a phone, where a handle small enough
          to fit under the chart is too small for a finger and the ranges above
          already offer the hour. */}
      {!narrow && <RangeControl window={window} value={view} onChange={zoomTo} label={clock} inset={inset} />}
    </div>
  )
})
