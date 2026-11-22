import manifest from "../../theme.json"
import { api } from "@/lib/api"

/** The settings declared in theme.json, as this theme reads them. */
export type Config = {
  notice: string
  show_summary: boolean
  show_globe: boolean
  show_toolbar: boolean
  color_mode: "auto" | "light" | "dark"
  footer: string
  show_price: boolean
  show_cost: boolean
  primary_currency: "CNY" | "USD"
  live_rates: boolean
  show_ping: boolean
  ping_probes: string
  ping_hours: "1" | "6" | "24"
  pond: boolean
  scene: "pond" | "wraith"
  pond_feed: boolean
  pond_fish: "auto" | "few" | "many"
}

type Field = {
  key: string
  type: string
  default: unknown
  options?: { value: string }[]
  min?: number
  max?: number
}

// Group headings (`type: "title"`) hold no value.
const fields = (manifest.config as unknown as Field[]).filter((f) => f.type !== "title")

/**
 * The panel's own check of a value against its declaration. A saved value may
 * date from an older version of this theme -- another type, an option since
 * removed, a number now out of range -- and one that no longer fits counts as
 * never saved.
 */
function fits(field: Field, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity)
    case "select":
      return !!field.options?.some((option) => option.value === value)
    default:
      return typeof value === "string"
  }
}

const pick = (saved: Record<string, unknown>) =>
  Object.fromEntries(fields.map((f) => [f.key, fits(f, saved[f.key]) ? saved[f.key] : f.default])) as Config

/** What the page shows until the hub's answer arrives, and whenever it does not. */
export const DEFAULTS = pick({})

const CACHE_KEY = "inkpond:config"

/** Last validated settings saved in this browser, for immediate mount across navigations. */
export function cachedConfig(): Config | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CACHE_KEY) : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? pick(parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The operator's settings over the defaults declared in theme.json, which the
 * hub does not store. Any failure, a hub predating settings (404) included,
 * renders the defaults rather than an error.
 */
export function loadConfig(): Promise<Config> {
  return api<Record<string, unknown>>(`/themes/${manifest.short}/config`)
    .then((saved) => {
      const cfg = pick(saved && typeof saved === "object" ? saved : {})
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(CACHE_KEY, JSON.stringify(cfg))
      } catch {
        // Storage may be disabled for the site.
      }
      return cfg
    })
    .catch(() => cachedConfig() ?? DEFAULTS)
}
