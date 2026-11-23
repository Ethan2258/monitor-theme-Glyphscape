import { useEffect, useRef, useState } from "react"
import { InIcon, OutIcon } from "@/components/icons"

import { daysLeft, deployed } from "@/components/NodeCard"
import { Regions } from "@/components/Regions"
import { SPEED_WINDOW, throughput, type Node } from "@/lib/api"
import { monthly, remaining, sum, type Rates } from "@/lib/cost"
import { bytes, money, pct, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

/** A figure and its unit, set apart: "24.2 KB/s" as 24.2 and KB/s. */
/**
 * A figure that rolls to each new value over about half a second, easing out,
 * rather than jumping every two seconds. Only this span redraws while it rolls;
 * with reduced motion it jumps.
 */
const STILL = matchMedia("(prefers-reduced-motion: reduce)")
function useRoll(target: number, ms = 550): number {
  const [shown, setShown] = useState(target)
  const now = useRef(target)
  const still = STILL.matches || document.hidden
  useEffect(() => {
    if (still) {
      now.current = target
      return
    }
    const from = now.current
    const start = performance.now()
    let frame = 0
    const step = (t: number) => {
      if (document.hidden) {
        now.current = target
        setShown(target)
        return
      }
      const k = Math.min(1, (t - start) / ms)
      const value = from + (target - from) * (1 - (1 - k) ** 3)
      now.current = value
      setShown(value)
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, ms, still])
  return still ? target : shown
}

function RollingFigure({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  return <Figure text={format(useRoll(value))} className={className} />
}

function Figure({ text, className }: { text: string; className?: string }) {
  const at = text.lastIndexOf(" ")
  return (
    <span className={cn("tnum whitespace-nowrap", className)}>
      {at < 0 ? text : text.slice(0, at)}
      {at >= 0 && <span className="ml-1 text-[0.5em] font-normal text-muted-foreground">{text.slice(at + 1)}</span>}
    </span>
  )
}

/**
 * The fleet's throughput over the last two minutes, one point per push: in,
 * sky; out, terracotta. Both on one scale, so the two stay comparable.
 */
/**
 * The line's points at one grain: pushes two seconds apart averaged into ten
 * seconds, beside the hub's minute buckets that fill what came before. At their
 * own grain the live pushes drew a jagged fringe at the right edge of an
 * otherwise smooth line.
 */
const GRAIN = 10_000
function evenGrain(history: { at: number; rx: number; tx: number }[]) {
  const out: { at: number; rx: number; tx: number }[] = []
  let bin: { key: number; at: number; rx: number; tx: number; n: number } | null = null
  const flush = () => {
    if (bin) out.push({ at: bin.at / bin.n, rx: bin.rx / bin.n, tx: bin.tx / bin.n })
    bin = null
  }
  for (let i = 0; i < history.length; i++) {
    const s = history[i]
    const next = history[i + 1]
    const prev = history[i - 1]
    // A minute bucket (no neighbour within half a minute) stands on its own.
    const coarse = (!prev || s.at - prev.at > 30_000) && (!next || next.at - s.at > 30_000)
    if (coarse) {
      flush()
      out.push(s)
      continue
    }
    const key = Math.floor(s.at / GRAIN)
    if (bin && bin.key !== key) flush()
    bin ??= { key, at: 0, rx: 0, tx: 0, n: 0 }
    bin.at += s.at
    bin.rx += s.rx
    bin.tx += s.tx
    bin.n++
  }
  flush()
  return out
}

function Wake({ ids }: { ids: number[] }) {
  const history = evenGrain(throughput(ids))
  // A line needs two points. The hub's history usually gives them at once; a
  // hub without it, the second push, four seconds in. Until then a dotted
  // level line says the line is being recorded.
  if (history.length < 2) {
    return (
      <div className="mt-4">
        <div className="flex h-10 items-end sm:h-14">
          <div className="w-full border-t border-dashed border-muted-foreground/40" />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">正在记录最近十分钟的网速…</div>
      </div>
    )
  }
  const top = Math.max(...history.flatMap((s) => [s.rx, s.tx]), 1)
  // On a time axis: the newest at 现在, ten minutes back at the left edge. A
  // line with nothing older starts part-way across rather than stretching a few
  // seconds over the whole span.
  const end = history[history.length - 1].at
  type P = [number, number][]
  const points = (pick: (s: { rx: number; tx: number }) => number): P =>
    history.map((s) => [Math.max(0, 100 - ((end - s.at) / SPEED_WINDOW) * 100), 38 - (pick(s) / top) * 34])
  // Through every point, as a Catmull-Rom spline turned to cubic Béziers,
  // with each control point held within the band so the curve never dips
  // below zero or overshoots the peak between two samples.
  const curve = (p: P) => {
    let d = `M${p[0][0]},${p[0][1]}`
    for (let i = 0; i < p.length - 1; i++) {
      const [p0, p1, p2, p3] = [p[i - 1] ?? p[i], p[i], p[i + 1], p[i + 2] ?? p[i + 1]]
      const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1])
      const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) / 6))
      const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) / 6))
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${c1y} ${p2[0] - (p3[0] - p1[0]) / 6},${c2y} ${p2[0]},${p2[1]}`
    }
    return d
  }
  const area = (p: P) => `${curve(p)} L100,40 L${p[0][0]},40 Z`
  const rx = points((s) => s.rx), tx = points((s) => s.tx)
  return (
    <div className="mt-4">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-10 w-full sm:h-14" aria-hidden>
        <defs>
          <linearGradient id="wake-rx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--rx)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--rx)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wake-tx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--tx)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--tx)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area(rx)} fill="url(#wake-rx)" />
        <path d={area(tx)} fill="url(#wake-tx)" />
        <path d={curve(rx)} fill="none" stroke="var(--rx)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={curve(tx)} fill="none" stroke="var(--tx)" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>十分钟前</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 rounded-full bg-rx" />下行</span>
          <span className="inline-flex items-center gap-1"><span className="h-0 w-3 border-t-[1.5px] border-dashed border-tx" />上行</span>
          <span>现在</span>
        </span>
      </div>
    </div>
  )
}

/** One figure of the row beneath: a label, the figure, and a quieter line under it. */
function Stat({ label, children, foot, wide = false, row = false }: { label: string; children: React.ReactNode; foot?: React.ReactNode; wide?: boolean; row?: boolean }) {
  return (
    // Two to a row on a phone; above it all in one row, a hairline between each.
    // `wide` takes a share and a half, for a figure that is two figures; `row`
    // a phone's whole row and an even share above it.
    <div className={cn("min-w-0 sm:min-w-[8.5rem] sm:border-l sm:pl-5 sm:first:border-l-0 sm:first:pl-0", wide ? "col-span-2 sm:flex-[1.5]" : row ? "col-span-2 sm:flex-1" : "sm:flex-1")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg/tight font-medium sm:mt-1.5">{children}</dd>
      {foot && <dd className="tnum mt-1 truncate text-xs text-muted-foreground">{foot}</dd>}
    </div>
  )
}

/** An amount in the operator's counting currency, the other one beneath it. */
function inOrder({ cny, usd, primary }: { cny: number; usd: number; primary: "CNY" | "USD" }) {
  const [first, second] = primary === "CNY" ? [money(cny, "CNY"), money(usd, "USD")] : [money(usd, "USD"), money(cny, "CNY")]
  return { first, second }
}

/**
 * The overview, set straight on the water at the head of the page: how many
 * nodes are up, how fast the fleet is moving data right now, and a row of what
 * matters beneath -- today's traffic, what the fleet costs a month, what is left
 * of what has been paid, and what expires next.
 *
 * Every figure is of `nodes`, which is whatever the list below is narrowed to.
 * The block is `data-pond-avoid`: the fish swim round it and fade beneath it;
 * and `data-sky-dim`: the ghosts drift through it, fading under the text.
 */
function Overview({ nodes, cost, rates, primary, onOpen }: {
  nodes: Node[]
  cost: boolean
  rates: Rates
  primary: "CNY" | "USD"
  onOpen?: (id: number) => void
}) {
  const online = nodes.filter((n) => n.online)
  const offline = nodes.filter((n) => !n.online && deployed(n))
  const add = (pick: (n: Node) => number) => nodes.reduce((total, n) => total + pick(n), 0)
  const history = throughput(nodes.map((n) => n.id))
  const now = history.at(-1) ?? { rx: 0, tx: 0 }
  const busiest = online.reduce<Node | null>(
    (top, n) => (n.metrics && (!top || n.metrics.cpu > top.metrics!.cpu) ? n : top),
    null,
  )

  const spend = sum(nodes.flatMap((n) => {
    const amount = monthly(n)
    return amount === null ? [] : [{ amount, currency: n.currency }]
  }), rates)
  const left = sum(nodes.flatMap((n) => {
    const amount = remaining(n, daysLeft(n))
    return amount === null ? [] : [{ amount, currency: n.currency }]
  }), rates)
  const next = nodes
    .flatMap((n) => {
      const days = daysLeft(n)
      return days === null ? [] : [{ node: n, days }]
    })
    .sort((a, b) => a.days - b.days)[0]

  const spent = inOrder({ cny: spend.cny, usd: spend.usd, primary })
  const kept = inOrder({ cny: left.cny, usd: left.usd, primary })
  const usd = rates.cny.USD

  return (
    <div data-pond-avoid="" data-pond-dim="box" data-sky-dim="" className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span className="inline-flex h-7 items-center gap-2 rounded-full border bg-card/80 px-3 shadow-xs">
          <span className={cn("size-2 rounded-full", offline.length ? "bg-hot" : "bg-online")} />
          <span>
            <span className="tnum text-foreground">{online.length}</span>
            <span className="tnum"> / {nodes.length}</span> 台在线
            {offline.length > 0 && <span className="text-hot"> · {offline.length} 台离线</span>}
          </span>
        </span>
        {busiest?.metrics && (
          <span className="flex min-w-0 max-w-full items-baseline gap-1">
            <span className="shrink-0">CPU 最高</span>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(busiest.id)}
                className="min-w-0 max-w-[16rem] cursor-pointer truncate text-foreground underline-offset-4 hover:underline"
                data-tip={`查看 ${busiest.name} 详情`}
              >
                {busiest.name}
              </button>
            ) : (
              <span className="min-w-0 max-w-[16rem] truncate text-foreground">{busiest.name}</span>
            )}
            <span className={cn("tnum shrink-0", busiest.metrics.cpu >= 90 && "text-hot")}>{pct(busiest.metrics.cpu.toFixed(1))}</span>
          </span>
        )}
      </p>

      <div className="mt-5 flex flex-wrap gap-x-12 gap-y-4 sm:mt-7">
        {[
          { label: "下行", value: now.rx, Icon: InIcon, tone: "text-rx" },
          { label: "上行", value: now.tx, Icon: OutIcon, tone: "text-tx" },
        ].map(({ label, value, Icon, tone }) => (
          <div key={label}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className={cn("size-3.5", tone)} />
              实时{label}
            </div>
            <RollingFigure value={value} format={rate} className="mt-1.5 block text-3xl/none font-medium tracking-tight sm:text-5xl/none" />
          </div>
        ))}
      </div>
      <Wake ids={nodes.map((n) => n.id)} />

      {/* Tighter on a phone, where the overview, the globe and the chips all
          come before the first card. */}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-5 sm:mt-6 sm:flex sm:flex-wrap sm:gap-y-6 sm:pt-6 lg:max-xl:grid lg:max-xl:grid-cols-2 lg:max-xl:gap-x-8 [&>*]:lg:max-xl:col-span-1 [&>*]:lg:max-xl:border-l-0 [&>*]:lg:max-xl:pl-0">
        <Stat wide label="今日流量" foot={`累计 ↓${bytes(add((n) => n.total_rx))} ↑${bytes(add((n) => n.total_tx))}`}>
          <span className="tnum whitespace-nowrap">↓ {bytes(add((n) => n.day_rx))}</span>
          <span className="tnum ml-3 whitespace-nowrap text-muted-foreground">↑ {bytes(add((n) => n.day_tx))}</span>
        </Stat>
        {cost && (
          <Stat label="月均支出" foot={spend.count ? spent.second : "还没有填写价格"}>
            <span className="tnum">{spend.count ? spent.first : "—"}</span>
          </Stat>
        )}
        {cost && (
          <Stat label="剩余价值" foot={left.count ? kept.second : "没有可折算的"}>
            <span className="tnum">{left.count ? kept.first : "—"}</span>
          </Stat>
        )}
        <Stat
          row
          label="最近到期"
          foot={
            next ? (
              <span className={next.days < 0 ? "text-hot" : next.days <= 7 ? "text-warn" : undefined}>
                {next.days < 0 ? `已过期 ${-next.days} 天` : next.days === 0 ? "今天到期" : `${next.days} 天后`}
              </span>
            ) : "都没有到期日"
          }
        >
          {next && onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(next.node.id)}
              className="block max-w-full cursor-pointer truncate text-left underline-offset-4 hover:underline"
              data-tip={`查看 ${next.node.name} 详情`}
            >
              {next.node.name}
            </button>
          ) : (
            <span className="block truncate" data-tip={next?.node.name} data-tip-overflow="">{next ? next.node.name : "—"}</span>
          )}
        </Stat>
      </dl>

      {cost && (spend.count > 0 || left.count > 0) && (
        <p className="tnum mt-5 text-[11px] text-muted-foreground">
          汇率 1 USD = ¥{(usd ?? 0).toFixed(4)} · {rates.live ? `${rates.date.slice(5)} 更新` : "参考值，未取到当日汇率"}
          {[...new Set([...spend.missing, ...left.missing])].length > 0 &&
            ` · ${[...new Set([...spend.missing, ...left.missing])].join("、")} 无汇率，未计入`}
        </p>
      )}
    </div>
  )
}

/**
 * The head of the home page, on the water: the overview beside the globe.
 * `nodes` are the nodes shown below; `scope` the ones the globe offers, which
 * the group tab narrows but the country does not, so another country is always
 * a click away.
 */
export function Hero({ nodes, scope, region, onRegion, onOpen, summary, globe, cost, rates, primary }: {
  nodes: Node[]
  scope: Node[]
  region: string | null
  onRegion: (code: string | null) => void
  onOpen?: (id: number) => void
  summary: boolean
  globe: boolean
  cost: boolean
  rates: Rates
  primary: "CNY" | "USD"
}) {
  const showGlobe = globe && scope.some((n) => n.country)
  if (!summary && !showGlobe) return <div className="h-24" />
  return (
    <section
      className={cn(
        // One bottom padding for both scenes: room for the realm's graveyard
        // under the globe, and open water below the figures for the pond.
        // Switching scene then moves nothing on the page, where a padding
        // eased between two values laid the whole list out again on every
        // frame of the switch. 144px from lg: the graves stand up to an
        // eighth of the head's height above its horizon, and at 1024, where
        // the stats wrap onto a second row, 128px left the exchange-rate line
        // standing on the first gravestone. Less on a phone, whose graveyard
        // is a third the height and where every pixel puts the first card
        // further down.
        "relative mx-auto grid w-full max-w-[1320px] items-center gap-x-10 gap-y-6 px-4 pt-4 pb-8 sm:gap-y-10 sm:px-6 sm:pb-12 lg:pt-6 lg:pb-14 xl:gap-x-16 [.tall-scene_&]:sm:pb-20 [.tall-scene_&]:lg:pb-36 [.tall-scene_&]:xl:pb-28",
        summary && showGlobe && "lg:grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      {summary && <Overview nodes={nodes} cost={cost} rates={rates} primary={primary} onOpen={onOpen} />}
      {showGlobe && <Regions nodes={scope} selected={region} onPick={onRegion} />}
    </section>
  )
}
