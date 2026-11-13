import { useEffect, useRef } from "react"

import { startPond, type Fish } from "@/lib/pond"

/**
 * The koi pond behind the page. Mounted once, above the routes, so the fish
 * carry on as the visitor moves between the list and a node. Purely decoration:
 * hidden from assistive technology, and it takes no pointer events itself -- the
 * pond listens on the window and decides what counts as a click on the water.
 */
export function Pond({ feed, fish }: { feed: boolean; fish: Fish }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => startPond(canvas.current!, { feed, fish }), [feed, fish])
  return <canvas ref={canvas} className="pond" aria-hidden />
}
