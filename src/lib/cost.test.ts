// The price figures: run with `npm test`, as format.test.ts is.
import { convert, cycleMonths, monthly, remaining, sum } from "./cost.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}
const near = (got: number | null, want: number, what: string) =>
  eq(got === null ? null : Math.round(got * 100) / 100, want, what)

const plan = (price: number, billing_cycle: string, currency = "USD") => ({ price, billing_cycle, currency })

eq(cycleMonths("yearly"), 12, "带名字的周期")
eq(cycleMonths("60m"), 60, "<n>m 是月数")
eq(cycleMonths("once"), 0, "一次性没有周期")
eq(Number.isNaN(cycleMonths("weekly")), true, "不认识的周期是 NaN")

near(monthly(plan(120, "yearly")), 10, "年付摊到每月")
near(monthly(plan(30, "quarterly")), 10, "季付摊到每月")
eq(monthly(plan(0, "monthly")), null, "免费的节点不计入")
eq(monthly(plan(120, "once")), null, "一次性不是每月的支出")
eq(monthly(plan(120, "weekly")), null, "不认识的周期不计入")

// A year is 365.25 days here, so a full yearly term is worth its price.
near(remaining(plan(120, "yearly"), 365.25), 120, "整期剩余等于价格")
near(remaining(plan(120, "yearly"), 36.525), 12, "剩十分之一就值十分之一")
near(remaining(plan(10, "monthly"), 365.25), 120, "预付一年的月付值十二个月")
eq(remaining(plan(120, "yearly"), 0), null, "今天到期，没有剩余")
eq(remaining(plan(120, "yearly"), -3), null, "已过期，没有剩余")
eq(remaining(plan(120, "yearly"), null), null, "没有到期日，无从折算")
eq(remaining(plan(120, "yearly"), undefined), null, "旧 hub 没给天数")
eq(remaining(plan(120, "once"), 100), null, "一次性不折算")
eq(remaining(plan(0, "yearly"), 100), null, "免费的不折算")

const rates = { date: "2026-11-11", live: true, cny: { USD: 7, EUR: 8 } }
eq(convert(10, "USD", rates), { cny: 70, usd: 10 }, "美元原样保留，人民币按汇率")
eq(convert(70, "CNY", rates), { cny: 70, usd: 10 }, "人民币换成美元")
eq(convert(1, "eur", rates), { cny: 8, usd: 8 / 7 }, "其他货币经人民币换算，代码不分大小写")
eq(convert(1, "GBP", rates), null, "不知道汇率的不换算")
eq(convert(1, "CNY", { ...rates, cny: {} }), null, "没有美元汇率时什么都不换算")
const items = [{ currency: "USD", amount: 10 }, { currency: "CNY", amount: 30 }, { currency: "GBP", amount: 2 }, { currency: "GBP", amount: 1 }]
eq(sum(items, rates), { cny: 100, usd: 10 + 30 / 7, count: 2, missing: ["GBP"] }, "合计两种货币，换算不了的列出来")
eq(sum([], rates), { cny: 0, usd: 0, count: 0, missing: [] }, "没有价格就没有合计")

if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("cost 校验未通过")
}
console.log("cost 校验通过")
