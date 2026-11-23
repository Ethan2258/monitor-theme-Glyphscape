// The latency strip's colour and depth (latency.ts). Run with `npm test`.
import { blockTier } from "./latency.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

// A steady 105 ms line: one amber, at the line's normal depth, end to end.
for (const v of [100, 103, 105, 108, 111]) eq(blockTier(v, 105), { tone: "warn", depth: 0 }, `平稳 105 ms 线上的 ${v} ms`)
// Its slow stretches stand out in the same colour, deeper.
eq(blockTier(118, 105), { tone: "warn", depth: 1 }, "高出常态 12%、13 ms")
eq(blockTier(135, 105), { tone: "warn", depth: 2 }, "高出常态 28%、30 ms")
// Far enough above the usual, a colour up.
eq(blockTier(160, 105), { tone: "hot", depth: 2 }, "高出常态 52%、55 ms")
eq(blockTier(70, 35), { tone: "warn", depth: 2 }, "快线上翻倍的尖峰")
// A fast line's normal is green and faint; a feelable bump is deeper green.
eq(blockTier(40, 40), { tone: "ok", depth: 0 }, "快线常态")
eq(blockTier(46, 40), { tone: "ok", depth: 1 }, "快线小幅变慢")
eq(blockTier(52, 40), { tone: "ok", depth: 2 }, "快线明显变慢")
// Twice the usual on a 1 ms line is still nothing.
eq(blockTier(2, 1), { tone: "ok", depth: 0 }, "1 ms 线上的 2 ms")
// Outright slow, a timeout, no data.
eq(blockTier(260, 255), { tone: "hot", depth: 0 }, "常态就在 250 ms 以上")
eq(blockTier(null, 105), { tone: "timeout", depth: 2 }, "超时")
eq(blockTier(undefined, 105), { tone: "none", depth: 0 }, "无数据")
eq(blockTier(120, null), { tone: "warn", depth: 0 }, "没有常态可比")

if (failed) {
  console.error(`
${failed} 项不通过`)
  throw new Error("latency 校验未通过")
}
console.log("latency 校验通过")
