import { nearestRegion, regionsOf, shortestArc, springStep, wrapLon } from "./globe.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

function ok(cond: boolean, what: string) {
  if (!cond) {
    failed++
    console.error(`✗ ${what}`)
  }
}

function near(got: number, want: number, eps: number, what: string) {
  if (!Number.isFinite(got) || Math.abs(got - want) > eps) {
    failed++
    console.error(`✗ ${what}\n    得到 ${got}\n    期望 ${want} (±${eps})`)
  }
}

// wrapLon keeps values strictly in [-180, 180) and guards non-finite inputs.
eq(wrapLon(0), 0, "wrapLon(0)")
eq(wrapLon(-180), -180, "wrapLon(-180) stays -180")
eq(wrapLon(180), -180, "wrapLon(180) wraps to -180")
eq(wrapLon(540), -180, "wrapLon(540) wraps to -180")
eq(wrapLon(-181), 179, "wrapLon(-181) wraps to 179")
eq(wrapLon(181), -179, "wrapLon(181) wraps to -179")
eq(wrapLon(Number.NaN), 0, "wrapLon(NaN) returns 0")

// shortestArc takes the shorter route around the globe, including across ±180°.
eq(shortestArc(170, -170), 20, "eastward across antimeridian is +20")
eq(shortestArc(-170, 170), -20, "westward across antimeridian is -20")
eq(shortestArc(-90, 170), -100, "westward via antimeridian (-90 -> 170)")
eq(shortestArc(10, 90), 80, "direct eastward arc")

// springStep is analytically frame-rate invariant across 60Hz, 120Hz and 240Hz.
function integrate(steps: number, totalTime: number) {
  let state = { value: 170, velocity: -8 }
  const dt = totalTime / steps
  for (let i = 0; i < steps; i++) {
    state = springStep(state.value, state.velocity, -170, 4.2, dt, true)
  }
  return state
}
const s60 = integrate(60, 0.75)
const s120 = integrate(120, 0.75)
const s240 = integrate(240, 0.75)
near(shortestArc(s60.value, s120.value), 0, 1e-9, "60Hz vs 120Hz angular position")
near(s60.velocity, s120.velocity, 1e-9, "60Hz vs 120Hz velocity")
near(shortestArc(s60.value, s240.value), 0, 1e-9, "60Hz vs 240Hz angular position")
near(s60.velocity, s240.velocity, 1e-9, "60Hz vs 240Hz velocity")

// Starting from rest produces smooth ease-in (quadratic displacement ~ dt^2) and zero overshoot.
let ease = { value: 0, velocity: 0 }
const first = springStep(ease.value, ease.velocity, 45, 4, 1 / 60, false)
ok(first.value > 0 && first.value < 0.25, "ease-in moves gently on frame 1 instead of snapping")
ok(first.velocity > 0 && first.velocity < 15, "velocity ramps smoothly from zero instead of jumping to omega*dist")
for (let i = 0; i < 300; i++) {
  ease = springStep(ease.value, ease.velocity, 45, 4, 1 / 60, false)
  ok(ease.value <= 45 + 1e-9, `no overshoot at step ${i}: ${ease.value}`)
}
near(ease.value, 45, 1e-3, "spring settles accurately at target")
near(ease.velocity, 0, 1e-3, "spring velocity settles at zero")

// regionsOf collapses antimeridian neighbors and orders tour monotonically eastward from biggest cluster.
eq(regionsOf([]), [], "empty markers")

const dateline = regionsOf([
  { lon: 176, lat: 10, count: 2 },
  { lon: -176, lat: 10, count: 2 },
])
eq(dateline.length, 1, "antimeridian pair stays one cluster")
near(Math.abs(dateline[0].lon), 180, 1e-9, "antimeridian midpoint at ±180")

const fleet = regionsOf([
  { lon: 10, lat: 50, count: 4 }, // Europe
  { lon: 115, lat: 35, count: 10 }, // Asia (largest)
  { lon: -95, lat: 38, count: 6 }, // North America
  { lon: 150, lat: -30, count: 2 }, // Oceania (within 60° of Asia? 35° away -> clustered with Asia)
])
// Asia+Oceania grouped together (~120°E, count 12), America (~-95°W), Europe (~10°E).
eq(fleet.length, 3, "three major global clusters")
eq(fleet[0].count, 12, "largest cluster is anchor at index 0")
const leg1 = (((fleet[1].lon - fleet[0].lon) % 360) + 360) % 360
const leg2 = (((fleet[2].lon - fleet[1].lon) % 360) + 360) % 360
const leg3 = (((fleet[0].lon - fleet[2].lon) % 360) + 360) % 360
ok(leg1 > 0 && leg2 > 0 && leg3 > 0, "tour advances steadily eastward")
near(leg1 + leg2 + leg3, 360, 1e-6, "full tour sums to 360° eastward")

// nearestRegion finds closest cluster including across ±180°.
eq(nearestRegion(fleet, -100), 1, "nearest to Americas")
eq(nearestRegion(fleet, 15), 2, "nearest to Europe")
eq(nearestRegion(fleet, -175), 0, "nearest across antimeridian")

if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("globe 校验未通过")
}
console.log("globe 校验通过")
