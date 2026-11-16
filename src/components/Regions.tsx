import { useMemo, useState } from "react"

import { Flag } from "@/components/Flag"
import { Globe, type Marker } from "@/components/Globe"
import type { Node } from "@/lib/api"
import { countryName, placeOf } from "@/lib/countries"
import { cn } from "@/lib/utils"

/** How many countries are listed before the rest fold behind a count. */
const SHOWN = 8

/**
 * Where the nodes are: the globe, and under it one chip a country, the most
 * nodes first. Either narrows the list to a country, and the same press again
 * lets go of it. The fish swim round it (`data-pond-avoid`).
 */
export function Regions({ nodes, selected, onPick }: {
  nodes: Node[]
  selected: string | null
  onPick: (code: string | null) => void
}) {
  const [all, setAll] = useState(false)

  const regions = useMemo(() => {
    const by = new Map<string, { code: string; count: number; online: number }>()
    for (const n of nodes) {
      if (!n.country) continue
      const code = n.country.toUpperCase()
      const region = by.get(code) ?? { code, count: 0, online: 0 }
      region.count++
      if (n.online) region.online++
      by.set(code, region)
    }
    // The order met breaks a tie, so chips do not swap places as nodes come and go.
    return [...by.values()].sort((a, b) => b.count - a.count)
  }, [nodes])

  // A country this theme has no place for still has its chip; it only lacks a marker.
  const markers = useMemo(
    () =>
      regions.flatMap<Marker>((r) => {
        const place = placeOf(r.code)
        return place ? [{ ...r, lat: place[0], lon: place[1] }] : []
      }),
    [regions],
  )

  // One more than the limit is listed whole: a chip saying "+1" would take the
  // room of the country it stands for.
  const fold = !all && regions.length > SHOWN + 1
  const listed = fold ? regions.filter((r, i) => i < SHOWN || r.code === selected) : regions
  const chip =
    "inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs shadow-xs transition-colors outline-none hover:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

  return (
    <div data-pond-avoid="" data-sky-ignore="" className="flex min-w-0 flex-col items-center gap-4 lg:w-[26rem]">
      <Globe markers={markers} selected={selected} onPick={onPick} />
      {regions.length > 0 && (
        <div role="group" aria-label="地区" className="flex max-w-[26rem] flex-wrap justify-center gap-1.5">
          {listed.map((r) => {
            const on = r.code === selected
            const name = countryName(r.code)
            return (
              <button
                key={r.code}
                aria-pressed={on}
                title={`${name} · ${r.count} 台${r.online < r.count ? `，${r.online} 在线` : ""}`}
                onClick={() => onPick(on ? null : r.code)}
                className={cn(chip, on && "border-foreground/60 bg-secondary")}
              >
                <Flag code={r.code} className="h-2.5 w-3.5" />
                {name}
                <span className="tnum text-muted-foreground">{r.count}</span>
              </button>
            )
          })}
          {regions.length > SHOWN + 1 && (
            <button onClick={() => setAll(!all)} className={cn(chip, "text-muted-foreground")}>
              {all ? "收起" : `+${regions.length - listed.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
