/**
 * How one block of a latency strip is drawn (CardPing.tsx), in two parts.
 *
 * The colour says how fast the line is outright: green under 100 ms, amber to
 * 250, red past it or for a timeout. A person reads those at a glance, and a
 * route that is slow all day should look slow.
 *
 * The depth says how this block compares with the line's own usual latency:
 * faint where it is the line's normal, deeper where it runs slower than that.
 * Colour alone left a line that sits at 105 ms amber end to end, with its slow
 * hours no different from the rest -- and "which hours were slowest" is what
 * the strip is for (issue #2). Slower counts only by a margin a person would
 * feel as well as by share: on a 1 ms line, 2 ms is twice the usual and still
 * nothing.
 *
 * A block far enough above the usual also moves up a colour, as a spike on a
 * fast line is worth seeing even while it stays under 100 ms.
 */
export const MID_MS = 100
export const SLOW_MS = 250

export type Tone = "none" | "ok" | "warn" | "hot" | "timeout"
/** 0 the line's normal, 1 somewhat slower than it, 2 clearly slower. */
export type Depth = 0 | 1 | 2

export function blockTier(v: number | null | undefined, typical: number | null): { tone: Tone; depth: Depth } {
  if (v === undefined) return { tone: "none", depth: 0 }
  if (v === null) return { tone: "timeout", depth: 2 }
  const over = typical ? v - typical : 0
  const share = typical ? v / typical : 1
  const depth: Depth = share >= 1.25 && over >= 12 ? 2 : share >= 1.1 && over >= 5 ? 1 : 0
  if (v >= SLOW_MS) return { tone: "hot", depth }
  if (v >= MID_MS) return share >= 1.5 && over >= 50 ? { tone: "hot", depth: 2 } : { tone: "warn", depth }
  return share >= 1.8 && over >= 30 ? { tone: "warn", depth: 2 } : { tone: "ok", depth }
}
