import { createContext, memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"

import { history } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Each node's latency to a few probes -- 电信, 联通, 移动 by default -- on its
 * card and on its page: the latest round trip, a strip of the last hour (or
 * whatever the operator picked) in which a darker block is a slower stretch,
 * and the window's loss. Asked for in issue #2: "which hours were slowest".
 *
 * One history query per node and window, `series=ping`, queued with every
 * other (`history` in api.ts), asked only once the card is on screen, kept a
 * minute, and shared by the card and the page.
 */

type PingPoint = { task_id: number; ts: number; latency: number | null; loss?: number }
type PingData = { ping?: PingPoint[]; probes?: Record<string, string>; loss?: Record<string, number> }

export type PingSettings = { show: boolean; probes: string; hours: number }
export const PingConfig = createContext<PingSettings>({ show: false, probes: "", hours: 1 })

/** How many blocks the strip is drawn in. */
const SLOTS = 30
/** How long an answer is kept before the card asks again. */
const FRESH = 60_000

type Entry = { data: PingData | null; at: number; failed: boolean }
const cache = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()

function load(id: number, hours: number) {
  const key = `${id}:${hours}`
  const have = cache.get(key)
  if (inflight.has(key) || (have && Date.now() - have.at < FRESH)) return
  inflight.add(key)
  const done = (entry: Entry) => {
    inflight.delete(key)
    cache.set(key, entry)
    listeners.get(key)?.forEach((fn) => fn())
  }
  history<PingData>(`/nodes/${id}/metrics?series=ping&hours=${hours}&points=${SLOTS * 2}`)
    .then((data) => done({ data, at: Date.now(), failed: false }))
    // A failure is kept a quarter as long, and what came before stays shown.
    .catch(() => done({ data: have?.data ?? null, at: Date.now() - (FRESH * 3) / 4, failed: true }))
}

/** The latency history of node `id`, asked for while `active` and refreshed each minute. */
export function useNodePing(id: number, hours: number, active: boolean): Entry | undefined {
  const key = `${id}:${hours}`
  const entry = useSyncExternalStore(
    (notify) => {
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(notify)
      return () => set.delete(notify)
    },
    () => cache.get(key),
  )
  useEffect(() => {
    if (!active) return
    load(id, hours)
    const timer = setInterval(() => load(id, hours), FRESH / 2)
    return () => clearInterval(timer)
  }, [id, hours, active])
  return entry
}

export type ProbeLine = {
  id: number
  name: string
  /** Latest round trip in ms, null for a timeout, undefined when no samples exist in the window. */
  latest: number | null | undefined
  loss: number
  /** One block per slot: its median, null for a timeout, undefined for no data. */
  slots: (number | null | undefined)[]
  /** Window start timestamp in unix seconds, for per-slot tooltips. */
  start: number
  typical: number | null
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2
}

// The three carriers, under the names a hub's probes usually carry.
const CARRIERS = [/电信|telecom|\bct\b|chinanet/i, /联通|unicom|\bcu\b/i, /移动|mobile|\bcm\b|cmcc/i]

/** The probes to show: the operator's list by name, else the three carriers, else the first three. */
export function pickProbes(probes: Record<string, string>, wanted: string): [number, string][] {
  const all = Object.entries(probes).map(([id, name]) => [Number(id), name] as [number, string]).sort((a, b) => a[0] - b[0])
  const names = wanted.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
  if (names.length) {
    return names.flatMap((n) => all.filter(([, name]) => name === n || name.includes(n)).slice(0, 1))
  }
  const carriers = CARRIERS.flatMap((re) => all.filter(([, name]) => re.test(name)).slice(0, 1))
  return (carriers.length ? carriers : all).slice(0, 3)
}

/** The chosen probes' lines over `hours`, ending now, in SLOTS blocks. */
export function probeLines(data: PingData | null | undefined, wanted: string, hours: number): ProbeLine[] {
  if (!data?.probes || !data.ping) return []
  const end = Date.now() / 1000
  const span = hours * 3600
  const start = end - span
  return pickProbes(data.probes, wanted).map(([id, name]) => {
    const rows = data.ping!.filter((p) => p.task_id === id).sort((a, b) => a.ts - b.ts)
    const buckets: (number | null)[][] = Array.from({ length: SLOTS }, () => [])
    for (const r of rows) {
      const i = Math.floor(((r.ts - start) / span) * SLOTS)
      if (i >= 0 && i < SLOTS) buckets[i].push(r.latency)
    }
    const slots = buckets.map((b) => {
      if (!b.length) return undefined
      const answered = b.filter((v): v is number => v !== null)
      return answered.length ? median(answered) : null
    })
    const answered = rows.map((r) => r.latency).filter((v): v is number => v !== null)
    const last = rows[rows.length - 1]
    return {
      id,
      name,
      latest: last ? last.latency : undefined,
      loss: data.loss?.[id] ?? 0,
      slots,
      start,
      typical: median(answered),
    }
  })
}

// Absolute round-trip tiers matching the card's semantic palette: green (<100 ms),
// amber (100–250 ms), and red (>=250 ms or timeout). Sharp spikes above a fast
// line's own median step up one tier so jitter on domestic links stays visible.
const MID_MS = 100
const SLOW_MS = 250

function shade(v: number | null | undefined, typical: number | null): string {
  if (v === undefined) return "bg-foreground/10"
  if (v === null) return "bg-hot"
  if (v >= SLOW_MS) return "bg-hot/75"
  if (v >= MID_MS) {
    if (typical && v / typical >= 1.5 && v - typical >= 50) return "bg-hot/75"
    return "bg-warn/85"
  }
  if (typical && v / typical >= 1.8 && v - typical >= 30) return "bg-warn/85"
  return "bg-online/85"
}

function latencyTone(v: number | null | undefined): string {
  if (v === undefined) return "text-muted-foreground"
  if (v === null || v >= SLOW_MS) return "text-hot"
  if (v >= MID_MS) return "text-warn"
  return "[color:color-mix(in_srgb,var(--online)_80%,var(--foreground))]"
}

function lossTone(loss: number): string {
  if (loss >= 10) return "text-hot"
  if (loss >= 3) return "text-warn"
  return "text-muted-foreground"
}

const ms = (v: number | null | undefined) => (v === undefined ? "—" : v === null ? "超时" : v < 1 ? "<1 ms" : `${Math.round(v)} ms`)

function hhmm(sec: number): string {
  const d = new Date(sec * 1000)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** A probe's row: name, strip, latest, loss. */
function ProbeRow({ line, hours }: { line: ProbeLine; hours: number }) {
  const step = (hours * 3600) / SLOTS
  const summary = `最近 ${hours} 小时 · 常态 ${line.typical === null ? "—" : ms(line.typical)}${line.loss > 0 ? ` · 丢包 ${line.loss.toFixed(1)} %` : ""}（绿 <${MID_MS} ms · 黄 ${MID_MS}–${SLOW_MS} ms · 红 ≥${SLOW_MS} ms / 超时）`
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)_4.75rem] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground" title={`${line.name} · ${summary}`}>{line.name}</span>
      <span
        className="flex h-2.5 min-w-0 gap-px"
        role="img"
        aria-label={`${line.name} 最近 ${hours} 小时延迟，绿顺畅、黄偏高、红较慢或超时`}
        title={summary}
      >
        {line.slots.map((v, i) => (
          <span
            key={i}
            className={cn("h-full min-w-0 flex-1 rounded-[1px]", shade(v, line.typical))}
            title={`${hhmm(line.start + i * step)} · ${v === undefined ? "无数据" : ms(v)}`}
          />
        ))}
      </span>
      <span className={cn("tnum text-right whitespace-nowrap", latencyTone(line.latest))} title={summary}>
        {ms(line.latest)}
        {line.loss >= 1 && <span className={cn("ml-1 text-[10px]", lossTone(line.loss))}>{Math.round(line.loss)}%</span>}
      </span>
    </div>
  )
}

