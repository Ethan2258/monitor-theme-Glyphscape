import { ChoiceMenu } from "@/components/ChoiceMenu"
import { GridIcon, RowsIcon, SearchIcon, SortIcon } from "@/components/icons"

import { SORTS, type SortKey } from "@/lib/filter"

// One look for both controls, at the height of the group tabs beside them.
const FIELD =
  "h-10 rounded-lg border bg-card text-base sm:h-[34px] outline-none transition-colors hover:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-xs"

/**
 * Search and order, at the end of the row the group tabs are on. Deliberately
 * no more than this: two quiet controls beside the tabs, rather than a bar of
 * their own between the summary and the nodes.
 *
 * Set at 16px on a phone, where iOS zooms the page into any smaller field the
 * moment it is focused.
 */
export type View = "cards" | "table"

export function Toolbar({ query, sort, view, ping = true, onQuery, onSort, onView }: {
  query: string
  sort: SortKey
  view: View
  ping?: boolean
  onQuery: (query: string) => void
  onSort: (sort: SortKey) => void
  onView: (view: View) => void
}) {
  // Pushed to the row's end only from xl, where it fits on the row beside the
  // tabs and chips. Narrower, it wraps onto a line of its own, and pushed right
  // there it would hang off the end of an empty line; from the left, it reads
  // as the list's second row of controls.
  const sorts = SORTS.filter(([key]) => ping || key !== "ping").map(([value, label]) => ({ value, label }))
  const current = sorts.find((s) => s.value === sort)?.label ?? sorts[0].label
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto xl:ml-auto">
      <label className="relative min-w-0 flex-1 sm:flex-initial">
        <span className="sr-only">搜索节点</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索"
          className={`${FIELD} w-full pr-2 pl-8 placeholder:text-muted-foreground sm:w-44`}
        />
      </label>
      <ChoiceMenu
        label="排序方式"
        title={`排序：${current}`}
        value={sort}
        items={sorts}
        onPick={(next) => onSort(next)}
        buttonClassName={`${FIELD} inline-flex cursor-pointer items-center gap-1.5 pr-2 pl-2.5 whitespace-nowrap aria-expanded:border-ring`}
      >
        <span>{current}</span>
        <SortIcon className="size-3.5 text-muted-foreground" />
      </ChoiceMenu>
      {/* Cards or a table. The table needs a laptop's width to be worth it, so a
          phone is not offered it. */}
      <div role="group" aria-label="显示方式" className="hidden h-[34px] items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5 xl:flex">
        {([["cards", "卡片", GridIcon], ["table", "列表", RowsIcon]] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            data-tip={label}
            aria-label={label}
            aria-pressed={view === value}
            onClick={() => onView(value)}
            className={`inline-flex size-[30px] items-center justify-center rounded-md transition-colors ${
              view === value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  )
}
