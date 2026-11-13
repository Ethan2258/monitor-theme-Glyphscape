import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

// The figures' typeface. One file a script, fetched by unicode-range: a page
// of digits and Latin letters loads the Latin file and nothing else.
import "@fontsource-variable/geist-mono/wght.css"

import App from "./App.tsx"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
