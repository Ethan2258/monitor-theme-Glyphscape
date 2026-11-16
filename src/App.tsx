import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { DoorIcon, RippleIcon } from "@/components/icons"
import { SceneMenu, ThemeMenu, type SceneChoice, type ThemeChoice } from "@/components/ThemeMenu"

import { Hero } from "@/components/Hero"
import { NodeHead } from "@/components/NodeCard"
import { NodeList } from "@/components/NodeList"
import { Pond } from "@/components/Pond"
import { Realm } from "@/components/Realm"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes } from "@/lib/api"
import { DEFAULTS, loadConfig, type Config } from "@/lib/config"
import { isSortKey, narrow, NO_FILTERS, type Filters } from "@/lib/filter"
import { applyPalette, applyScene, transitionPalette } from "@/lib/palette"
import { stir } from "@/lib/pond"
import { useRates } from "@/lib/rates"

const WRAITH_ICON =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%23101114"/><path d="M7.5 14.5a8.5 8.5 0 0 1 17 0V27l-2.83-2.1-2.84 2.1-2.83-2.1-2.83 2.1-2.84-2.1L7.5 27Z" fill="%23e9ebf0"/><ellipse cx="12.8" cy="14" rx="1.9" ry="2.7" fill="%23101114"/><ellipse cx="19.2" cy="14" rx="1.9" ry="2.7" fill="%23101114"/><ellipse cx="16" cy="19.6" rx="1.3" ry="2" fill="%23101114"/></svg>'

const DEFAULT_ICON =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g fill="%238a8a8a"><rect x="2" y="9" width="3" height="5" rx="1"/><rect x="6.5" y="5" width="3" height="9" rx="1"/><rect x="11" y="2" width="3" height="12" rx="1"/></g></svg>'

