import type { CSSProperties } from "react"
import { BackIcon, InIcon, OutIcon, TagIcon } from "@/components/icons"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Flag, hasFlag } from "@/components/Flag"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { convert, remaining, type Rates } from "@/lib/cost"
import { bytes, cycle, daysUntil, FOREVER, money, osName, pair, percent, rate, sinceSeen, uptime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Matched against the whole release name, since "Red Hat Enterprise Linux" and
// "Raspbian GNU/Linux" do not lead with one word to key on. The distributions a
// VPS ships with; the rest take the penguin. Each logo costs 1-6 KB of entry
// bundle, so the list stays at what hosts offer.
const DISTROS: [string, SimpleIcon][] = [
  ["debian", siDebian], ["raspbian", siDebian], ["ubuntu", siUbuntu], ["alpine", siAlpinelinux],
  ["centos", siCentos], ["rocky", siRockylinux], ["almalinux", siAlmalinux], ["red hat", siRedhat],
  ["fedora", siFedora], ["arch", siArchlinux], ["opensuse", siOpensuse],
]

/**
 * This period's usage as the plan meters it. The hub computes it; the switch
 * below serves only a hub from before `month_used`.
 */
export function monthUsage(node: Node): number {
  if (typeof node.month_used === "number") return node.month_used
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

// A node that has reported once has told the hub its shape -- cores, memory,
// disk -- and the hub retains its traffic totals whether connected or not. A node
// that never connected is the only case with nothing to show.
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

/**
 * Days until the node's term ends, as the hub counts them: it renews an online
 * node by its own calendar, and counting on the visitor's would show the node
 * expired for hours before that. Only a hub from before `expires_in` leaves the
 * count to the browser. null without a date.
 */
export function daysLeft(node: Node): number | null {
  return node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)
}

/**
 * The dot plus how long the machine has been up, or once it is gone, how long it
 * has been absent -- the first question asked of an offline node. Both are
 * durations, so the badge keeps its shape either way.
 */
export function Status({ node }: { node: Node }) {
  const down = sinceSeen(node)
  // Whole days once there are any: on a badge, "11 天" reads at a glance where
  // "11 天 3 小时" is a sentence. The full figure is on hover.
  const short = (seconds: number) => (seconds >= 86400 ? `${Math.floor(seconds / 86400)} 天` : uptime(seconds))
  const label = node.online
    ? `在线 ${node.metrics ? short(node.metrics.uptime) : ""}`
    : deployed(node)
      ? `离线 ${down >= 60 ? short(down) : ""}`
      : "未接入"
  const full = node.online ? (node.metrics ? `已运行 ${uptime(node.metrics.uptime)}` : "已连上，等待上报") : deployed(node) && down >= 60 ? `离线 ${uptime(down)}` : undefined
  return (
    // Muted once it stops reporting: the figures on the page are genuine, merely
    // no longer current.
    <Badge
      title={full}
      className={cn("tnum shrink-0 gap-1.5 font-normal", !node.online && "text-muted-foreground")}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          node.online ? "bg-online" : deployed(node) ? "bg-offline" : "bg-muted-foreground/40",
        )}
      />
      {label.trim()}
    </Badge>
  )
}

/** Where the machine is: its flag, or the bare code for one the set lacks. */
export function Country({ node }: { node: Node }) {
  if (!node.country) return null
  if (hasFlag(node.country)) return <Flag code={node.country} />
  return (
    <Badge className="shrink-0 font-normal text-muted-foreground">
      {node.country}
    </Badge>
  )
}

/**
 * The distribution's logo in its brand colour, standing in for the name, which
 * shows on hover. Mixed toward white on the dark theme, where AlmaLinux's black
 * and CentOS's navy would otherwise vanish.
 */
function OsIcon({ os }: { os: string }) {
  const name = os.toLowerCase()
  const icon = DISTROS.find(([key]) => name.includes(key))?.[1] ?? siLinux
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      style={{ "--brand": `#${icon.hex}` } as CSSProperties}
      className="size-3 shrink-0 fill-(--brand) dark:fill-[color-mix(in_oklab,var(--brand)_60%,white)]"
    >
      <title>{osName(os)}</title>
      <path d={icon.path} />
    </svg>
  )
}

