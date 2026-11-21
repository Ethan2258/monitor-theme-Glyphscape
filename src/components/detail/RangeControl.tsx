import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"

import { RING } from "./chart"

export type Range = [number, number]

// The narrowest stretch the window can be closed to, as a share of the whole:
// narrower, a handle would sit on top of the other and neither could be taken.
const MIN_SHARE = 0.02

type Mode = "from" | "to" | "move"

/** `r` moved by `dt` in `mode`, held within `[w0, w1]` and no narrower than `min`. */
function shift([a, b]: Range, mode: Mode, dt: number, [w0, w1]: Range, min: number): Range {
  if (mode === "from") return [Math.min(Math.max(a + dt, w0), b - min), b]
  if (mode === "to") return [a, Math.max(Math.min(b + dt, w1), a + min)]
  const by = Math.min(Math.max(dt, w0 - a), w1 - b)
  return [a + by, b + by]
}

/**
 * The latency chart's zoom: two handles and the window between them, under the
 * plot and as wide as it, driving the chart's time axis through `onChange`.
 *
 * In place of recharts' Brush, which follows a controlled selection only
 * partly -- one handle per render, and neither while one has focus -- so a
 * reset by Esc or by the button, or a refresh while zoomed, could only be shown
 * by drawing the chart afresh. This one is drawn from `value` on every render.
 *
 * A drag or an arrow key moves the handles at once, from a draft of its own,
 * and hands the range on as a transition, so the chart redraws as fast as it
 * can without holding the handles back; the release, or the key's release,
 * hands on the final range directly. A range that is the whole window is
 * handed on as null.
 *
 * `inset` is the space left and right of the plot within the chart, which the
 * track keeps clear of so its ends sit under the plot's.
 */
export function RangeControl({ window, value, onChange, label, inset }: {
  window: Range
  value: Range | null
  onChange: (range: Range | null, final: boolean) => void
  label: (ts: number) => string
  inset: { left: number; right: number }
}) {
  const track = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Range | null>(null)
  const latest = useRef<Range | null>(null)
  const drag = useRef<{ mode: Mode; x: number; from: Range; id: number } | null>(null)

  const [w0, w1] = window
  const span = Math.max(1, w1 - w0)
  const min = span * MIN_SHARE
  const range: Range = draft ?? value ?? window
  const at = (ts: number) => `${(Math.min(1, Math.max(0, (ts - w0) / span)) * 100).toFixed(3)}%`
  const whole = (r: Range): Range | null => (r[0] <= w0 && r[1] >= w1 ? null : r)

  const move = (next: Range) => {
    latest.current = next
    setDraft(next)
    onChange(whole(next), false)
  }
  const commit = () => {
    const last = latest.current
    if (!last) return
    latest.current = null
    setDraft(null)
    onChange(whole(last), true)
  }

  const grab = (mode: Mode) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return
    // No text selection, and no scroll on a touch screen, while dragging.
    e.preventDefault()
    e.stopPropagation()
    // Focused, so Esc and the arrows reach it afterwards; without the ring,
    // which is for a visitor who got there by keyboard.
    if (mode !== "move") e.currentTarget.focus({ preventScroll: true, focusVisible: false })
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, from: range, id: e.pointerId }
  }
  const follow = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    const width = track.current?.clientWidth
    if (!d || d.id !== e.pointerId || !width) return
    move(shift(d.from, d.mode, ((e.clientX - d.x) / width) * span, window, min))
  }
  const release = () => {
    drag.current = null
    commit()
  }
  const pointer = { onPointerMove: follow, onPointerUp: release, onPointerCancel: release, onLostPointerCapture: release }
  // A key let go, or focus lost, ends what the keys began, and leaves a drag
  // under way to its pointer.
  const settle = () => {
    if (!drag.current) commit()
  }

  const keys = (mode: "from" | "to") => (e: KeyboardEvent<HTMLElement>) => {
    const from = latest.current ?? range
    // A hundredth of the window a press, a tenth with Shift.
    const step = (span / 100) * (e.shiftKey ? 10 : 1)
    const by =
      e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step
      : e.key === "ArrowRight" || e.key === "ArrowUp" ? step
      : e.key === "Home" ? -span
      : e.key === "End" ? span
      : 0
    if (!by) return
    e.preventDefault()
    move(shift(from, mode, by, window, min))
  }

  const handle = (mode: "from" | "to", ts: number, name: string) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-orientation="horizontal"
      aria-valuemin={w0}
      aria-valuemax={w1}
      aria-valuenow={Math.round(ts)}
      aria-valuetext={label(ts)}
      title={`${name} · ${label(ts)}`}
      onPointerDown={grab(mode)}
      {...pointer}
      onKeyDown={keys(mode)}
      onKeyUp={settle}
      onBlur={settle}
      // Centred on its edge of the window, 14 px wide: wide enough to find
      // with a pointer, and its grip lines say it can be taken.
      className={`absolute inset-y-0 z-10 -ml-[7px] flex w-3.5 cursor-ew-resize touch-none items-center justify-center gap-[3px] rounded-[3px] bg-primary ${RING}`}
      style={{ left: at(ts) }}
    >
      <span className="h-2 w-px bg-primary-foreground/80" />
      <span className="h-2 w-px bg-primary-foreground/80" />
    </div>
  )

  return (
    <div
      ref={track}
      data-range-control
      className="relative h-5 shrink-0 touch-none select-none"
      style={{ marginLeft: inset.left, marginRight: inset.right }}
    >
      {/* The track: clear, edged in the grid's hairline. */}
      <div className="absolute inset-0 rounded-[3px] border border-border" />
      {/* The stretch in view, in the theme's accent; dragged, it pans. */}
      <div
        aria-hidden
        onPointerDown={grab("move")}
        {...pointer}
        className={`absolute inset-y-0 bg-accent ${draft ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ left: at(range[0]), right: `calc(100% - ${at(range[1])})` }}
      />
      {handle("from", range[0], "缩放起点")}
      {handle("to", range[1], "缩放终点")}
    </div>
  )
}
