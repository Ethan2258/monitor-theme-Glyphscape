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
  jsSrc: string
  iconHref: string
  title: string
}

let preloaded = false
let shell: AdminShell | null = null
let meSnapshot: unknown = null
let nodesSnapshot: { nodes: unknown[]; admin: boolean } | null = null
let unmountHome: (() => void) | null = null
let transitioning = false

/** Records the latest `/api/me` response so `/admin/` can mount without waiting on it. */
export function recordMeSnapshot(me: unknown) {
  meSnapshot = me
}

/** Records the latest `/api/nodes` payload when it includes `admin`, matching `/admin/`'s view. */
export function recordNodesSnapshot(nodes: unknown[], admin?: boolean) {
  if (typeof admin === "boolean") nodesSnapshot = { nodes, admin }
}

/** Registers the root unmount callback from `src/main.tsx`. */
export function registerHomeUnmount(fn: () => void) {
  unmountHome = fn
}

/**
 * Fetches `/admin/nodes` in the background and preloads its hashed CSS and JS
 * assets while the visitor is still on the status page. Ignored in demo mode
 * where `/admin/nodes` does not return the hub's admin shell.
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
      shell = {
        cssHref,
        jsSrc,
        iconHref: doc.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "/admin/favicon.svg",
        title: doc.title || "Monitor 后台",
      }
      const cssHint = document.createElement("link")
      cssHint.rel = "preload"
      cssHint.as = "style"
      cssHint.crossOrigin = "anonymous"
      cssHint.href = cssHref
      const jsHint = document.createElement("link")
      jsHint.rel = "modulepreload"
      jsHint.crossOrigin = "anonymous"
      jsHint.href = jsSrc
      document.head.append(cssHint, jsHint)
    })
    .catch(() => {})
}

function loadAdminCss(href: string): Promise<HTMLLinkElement> {
  return new Promise((resolve) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.crossOrigin = "anonymous"
    link.href = href
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
  if (usedMe && usedNodes) return () => {}

  const restore = () => {
    if (window.fetch === wrapped) window.fetch = realFetch
  }
  const timer = setTimeout(restore, 1500)
  const wrapped: typeof window.fetch = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (method === "GET") {
      const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input)
      let pathname = ""
      try {
        pathname = new URL(rawUrl, location.href).pathname
      } catch {
        pathname = rawUrl
      }
      if (!usedMe && meSnapshot && pathname === "/api/me") {
        usedMe = true
        if (usedMe && usedNodes) {
          clearTimeout(timer)
          restore()
        }
        return Promise.resolve(
          new Response(JSON.stringify(meSnapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }
      if (!usedNodes && nodesSnapshot && pathname === "/api/nodes") {
        usedNodes = true
        if (usedMe && usedNodes) {
          clearTimeout(timer)
          restore()
        }
        return Promise.resolve(
          new Response(JSON.stringify(nodesSnapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }
    }
    return realFetch(input, init)
  }
  window.fetch = wrapped
  return () => {
    clearTimeout(timer)
    restore()
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
  const vtStyle = document.createElement("style")
  vtStyle.textContent =
    "::view-transition-old(root),::view-transition-new(root){animation-duration:160ms;animation-timing-function:cubic-bezier(0.22,1,0.36,1)}"

  const handoff = async () => {
    const restoreFetch = installFetchSnapshot()
    try {
      const adminCss = await loadAdminCss(target.cssHref)
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
      const vt = document.startViewTransition(handoff)
      void vt.finished.then(
        () => vtStyle.remove(),
        () => vtStyle.remove(),
      )
    } catch {
      vtStyle.remove()
      void handoff()
    }
  } else {
    void handoff()
  }
}
