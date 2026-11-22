import { memo, type CSSProperties } from "react"
import { BackIcon, InIcon, OutIcon, TagIcon } from "@/components/icons"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Flag, hasFlag } from "@/components/Flag"
import { CardPing, type OpenNode } from "@/components/CardPing"
import { Meter } from "@/components/Meter"
import { TRAFFIC_WARN } from "@/lib/filter"
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
  return <StatusBadge {...statusOf(node)} />
}

type Tone = "online" | "offline" | "fresh"

/**
 * What the badge says, as plain values: the uptime moves every push, but the
 * badge shows it in whole days, so most pushes leave these unchanged and the
 * badge as it was.
 */
function statusOf(node: Node): { word: string; label: string; full: string | undefined; tone: Tone } {
  const down = sinceSeen(node)
  // Whole days once there are any, whole hours under a day: on a badge, "11 天"
  // or "12 小时" reads at a glance where "12 小时 52 分" is a sentence that
  // crowds the node's name. The full figure is on hover.
  const short = (seconds: number) =>
    seconds >= 86400 ? `${Math.floor(seconds / 86400)} 天` : seconds >= 3600 ? `${Math.floor(seconds / 3600)} 小时` : uptime(seconds)
  const word = node.online ? "在线" : deployed(node) ? "离线" : "未接入"
  const label = node.online ? (node.metrics ? short(node.metrics.uptime) : "") : deployed(node) && down >= 60 ? short(down) : ""
  const full = node.online ? (node.metrics ? `已运行 ${uptime(node.metrics.uptime)}` : "已连上，等待上报") : deployed(node) && down >= 60 ? `离线 ${uptime(down)}` : word
  return { word, label, full, tone: node.online ? "online" : deployed(node) ? "offline" : "fresh" }
}

const StatusBadge = memo(function StatusBadge({ word, label, full, tone }: { word: string; label: string; full: string | undefined; tone: Tone }) {
  return (
    // Muted once it stops reporting: the figures on the page are genuine, merely
    // no longer current.
    <Badge
      title={full}
      className={cn("tnum shrink-0 gap-1.5 font-normal", tone !== "online" && "text-muted-foreground")}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "online" ? "bg-online" : tone === "offline" ? "bg-offline" : "bg-muted-foreground/40",
        )}
      />
      {/* In a card narrower than 22 rem -- every column of a grid -- the dot
          says online or offline and the word gives its room to the node's
          name. A wider card, and the node page, keep it. */}
      <span className={cn(label && "@max-[22rem]:sr-only")}>{word}</span>
      {label && <span>{label}</span>}
    </Badge>
  )
})

/**
 * Where the machine is: its flag, or the bare code for one the set lacks.
 * Compared on the country alone, since the node it is handed is a new object
 * whenever any figure of it moves.
 */
export const Country = memo(
  function Country({ node, className }: { node: Node; className?: string }) {
    if (!node.country) return null
    if (hasFlag(node.country)) return <Flag code={node.country} className={className} />
    return (
      <Badge className="shrink-0 font-normal text-muted-foreground">
        {node.country}
      </Badge>
    )
  },
  (a, b) => a.node.country === b.node.country && a.className === b.className,
)

/**
 * The distribution's logo in its brand colour, standing in for the name, which
 * shows on hover. Mixed toward white on the dark theme, where AlmaLinux's black
 * and CentOS's navy would otherwise vanish.
 */
const OsIcon = memo(function OsIcon({ os }: { os: string }) {
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
})

// Traffic uses the plan's own counting rule, so the bar matches the quota the
// node is billed against.
function trafficFoot(node: Node) {
  return node.traffic_limit > 0
    ? pair(monthUsage(node), node.traffic_limit)
    : `${bytes(monthUsage(node))} · ${FOREVER}`
}