const ICON_LINK = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
const INITIAL_ICON = ICON_LINK?.getAttribute("href") ?? "/favicon.svg"
// The hub stamps href="/favicon.svg" with the first 8 hex digits of the served
// file's SHA-256 (`?v=d777706a` for our public/favicon.svg). Any other digest
// means the operator uploaded a site icon in the panel, which stays across scenes.
const HAS_SITE_ICON =
  INITIAL_ICON !== "/favicon.svg" &&
  !INITIAL_ICON.startsWith("/favicon.svg?v=d777706a") &&
  !INITIAL_ICON.startsWith("/favicon.svg?v=8c067ea2")

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
  // The scene behind the head of the page: the koi pond or the ghost realm, each
  // in its own palette. The visitor's own choice, else the operator's default
  // (as this browser saw it last, until the settings arrive). Put away, the
  // scene's palette stays.
  const [shown, setShown] = useState(() => stored("inkpond:pond") !== "off")
  const [pickedScene, setPickedScene] = useState(() => stored("inkpond:scene"))
  const [siteScene] = useState(() => stored("inkpond:scene-site"))
  const scene: "pond" | "wraith" =
    pickedScene === "pond" || pickedScene === "wraith" ? pickedScene : (config?.scene ?? (siteScene === "wraith" ? "wraith" : "pond"))
  useEffect(() => {
    if (config) store("inkpond:scene-site", config.scene)
  }, [config])
  // The first time at once (public/boot.js has painted it already); after that,
  // blended, as a change of light and dark is.
  const sceneSeen = useRef(false)
  useEffect(() => {
    applyScene(scene === "wraith", sceneSeen.current)
    sceneSeen.current = true
  }, [scene])
  const pickScene = (choice: SceneChoice) => {
    if (choice === "off") {
      store("inkpond:pond", "off")
      return setShown(false)
    }
    store("inkpond:pond", "on")
    store("inkpond:scene", choice)
    setShown(true)
    setPickedScene(choice)
  }
  const activeScene: SceneChoice = config?.pond === false || !shown ? "off" : scene
  const iconHref = HAS_SITE_ICON
    ? INITIAL_ICON
    : activeScene === "wraith"
      ? WRAITH_ICON
      : activeScene === "off"
        ? DEFAULT_ICON
        : INITIAL_ICON
  useEffect(() => {
    if (!HAS_SITE_ICON && ICON_LINK && ICON_LINK.getAttribute("href") !== iconHref) ICON_LINK.href = iconHref
  }, [iconHref])
  const rates = useRates(settings.live_rates)
  const { nodes, error, closed } = useNodes()
  const [open, go] = useNodeRoute()
  const adminTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const clear = () => {
      if (adminTimer.current) {
        clearTimeout(adminTimer.current)
        adminTimer.current = null
      }
      document.documentElement.classList.remove("leaving-admin")
    }
    clear()
    addEventListener("pageshow", clear)
    return () => {
      removeEventListener("pageshow", clear)
      clear()
    }
  }, [])
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

  // The scene waits for the settings, so the operator's choice of scene and of
  // how many fish does not change it a moment after it starts. It is the first
  // thing at the head of the page whatever page is showing, so moving between
  // them keeps the same fish, or the same ghosts.
  const pond = config?.pond && shown && (scene === "wraith" ? <Realm /> : <Pond feed={config.pond_feed} fish={config.pond_fish} />)

  if (!me) return (
    <div className="relative isolate min-h-svh">
      {pond}
      <div className="relative grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
        {meError ? <div data-pond-avoid="" data-sky-avoid="" className="space-y-3 text-center"><p role="alert">加载失败：{meError}</p><Button onClick={loadMe}>重试</Button></div> : <span data-pond-avoid="" data-sky-avoid="">加载中…</span>}
      </div>
    </div>
  )

  // The status page is closed and nobody is signed in: redirect to the panel.
  if (!me.public_page && !me.authed) return null

  const primary = settings.primary_currency
  const notice = settings.notice.trim()

  return (
    <div className="flex min-h-svh flex-col">
      {/* The head of the page, with its scene behind it: the header, then the
          overview or a node's name. */}
      <div className="relative isolate">
        {pond}
        <header className="relative z-20 mx-auto flex w-full max-w-[1320px] items-center gap-1 px-4 py-4 sm:px-6">
          {/* The site name is the way back to the list. The icon follows the
              scene unless the operator has uploaded a site icon in the panel. */}
          <button
            data-pond-avoid=""
            data-sky-dim=""
            className="mr-auto flex min-w-0 items-center gap-2.5 font-semibold transition-opacity hover:opacity-70"
            onClick={() => go(null)}
          >
            <img src={iconHref} alt="" className="size-5 shrink-0" />
            <span className="truncate text-[15px]">{me.site_name || "Monitor"}</span>
          </button>
          <div data-pond-avoid="" data-sky-dim="" className="flex items-center gap-1">
            <a
              href="/admin/"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                stir({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
                void fetch("/admin/", { credentials: "same-origin" }).catch(() => {})
                document.documentElement.classList.add("leaving-admin")
                if (adminTimer.current) clearTimeout(adminTimer.current)
                adminTimer.current = setTimeout(() => {
                  location.href = "/admin/"
                }, 220)
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <DoorIcon className="size-4" />
              {me.authed ? "后台" : "登录"}
            </a>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            {config?.pond && <SceneMenu choice={shown ? scene : "off"} scene={scene} onPick={pickScene} />}
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

        <div key={open ?? "list"} className="view-enter">
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
            />
          )}
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1320px] flex-1 space-y-5 px-4 pb-10 sm:px-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div key={open ?? "list"} className="view-enter">
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
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[1320px] px-4 pt-4 pb-10 text-center text-xs text-muted-foreground sm:px-6">
        {settings.footer.trim() && <p className="mb-1 break-words">{settings.footer.trim()}</p>}
        <p>
          <a className="hover:text-foreground" href="https://github.com/monitor-probe/monitor" target="_blank" rel="noreferrer">Monitor</a>
          <span className="mx-1.5 opacity-50">·</span>
          锦鲤来自{" "}
          <a className="hover:text-foreground" href="https://github.com/stqfdyr/ascii-pond" target="_blank" rel="noreferrer">ascii-pond</a>
          <span className="mx-1.5 opacity-50">·</span>
          幽灵来自{" "}
          <a className="hover:text-foreground" href="https://github.com/Ethan2258/ascii-ghost" target="_blank" rel="noreferrer">ascii-ghost</a>
        </p>
      </footer>
    </div>
  )
}
