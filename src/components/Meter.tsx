import { memo, type ReactNode } from "react"

import { pct as formatPct } from "@/lib/format"
import { cn } from "@/lib/utils"

type Props = { label: ReactNode; pct: number | null; foot: ReactNode; empty?: ReactNode; warn?: number }

/** From here up a meter is drawn in the page's one colour: nearly full is the thing to notice. */
const HOT = 90

/**
 * One metric: name and percentage on top, bar in the middle, raw numbers
 * underneath. Ink on paper while there is room, since the length of the bar
 * carries the message; red once there is not.
 *
 * Memoised on its plain props: of a card's four, only those whose figures
 * moved since the last push draw again.
 */
export const Meter = memo(function Meter({ label, pct, foot, empty = "—", warn }: Props) {
  // null means the metric has no ceiling to fill, so the bar stays empty rather
  // than reporting 0%. What replaces the percentage depends on the reason:
  // unknown for a node with no metrics, ∞ for a plan with no limit. The bar stops
  // at full while the figure does not, so a plan past its quota reads 209%.
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const hot = pct !== null && pct >= HOT
  // Where a filter elsewhere counts from a lower share (traffic, at 80 %), the
  // bar says so too, in the warning's own colour.
  const warned = !hot && warn !== undefined && pct !== null && pct >= warn
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className={cn("tnum text-xs font-medium", hot && "text-hot", warned && "text-warn")}>
          {pct === null ? empty : formatPct(pct < 10 ? pct.toFixed(1) : pct.toFixed(0))}
        </span>
      </div>
      {/* Moved rather than resized: a transform eases on the compositor, where
          a width would lay the page out again on every frame of every bar's
          ease, each push. A full-length bar slid left out of the track, rather
          than one scaled down, so its leading end keeps its round cap; the
          track's own rounding clips the other end. */}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full w-full rounded-full transition-transform duration-500", hot ? "bg-hot" : warned ? "bg-warn" : "bg-foreground")}
          style={{ transform: `translateX(${filled - 100}%)` }}
        />
      </div>
      <div className="tnum mt-1.5 truncate text-xs text-muted-foreground">{foot}</div>
    </div>
  )
})
