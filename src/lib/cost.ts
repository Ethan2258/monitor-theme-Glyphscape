// What a node costs, what is left of what has been paid for it, and both in
// the two currencies this theme counts in: renminbi and US dollars. Kept free
// of imports so `npm test` can run it under Node as it stands.

type Priced = { price: number; currency: string; billing_cycle: string }

// Hub 1.3.0 and earlier store only these names; later hubs store any other
// length as `<n>m`.
const NAMED: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12, biennial: 24, triennial: 36 }

/** Months in a billing cycle: 0 for a one-off purchase, NaN for a value this theme does not know. */
export function cycleMonths(cycle: string): number {
  if (cycle === "once") return 0
  return NAMED[cycle] ?? Number(/^(\d+)m$/.exec(cycle)?.[1])
}

/**
 * The price spread over the months it buys, which is what makes a yearly plan
 * comparable with a monthly one. null for a free node and for a one-off
 * purchase, which recurs in no month.
 */
export function monthly(node: Priced): number | null {
  const months = cycleMonths(node.billing_cycle)
  return node.price > 0 && months > 0 ? node.price / months : null
}

/** A month as a share of a year, so twelve of them are one year whichever months they are. */
const DAYS_PER_MONTH = 365.25 / 12

/**
 * The share of the current price that the days until expiry are worth: what the
 * node would fetch if its remaining term were sold on. `days` is the hub's count
 * (`expires_in`). null where there is nothing to prorate -- no price, a one-off
 * purchase, no expiry date -- and once the term has run out.
 *
 * Not capped at the price: a monthly plan paid a year ahead is worth twelve of
 * its months.
 */
export function remaining(node: Priced, days: number | null | undefined): number | null {
  const months = cycleMonths(node.billing_cycle)
  if (!(node.price > 0) || !(months > 0) || days == null || !(days > 0)) return null
  return (node.price * days) / (months * DAYS_PER_MONTH)
}

/**
 * Exchange rates: how many renminbi one unit of each currency buys, by
 * upper-case code. `date` is the day the source published them; `live` is
 * false for the table built into the theme, used when no source answers.
 */
export type Rates = { cny: Record<string, number>; date: string; live: boolean }

/** An amount in both counting currencies. */
export type Both = { cny: number; usd: number }

/** `amount` of `currency` in renminbi and in dollars, or null where the rate is unknown. */
export function convert(amount: number, currency: string, rates: Rates): Both | null {
  const code = currency.toUpperCase()
  const per = code === "CNY" ? 1 : rates.cny[code]
  const usd = rates.cny.USD
  if (!(per > 0) || !(usd > 0)) return null
  const cny = amount * per
  // An amount already in dollars stays exactly what was typed.
  return { cny, usd: code === "USD" ? amount : cny / usd }
}

/**
 * Amounts added up in both currencies. A currency with no known rate cannot be
 * added in; its code is listed under `missing` rather than guessed at.
 */
export function sum(items: { amount: number; currency: string }[], rates: Rates): Both & { count: number; missing: string[] } {
  const total = { cny: 0, usd: 0, count: 0, missing: [] as string[] }
  for (const item of items) {
    const both = convert(item.amount, item.currency, rates)
    if (!both) {
      if (!total.missing.includes(item.currency)) total.missing.push(item.currency)
      continue
    }
    total.cny += both.cny
    total.usd += both.usd
    total.count++
  }
  return total
}
