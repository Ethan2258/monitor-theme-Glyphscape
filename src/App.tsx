import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { DoorIcon, RippleIcon } from "@/components/icons"
import { ThemeMenu, type ThemeChoice } from "@/components/ThemeMenu"

import { Hero } from "@/components/Hero"
import { NodeHead } from "@/components/NodeCard"
import { NodeList } from "@/components/NodeList"
import { Pond } from "@/components/Pond"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes } from "@/lib/api"
import { DEFAULTS, loadConfig, type Config } from "@/lib/config"
import { isSortKey, narrow, NO_FILTERS, type Filters } from "@/lib/filter"
import { applyPalette, transitionPalette } from "@/lib/palette"
import { useRates } from "@/lib/rates"

// `history_days` is absent from hubs predating the hourly tier, which kept a
// week for anonymous callers.
type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean; history_days?: number }

// Split out because recharts is most of this bundle and the list page draws no
// chart, with the rest fetched immediately after it paints.
const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

// Storage can be switched off for the site, and then even reading it throws.
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice then lasts until the page is closed.
  }
}

// `/node/{id}` is a real page: it survives a reload, can be linked to, and back
// leaves the detail view rather than the site. The hub serves index.html for any
// unknown path, so no server-side route is required.
function useNodeRoute() {
  const read = () => {
    const match = location.pathname.match(/^\/node\/(\d+)/)
    return match ? Number(match[1]) : null
  }
  const [id, setId] = useState(read)
  // Where the list was scrolled to when a node was opened, so that coming back
  // returns to the same card.
  const listScroll = useRef(0)
  useEffect(() => {
    const sync = () => setId(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return [
    id,
    (next: number | null) => {
      const path = next === null ? "/" : `/node/${next}`
      if (next !== null && id === null) listScroll.current = scrollY
      if (location.pathname !== path) history.pushState({}, "", path)
      setId(next)
      const top = next === null && id !== null ? listScroll.current : 0
      requestAnimationFrame(() => scrollTo(0, top))
    },
  ] as const
}

const DARK_MEDIA = matchMedia("(prefers-color-scheme: dark)")

/**
 * The visitor's own choice; failing that the operator's `color_mode`; failing
 * that the system's. Only the toggle writes the choice down: persisting the
 * system's answer on load would pin it. The panel at `/admin/` shares this key
 * on one origin, so it holds to the same rule.
 *
 * `mode` is null until the hub's settings arrive. Until then the mode this
 * browser saw last time stands in for it, which is also what public/boot.js
 * paints the first frame with.
 */
function useTheme(mode: Config["color_mode"] | null) {
  const [saved, setSaved] = useState(() => stored("theme"))
  const [remembered] = useState(() => stored("inkpond:mode"))
  const system = useSyncExternalStore(
    (notify) => {
      DARK_MEDIA.addEventListener("change", notify)
      return () => DARK_MEDIA.removeEventListener("change", notify)
    },
    () => DARK_MEDIA.matches,
  )
  const site = mode ?? remembered
  const dark = saved ? saved === "dark" : site === "dark" || (site !== "light" && system)

  // A change from anywhere but the toggle -- the system's, the operator's --
  // switches at once. The toggle's own change has already been applied, inside
  // its ripple, by the time this runs.
  useEffect(() => applyPalette(dark), [dark])
  useEffect(() => {
    if (mode) store("inkpond:mode", mode)
  }, [mode])

  // Light, dark, or nothing written down: then the operator's default, and
  // failing that the system's, which the page follows live.
  const choice: ThemeChoice = saved === "light" || saved === "dark" ? saved : "auto"
  return [
    dark,
    choice,
    (next: ThemeChoice, at: { x: number; y: number }) => {
      const value = next === "auto" ? null : next
      if (value) store("theme", value)
      else {
        try {
          localStorage.removeItem("theme")
        } catch {
          // Then the choice lasts until the page is closed.
        }
      }
      const nextDark = value ? value === "dark" : site === "dark" || (site !== "light" && system)
      if (nextDark === dark) return setSaved(value)
      transitionPalette(nextDark, at, () => flushSync(() => setSaved(value)))
    },
  ] as const
}

/**
 * The palette toggle, holding the palette state itself: a change re-renders this
 * button and nothing else, so the frame the view transition waits on stays short.
 */
function ThemeSwitch({ mode }: { mode: Config["color_mode"] | null }) {
  const [, choice, pick] = useTheme(mode)
  return <ThemeMenu choice={choice} onPick={pick} />
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const [config, setConfig] = useState<Config | null>(null)
  const settings = config ?? DEFAULTS
  // The visitor's own switch for the fish, within what the operator allows.
  const [fish, setFish] = useState(() => stored("inkpond:pond") !== "off")
  const rates = useRates(settings.live_rates)
  const { nodes, error, closed } = useNodes()
  const [open, go] = useNodeRoute()
  // What the list is narrowed to, held here so it survives a visit to a node's
  // page. The order is the visitor's preference and outlives the tab.
  const [filters, setFilters] = useState<Filters>(() => {
    const sort = stored("inkpond:sort")
    return { ...NO_FILTERS, sort: isSortKey(sort) ? sort : "default" }
  })
  useEffect(() => store("inkpond:sort", filters.sort), [filters.sort])
  // Cards or a table: the visitor's own preference.
  const [layout, setLayout] = useState<"cards" | "table">(() => (stored("inkpond:view") === "table" ? "table" : "cards"))
  useEffect(() => store("inkpond:view", layout), [layout])

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message))
  }, [])

  useEffect(() => {
    loadMe()
    // Requested alongside /me, not after it. It never rejects.
    void loadConfig().then(setConfig)
    void loadDetail()
  }, [loadMe])

  // The status page was closed while this tab was open: re-query, and the
  // effect below sends an anonymous visitor to the panel.
  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])
  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const selected = sorted.find((n) => n.id === open)
  const view = narrow(sorted, filters)
  // A tab or a country that has emptied is let go of, so a later one of the
  // same name does not take the page over.
  useEffect(() => {
    if (nodes && (view.group !== filters.group || view.region !== filters.region)) {
      // oxlint-disable-next-line react/set-state-in-effect
      setFilters({ ...filters, group: view.group, region: view.region })
    }
  }, [nodes, view.group, view.region, filters])

  useEffect(() => {
    document.title = [selected?.name, me?.site_name || "Monitor"].filter(Boolean).join(" · ")
  }, [selected?.name, me?.site_name])

  // The pond waits for the settings, so the operator's choice of how many fish
  // does not restock it a moment after it fills. It is the first thing in the
  // water whatever page is showing, so moving between them keeps the same fish.
  const pond = config?.pond && fish && <Pond feed={config.pond_feed} fish={config.pond_fish} />

  if (!me) return (
    <div className="relative isolate min-h-svh">
      {pond}
      <div className="relative grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
        {meError ? <div data-pond-avoid="" className="space-y-3 text-center"><p role="alert">加载失败：{meError}</p><Button onClick={loadMe}>重试</Button></div> : <span data-pond-avoid="">加载中…</span>}
      </div>
    </div>
  )

  // The status page is closed and nobody is signed in: redirect to the panel.
  if (!me.public_page && !me.authed) return null

  const primary = settings.primary_currency
  const notice = settings.notice.trim()

  return (
    <div className="flex min-h-svh flex-col">
      {/* The water: the header and the head of the page, with the fish in it. */}
      <div className="relative isolate">
        {pond}
        <header className="relative z-20 mx-auto flex w-full max-w-[1320px] items-center gap-1 px-4 py-4 sm:px-6">
          {/* The site name is the way back to the list. The icon is the hub's:
              an operator who uploads one replaces /favicon.svg, and this follows. */}
          <button
            data-pond-avoid=""
            className="mr-auto flex min-w-0 items-center gap-2.5 font-semibold transition-opacity hover:opacity-70"
            onClick={() => go(null)}
          >
            <img src="/favicon.svg" alt="" className="size-5 shrink-0" />
            <span className="truncate text-[15px]">{me.site_name || "Monitor"}</span>
          </button>
          <div data-pond-avoid="" className="flex items-center gap-2">
            <a
              href="/admin/"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <DoorIcon className="size-4" />
              {me.authed ? "后台" : "登录"}
            </a>
            <span className="h-4 w-px bg-border" aria-hidden />
            <ThemeSwitch mode={config?.color_mode ?? null} />
          </div>
        </header>

        {notice && (
          <div className="relative mx-auto w-full max-w-[1320px] px-4 sm:px-6">
            {/* The operator's words to every visitor. Plain text, as typed. */}
            <Card className="flex-row items-start gap-2.5 px-4 py-3 text-sm">
              <RippleIcon className="mt-0.5 size-4 shrink-0 text-marker" />
              <p className="min-w-0 leading-relaxed break-words whitespace-pre-wrap">{notice}</p>
            </Card>
          </div>
        )}

        {open !== null ? (
          selected ? <NodeHead node={selected} onBack={() => go(null)} /> : <div className="h-28" />
        ) : !nodes || !config ? (
          <div className="h-[22rem]" />
        ) : (
          <Hero
            nodes={view.shown}
            scope={view.inGroup}
            region={view.region}
            onRegion={(region) => setFilters({ ...filters, group: view.group, region })}
            summary={settings.show_summary}
            globe={settings.show_globe}
            cost={settings.show_price && settings.show_cost && sorted.some((n) => n.price > 0)}
            rates={rates}
            primary={primary}
            fish={config.pond ? { on: fish, toggle: () => { store("inkpond:pond", fish ? "off" : "on"); setFish(!fish) } } : null}
          />
        )}
      </div>

      <main className="mx-auto w-full max-w-[1320px] flex-1 space-y-5 px-4 pb-10 sm:px-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {open !== null ? (
          !nodes ? (
            <Skeleton className="h-96" />
          ) : selected ? (
            <Card className="gap-0 p-4 sm:p-6">
              <Suspense fallback={<Skeleton className="h-96" />}>
                <NodeDetail
                  node={selected}
                  historyDays={me.history_days ?? 7}
                  price={settings.show_price}
                  rates={rates}
                  primary={primary}
                />
              </Suspense>
            </Card>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              节点不存在或未公开。<button className="underline" onClick={() => go(null)}>返回列表</button>
            </p>
          )
        ) : !nodes || !config ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : (
          <NodeList
            nodes={sorted}
            groups={view.groups}
            ungrouped={view.ungrouped}
            group={view.group}
            shown={view.shown}
            counts={view.counts}
            filters={filters}
            onFilters={setFilters}
            onOpen={go}
            toolbar={settings.show_toolbar}
            price={settings.show_price}
            rates={rates}
            primary={primary}
            view={layout}
            onView={setLayout}
          />
        )}
      </main>

      <footer className="mx-auto w-full max-w-[1320px] px-4 pt-4 pb-10 text-center text-xs text-muted-foreground sm:px-6">
        {settings.footer.trim() && <p className="mb-1 break-words">{settings.footer.trim()}</p>}
        <p>
          <a className="hover:text-foreground" href="https://github.com/monitor-probe/monitor" target="_blank" rel="noreferrer">Monitor</a>
          <span className="mx-1.5 opacity-50">·</span>
          锦鲤来自{" "}
          <a className="hover:text-foreground" href="https://github.com/stqfdyr/ascii-pond" target="_blank" rel="noreferrer">ascii-pond</a>
        </p>
      </footer>
    </div>
  )
}
