import { useEffect, useState } from "react"

import { readNodesSnapshot, recordNodesSnapshot } from "./admin.ts"
import { whenStill } from "./still.ts"

export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  swap_total: number
  swap_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  tcp: number
  udp: number
  procs: number
}

export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  online: boolean
  /** ISO 3166-1 alpha-2, or empty when the hub could not locate the address. */
  country: string
  /** Set by the operator; empty is ungrouped. Absent from a hub predating groups. */
  group?: string
  /** One line the operator wrote for visitors, plain text; empty for none. Absent on older hubs. */
  public_remark?: string
  last_seen: number
  /** Seconds since `last_seen` on the hub's clock, null for a node never seen. Absent on older hubs. */
  last_seen_ago?: number | null
  metrics: Metrics | null
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  /**
   * Days until `expires_at` on the hub's calendar, negative once past, null
   * without a date. Absent on older hubs.
   */
  expires_in?: number | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  /** This period's usage as the plan meters it (`traffic_mode`). Absent on older hubs. */
  month_used?: number
  month_start: string
  day_rx: number
  day_tx: number
  /** Panel only. */
  hostname?: string
  ip?: string
  remark?: string
}

/** Every group in use, in the order of the first node carrying it: the operator's node order decides the tab order. */
export function groupsOf(nodes: Pick<Node, "group">[]): string[] {
  return [...new Set(nodes.map((n) => n.group ?? "").filter(Boolean))]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Every error the hub answers is one line of plain text written for the reader.
 * Anything else came from something in front of it -- a proxy's error page, a
 * CDN's challenge, an empty 502 -- and is described by its status instead.
 */
async function failure(res: Response): Promise<ApiError> {
  const text = res.headers.get("content-type")?.startsWith("text/plain") ? (await res.text()).trim() : ""
  return new ApiError(
    res.status,
    text || (res.status >= 500 ? `服务暂时无法访问（HTTP ${res.status}），稍后再试` : `请求被拦截（HTTP ${res.status}），稍后再试`),
  )
}

/**
 * How long one attempt may go unanswered. A connection that died without
 * closing, as when a NAT on a phone's path forgets it, holds a request sent over
 * it until TCP gives up: still pending after 300 s in Chrome over HTTP/1.1,
 * which nginx serves unless configured for HTTP/2. Over HTTP/2 Chrome replaces
 * the dead connection after 10 s itself, but only for a request sent once the
 * connection has been idle 10 s; one sent sooner hangs as over HTTP/1.1.
 * Healthy, the slowest request here, a node's history, answers within 3 s on 4G.
 */
const TIMEOUT = 20_000

/**
 * Further attempts after a timeout. The aborted connection is closed, but the
 * next attempt takes the next idle one, which may be dead as well: Chrome keeps
 * up to six per host, and with four dead the fifth attempt was the first to
 * succeed. Every request here is a GET, so repeating one is safe.
 */
const RETRIES = 6

export async function api<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api${path}`, { signal: AbortSignal.timeout(TIMEOUT) })
      if (!res.ok) throw await failure(res)
      if (res.status === 204) return undefined as T
      // A 200 carrying HTML is a proxy's page, not the hub's JSON.
      return await res.json().catch((e) => {
        throw e instanceof SyntaxError ? new ApiError(res.status, "收到的不是状态数据，稍后再试") : e
      })
    } catch (e) {
      if (e instanceof ApiError) throw e
      // Anything else failed on the network, the body's read included, where
      // the timeout also applies. Chrome names a timeout before the response
      // TimeoutError and one during the body's read AbortError; nothing else
      // here aborts a request.
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
      if (!timedOut || attempt === RETRIES) {
        throw new ApiError(0, "网络连接失败，稍后再试")
      }
    }
  }
}

/**
 * Throughput, one entry per push, of every node that was reporting in it. Kept
 * by node rather than summed: the summary follows whatever the list is narrowed
 * to -- a group, a country, a search -- and draws the line of exactly those
 * nodes, which a sum taken at arrival could not be split back into. Held beside
 * the stream that feeds it rather than in the tile that draws it: the summary
 * unmounts while a node page is open, so a buffer held there would restart
 * empty on every return.
 *
 * Ten minutes, on a time axis: each entry carries when it was taken. Live pushes
 * come every two seconds; what came before the page opened, or while it was
 * hidden, is filled from the hub's history in its minute buckets (`backfill`),
 * so the line is whole from the first paint and after a return, rather than a
 * sliver growing from the right edge.
 */
export const SPEED_WINDOW = 10 * 60_000
type Speeds = Map<number, { rx: number; tx: number }>
export const speedHistory: { at: number; speeds: Speeds }[] = []

function trimSpeeds(now: number) {
  while (speedHistory.length && speedHistory[0].at < now - SPEED_WINDOW) speedHistory.shift()
}

export function sample(nodes: Node[], at = Date.now()) {
  const speeds: Speeds = new Map()
  for (const n of nodes) {
    if (n.online && n.metrics) speeds.set(n.id, { rx: n.metrics.net_rx, tx: n.metrics.net_tx })
  }
  speedHistory.push({ at, speeds })
  trimSpeeds(at)
}

/** The throughput line of the nodes `ids`: their sum in each entry kept, with its time. */
export function throughput(ids: Iterable<number>): { at: number; rx: number; tx: number }[] {
  const wanted = [...ids]
  return speedHistory.map(({ at, speeds }) => {
    const total = { at, rx: 0, tx: 0 }
    for (const id of wanted) {
      const speed = speeds.get(id)
      if (speed) {
        total.rx += speed.rx
        total.tx += speed.tx
      }
    }
    return total
  })
}

/**
 * A history query (`/nodes/{id}/metrics`), queued. The hub answers a fifth
 * concurrent one with 503 rather than queueing it, and this page asks for
 * several at once -- the throughput fill, the cards' latency, a node page --
 * so they wait here instead, two at a time, and a 503 is tried again shortly,
 * three times at most.
 */
const HISTORY_AT_ONCE = 2
const historyQueue: (() => void)[] = []
let historyRunning = 0
function historyPump() {
  while (historyRunning < HISTORY_AT_ONCE && historyQueue.length) {
    historyRunning++
    historyQueue.shift()!()
  }
}
export function history<T>(path: string, priority = false, attempt = 0): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      api<T>(path)
        .then(resolve, (e: unknown) => {
          if (e instanceof ApiError && e.status === 503 && attempt < 3) {
            setTimeout(() => history<T>(path, priority, attempt + 1).then(resolve, reject), 1500 * (attempt + 1))
          } else reject(e)
        })
        .finally(() => {
          historyRunning--
          historyPump()
        })
    }
    // Foreground detail-page queries cut ahead of background backfill / card ping queues.
    if (priority) historyQueue.unshift(run)
    else historyQueue.push(run)
    historyPump()
  })
}

// Past this many reporting nodes the fill is skipped: one request each, and a
// sum missing some of them would draw a dip that never happened.
const BACKFILL_MAX = 48

/**
 * Fills the line between `from` and `to` (ms) from the hub's minute buckets of
 * every node in `ids`, each placed at its bucket's middle, wherever no entry
 * already lies within half a minute of it: the start of the window and any
 * gap, whatever else the line holds. All or nothing: if
 * any node's history fails, nothing is added, for the same reason. A hub without
 * the history, or one that keeps it from anonymous visitors, simply adds none.
 */
export async function backfill(ids: number[], from: number, to: number) {
  if (!ids.length || ids.length > BACKFILL_MAX || to - from < 60_000) return
  type Bucket = { ts: number; net_rx: number; net_tx: number }
  const hours = Math.min(24, Math.max(1, Math.ceil((Date.now() - from) / 3_600_000)))
  const minutes = Math.ceil((Date.now() - from) / 60_000) + 2
  const answers: { id: number; metrics: Bucket[]; step: number }[] = []
  try {
    // Queued with every other history query (`history`).
    {
      const got = await Promise.all(ids.map((id) =>
        history<{ metrics?: Bucket[]; step?: number }>(`/nodes/${id}/metrics?hours=${hours}&points=${Math.min(1440, hours * 60)}&series=metrics`)
          .then((h) => ({ id, metrics: (h?.metrics ?? []).slice(-minutes), step: h?.step ?? 60 }))))
      answers.push(...got)
    }
  } catch {
    return
  }
  const filled = new Map<number, Speeds>()
  for (const { id, metrics, step } of answers) {
    for (const b of metrics) {
      const at = b.ts * 1000 + (step * 1000) / 2
      if (at < from || at >= to) continue
      if (speedHistory.some((e) => Math.abs(e.at - at) < 30_000)) continue
      let speeds = filled.get(at)
      if (!speeds) filled.set(at, (speeds = new Map()))
      speeds.set(id, { rx: b.net_rx, tx: b.net_tx })
    }
  }
  if (!filled.size) return
  for (const [at, speeds] of filled) speedHistory.push({ at, speeds })
  speedHistory.sort((a, b) => a.at - b.at)
  trimSpeeds(Date.now())
}

/** A malformed report must not remove every other node from the page. */
export function safeNodes(nodes: Node[]): Node[] {
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0
  const fields = ["uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used", "disk_total", "disk_used",
    "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx", "tcp", "udp", "procs"] as const
  return nodes.map((node) => {
    const m = node.metrics
    return !m || (fields.every((key) => number(m[key])) && Array.isArray(m.load) && m.load.length === 3 && m.load.every(number))
      ? node : { ...node, metrics: null }
  })
}

/**
 * Whether two reports of a node say the same thing: every field equal, the
 * metrics and their load averages compared field by field. Two levels deep is
 * all a node has.
 */
function same(a: unknown, b: unknown, depth = 2): boolean {
  if (Object.is(a, b)) return true
  if (!depth || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1))
}

/**
 * The nodes of `next`, each replaced by its object in `previous` when nothing
 * in it changed. Every push parses into all-new objects, so without this no
 * card could tell by identity that its node is as it was, and every card on
 * the page would draw again every two seconds -- an offline one included.
 */
export function reuseNodes(previous: Map<number, Node>, next: Node[]): Node[] {
  return next.map((node) => {
    const old = previous.get(node.id)
    return old && same(old, node) ? old : node
  })
}

/**
 * Asks the hub to gzip each pushed frame, sent then as a binary message: a
 * hundred reporting nodes are about 110 KB of JSON every two seconds, 15 KB
 * compressed. Only where the browser can decompress it; a hub that predates the
 * parameter ignores it and sends text, which [frameText] passes through.
 */
const GZIP = typeof DecompressionStream === "function" ? "?gzip" : ""

/** A pushed frame as text: a gzipped one arrives as binary. */
const frameText = (data: string | Blob) =>
  typeof data === "string" ? data : new Response(data.stream().pipeThrough(new DecompressionStream("gzip"))).text()

/**
 * Live node list. Uses the WebSocket the hub pushes every two seconds, falling
 * back to polling if it cannot be established.
 */
export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(() => {
    const cached = readNodesSnapshot<Node>()
    if (!cached) return null
    const safe = safeNodes(cached)
    if (speedHistory.length === 0) sample(safe)
    return safe
  })
  const [error, setError] = useState<string | null>(null)
  // Set when the hub answers 401: the status page has been closed to anonymous
  // callers since this tab loaded. The hub also ends the stream, so this surfaces
  // on the fallback fetch the reconnect starts; a close allows a client to
  // re-query its state but cannot compel it.
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let silent: ReturnType<typeof setTimeout> | null = null

    // The throughput line is on a time axis, so a gap -- the page hidden, the
    // stream silent -- is time with no pushes. The first arrival on load, and
    // the first after a return, fill it from the hub's minute history.
    let gap = true
    let previous = new Map<number, Node>()
    const receive = (list: Node[]) => {
      const safe = reuseNodes(previous, safeNodes(list))
      previous = new Map(safe.map((n) => [n.id, n]))
      const now = Date.now()
      if (gap) void backfill(safe.filter((n) => n.online && n.metrics).map((n) => n.id), now - SPEED_WINDOW, now)
      gap = false
      sample(safe, now)
      // Not mid-way through a palette change, where a full re-render would stall it.
      whenStill("nodes", () => {
        setNodes(safe)
        setError(null)
        setClosed(false)
      })
    }

    // The snapshot a reload or the panel mounts from. Serialising it is some
    // 30 KB of JSON into sessionStorage, which on every push cost more than the
    // push itself; only the last one before the page goes is ever read. So the
    // first is kept at once, for a handoff to the panel straight after load, and
    // the rest wait for the page to be hidden, left or unmounted -- the panel's
    // handoff unmounts this page before it asks for the list.
    let saved = false
    let unsaved: { nodes: Node[]; admin?: boolean } | null = null
    const record = (nodes: Node[], admin?: boolean) => {
      if (saved) {
        unsaved = { nodes, admin }
        return
      }
      saved = true
      recordNodesSnapshot(nodes, admin)
    }
    const save = () => {
      if (unsaved) recordNodesSnapshot(unsaved.nodes, unsaved.admin)
      unsaved = null
    }

    // Bumped by `pause`: a request started before the page was hidden may fail
    // or land after a fresh one, and neither result describes the page now.
    let epoch = 0
    const fetchOnce = () => {
      const started = epoch
      return api<{ nodes: Node[]; admin?: boolean }>("/nodes")
        .then((d) => {
          if (started !== epoch) return
          record(d.nodes, d.admin)
          receive(d.nodes)
        })
        .catch((e: Error) => {
          if (started !== epoch) return
          // A request lost on a dead pooled connection says nothing of an open
          // stream, whose own watchdog reports it going quiet.
          if (e instanceof ApiError && e.status === 0 && socket?.readyState === WebSocket.OPEN) return
          setError(e.message)
          if (e instanceof ApiError && e.status === 401) setClosed(true)
        })
    }

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws${GZIP}`
    // A hub restart closes every stream. Without reconnecting, a page that
    // outlives a deploy would remain on the fallback poll for the rest of its
    // life, refreshing every 5 seconds rather than 2 with no indication.
    const connect = () => {
      let opened: WebSocket
      try {
        opened = new WebSocket(url)
      } catch {
        poll ??= setInterval(fetchOnce, 5000)
        return
      }
      socket = opened
      // Re-armed by every frame read. Five of the hub's two-second pushes without one
      // mean the connection died without closing, as when a NAT on the path
      // forgets it or the hub's machine drops off the network; the browser sends
      // nothing on it and would notice only when TCP keepalive gives up, 450 s
      // later in Chrome. The stream is replaced rather
      // than closed and awaited: on a dead connection the close event arrives
      // only after the 60 s closing handshake times out. The notice stays until
      // data arrives, since with no network the fetch started alongside may hang
      // rather than fail.
      const watch = () => {
        if (silent) clearTimeout(silent)
        silent = setTimeout(() => {
          setError("实时数据中断，正在重新连接")
          resume()
        }, 10_000)
      }
      watch()
      // In arrival order: a gzipped frame decodes asynchronously, and one that
      // finishes after this stream closed or was replaced describes nothing
      // current. Only a frame that reads re-arms the watchdog, so a stream whose
      // frames cannot be read counts as silent and is replaced.
      let decoded = Promise.resolve()
      opened.onmessage = (event) => {
        decoded = decoded
          .then(async () => {
            const frame = JSON.parse(await frameText(event.data)) as { nodes: Node[]; admin?: boolean }
            if (opened.readyState !== WebSocket.OPEN) return
            watch()
            record(frame.nodes, frame.admin)
            receive(frame.nodes)
            // The stream has returned; the poll was only covering for it.
            if (poll) {
              clearInterval(poll)
              poll = null
            }
          })
          .catch((e) => console.warn("live frame dropped:", e))
      }
      opened.onerror = () => opened.close()
      opened.onclose = () => {
        if (silent) clearTimeout(silent)
        poll ??= setInterval(fetchOnce, 5000)
        retry = setTimeout(connect, 5000)
      }
    }

    // A phone suspends a page it sends to the background and drops its
    // connections without telling it. Back in front, the socket may still read
    // as open while nothing arrives, or close and wait out the retry, either
    // way leaving the figures from before; a request caught in flight fails.
    // So a hidden page lets go of the stream and starts nothing, and a visible
    // one fetches at once and opens a fresh stream.
    const pause = () => {
      save()
      epoch++
      if (socket) {
        socket.onclose = null
        socket.close()
        socket = null
      }
      if (poll) clearInterval(poll)
      if (retry) clearTimeout(retry)
      if (silent) clearTimeout(silent)
      poll = retry = silent = null
    }
    const resume = () => {
      pause()
      gap = true
      fetchOnce()
      connect()
    }
    const visibility = () => (document.hidden ? pause() : resume())
    document.addEventListener("visibilitychange", visibility)
    // A reload or a link away does not always hide the page first.
    addEventListener("pagehide", save)
    resume()

    return () => {
      document.removeEventListener("visibilitychange", visibility)
      removeEventListener("pagehide", save)
      pause()
    }
  }, [])

  return { nodes, error, closed }
}
