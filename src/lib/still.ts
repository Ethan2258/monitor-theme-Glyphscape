/**
 * While the palette change plays, the page holds still: work that would
 * re-render it (the live figures arriving every two seconds) waits until it is
 * done, keeping only the latest of each kind, so no long frame lands in the
 * middle of the rings. No imports, so the node tests can load what uses it.
 */
let quiet = 0
const waiting = new Map<string, () => void>()

/** Runs `fn` now, or once the palette change playing has finished. */
export function whenStill(key: string, fn: () => void) {
  if (!quiet) return fn()
  waiting.set(key, fn)
}

/**
 * Holds the page still; returns what lets it go (safe to call twice). Whatever
 * goes wrong, it lets go by itself after `limit` milliseconds.
 */
export function hush(limit: number): () => void {
  quiet++
  let done = false
  const release = () => {
    if (done) return
    done = true
    if (--quiet) return
    const queued = [...waiting.values()]
    waiting.clear()
    for (const fn of queued) fn()
  }
  setTimeout(release, limit)
  return release
}
