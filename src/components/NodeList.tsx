import { NodeCard } from "@/components/NodeCard"
import { NodeTable } from "@/components/NodeTable"
import { Toolbar, type View } from "@/components/Toolbar"
import type { Node } from "@/lib/api"
import type { Rates } from "@/lib/cost"
import { NO_FILTERS, STATUSES, type Filters, type Status } from "@/lib/filter"
import { cn } from "@/lib/utils"

/**
 * The nodes, on the paper below the pond: a heading row -- the count, the group
 * tabs once the operator has grouped anything, search and order at its end --
 * and the cards under it.
 */
export function NodeList({ nodes, groups, ungrouped, group, shown, counts, filters, onFilters, onOpen, onPrefetch, toolbar, price, rates, primary, view, onView }: {
  /** How many nodes are in each state, of those the group and country leave. */
  counts: Record<Status, number>
  /** Every node, in the operator's order. */
  nodes: Node[]
  groups: string[]
  ungrouped: number
  /** The group tab in force: null for all of them, "" for the ungrouped. */
  group: string | null
  /** What the filters leave, in the order picked. */
  shown: Node[]
  filters: Filters
  onFilters: (filters: Filters) => void
  onOpen: (id: number) => void
  onPrefetch?: () => void
  toolbar: boolean
  price: boolean
  rates: Rates
  primary: "CNY" | "USD"
  view: View
  onView: (view: View) => void
}) {
  const narrowed = filters.group !== null || filters.region !== null || filters.query.trim() !== "" || filters.status !== null
  // A state no node is in has nothing to show, and is left out -- unless it is
  // the one picked, which stays so it can be let go of.
  const states = STATUSES.filter(([key]) => counts[key] > 0 || filters.status === key)
  const tabs = [
    [null, "全部", nodes.length] as const,
    ...groups.map((g) => [g, g, nodes.filter((n) => n.group === g).length] as const),
    ...(ungrouped && groups.length ? [["", "未分组", ungrouped] as const] : []),
  ]
  // A hub that has never filled in a price would otherwise show 免费 on every card.
  const priced = price && nodes.some((n) => n.price > 0)

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 className="flex items-baseline gap-2 text-base font-medium">
          节点
          <span className="tnum text-sm font-normal text-muted-foreground">
            {shown.length === nodes.length ? nodes.length : `${shown.length} / ${nodes.length}`}
          </span>
        </h2>
        {/* Group tabs appear only once the operator has grouped something, so
            a hub without groups keeps the page it always had. There may be
            dozens: the strip scrolls within itself. */}
        {groups.length > 0 && (
          <div role="group" aria-label="分组" className="flex max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-secondary/70 p-0.5">
            {tabs.map(([value, label, count]) => (
              <button
                // Group names are free text, so they carry a prefix no key of
                // the 全部 tab can share.
                key={value === null ? "*" : `=${value}`}
                aria-pressed={group === value}
                onClick={() => onFilters({ ...filters, group: value, region: null })}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                  group === value ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span className="tnum text-xs text-muted-foreground">{count}</span>
              </button>
            ))}
          </div>
        )}
        {states.length > 0 && (
          <div role="group" aria-label="状态" className="flex flex-wrap items-center gap-1.5">
            {states.map(([key, label]) => {
              const on = filters.status === key
              return (
                <button
                  key={key}
                  aria-pressed={on}
                  onClick={() => onFilters({ ...filters, status: on ? null : key })}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                    on
                      ? "border-foreground/50 bg-secondary text-foreground"
                      : "text-muted-foreground hover:border-ring hover:text-foreground",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", key === "offline" || key === "traffic" ? "bg-hot" : key === "expiring" ? "bg-warn" : "bg-muted-foreground")} />
                  {label}
                  <span className="tnum">{counts[key]}</span>
                </button>
              )
            })}
          </div>
        )}
        {toolbar && nodes.length > 1 && (
          <Toolbar
            query={filters.query}
            sort={filters.sort}
            onQuery={(query) => onFilters({ ...filters, query })}
            onSort={(sort) => onFilters({ ...filters, sort })}
            view={view}
            onView={onView}
          />
        )}
      </div>

      {nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">还没有节点</p>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          没有符合条件的节点。
          {narrowed && (
            <button className="underline" onClick={() => onFilters({ ...NO_FILTERS, sort: filters.sort })}>
              清除筛选
            </button>
          )}
        </p>
      ) : view === "table" ? (
        <>
          <div className="hidden lg:block" onPointerEnter={onPrefetch} onFocus={onPrefetch}>
            <NodeTable nodes={shown} price={priced} rates={rates} primary={primary} onOpen={onOpen} />
          </div>
          <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:hidden" onPointerEnter={onPrefetch} onFocus={onPrefetch}>
            {shown.map((n) => (
              <NodeCard key={n.id} node={n} price={priced} rates={rates} primary={primary} onOpen={() => onOpen(n.id)} />
            ))}
          </div>
        </>
      ) : (
        <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" onPointerEnter={onPrefetch} onFocus={onPrefetch}>
          {shown.map((n) => (
            <NodeCard key={n.id} node={n} price={priced} rates={rates} primary={primary} onOpen={() => onOpen(n.id)} />
          ))}
        </div>
      )}
    </>
  )
}
