/// <reference types="node" />
import assert from "node:assert/strict"
import type { Node } from "./api.ts"
import { isSortKey, sortNodes } from "./filter.ts"

const make = (id: number, sort = id): Node => ({ id, sort, name: `n${id}` } as Node)

assert.equal(isSortKey("ping"), true)
assert.equal(isSortKey("unknown"), false)

// Latency order: lowest ms first, then timeouts (Infinity), then nodes with no data,
// with the operator's default order breaking ties.
const nodes = [make(1), make(2), make(3), make(4), make(5)]
const ranks = new Map<number, number | null>([
  [1, 240],
  [2, Infinity],
  [3, 12],
  [4, 85],
])
assert.deepEqual(
  sortNodes(nodes, "ping", ranks).map((n) => n.id),
  [3, 4, 1, 2, 5],
)
console.log("filter 校验通过")