// Traffic uses the plan's own counting rule, so the bar matches the quota the
// node is billed against.
function trafficFoot(node: Node) {
  return node.traffic_limit > 0
    ? pair(monthUsage(node), node.traffic_limit)
    : `${bytes(monthUsage(node))} / ${FOREVER}`
}

// No date means nothing expires: a permanent host, or one with no renewal set. A
// blank corner asserts neither. Past the date is the page's red; within a week
// of it, the amber before the red.
function Expiry({ node }: { node: Node }) {
  const days = daysLeft(node)
  if (days === null) return <span className="text-xs text-muted-foreground" title="没有到期日">长期</span>
  const tone = days < 0 ? "text-hot" : days <= 7 ? "text-warn" : "text-muted-foreground"
  return (
    <span className={cn("tnum text-xs", tone)}>
      {days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `${days} 天后到期`}
    </span>
  )
}

/**
 * What the node costs and what is left of it, the card's last line, counted
 * only in renminbi and dollars. A price billed in either stays as billed; one
 * billed in anything else is shown in the operator's counting currency, with
 * the original on hover. On the right, what the days until expiry are worth,
 * in that same currency, so every card's figure compares with the next.
 */
function Price({ node, rates, primary }: { node: Node; rates: Rates; primary: "CNY" | "USD" }) {
  const days = daysLeft(node)
  const left = remaining(node, days)
  const code = node.currency.toUpperCase()
  const pick = (both: { cny: number; usd: number }) => (primary === "CNY" ? money(both.cny, "CNY") : money(both.usd, "USD"))
  const billed = node.price > 0 && code !== "CNY" && code !== "USD" ? convert(node.price, code, rates) : null
  const worth = left === null ? null : convert(left, code, rates)
  return (
    <div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
      <span
        className="tnum inline-flex min-w-0 items-center gap-1.5"
        title={billed ? `账单 ${money(node.price, code)}` : undefined}
      >
        <TagIcon className="size-3 shrink-0 text-muted-foreground" />
        {node.price > 0 ? (
          <span className="truncate">
            {billed ? `≈${pick(billed)}` : money(node.price, code)}
            <span className="text-muted-foreground"> / {cycle(node.billing_cycle)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">免费</span>
        )}
      </span>
      {left !== null && (
        <span
          className="tnum inline-flex min-w-0 shrink-0 items-baseline gap-1.5"
          title={`剩余 ${days} 天按当前价格折算${worth ? `：${money(worth.cny, "CNY")} ≈ ${money(worth.usd, "USD")}` : ""}`}
        >
          <span className="text-muted-foreground">剩余</span>
          <span className="font-medium">{worth ? pick(worth) : money(left, code)}</span>
        </span>
      )}
    </div>
  )
}

export function NodeCard({ node, price, rates, primary, onOpen }: {
  node: Node
  /** Whether to draw the price row: the operator's setting, and some node having a price. */
  price: boolean
  rates: Rates
  primary: "CNY" | "USD"
  onOpen: () => void
}) {
  const m = node.metrics

  return (
    <Card
      onClick={onOpen}
      // min-w-0: a grid item sizes to its content unless told otherwise, and the
      // OS line below does not wrap, so on a phone the card would grow past its
      // column and scroll the page sideways. The truncate inside only takes effect
      // once the card is allowed to be narrower.
      className={cn(
        "min-w-0 cursor-pointer gap-0 p-4 transition-colors hover:border-ring",
        // Gone quiet: a red edge and a faint red wash, so it is found at a glance
        // in a grid of live ones.
        !node.online && deployed(node) && "border-hot/40 bg-[color-mix(in_srgb,var(--hot)_5%,var(--card))]",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Country node={node} />
            <h3 className="truncate font-medium" title={node.name}>{node.name}</h3>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {node.os && <OsIcon os={node.os} />}
            <span className="truncate">
              {node.os
                ? [node.virt !== "none" && node.virt, node.arch].filter(Boolean).join(" · ")
                : "等待首次上报"}
            </span>
          </p>
        </div>
        {/* State right, identity left, one line each. */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Status node={node} />
          <Expiry node={node} />
        </div>
      </div>

      {/* What the operator wants a visitor to know about this node, in their
          words. Plain text, one line; the whole of it is on the node's page. */}
      {node.public_remark && (
        <p className="mt-2 truncate text-xs text-muted-foreground" title={node.public_remark}>
          {node.public_remark}
        </p>
      )}

      {/* One layout for both states: a disconnected node still knows its
          cores, memory, disk size and traffic totals, and showing those with
          the live figures blank beats a stretched card with one line in it. */}
      {deployed(node) ? (
        <div className="relative flex flex-1 flex-col">
          {/* The last figures it reported, faded, with how long it has been
              gone set over them. */}
          {!node.online && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span className="tnum rounded-full border border-hot/40 bg-card px-3 py-1 text-xs font-medium text-hot shadow-xs">
                离线
              </span>
            </div>
          )}
          <div className={cn("flex flex-1 flex-col", !node.online && "opacity-35")}>
          <div className="mt-4 mb-4 grid grid-cols-2 gap-x-4 gap-y-4">
            {/* The core count belongs beside the word CPU: it is what the
                percentage and the load averages are both measured against. */}
            <Meter
              label={`CPU ${node.cpu_cores} 核`}
              pct={m ? m.cpu : null}
              foot={m ? m.load.map((n) => n.toFixed(2)).join(" ") : "—"}
            />
            <Meter
              label="内存"
              pct={m ? percent(m.mem_used, m.mem_total) : null}
              foot={m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)}
            />
            <Meter
              label="硬盘"
              pct={m ? percent(m.disk_used, m.disk_total) : null}
              foot={m ? pair(m.disk_used, m.disk_total) : bytes(node.disk_total)}
            />
            <Meter
              label="流量"
              pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null}
              empty={FOREVER}
              foot={trafficFoot(node)}
            />
          </div>

          <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 text-xs">
            <span className="tnum inline-flex items-center gap-1.5">
              <InIcon className="size-3 text-muted-foreground" />
              {m ? rate(m.net_rx) : "—"}
            </span>
            <span className="tnum inline-flex items-center gap-1.5">
              <OutIcon className="size-3 text-muted-foreground" />
              {m ? rate(m.net_tx) : "—"}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <InIcon className="size-3" />
              {bytes(node.total_rx)}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <OutIcon className="size-3" />
              {bytes(node.total_tx)}
            </span>
          </div>
          </div>
          {price && <Price node={node} rates={rates} primary={primary} />}
        </div>
      ) : (
        /* Never connected: nothing to plot, so the card stays short rather than
           padding out to match its neighbours. */
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          还没有接入。在后台生成安装命令并执行一次。
        </p>
      )}
    </Card>
  )
}

/**
 * A node's name and state, large, at the head of its page: on the water above
 * the sheet of facts and charts, as the overview is above the list. With the
 * operator's line for visitors under it, whole.
 */
export function NodeHead({ node, onBack }: { node: Node; onBack: () => void }) {
  return (
    <section data-pond-avoid="" data-pond-dim="box" className="relative mx-auto w-full max-w-[1320px] px-4 pt-2 pb-10 sm:px-6 lg:pt-4 lg:pb-12">
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <BackIcon className="size-4" /> 全部节点
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Country node={node} />
        <h1 className="min-w-0 truncate text-3xl font-medium tracking-tight sm:text-4xl" title={node.name}>{node.name}</h1>
        <Status node={node} />
        {node.agent_version && <Badge className="tnum font-normal text-muted-foreground">agent {node.agent_version}</Badge>}
        {node.group && <Badge className="font-normal text-muted-foreground">{node.group}</Badge>}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {[osName(node.os), node.virt !== "none" ? node.virt : "", node.arch].filter(Boolean).join(" · ") || "等待首次上报"}
      </p>
      {node.public_remark && (
        <p className="mt-4 max-w-2xl border-l-2 border-marker/60 pl-3 text-sm leading-relaxed break-words">
          {node.public_remark}
        </p>
      )}
    </section>
  )
}
