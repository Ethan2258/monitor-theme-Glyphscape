import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react"

import { AutoIcon, CheckIcon, GhostIcon, GhostOffIcon, KoiIcon, KoiOffIcon, MoonIcon, SunIcon } from "@/components/icons"
import { preloadPond } from "@/lib/pond"
import { preloadRealm } from "@/lib/realm"
import { cn } from "@/lib/utils"

export type ThemeChoice = "light" | "dark" | "auto"
export type SceneChoice = "pond" | "wraith" | "off"

type MenuIcon = ComponentType<{ className?: string }>

const CHOICES = [
  { value: "light", label: "浅色", Icon: SunIcon },
  { value: "dark", label: "深色", Icon: MoonIcon },
  { value: "auto", label: "跟随系统", Icon: AutoIcon },
] as const

const SCENES = [
  { value: "pond", label: "锦鲤", Icon: KoiIcon },
  { value: "wraith", label: "幽灵", Icon: GhostIcon },
  { value: "off", label: "收起", Icon: null },
] as const

/**
 * Shared header icon button with a small single-choice menu underneath, closed
 * on outside press or Escape. Opened, focus moves into the menu, onto the
 * choice in force; the arrow keys, Home and End move between the choices, as
 * in any menu, and Escape or Tab leaves it.
 */
function HeaderMenu<T extends string>({
  label,
  title,
  value,
  currentIcon: CurrentIcon,
  items,
  onPick,
  onOpen,
}: {
  label: string
  title: string
  value: T
  currentIcon: MenuIcon
  items: readonly { value: T; label: string; Icon: MenuIcon }[]
  onPick: (value: T, at: { x: number; y: number }) => void
  /** Called as the menu opens, before any choice: for fetching what a choice will need. */
  onOpen?: () => void
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
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
        // From the button too: ArrowDown opens the menu, as on a native select.
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            onOpen?.()
            setOpen(true)
          }
        }}
        className="inline-flex size-10 items-center sm:size-8 justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <CurrentIcon className="size-[18px]" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute top-[calc(100%+8px)] right-0 z-30 w-40 rounded-xl border bg-popover p-1 shadow-[0_10px_30px_rgb(0_0_0/0.12)]"
        >
          {items.map((item) => (
            <button
              key={item.value}
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
              <item.Icon className="size-4" />
              <span className="flex-1 text-left">{item.label}</span>
              {value === item.value && <CheckIcon className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The visitor's palette: light, dark, or whatever the system is set to. A
 * button showing the choice in force, and under it a small menu of the three.
 * The menu reports where the button sits, which is where the ripple of a
 * palette change spreads from.
 */
export function ThemeMenu({ choice, onPick }: { choice: ThemeChoice; onPick: (choice: ThemeChoice, at: { x: number; y: number }) => void }) {
  const current = CHOICES.find((c) => c.value === choice)!
  return (
    <HeaderMenu
      label="配色"
      title={`配色：${current.label}`}
      value={choice}
      currentIcon={current.Icon}
      items={CHOICES}
      onPick={onPick}
    />
  )
}

/**
 * The visitor's scene: koi pond, ghost realm, or collapsed. Matches ThemeMenu
 * in the header; when collapsed, shows the active scene's struck-through icon.
 */
export function SceneMenu({ choice, scene, onPick }: { choice: SceneChoice; scene: "pond" | "wraith"; onPick: (choice: SceneChoice) => void }) {
  const offIcon: MenuIcon = scene === "wraith" ? GhostOffIcon : KoiOffIcon
  const current = SCENES.find((c) => c.value === choice)!
  const items = SCENES.map((item) => ({ ...item, Icon: item.Icon ?? offIcon }))
  return (
    <HeaderMenu
      label="场景"
      title={`场景：${current.label}`}
      value={choice}
      currentIcon={current.Icon ?? offIcon}
      items={items}
      onPick={(next) => onPick(next)}
      // The scene a choice switches to is fetched as the menu opens, if the
      // idle prefetch has not already brought it, so the switch itself does
      // not wait on the network.
      onOpen={() => {
        preloadPond()
        preloadRealm()
      }}
    />
  )
}
