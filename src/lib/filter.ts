import type { Node } from "./api.ts"
import { countryName } from "./countries.ts"
import { monthly } from "./cost.ts"
import { daysUntil, percent } from "./format.ts"

/** The orders the list can be put in. `default` is the operator's own. */
export const SORTS = [
  ["default", "默认排序"],
  ["name", "名称"],
  ["cpu", "CPU"],
  ["mem", "内存"],
  ["disk", "硬盘"],
  ["traffic", "流量"],
  ["speed", "网速"],
  ["ping", "延迟"],
  ["expiry", "到期"],
  ["price", "价格"],
] as const

export type SortKey = (typeof SORTS)[number][0]

export const isSortKey = (v: unknown): v is SortKey => SORTS.some(([key]) => key === v)

// What a node is ranked by under each order, or null where it has nothing to be
// ranked by -- no live metrics, no expiry date, no price -- which puts it after
// every node that has. The largest first, except the date nearest first.
const RANK: Record<Exclude<SortKey, "default" | "name" | "ping">, (n: Node) => number | null> = {
  cpu: (n) => n.metrics?.cpu ?? null,
  mem: (n) => (n.metrics ? percent(n.metrics.mem_used, n.metrics.mem_total) : null),
  disk: (n) => (n.metrics ? percent(n.metrics.disk_used, n.metrics.disk_total) : null),
  traffic: (n) => {
    const used = typeof n.month_used === "number" ? n.month_used : n.month_rx + n.month_tx
    // Against the quota where there is one; a plan without one ranks by what it
    // has moved, after every plan that has.
    return n.traffic_limit > 0 ? 1e6 + percent(used, n.traffic_limit) : used / 2 ** 50
  },
  speed: (n) => (n.metrics ? n.metrics.net_rx + n.metrics.net_tx : null),
  expiry: (n) => {
    const days = n.expires_in !== undefined ? n.expires_in : daysUntil(n.expires_at)
    return days === null ? null : -days
  },
  price: (n) => monthly(n),
}

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })

/** The operator's order: `sort`, then the order the nodes were added in. */
const byDefault = (a: Node, b: Node) => a.sort - b.sort || a.id - b.id

export function sortNodes(nodes: Node[], key: SortKey, ping?: ReadonlyMap<number, number | null>): Node[] {
  if (key === "default") return [...nodes].sort(byDefault)
  if (key === "name") return [...nodes].sort((a, b) => collator.compare(a.name, b.name) || byDefault(a, b))
  const rank =
    key === "ping"
      ? (n: Node) => {
          const ms = ping?.get(n.id)
          if (ms === undefined || ms === null) return null
          return Number.isFinite(ms) ? -ms : -1e9
        }
      : RANK[key]
  // Ranked once a node rather than once a comparison.
  return nodes
    .map((node) => ({ node, value: rank(node) }))
    .sort((a, b) =>
      a.value === null || b.value === null
        ? Number(a.value === null) - Number(b.value === null) || byDefault(a.node, b.node)
        : b.value - a.value || byDefault(a.node, b.node),
    )
    .map((entry) => entry.node)
}

/**
 * The nodes matching what was typed: every word of it found somewhere in the
 * node's name, group, country, system or public remark -- and in its private
 * remark, hostname and address, which only a signed-in operator is sent.
 */
export function searchNodes(nodes: Node[], query: string): Node[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return nodes
  return nodes.filter((n) => {
    const text = [
      n.name, n.group, n.country, n.country && countryName(n.country), n.os, n.arch, n.virt, n.public_remark,
      n.remark, n.hostname, n.ip,
    ].filter(Boolean).join("\n").toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

/**
 * What the list is narrowed to. `null` is "all" for the group and the country,
 * never a string: a group may be named anything, 全部 included. `""` is the
 * ungrouped.
 */
export type Filters = { group: string | null; region: string | null; query: string; sort: SortKey; status: Status | null }

export const NO_FILTERS: Filters = { group: null, region: null, query: "", sort: "default", status: null }

/**
 * The states a node can be picked out by, as in the hub's own node list:
 * gone quiet, near its traffic quota, near or past its expiry, and -- seen only
 * by a signed-in operator -- not public.
 */
export const STATUSES = [
  ["offline", "离线"],
  ["traffic", "流量预警"],
  ["expiring", "即将到期"],
  ["private", "不公开"],
] as const
export type Status = (typeof STATUSES)[number][0]

/** Past this share of its quota, a plan's traffic is a warning. */
export const TRAFFIC_WARN = 80
/** Within this many days of its expiry, or past it, a node is expiring. */
const EXPIRY_WARN = 7

export function hasStatus(n: Node, status: Status): boolean {
  switch (status) {
    case "offline":
      return !n.online && (n.cpu_cores > 0 || n.mem_total > 0)
    case "traffic": {
      if (!(n.traffic_limit > 0)) return false
      const used = typeof n.month_used === "number" ? n.month_used : n.month_rx + n.month_tx
      return percent(used, n.traffic_limit) >= TRAFFIC_WARN
    }
    case "expiring": {
      const days = n.expires_in !== undefined ? n.expires_in : daysUntil(n.expires_at)
      return days !== null && days <= EXPIRY_WARN
    }
    case "private":
      return n.public === false
  }
}

/**
 * The nodes as narrowed by `filters`, in order. A group tab or a country that
 * has since emptied -- renamed, the node moved -- falls back to all of them
 * rather than to an empty page; the caller writes the corrected filters back.
 */
export function narrow(nodes: Node[], filters: Filters, ping?: ReadonlyMap<number, number | null>) {
  const groups = [...new Set(nodes.map((n) => n.group ?? "").filter(Boolean))]
  const ungrouped = nodes.filter((n) => !n.group).length
  const group =
    filters.group === null || (filters.group === "" ? ungrouped > 0 : groups.includes(filters.group))
      ? filters.group
      : null
  const inGroup = group === null ? nodes : nodes.filter((n) => (n.group ?? "") === group)
  const inCountry = (n: Node, code: string) => (n.country ?? "").toUpperCase() === code
  const region = filters.region !== null && inGroup.some((n) => inCountry(n, filters.region!)) ? filters.region : null
  const inRegion = region === null ? inGroup : inGroup.filter((n) => inCountry(n, region))
  const status = filters.status
  const inStatus = status === null ? inRegion : inRegion.filter((n) => hasStatus(n, status))
  const shown = sortNodes(searchNodes(inStatus, filters.query), filters.sort, ping)
  // How many of the nodes the group and country leave are in each state, for the chips.
  const counts = Object.fromEntries(STATUSES.map(([key]) => [key, inRegion.filter((n) => hasStatus(n, key)).length])) as Record<Status, number>
  return { groups, ungrouped, group, region, inGroup, shown, counts }
}