// No date means nothing expires: a permanent host, or one with no renewal set. A
// blank corner asserts neither. Past the date is the page's red; within a week
// of it, the amber before the red.
function Expiry({ days }: { days: number | null }) {
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
const Price = memo(function Price({ price, currency, billing_cycle, days, rates, primary }: {
  price: number
  currency: string
  billing_cycle: string
  days: number | null
  rates: Rates
  primary: "CNY" | "USD"
}) {
  const node = { price, currency, billing_cycle }
  const left = remaining(node, days)
  const code = currency.toUpperCase()
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
})

/**
 * Who and where the node is, and its state: the card's head, compared on the
 * plain values it shows, so the pushes that move only the figures below leave
 * it as it was.
 */
const CardHead = memo(function CardHead({ node, name, os, virt, arch, days, status }: {
  /** For the flag, which reads its country alone. */
  node: Node
  name: string
  os: string
  virt: string
  arch: string
  days: number | null
  status: ReturnType<typeof statusOf>
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Country node={node} />
          <h3 className="truncate font-medium @max-[20rem]:text-[14px] @max-[20rem]:tracking-tight" title={name}>{name}</h3>
        </div>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {os && <OsIcon os={os} />}
          <span className="truncate">
            {os ? [virt !== "none" && virt, arch].filter(Boolean).join(" · ") : "等待首次上报"}
          </span>
        </p>
      </div>
      {/* State right, identity left, one line each. */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge {...status} />
        <Expiry days={days} />
      </div>
    </div>
  )
}, (a, b) =>
  a.node.country === b.node.country && a.name === b.name && a.os === b.os && a.virt === b.virt && a.arch === b.arch &&
  a.days === b.days && a.status.word === b.status.word && a.status.label === b.status.label && a.status.full === b.status.full && a.status.tone === b.status.tone)

/**
 * One node, as a card. Memoised: the list hands it the node object the last
 * push left unchanged (see reuseNodes) and one onOpen for every card, taking the
 * id, so a card whose node did not move is skipped outright, and one whose did
 * draws again only the parts that changed.
 */
export const NodeCard = memo(function NodeCard({ node, price, remarks, rates, primary, onOpen }: {
  node: Node
  /** Whether to draw the price row: the operator's setting, and some node having a price. */
  price: boolean
  /**
   * Whether any card beside it carries a remark: if so every card keeps the
   * remark's line, empty or not, so the meters of a row of cards line up.
   */
  remarks: boolean
  rates: Rates
  primary: "CNY" | "USD"
  onOpen: OpenNode
}) {
  const m = node.metrics
  const days = daysLeft(node)

  return (
    <Card
      onClick={() => onOpen(node.id)}
      // Where the page returns focus on coming back from this node's page.
      data-node={node.id}
      // min-w-0: a grid item sizes to its content unless told otherwise, and the
      // OS line below does not wrap, so on a phone the card would grow past its
      // column and scroll the page sideways. The truncate inside only takes effect
      // once the card is allowed to be narrower.
      //
      // content-visibility: a push re-renders every card whose figures moved,
      // and on a phone styling and laying out the thirty cards below the fold
      // took most of each push's frame. Off screen the browser now skips them,
      // holding each at its last measured height (330px until it has one), so
      // the scrollbar does not jump as they come into view.
      //
      // Focus is a ring rather than the 1px outline every element gets, which
      // was lost against the card's own border.
      className={cn(
        "@container min-w-0 cursor-pointer gap-0 p-4 transition-colors outline-none hover:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[content-visibility:auto] [contain-intrinsic-block-size:auto_330px]",
        // Gone quiet: a red edge and a faint red wash, so it is found at a glance
        // in a grid of live ones.
        !node.online && deployed(node) && "border-hot/40 bg-[color-mix(in_srgb,var(--hot)_5%,var(--card))]",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(node.id))}
    >
      <CardHead
        node={node}
        name={node.name}
        os={node.os}
        virt={node.virt}
        arch={node.arch}
        days={days}
        status={statusOf(node)}
      />

      {/* What the operator wants a visitor to know about this node, in their
          words. Plain text, one line; the whole of it is on the node's page.
          The line is kept, empty, on a card without one while another card
          has one, or the meters below would sit a line lower on that card
          than on its neighbours. */}
      {(node.public_remark || remarks) && (
        <p
          // A phone shows one card a row, with no neighbour to line up with.
          className={cn("mt-2 h-4 truncate text-xs text-muted-foreground", !node.public_remark && "max-sm:hidden")}
          title={node.public_remark || undefined}
          aria-hidden={node.public_remark ? undefined : true}
        >
          {node.public_remark}
        </p>
      )}

      {/* One layout for both states: a disconnected node still knows its
          cores, memory, disk size and traffic totals, and showing those with
          the live figures blank beats a stretched card with one line in it. */}
      {deployed(node) ? (
        <div className="flex flex-1 flex-col">
          {/* The last figures it reported, set in the quieter ink with their
              bars faded. The badge already says it is offline, and the card's
              red edge marks it; a label set over the figures would hide the
              very ones still worth reading. Only the bars fade: fading the
              text as well left it near 2:1 against the card, too faint to read. */}
          <div className={cn("flex flex-1 flex-col", !node.online && "text-muted-foreground [&_.bg-muted]:opacity-40")}>
          <div className="mt-4 mb-4 grid grid-cols-2 gap-x-4 gap-y-4">
            {/* The core count belongs beside the word CPU: it is what the
                percentage and the load averages are both measured against. */}
            <Meter
              label={`CPU ${node.cpu_cores} 核`}
              pct={m ? m.cpu : null}
              foot={m ? `负载 ${m.load.map((n) => n.toFixed(2)).join(" ")}` : "—"}
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
              warn={TRAFFIC_WARN}
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
              累计 {bytes(node.total_rx)}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <OutIcon className="size-3" />
              累计 {bytes(node.total_tx)}
            </span>
          </div>
          <CardPing id={node.id} onOpen={onOpen} />
          </div>
          {price && (
            <Price
              price={node.price}
              currency={node.currency}
              billing_cycle={node.billing_cycle}
              days={days}
              rates={rates}
              primary={primary}
            />
          )}
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
})

/**
 * A node's name and state, large, at the head of its page: on the water above
 * the sheet of facts and charts, as the overview is above the list. With the
 * operator's line for visitors under it, whole.
 */
export function NodeHead({ node, onBack }: { node: Node; onBack: () => void }) {
  return (
    // One bottom padding for both scenes, room for the realm's graveyard under
    // the name and open water for the pond: switching scene then moves nothing
    // below it, where a padding eased between two values laid the page out
    // again on every frame of the switch.
    <section data-pond-avoid="" data-pond-dim="box" data-sky-dim="" className="relative mx-auto w-full max-w-[1320px] px-4 pt-2 pb-8 sm:px-6 sm:pb-10 lg:pt-4 lg:pb-12 [.tall-scene_&]:sm:pb-16 [.tall-scene_&]:lg:pb-20">
      <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:mb-5 sm:min-h-0">
        <BackIcon className="size-4" /> 全部节点
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Top-aligned, the flag set on the first line's middle: centred, it
            would hang between the lines of a name that wraps on a phone. */}
        <div className="flex min-w-0 items-start gap-3">
          {node.country && (
            <span className="mt-1.5 flex shrink-0 sm:mt-2">
              {/* In proportion to the name beside it, at the flag's own 3:2. */}
              <Country node={node} className="h-5 w-7.5 rounded-[3px] sm:h-6 sm:w-9" />
            </span>
          )}
          <h1 className="min-w-0 text-2xl font-medium tracking-tight break-words sm:text-4xl">{node.name}</h1>
        </div>
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
