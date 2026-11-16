type ClickLike = {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  button: number
  preventDefault: () => void
}

type AdminShell = {
  cssHref: string
  cssText: string
  jsSrc: string
  iconHref: string
  title: string
}

const ME_KEY = "inkpond:me"
const NODES_KEY = "inkpond:nodes"
const CONFIG_KEYS = ["inkpond:config", "inkpond:mode", "inkpond:scene-site"] as const

let preloaded = false
let shell: AdminShell | null = null
let meSnapshot: unknown = null
let nodesSnapshot: { nodes: unknown[]; admin: boolean } | null = null
let unmountHome: (() => void) | null = null
let transitioning = false

function readSession<T>(key: string): T | null {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeSession(key: string, value: unknown) {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be disabled for the site.
  }
}

function removeSession(key: string) {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key)
  } catch {
    // Ignore storage errors.
  }
}

function clearThemeCache() {
  try {
    if (typeof localStorage === "undefined") return
    for (const key of CONFIG_KEYS) localStorage.removeItem(key)
  } catch {
    // Ignore storage errors.
  }
}

function clearSnapshots(nodesOnly = false) {
  nodesSnapshot = null
  removeSession(NODES_KEY)
  if (!nodesOnly) {
    meSnapshot = null
    removeSession(ME_KEY)
  }
}

/** Records the latest `/api/me` response so `/admin/` and navigations can mount without waiting on it. */
export function recordMeSnapshot(me: unknown) {
  meSnapshot = me
  const m = me as { public_page?: boolean; authed?: boolean } | null
  if (m && (m.public_page || m.authed)) writeSession(ME_KEY, me)
  else removeSession(ME_KEY)
}

/** Returns the in-memory or session-cached `/api/me` response, if any. */
export function readMeSnapshot<T>(): T | null {
  return (meSnapshot as T | null) ?? readSession<T>(ME_KEY)
}

/** Records the latest `/api/nodes` payload for `/admin/` handoff and immediate return mounts. */
export function recordNodesSnapshot(nodes: unknown[], admin?: boolean) {
  if (typeof admin === "boolean") nodesSnapshot = { nodes, admin }
  writeSession(NODES_KEY, nodes)
}

/** Returns the in-memory or session-cached node list, if any. */
export function readNodesSnapshot<T>(): T[] | null {
  if (nodesSnapshot?.nodes) return nodesSnapshot.nodes as T[]
  const cached = readSession<unknown>(NODES_KEY)
  return Array.isArray(cached) ? (cached as T[]) : null
}

/** Registers the root unmount callback from `src/main.tsx`. */
export function registerHomeUnmount(fn: () => void) {
  unmountHome = fn
}

/**
 * Fetches `/admin/nodes` in the background, caches its stylesheet text in
 * memory (avoiding unused `<link rel="preload">` console warnings), and
 * preloads its hashed entry module while the visitor is still on the status page.
 */
export function preloadAdmin() {
  if (preloaded || typeof document === "undefined") return
  preloaded = true
  void fetch("/admin/nodes", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) return
      const doc = new DOMParser().parseFromString(await res.text(), "text/html")
      const cssHref = doc.querySelector('link[rel="stylesheet"][href^="/admin/assets/"]')?.getAttribute("href")
      const jsSrc = doc.querySelector('script[type="module"][src^="/admin/assets/"]')?.getAttribute("src")
      if (!cssHref || !jsSrc) return
      const nextShell: AdminShell = {
        cssHref,
        cssText: "",
        jsSrc,
        iconHref: doc.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "/admin/favicon.svg",
        title: doc.title || "Monitor 后台",
      }
      shell = nextShell
      const jsHint = document.createElement("link")
      jsHint.rel = "modulepreload"
      jsHint.crossOrigin = "anonymous"
      jsHint.href = jsSrc
      document.head.append(jsHint)
      void fetch(cssHref, { credentials: "same-origin" })
        .then((cssRes) => (cssRes.ok ? cssRes.text() : ""))
        .then((text) => {
          if (text) nextShell.cssText = text
        })
        .catch(() => {})
    })
    .catch(() => {})
}

function loadAdminCss(target: AdminShell): Promise<HTMLElement> {
  if (target.cssText) {
    const style = document.createElement("style")
    style.dataset.adminCss = ""
    style.textContent = target.cssText
    document.head.append(style)
    return Promise.resolve(style)
  }
  return new Promise((resolve) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.crossOrigin = "anonymous"
    link.href = target.cssHref
    const timer = setTimeout(() => resolve(link), 1500)
    const done = () => {
      clearTimeout(timer)
      resolve(link)
    }
    link.onload = done
    link.onerror = done
    document.head.append(link)
  })
}