/**
 * The card's latency block: asks once the card nears the screen, draws
 * nothing for a node without probes, and keeps its height while it loads so
 * the card does not grow under the reader.
 */
export const CardPing = memo(function CardPing({ id }: { id: number }) {
  const { show, probes, hours } = useContext(PingConfig)
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!show || !box.current) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "200px" })
    io.observe(box.current)
    return () => io.disconnect()
  }, [show])
  const entry = useNodePing(id, hours, show && near)
  if (!show) return null
  const lines = probeLines(entry?.data, probes, hours)
  // Answered with no probes at all: nothing to show, and no space kept.
  if (entry && !entry.failed && lines.length === 0) return <div ref={box} />
  return (
    <div ref={box} className="mt-3 space-y-1.5 border-t pt-3">
      {lines.length
        ? lines.map((l) => <ProbeRow key={l.id} line={l} hours={hours} />)
        : [0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-[4.25rem_minmax(0,1fr)_4.75rem] items-center gap-2" aria-hidden>
              <span className="h-2.5 rounded bg-muted" />
              <span className="h-2.5 rounded bg-muted/60" />
              <span className="h-2.5 rounded bg-muted" />
            </div>
          ))}
    </div>
  )
})

/**
 * A table row's latency cell: the chosen probes' latest round trips on one
 * line, their names beneath. Asks once the row nears the screen.
 */
export const PingCell = memo(function PingCell({ id }: { id: number }) {
  const { show, probes, hours } = useContext(PingConfig)
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!show || !box.current) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "200px" })
    io.observe(box.current)
    return () => io.disconnect()
  }, [show])
  const entry = useNodePing(id, hours, show && near)
  const lines = probeLines(entry?.data, probes, hours)
  return (
    <div ref={box} className="tnum min-w-0 text-xs">
      {!show ? null : lines.length ? (
        <>
          <div className="truncate">
            {lines.map((l, i) => (
              <span key={l.id} className={latencyTone(l.latest)}>
                {i > 0 && <span className="text-muted-foreground"> · </span>}
                {l.latest === undefined ? "—" : l.latest === null ? "超时" : l.latest < 1 ? "<1" : Math.round(l.latest)}
              </span>
            ))}
            {lines.some((l) => typeof l.latest === "number") && <span className="text-muted-foreground"> ms</span>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{lines.map((l) => l.name).join(" · ")}</div>
        </>
      ) : (
        <span className="text-muted-foreground">{entry ? "—" : "…"}</span>
      )}
    </div>
  )
})

/** A node page's one-line summary: each chosen probe's latest round trip. */
export function PingSummary({ id }: { id: number }) {
  const { show, probes, hours } = useContext(PingConfig)
  const entry = useNodePing(id, hours, show)
  const lines = probeLines(entry?.data, probes, hours)
  if (!show || !lines.length) return null
  return (
    <span>
      {lines.map((l, i) => (
        <span key={l.id}>
          {i > 0 && " · "}
          <span className={cn("whitespace-nowrap", latencyTone(l.latest))}>{`${l.name} ${ms(l.latest)}`}</span>
        </span>
      ))}
    </span>
  )
}
