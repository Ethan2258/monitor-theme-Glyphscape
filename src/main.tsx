import { StrictMode } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

// The figures' typeface. One file a script, fetched by unicode-range: a page
// of digits and Latin letters loads the Latin file and nothing else.
import "@fontsource-variable/geist-mono/wght.css"

import { registerHomeUnmount } from "./lib/admin"
import App from "./App.tsx"
import "./index.css"

const root = createRoot(document.getElementById("root")!)
registerHomeUnmount(() => flushSync(() => root.unmount()))
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
