import { useEffect, useRef } from "react"

import { startRealm } from "@/lib/realm"

/**
 * The ghost realm at the head of the page, the other of the two scenes beside
 * the koi pond. Mounted once, above the routes, so the wraiths carry on as the
 * visitor moves between the list and a node.
 * Purely decoration: hidden from assistive technology, and it takes no pointer
 * events itself.
 */
export function Realm({ hidden = false }: { hidden?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => startRealm(canvas.current!), [])
  return <canvas ref={canvas} className="realm" aria-hidden hidden={hidden} />
}
