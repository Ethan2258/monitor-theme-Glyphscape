import { memo } from "react"

import { Country, daysLeft, deployed, monthUsage } from "@/components/NodeCard"
import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { convert, remaining, type Rates } from "@/lib/cost"
import { bytes, cycle, FOREVER, money, pct as formatPct, percent, rate, sinceSeen, uptime } from "@/lib/format"
import { cn } from "@/lib/utils"

// One grid for the heading and every row, so the columns line up.
const COLUMNS = "grid grid-cols-[minmax(13rem,2.2fr)_minmax(6.5rem,1fr)_repeat(3,minmax(6.5rem,1fr))_minmax(8rem,1.15fr)_minmax(8rem,1.15fr)_minmax(10rem,1.5fr)] items-center gap-x-5"

/** A percentage over a thin bar: red past nine tenths, like the cards' meters. */
const Bar = memo(function Bar({ pct, foot }: { pct: number | null; foot?: string }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>
  const hot = pct >= 90
  return (
    <div className="min-w-0">
      <div className={cn("tnum text-[13px] font-medium", hot && "text-hot")}>{formatPct(pct < 10 ? pct.toFixed(1) : pct.toFixed(0))}</div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", hot ? "bg-hot" : "bg-foreground/80")} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      {foot && <div className="tnum mt-1 truncate text-[11px] text-muted-foreground">{foot}</div>}
    </div>
  )
})

/**
 * The nodes as a table, one row each: for a long list, where cards make the
 * eye travel. Every column is a figure the cards carry, in the same order --
 * who and where, state, CPU, memory, disk, live speed, this period's traffic,
 * and what it costs -- so the two views read alike. Below a laptop's width the
 * table scrolls sideways rather than squeezing its columns.
 */
export function NodeTable({ nodes, price, rates, primary, onOpen }: {
  nodes: Node[]
  price: boolean
  rates: Rates
  primary: "CNY" | "USD"
  onOpen: (id: number) => void
}) {
  return (
    <Card className="gap-0 overflow-x-auto py-0">
      <div className="min-w-[68rem]">
        <div className={cn(COLUMNS, "border-b px-5 py-2.5 text-xs text-muted-foreground")}>
          <span>节点</span>
          <span>状态</span>
          <span>CPU</span>
          <span>内存</span>
          <span>硬盘</span>
          <span>网速</span>
          <span>本期流量</span>
          <span>{price ? "价格 · 剩余" : "到期"}</span>
        </div>
        {nodes.map((n) => (
          <Row key={n.id} n={n} price={price} rates={rates} primary={primary} onOpen={onOpen} />
        ))}
      </div>
    </Card>
  )
}

/**
 * One node's row. Memoised like the cards: handed the node object a push left
 * unchanged, and the one onOpen for every row, it is skipped outright.
 */
const Row = memo(function Row({ n, price, rates, primary, onOpen }: {
  n: Node
  price: boolean
  rates: Rates
  primary: "CNY" | "USD"
  onOpen: (id: number) => void
}) {
  const pick = (both: { cny: number; usd: number }) => (primary === "CNY" ? money(both.cny, "CNY") : money(both.usd, "USD"))
  const m = n.metrics
  const used = monthUsage(n)
  const days = daysLeft(n)
  const left = remaining(n, days)
  const worth = left === null ? null : convert(left, n.currency, rates)
  const code = n.currency.toUpperCase()
  const billed = n.price > 0 && code !== "CNY" && code !== "USD" ? convert(n.price, code, rates) : null
  return (
    <div
      role="button"
      // Where the page returns focus on coming back from this node's page.
      data-node={n.id}
      tabIndex={0}
      onClick={() => onOpen(n.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(n.id))}
      // Rows out of view are skipped by the browser on each push, held at
      // their last measured height (about a row's, 70px, until measured), as
      // the cards are. Focus is an inset ring as well as the tint, which alone
      // was too faint to follow from row to row.
      className={cn(
        COLUMNS,
        "cursor-pointer border-b px-5 py-3 transition-colors last:border-b-0 hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
        "[content-visibility:auto] [contain-intrinsic-block-size:auto_70px]",
        !n.online && "text-muted-foreground",
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Country node={n} />
          <span className="truncate text-sm font-medium" title={n.name}>{n.name}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {n.public_remark || [n.virt !== "none" && n.virt, n.arch, n.cpu_cores ? `${n.cpu_cores} 核` : ""].filter(Boolean).join(" · ") || "等待首次上报"}
        </div>
      </div>
      <div className="tnum min-w-0 text-xs">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", n.online ? "bg-online" : deployed(n) ? "bg-offline" : "bg-muted-foreground/40")} />
          {n.online ? "在线" : deployed(n) ? "离线" : "未接入"}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {n.online ? (m ? uptime(m.uptime) : "") : deployed(n) && sinceSeen(n) >= 60 ? uptime(sinceSeen(n)) : ""}
        </div>
      </div>
      <Bar pct={m ? m.cpu : null} foot={m ? m.load.map((x) => x.toFixed(2)).join(" ") : undefined} />
      <Bar pct={m ? percent(m.mem_used, m.mem_total) : null} foot={m ? bytes(m.mem_total) : undefined} />
      <Bar pct={m ? percent(m.disk_used, m.disk_total) : null} foot={m ? bytes(m.disk_total) : undefined} />
      <div className="tnum min-w-0 text-xs">
        <div className="truncate"><span className="text-rx">↓</span> {m ? rate(m.net_rx) : "—"}</div>
        <div className="mt-0.5 truncate"><span className="text-tx">↑</span> {m ? rate(m.net_tx) : "—"}</div>
      </div>
      <div className="min-w-0">
        {n.traffic_limit > 0 ? (
          <Bar pct={percent(used, n.traffic_limit)} foot={`${bytes(used)} / ${bytes(n.traffic_limit)}`} />
        ) : (
          <div className="tnum text-xs">
            {bytes(used)} <span className="text-muted-foreground">· {FOREVER}</span>
          </div>
        )}
      </div>
      <div className="tnum min-w-0 text-xs">
        {price && (
          <div className="truncate" title={billed ? `账单 ${money(n.price, code)}` : undefined}>
            {n.price > 0 ? (
              <>
                {billed ? `≈${pick(billed)}` : money(n.price, code)}
                <span className="text-muted-foreground"> / {cycle(n.billing_cycle)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">免费</span>
            )}
          </div>
        )}
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {price && worth ? `剩余 ${pick(worth)} · ` : ""}
          <span className={days !== null && days < 0 ? "text-hot" : days !== null && days <= 7 ? "text-warn" : undefined}>
            {days === null ? "永不到期" : days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `${days} 天到期`}
          </span>
        </div>
      </div>
    </div>
  )
})
