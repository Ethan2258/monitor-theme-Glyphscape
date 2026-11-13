import { useEffect, useState } from "react"

import type { Rates } from "@/lib/cost"

/**
 * Exchange rates for the renminbi and dollar totals, fetched in the visitor's
 * browser from free public sources that publish once a day. All are asked and
 * the newest day wins; the answer is kept in this browser until a newer day's
 * rates can be out, so a page that is reloaded does not ask again.
 *
 * Sources publishing daily is what "live" means here: they follow the market's
 * close, not its every tick. An operator who would rather the page made no
 * request to a third party switches `live_rates` off and gets the table below.
 */
const SOURCES: { url: string; read: (body: unknown) => { date: string; perCny: Record<string, number> } }[] = [
  {
    // fawazahmed0/exchange-api from its Cloudflare mirror, first: it is served
    // uncached, where jsDelivr may hand out a copy a day or two old.
    url: "https://latest.currency-api.pages.dev/v1/currencies/cny.min.json",
    read: (b) => { const j = b as { date: string; cny: Record<string, number> }; return { date: j.date, perCny: j.cny } },
  },
  {
    // The same data through jsDelivr, for where the mirror cannot be reached.
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.min.json",
    read: (b) => { const j = b as { date: string; cny: Record<string, number> }; return { date: j.date, perCny: j.cny } },
  },
  {
    // Frankfurter: the European Central Bank's reference rates, ~30 currencies.
    url: "https://api.frankfurter.dev/v1/latest?base=CNY",
    read: (b) => { const j = b as { date: string; rates: Record<string, number> }; return { date: j.date, perCny: j.rates } },
  },
]

/**
 * Renminbi per unit, as published on 11 November 2026. Used until a source
 * answers, and for good if none does; the page then says the totals are by
 * reference rates.
 */
const BUILT_IN: Rates = {
  date: "2026-11-11",
  live: false,
  cny: {
    USD: 6.674, EUR: 7.45, HKD: 0.8507, JPY: 0.04203, GBP: 8.909, SGD: 5.207, KRW: 0.005005, AUD: 4.59,
    CAD: 4.699, TWD: 0.2033, MYR: 1.638, THB: 0.1986, RUB: 0.08021, INR: 0.07124, CHF: 8.079, NZD: 3.744,
    VND: 0.0002604, PHP: 0.1057, IDR: 0.0003677, TRY: 0.1329, AED: 1.817, BRL: 1.195, SEK: 0.6759,
    NOK: 0.7024, PLN: 1.695, ZAR: 0.4042, MXN: 0.3591,
  },
}

const KEY = "inkpond:rates"
/** How often an open page looks whether a newer day's rates are out. */
const CHECK = 3600_000
/** At most this long between asking the sources, whatever the cache says. */
const FRESH = 6 * 3600_000

/** Today in the visitor's calendar, as the sources write a date: 2026-11-13. */
const today = () => new Date().toLocaleDateString("sv-SE")
/** The day before `date`, in the same form. */
const dayBefore = (date: string) => new Date(new Date(`${date}T12:00:00`).getTime() - 86400_000).toLocaleDateString("sv-SE")

function cached(): (Rates & { at: number }) | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null")
    return saved && typeof saved.at === "number" && saved.cny?.USD > 0 ? saved : null
  } catch {
    return null
  }
}

/**
 * Whether the rates kept are still the newest there could be. The sources
 * publish a day's rates some hours into the next, so rates dated yesterday
 * are current; older ones, or ones fetched on an earlier day, are asked for
 * again. And never kept longer than six hours either way.
 */
function current(saved: Rates & { at: number }): boolean {
  const now = today()
  return Date.now() - saved.at < FRESH
    && new Date(saved.at).toLocaleDateString("sv-SE") === now
    && saved.date >= dayBefore(now)
}

async function ask(source: (typeof SOURCES)[number]): Promise<Rates> {
  const res = await fetch(source.url, { signal: AbortSignal.timeout(8000), credentials: "omit", cache: "no-store" })
  if (!res.ok) throw new Error(String(res.status))
  const { date, perCny } = source.read(await res.json())
  // The sources give units of each currency per renminbi; turned round.
  const cny: Record<string, number> = {}
  for (const [code, per] of Object.entries(perCny)) {
    if (typeof per === "number" && per > 0 && /^[a-z]{3}$/i.test(code)) cny[code.toUpperCase()] = 1 / per
  }
  if (!(cny.USD > 0)) throw new Error("no USD")
  return { cny, date: String(date).slice(0, 10), live: true }
}

/**
 * Every source at once, and the newest day any of them has. A CDN may hand out
 * a copy a day or two old, and one source may lag another; asking all of them
 * and keeping the latest is what makes the page move on to each new day.
 */
async function fetchRates(): Promise<Rates | null> {
  const answers = await Promise.allSettled(SOURCES.map(ask))
  const got = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []))
  // The newest date; on a tie, the first source, which carries the most currencies.
  return got.reduce<Rates | null>((best, r) => (!best || r.date > best.date ? r : best), null)
}

/**
 * The rates to count with: built in at first, then the newest this browser can
 * get. A page left open moves on by itself: it looks every hour, and again
 * when it comes back into view, whether a newer day's rates are out.
 */
export function useRates(live: boolean): Rates {
  const [rates, setRates] = useState<Rates>(() => (live && cached()) || BUILT_IN)
  useEffect(() => {
    if (!live) {
      // oxlint-disable-next-line react/set-state-in-effect
      setRates(BUILT_IN)
      return
    }
    let active = true
    let asking = false
    const refresh = async () => {
      const saved = cached()
      if (saved && current(saved)) {
        if (active) setRates(saved)
        return
      }
      if (asking) return
      asking = true
      const next = await fetchRates()
      asking = false
      if (!active || !next) return
      // A source answering with an older day than the one kept is ignored.
      const keep = saved && saved.date > next.date ? { ...saved, at: Date.now() } : { ...next, at: Date.now() }
      setRates(keep)
      try {
        localStorage.setItem(KEY, JSON.stringify(keep))
      } catch {
        // Then it is asked for again on the next visit.
      }
    }
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    void refresh()
    const timer = setInterval(refresh, CHECK)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [live])
  return rates
}
