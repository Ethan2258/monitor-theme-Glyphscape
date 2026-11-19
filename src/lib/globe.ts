/** Mathematical helpers and pure rotation/region primitives for the 3D globe. */

export interface RegionMarker {
  lon: number
  lat: number
  count: number
}

export interface Region {
  lon: number
  lat: number
  count: number
}

export interface SpringState {
  value: number
  velocity: number
}

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Wrap any longitude in degrees into the half-open interval `[-180, 180)`. */
export function wrapLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  return wrapped === 0 ? 0 : wrapped
}

/**
 * Signed shortest angular distance in degrees from `from` to `to`, within
 * `[-180, 180)`. Positive means turning east (`+lon`), negative means west.
 */
export function shortestArc(from: number, to: number): number {
  return wrapLon(to - from)
}

/**
 * Advance a critically damped harmonic spring (`zeta = 1`) over `dt` seconds
 * using its exact analytical solution. Frame-rate independent, `C1` smooth
 * across target switches (no initial acceleration snap), and overshoot-free
 * when starting from rest (`velocity = 0`).
 */
export function springStep(
  value: number,
  velocity: number,
  target: number,
  omega: number,
  dt: number,
  angular = false,
): SpringState {
  if (dt <= 0 || omega <= 0) {
    return { value: angular ? wrapLon(value) : value, velocity }
  }
  const x0 = angular ? -shortestArc(value, target) : value - target
  const delta = velocity + omega * x0
  const decay = Math.exp(-omega * dt)
  const x1 = (x0 + delta * dt) * decay
  const v1 = (velocity - omega * delta * dt) * decay
  const next = target + x1
  return {
    value: angular ? wrapLon(next) : next,
    velocity: v1,
  }
}

/**
 * Cluster fleet markers by longitudinal proximity (splitting gaps wider than
 * `60 deg` round the globe without splitting across the antimeridian), then
 * order regions monotonically eastward starting from the largest cluster.
 */
export function regionsOf(markers: readonly RegionMarker[]): Region[] {
  if (markers.length === 0) return []
  const sorted = markers
    .map((m) => ({ lon: wrapLon(m.lon), lat: m.lat, count: Math.max(0, m.count) }))
    .sort((a, b) => a.lon - b.lon)

  // Start after the widest gap so a cluster straddling ±180° stays intact.
  let widest = -1
  let at = 0
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length]
    const gap =
      sorted.length === 1
        ? 360
        : (((next.lon - sorted[i].lon) % 360) + 360) % 360
    if (gap > widest) {
      widest = gap
      at = (i + 1) % sorted.length
    }
  }

  const ring = [...sorted.slice(at), ...sorted.slice(0, at)]
  const groups: (typeof sorted)[] = [[ring[0]]]
  for (let i = 1; i < ring.length; i++) {
    const gap = (((ring[i].lon - ring[i - 1].lon) % 360) + 360) % 360
    if (gap > 60) groups.push([ring[i]])
    else groups[groups.length - 1].push(ring[i])
  }

  const regions: Region[] = groups.map((g) => {
    let sx = 0
    let sy = 0
    let lat = 0
    let n = 0
    for (const m of g) {
      const w = m.count > 0 ? m.count : 1
      sx += Math.cos(m.lon * RAD) * w
      sy += Math.sin(m.lon * RAD) * w
      lat += m.lat * w
      n += w
    }
    const totalCount = g.reduce((sum, m) => sum + m.count, 0)
    return {
      lon: wrapLon(Math.atan2(sy, sx) * DEG),
      lat: clamp(lat / n, -25, 35),
      count: totalCount,
    }
  })

  if (regions.length <= 1) return regions

  // Anchor at the largest cluster so initial focus faces where most nodes live,
  // then advance monotonically eastward round the world without reversing.
  let anchorIdx = 0
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].count > regions[anchorIdx].count) anchorIdx = i
  }
  const anchorLon = regions[anchorIdx].lon
  return regions.sort((a, b) => {
    const oa = (((a.lon - anchorLon) % 360) + 360) % 360
    const ob = (((b.lon - anchorLon) % 360) + 360) % 360
    return oa - ob
  })
}

/** Return the index of the region closest in longitude to `lon`. */
export function nearestRegion(regions: readonly Region[], lon: number): number {
  if (regions.length === 0) return 0
  let best = 0
  let bestDist = Math.abs(shortestArc(lon, regions[0].lon))
  for (let i = 1; i < regions.length; i++) {
    const d = Math.abs(shortestArc(lon, regions[i].lon))
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}
