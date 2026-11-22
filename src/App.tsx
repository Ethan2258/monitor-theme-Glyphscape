import { lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { DoorIcon, RippleIcon } from "@/components/icons"
import { SceneMenu, ThemeMenu, type SceneChoice, type ThemeChoice } from "@/components/ThemeMenu"

import { Hero } from "@/components/Hero"
import { NodeHead } from "@/components/NodeCard"
import { NodeList } from "@/components/NodeList"
import { SceneStage } from "@/components/SceneStage"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { openAdmin, preloadAdmin, readMeSnapshot, recordMeSnapshot } from "@/lib/admin"
import { api, useNodes } from "@/lib/api"
import { cachedConfig, DEFAULTS, loadConfig, type Config } from "@/lib/config"
import { isSortKey, narrow, NO_FILTERS, type Filters } from "@/lib/filter"
import { applyPalette, applyScene, transitionPalette } from "@/lib/palette"
import { preloadPond } from "@/lib/pond"
import { preloadRealm } from "@/lib/realm"
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

function syncFavicon(href: string) {
  if (!HAS_SITE_ICON && ICON_LINK && ICON_LINK.getAttribute("href") !== href) ICON_LINK.href = href
}

function syncTitle(nodeName: string | undefined, siteName: string | undefined) {
  document.title = [nodeName, siteName || "Monitor"].filter(Boolean).join(" · ")
}

// `history_days` is absent from hubs predating the hourly tier, which kept a
// week for anonymous callers.
type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean; history_days?: number; site?: string }

// Split out because recharts is most of this bundle and the list page draws no
// chart, with the rest fetched immediately after it paints.
// One request, shared by the idle prefetch, a hover and the page itself. Once it
// has arrived the component is used directly: `lazy` alone would suspend on its
// first render anyway, and React then holds the fallback up for a few hundred
// milliseconds even though the code is already here.
type DetailComponent = typeof import("@/components/NodeDetail").NodeDetail
let detailReady: DetailComponent | null = null
let detailRequest: Promise<{ default: DetailComponent }> | null = null
const loadDetail = () =>
  (detailRequest ??= import("@/components/NodeDetail").then((m) => {
    detailReady = m.NodeDetail
    return { default: m.NodeDetail }
  }))
