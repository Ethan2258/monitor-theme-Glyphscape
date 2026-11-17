import { useLayoutEffect, useRef, useState, type RefObject } from "react"

import { Pond } from "@/components/Pond"
import { Realm } from "@/components/Realm"
import type { SceneChoice } from "@/components/ThemeMenu"
import { FADE } from "@/lib/palette"
import type { Fish } from "@/lib/pond"

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)")
const EASE = "cubic-bezier(0.37, 0, 0.63, 1)"

/**
 * Renders the active header scene (`Pond` or `Realm`) directly inside the hero
 * `.isolate` wrapper so `:has(> .realm)` keeps matching, while cross-fading a
 * snapshot of the outgoing canvas across scene switches (`pond` <-> `wraith` <-> `off`).
 */
export function SceneStage({ hostRef, scene, feed, fish }: {
  hostRef: RefObject<HTMLDivElement | null>
  scene: SceneChoice
  feed: boolean
  fish: Fish
}) {
  const [rendered, setRendered] = useState<SceneChoice>(scene)
  const stillHostRef = useRef<HTMLDivElement>(null)
  const fadeEnter = useRef(false)

  useLayoutEffect(() => {
    if (scene === rendered) return
    const host = hostRef.current
    const stillHost = stillHostRef.current
    if (host && stillHost) {
      stillHost.replaceChildren()
      const live = host.querySelector<HTMLCanvasElement>("canvas.pond, canvas.realm")
      if (!REDUCED.matches && live && live.width > 0 && live.height > 0 && live.offsetParent) {
        const still = document.createElement("canvas")
        still.width = live.width
        still.height = live.height
        still.getContext("2d")?.drawImage(live, 0, 0)
        still.className = live.classList.contains("realm") ? "scene-still-realm" : "scene-still-pond"
        stillHost.append(still)
        const anim = still.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, easing: EASE, fill: "forwards" })
        let cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          still.remove()
        }
        anim.finished.then(cleanup, cleanup)
        setTimeout(cleanup, FADE + 100)
      }
    }
    fadeEnter.current = rendered === "off" && scene !== "off"
    // oxlint-disable-next-line react/set-state-in-effect
    setRendered(scene)
  }, [hostRef, rendered, scene])

  useLayoutEffect(() => {
    if (!fadeEnter.current || rendered === "off" || REDUCED.matches) return
    fadeEnter.current = false
    const canvas = hostRef.current?.querySelector<HTMLCanvasElement>("canvas.pond, canvas.realm")
    canvas?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE, easing: EASE })
  }, [hostRef, rendered])

  return (
    <>
      {rendered === "wraith" ? <Realm /> : rendered === "pond" ? <Pond feed={feed} fish={fish} /> : null}
      <div ref={stillHostRef} className="pointer-events-none absolute inset-0 -z-1" aria-hidden />
    </>
  )
}