function installFetchSnapshot(): () => void {
  const realFetch = window.fetch.bind(window)
  let usedMe = !meSnapshot
  let usedNodes = !nodesSnapshot

  const timer = setTimeout(() => {
    usedMe = true
    usedNodes = true
  }, 1500)

  const wrapped: typeof window.fetch = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input)
    let pathname = ""
    try {
      pathname = new URL(rawUrl, location.href).pathname
    } catch {
      pathname = rawUrl
    }
    if (method === "GET") {
      if (!usedMe && meSnapshot && pathname === "/api/me") {
        usedMe = true
        return Promise.resolve(
          new Response(JSON.stringify(meSnapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }
      if (!usedNodes && nodesSnapshot && pathname === "/api/nodes") {
        usedNodes = true
        return Promise.resolve(
          new Response(JSON.stringify(nodesSnapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }
    } else {
      if (pathname === "/api/auth/logout" || pathname === "/api/logout" || pathname === "/api/auth/login" || pathname === "/api/settings") {
        clearSnapshots()
      } else if (pathname === "/api/nodes" || pathname.startsWith("/api/nodes/")) {
        clearSnapshots(true)
      } else if (pathname === "/api/themes/inkpond/config") {
        clearThemeCache()
      } else if (pathname === "/api/db/restore") {
        clearSnapshots()
        clearThemeCache()
      }
    }
    return realFetch(input, init)
  }
  window.fetch = wrapped
  return () => {
    clearTimeout(timer)
    if (window.fetch === wrapped) window.fetch = realFetch
  }
}

function waitForAdminPaint(rootEl: HTMLElement): Promise<void> {
  if (rootEl.querySelector("header, form, [role='alert']")) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      resolve()
    }
    const observer = new MutationObserver(() => {
      if (rootEl.querySelector("header, form, [role='alert']")) finish()
    })
    observer.observe(rootEl, { childList: true, subtree: true })
    const timer = setTimeout(finish, 120)
  })
}

function syncAdminThemeClass() {
  let saved: string | null = null
  try {
    saved = localStorage.getItem("theme")
  } catch {
    // Storage may be disabled; system preference stands.
  }
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  document.documentElement.classList.remove("wraith", "palette-fade")
  document.documentElement.classList.toggle("dark", dark)
}

/**
 * Transitions in-place to the preloaded admin SPA (`/admin/nodes`) inside a
 * single view transition so there is no white flash or loading screen.
 */
export function openAdmin(e: ClickLike) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
  if (!shell || !unmountHome || transitioning) return
  e.preventDefault()
  transitioning = true

  const target = shell
  const unmount = unmountHome
  // Keep `@view-transition { navigation: auto; }` active inside `/admin/` so
  // clicking "状态面板" (`<a href="/">`) transitions smoothly back to `/`.
  const vtStyle = document.createElement("style")
  vtStyle.textContent =
    "@view-transition{navigation:auto;}::view-transition-old(root),::view-transition-new(root){animation-duration:160ms;animation-timing-function:cubic-bezier(0.22,1,0.36,1)}"

  const handoff = async () => {
    const restoreFetch = installFetchSnapshot()
    try {
      const adminCss = await loadAdminCss(target)
      syncAdminThemeClass()
      for (const el of document.querySelectorAll('head style, head link[rel="stylesheet"]')) {
        if (el !== adminCss) el.remove()
      }
      document.head.append(vtStyle)
      history.pushState({}, "", "/admin/nodes")
      addEventListener(
        "popstate",
        () => {
          if (!location.pathname.startsWith("/admin")) location.reload()
        },
        { capture: true },
      )
      document.title = target.title
      const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (icon) icon.href = target.iconHref
      unmount()
      await import(/* @vite-ignore */ target.jsSrc)
      const rootEl = document.getElementById("root")
      if (rootEl) await waitForAdminPaint(rootEl)
    } catch {
      vtStyle.remove()
      restoreFetch()
      transitioning = false
      location.href = "/admin/nodes"
    }
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!reduced && typeof document.startViewTransition === "function") {
    try {
      document.startViewTransition(handoff)
    } catch {
      void handoff()
    }
  } else {
    void handoff()
  }
}