const LazyDetail = lazy(loadDetail)
const prefetchDetail = () => {
  void loadDetail()
}

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
  const current = useRef(id)
  // Where the list was scrolled to when a node was opened, and which node it
  // was, so that coming back returns to the same card, focus and all.
  const listScroll = useRef(0)
  const opened = useRef<number | null>(null)
  // Where to scroll and what to focus once the new page is on screen: applied
  // in the commit that shows it, so neither page is ever seen at the other's
  // scroll position.
  const arrive = useRef<{ top: number; focus: number | null | "title" } | null>(null)
  useEffect(() => {
    const sync = () => {
      current.current = read()
      setId(current.current)
    }
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  useLayoutEffect(() => {
    const next = arrive.current
    if (!next) return
    arrive.current = null
    scrollTo(0, next.top)
    // Keyboard and screen-reader visitors land on the node's name, or back on
    // the card they opened, rather than at the top of the document.
    const target =
      next.focus === "title"
        ? document.querySelector<HTMLElement>("h1")
        : next.focus === null
          ? null
          : document.querySelector<HTMLElement>(`[data-node="${next.focus}"]`)
    if (target) {
      if (next.focus === "title" && !target.hasAttribute("tabindex")) target.tabIndex = -1
      target.focus({ preventScroll: true })
    }
  }, [id])
  // Stable, so the list and its cards can skip re-rendering.
  const go = useCallback((next: number | null) => {
    const from = current.current
    const path = next === null ? "/" : `/node/${next}`
    if (next !== null && from === null) {
      listScroll.current = scrollY
      opened.current = next
    }
    if (location.pathname !== path) history.pushState({}, "", path)
    const back = next === null && from !== null
    arrive.current = { top: back ? listScroll.current : 0, focus: next === null ? (back ? opened.current : null) : "title" }
    current.current = next
    // In a transition: the page in view stays until the next one can render,
    // with no fallback flashing in between.
    startTransition(() => setId(next))
  }, [])
  return [id, go] as const
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
  const [me, setMe] = useState<Me | null>(() => readMeSnapshot<Me>())
  const [meError, setMeError] = useState("")
  const [config, setConfig] = useState<Config | null>(cachedConfig)
  const settings = config ?? DEFAULTS
  // The scene behind the head of the page: the koi pond or the ghost realm, each
  // in its own palette. The visitor's own choice, else the operator's default
  // (as this browser saw it last, until the settings arrive). Put away, the
  // default icon and default palette are restored.
  const [shown, setShown] = useState(() => stored("inkpond:pond") !== "off")
  const [pickedScene, setPickedScene] = useState(() => stored("inkpond:scene"))
  const [siteScene] = useState(() => stored("inkpond:scene-site"))
  const scene: "pond" | "wraith" =
    pickedScene === "pond" || pickedScene === "wraith" ? pickedScene : (config?.scene ?? (siteScene === "wraith" ? "wraith" : "pond"))
  useEffect(() => {
    if (config) store("inkpond:scene-site", config.scene)
  }, [config])
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
  // The first time at once (public/boot.js has painted it already); after that,
  // blended, as a change of light and dark is.
  const sceneSeen = useRef(false)
  useEffect(() => {
    applyScene(activeScene === "wraith", sceneSeen.current)
    sceneSeen.current = true
  }, [activeScene])
  const iconHref = HAS_SITE_ICON
    ? INITIAL_ICON
    : activeScene === "wraith"
      ? WRAITH_ICON
      : activeScene === "off"
        ? DEFAULT_ICON
        : INITIAL_ICON
  useEffect(() => syncFavicon(iconHref), [iconHref])
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
      .then((next) => {
        recordMeSnapshot(next)
        setMe(next)
        setMeError("")
      })
      .catch((e: Error) => setMeError(e.message))
  }, [])

  const headRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadMe()
    // Requested alongside /me, not after it. It never rejects.
    void loadConfig().then(setConfig)
    // Once the page is up: the node page, the panel, and both scene engines,
    // so neither a click on a card nor a switch of scene waits on the network.
    const runIdle = () => {
      void loadDetail()
      preloadAdmin()
      preloadPond()
      preloadRealm()
    }
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(runIdle, { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const timer = setTimeout(runIdle, 600)
    return () => clearTimeout(timer)
  }, [loadMe])

  // The status page was closed while this tab was open: re-query, and the
  // effect below sends an anonymous visitor to the panel.
  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])
  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = useMemo(() => [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id), [nodes])
  const selected = sorted.find((n) => n.id === open)
  // The search box answers each key at once; the list it narrows follows a beat
  // behind when there is a lot to redraw.
  const query = useDeferredValue(filters.query)
  const view = useMemo(() => narrow(sorted, { ...filters, query }), [sorted, filters, query])
  // The overview sums what the group, the country and the status leave, not
  // what the search box has found: typing a name does not empty the figures.
  const overview = useMemo(() => (query ? narrow(sorted, { ...filters, query: "" }).shown : view.shown), [sorted, filters, query, view.shown])
  const pickRegion = useCallback((region: string | null) => setFilters((f) => ({ ...f, region })), [])
  // A tab or a country that has emptied is let go of, so a later one of the
  // same name does not take the page over.
  useEffect(() => {
    if (nodes && (view.group !== filters.group || view.region !== filters.region)) {
      // oxlint-disable-next-line react/set-state-in-effect
      setFilters({ ...filters, group: view.group, region: view.region })
    }
  }, [nodes, view.group, view.region, filters])

  useEffect(() => syncTitle(selected?.name, me?.site_name), [selected?.name, me?.site_name])

  if (!me || !config) return (
    <div className="relative isolate min-h-svh">
      <div className="relative grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
        {meError ? <div data-pond-avoid="" data-sky-avoid="" className="space-y-3 text-center"><p role="alert">加载失败：{meError}</p><Button onClick={loadMe}>重试</Button></div> : <span data-pond-avoid="" data-sky-avoid="">加载中…</span>}
      </div>
    </div>
  )

  // The status page is closed and nobody is signed in: redirect to the panel.
  if (!me.public_page && !me.authed) return null

  const primary = settings.primary_currency
  const Detail = detailReady ?? LazyDetail
  const notice = settings.notice.trim()

  return (
    <div className="flex min-h-svh flex-col">
      {/* For the keyboard: past the header, the overview and the globe's
          chips, straight to the nodes. Out of sight until focused, then
          shown at the top left over everything. */}
      {open === null && (
        <a
          href="#nodes"
          onClick={(e) => {
            // Focus, not only the scroll a fragment gives: the next Tab then
            // carries on from the list rather than from the top.
            e.preventDefault()
            const list = document.getElementById("nodes")
            list?.focus({ preventScroll: true })
            list?.scrollIntoView({ block: "start" })
          }}
          className="sr-only rounded-full border bg-popover px-4 py-2 text-sm shadow-sm outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          跳到节点列表
        </a>
      )}
      {/* The head of the page, with its scene behind it: the header, then the
          overview or a node's name. `scene-band` marks it for index.css, which
          lets this one element keep its transition during a palette blend. */}
      <div ref={headRef} className="scene-band relative isolate">
        <SceneStage hostRef={headRef} scene={activeScene} feed={config.pond_feed} fish={config.pond_fish} />
        <header className="relative z-20 mx-auto flex w-full max-w-[1320px] items-center gap-1 px-4 py-4 sm:px-6">
          {/* The site name is the way back to the list. The icon follows the
              scene unless the operator has uploaded a site icon in the panel. */}
          <button
            data-pond-avoid=""
            data-pond-dim="box"
            data-sky-dim=""
            className="mr-auto flex min-w-0 items-center gap-2.5 font-semibold transition-opacity hover:opacity-70"
            onClick={() => go(null)}
          >
            <img src={iconHref} alt="" className="size-5 shrink-0" />
            <span className="truncate text-[15px]">{me.site_name || "Monitor"}</span>
          </button>
          <div data-pond-avoid="" data-pond-dim="box" data-sky-dim="" className="flex shrink-0 items-center gap-1">
            <a
              href="/admin/nodes"
              onClick={openAdmin}
              onPointerEnter={preloadAdmin}
              onFocus={preloadAdmin}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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

        {open !== null ? (
          selected ? <NodeHead node={selected} onBack={() => go(null)} /> : <div className="h-28" />
        ) : !nodes || !config ? (
          <div className="h-[22rem]" />
        ) : (
          <Hero
            nodes={overview}
            scope={view.inGroup}
            region={view.region}
            onRegion={pickRegion}
            onOpen={go}
            summary={settings.show_summary}
            globe={settings.show_globe}
            cost={settings.show_price && settings.show_cost && sorted.some((n) => n.price > 0)}
            rates={rates}
            primary={primary}
          />
        )}
      </div>

      {/* `nodes`: where the skip link lands; focusable by script only. */}
      <main id="nodes" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 scroll-mt-4 space-y-5 px-4 pb-10 outline-none sm:px-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {open !== null ? (
          !nodes ? (
            <Skeleton className="h-96" />
          ) : selected ? (
            <Card className="gap-0 p-4 sm:p-6">
              <Suspense fallback={<Skeleton className="h-[34rem]" />}>
                <Detail
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
            onPrefetch={prefetchDetail}
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
          <span className="mx-1.5 opacity-50">·</span>
          幽灵来自{" "}
          <a className="hover:text-foreground" href="https://github.com/Ethan2258/ascii-ghost" target="_blank" rel="noreferrer">ascii-ghost</a>
        </p>
      </footer>
    </div>
  )
}
