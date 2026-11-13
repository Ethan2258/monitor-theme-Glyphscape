import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Props = { label: ReactNode; pct: number | null; foot: ReactNode; empty?: ReactNode }

/** From here up a meter is drawn in the page's one colour: nearly full is the thing to notice. */
const HOT = 90

/**
 * One metric: name and percentage on top, bar in the middle, raw numbers
 * underneath. Ink on paper while there is room, since the length of the bar
 * carries the message; red once there is not.
 */
export function Meter({ label, pct, foot, empty = "—" }: Props) {
  // null means the metric has no ceiling to fill, so the bar stays empty rather
  // than reporting 0%. What replaces the percentage depends on the reason:
  // unknown for a node with no metrics, ∞ for a plan with no limit. The bar stops
  // at full while the figure does not, so a plan past its quota reads 209%.
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const hot = pct !== null && pct >= HOT
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className={cn("tnum text-xs font-medium", hot && "text-hot")}>
          {pct === null ? empty : `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", hot ? "bg-hot" : "bg-foreground")}
          style={{ width: `${filled}%` }}
        />
      </div>
      <div className="tnum mt-1.5 truncate text-xs text-muted-foreground">{foot}</div>
    </div>
  )
}
