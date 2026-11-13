import https from "node:https"
import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * `npm run demo`: a hub that lives in the page. scripts/dev-hub.js is the
 * stand-in the theme site previews every theme against -- thirty generated
 * nodes, among them an offline one, one that has not reported yet, expired and
 * expiring plans, several currencies and a very long name -- answering /api and
 * the WebSocket without a request leaving the browser. scripts/dev-demo.js adds
 * what it lacks for trying the theme out: settings, and a way to reach a state
 * from the address. Both run ahead of the theme's own scripts.
 *
 * Development server only; nothing of either is in a build.
 */
function demoHub(): Plugin {
  const scripts = { "/@demo-hub.js": "/scripts/dev-hub.js", "/@demo-tools.js": "/scripts/dev-demo.js" }
  return {
    name: "inkpond-demo-hub",
    apply: "serve",
    configureServer(server) {
      for (const [path, file] of Object.entries(scripts)) {
        server.middlewares.use(path, (_req, res) => {
          res.setHeader("content-type", "text/javascript; charset=utf-8")
          res.end(readFileSync(import.meta.dirname + file))
        })
      }
    },
    transformIndexHtml: () =>
      Object.keys(scripts).map((src) => ({ tag: "script", attrs: { src }, injectTo: "head-prepend" as const })),
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), mode === "demo" && demoHub()],
  // import.meta.dirname rather than new URL(...).pathname: the latter is
  // URL-encoded, so a checkout under a path containing a space or a non-ASCII
  // name resolves to %20 and the alias silently points nowhere.
  resolve: { alias: { "@": import.meta.dirname + "/src" } },
  build: {
    chunkSizeWarningLimit: 900,
    // Flags stay files. Vite would inline every one under 4 KiB -- all of them --
    // as a data URL, and because the page imports the whole set, all of them
    // would ship in the entry chunk whichever flags a hub's nodes need.
    assetsInlineLimit: (file) => (file.includes("/country-flag-icons/") ? false : undefined),
  },
  // A theme reads public data only, so any hub with its status page open can
  // serve as the source: MONITOR_HUB=https://hub.example.com npm run dev.
  // changeOrigin sends that hub its own name as Host, which the proxy or CDN in
  // front of it routes by.
  // Behind an HTTP proxy (https_proxy and the like), the requests go through it,
  // as everything else on the machine does; the agent reads those variables.
  server: {
    proxy: {
      "/api": {
        target: process.env.MONITOR_HUB || "http://127.0.0.1:9911",
        changeOrigin: true,
        ws: true,
        ...(process.env.MONITOR_HUB?.startsWith("https:") && (process.env.https_proxy || process.env.HTTPS_PROXY)
          ? { agent: new https.Agent({ proxyEnv: process.env } as https.AgentOptions) }
          : {}),
      },
    },
  },
}))
