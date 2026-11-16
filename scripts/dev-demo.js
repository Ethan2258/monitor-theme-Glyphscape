// Loaded by `npm run demo` only, after scripts/dev-hub.js and before the theme:
// what the stand-in hub lacks for trying the theme out. Nothing here is in a
// build.
//
// The stand-in has no settings to save. Put the JSON a hub would answer in
// localStorage under `demo:config`, or in the address, and it is what the
// theme's settings request gets back.
//
//   ?theme=dark               the visitor's choice of palette (or light)
//   ?config={"notice":"…"}    the operator's settings
//   ?reset                    forget both, and the theme's own preferences
//
// And for a screenshot of a state that takes a click to reach, steps to run
// once the page is up, each `@` the milliseconds after load to run it at:
//
//   ?click=[title="切换配色"]@6000     click what a selector finds
//   ?click=text:网络延迟@4000           or the first control whose label has the text
//   ?type=input[type=search]=tokyo@4000
(() => {
  const q = new URLSearchParams(location.search)
  if (q.has("reset")) {
    for (const key of ["theme", "demo:config", "inkpond:mode", "inkpond:pond", "inkpond:scene", "inkpond:scene-site", "inkpond:sort", "inkpond:view"]) {
      localStorage.removeItem(key)
    }
  }
  if (q.has("theme")) localStorage.setItem("theme", q.get("theme"))
  if (q.has("config")) localStorage.setItem("demo:config", q.get("config"))

  const next = window.fetch
  window.fetch = function (input, init) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href)
      const saved = localStorage.getItem("demo:config")
      if (saved && /^\/api\/themes\/[^/]+\/config$/.test(url.pathname) && (init?.method ?? "GET") === "GET") {
        return Promise.resolve(new Response(saved, { headers: { "content-type": "application/json" } }))
      }
    } catch {}
    return next.call(this, input, init)
  }

  const find = (what) =>
    what.startsWith("text:")
      ? [...document.querySelectorAll('button, a, select, [role="button"]')].find((el) =>
          el.textContent.includes(what.slice(5)),
        )
      : document.querySelector(what)
  const steps = (name) =>
    q.getAll(name).map((step) => {
      const at = step.lastIndexOf("@")
      return at < 0 ? [step, 3000] : [step.slice(0, at), Number(step.slice(at + 1))]
    })

  for (const [what, at] of steps("click")) setTimeout(() => find(what)?.click(), at)
  for (const [what, at] of steps("type")) {
    setTimeout(() => {
      const split = what.lastIndexOf("=")
      const field = find(what.slice(0, split))
      if (!field) return
      // Through the element's own setter, which is what React listens behind.
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value").set.call(field, what.slice(split + 1))
      field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }))
    }, at)
  }
})()
