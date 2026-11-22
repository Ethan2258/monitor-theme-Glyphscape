import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react"

import { CheckIcon } from "@/components/icons"
import { cn } from "@/lib/utils"

export type MenuIcon = ComponentType<{ className?: string }>

/**
 * A button with a small single-choice menu underneath, closed on outside press
 * or Escape: the palette and scene menus in the header, and the list's order.
 * One look for all of them -- a rounded panel on the popover colour, the choice
 * in force in full ink with a tick, the others muted.
 *
 * Opened, focus moves into the menu, onto the choice in force; the arrow keys,
 * Home and End move between the choices, as in any menu, and Escape or Tab
 * leaves it. ArrowDown or ArrowUp on the button opens it, as on a native select.
 */
export function ChoiceMenu<T extends string>({
  label,
  title,
  value,
  items,
  onPick,
  onOpen,
  buttonClassName,
  children,
  menuClassName,
}: {
  label: string
  title?: string
  value: T
  items: readonly { value: T; label: string; Icon?: MenuIcon }[]
  onPick: (value: T, at: { x: number; y: number }) => void
  /** Called as the menu opens, before any choice: for fetching what a choice will need. */
  onOpen?: () => void
  buttonClassName: string
  /** What the button shows. */
  children: ReactNode
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // Closed by a press anywhere else.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    addEventListener("pointerdown", away)
    return () => removeEventListener("pointerdown", away)
  }, [open])

  // Focus goes into the menu as it opens, onto the choice in force, so the
  // arrow keys work at once and a screen reader announces where it is.
  useEffect(() => {
    if (!open) return
    const choices = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    ;(choices.find((el) => el.getAttribute("aria-checked") === "true") ?? choices[0])?.focus()
  }, [open])

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const choices = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    const at = choices.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      e.preventDefault()
      choices[(i + choices.length) % choices.length]?.focus()
    }
    if (e.key === "ArrowDown") go(at + 1)
    else if (e.key === "ArrowUp") go(at < 0 ? choices.length - 1 : at - 1)
    else if (e.key === "Home") go(0)
    else if (e.key === "End") go(choices.length - 1)
    else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      button.current?.focus()
    } else if (e.key === "Tab") {
      // Tab leaves the menu for the next thing on the page, and the menu
      // closes behind it rather than staying open with focus elsewhere.
      setOpen(false)
    }
  }

  return (
    <div ref={root} data-pond-ignore="" data-sky-ignore="" className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            onOpen?.()
            setOpen(true)
          }
        }}
        className={buttonClassName}
      >
        {children}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            "absolute top-[calc(100%+8px)] right-0 z-30 w-40 rounded-xl border bg-popover p-1 shadow-[0_10px_30px_rgb(0_0_0/0.12)]",
            menuClassName,
          )}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === item.value}
              // Reached by the arrow keys, not by Tab: one stop for the whole menu.
              tabIndex={-1}
              onClick={() => {
                const box = button.current!.getBoundingClientRect()
                setOpen(false)
                // Back to the button, or focus would fall to the page's top
                // as the chosen item leaves with the menu.
                button.current!.focus()
                onPick(item.value, { x: box.left + box.width / 2, y: box.top + box.height / 2 })
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50",
                value === item.value ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {item.Icon && <item.Icon className="size-4" />}
              <span className="flex-1 text-left">{item.label}</span>
              {value === item.value && <CheckIcon className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
