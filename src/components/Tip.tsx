import { useEffect } from "react"

/**
 * The page's hover hints, in place of the browser's own `title` tooltip: that
 * one waits a second, is drawn by the system in its own font and colours, and
 * reads as a different program's. Any element with a `data-tip` gets this
 * one instead -- the globe's marker label in look (a small popover-coloured
 * box), above the element and flipped below it near the top of the window.
 *
 * One box for the whole page, moved and refilled by hand on each hint, so a
 * hover redraws nothing in React. Shown after a short pause, or at once while
 * moving from one hinted thing to the next, as along a latency strip; hidden
 * on leaving, pressing, scrolling or a key. A mouse or pen only: a touch has no
 * hover, and the hinted things there either do something on a tap or repeat
 * what is already on screen. Keyboard focus shows it too.
 */
const WAIT = 350
/** Within this long of the last hint closing, the next opens at once. */
const WARM = 400
const GAP = 8
const EDGE = 8

export function TipLayer() {
  useEffect(() => {
    const box = document.createElement("div")
    box.setAttribute("role", "tooltip")
    box.id = "page-tip"
    box.className =
      "pointer-events-none fixed top-0 left-0 z-50 max-w-72 rounded-md border bg-popover px-2 py-1 text-xs text-foreground shadow-sm whitespace-pre-line"
    box.hidden = true
    document.body.append(box)

    let target: HTMLElement | null = null
    let timer = 0
    let closedAt = 0

    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const w = box.offsetWidth
      const h = box.offsetHeight
      const below = r.top - GAP - h < EDGE
      const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), innerWidth - w - EDGE)
      const y = below ? r.bottom + GAP : r.top - GAP - h
      box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip
      if (!text) return
      target = el
      box.textContent = text
      box.hidden = false
      place(el)
      el.setAttribute("aria-describedby", box.id)
    }
    const hide = () => {
      clearTimeout(timer)
      if (!target) return
      target.removeAttribute("aria-describedby")
      target = null
      closedAt = performance.now()
      box.hidden = true
    }
    const want = (el: HTMLElement) => {
      if (el === target) return
      clearTimeout(timer)
      const warm = target !== null || performance.now() - closedAt < WARM
      if (target) hide()
      if (warm) show(el)
      else timer = window.setTimeout(() => show(el), WAIT)
    }

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]")
      if (el) want(el)
      else if (target || timer) hide()
    }
    const out = (e: PointerEvent) => {
      // Leaving the window, or into something with no hint of its own.
      if (!e.relatedTarget) hide()
    }
    const focus = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (el.dataset?.tip && el.matches(":focus-visible")) want(el)
    }
    const blur = (e: FocusEvent) => {
      if (e.target === target) hide()
    }

    addEventListener("pointerover", over, { passive: true })
    document.addEventListener("pointerout", out, { passive: true })
    addEventListener("pointerdown", hide, { passive: true })
    addEventListener("keydown", hide)
    addEventListener("scroll", hide, { passive: true, capture: true })
    addEventListener("blur", hide)
    document.addEventListener("focusin", focus)
    document.addEventListener("focusout", blur)
    return () => {
      hide()
      box.remove()
      removeEventListener("pointerover", over)
      document.removeEventListener("pointerout", out)
      removeEventListener("pointerdown", hide)
      removeEventListener("keydown", hide)
      removeEventListener("scroll", hide, { capture: true })
      removeEventListener("blur", hide)
      document.removeEventListener("focusin", focus)
      document.removeEventListener("focusout", blur)
    }
  }, [])
  return null
}
