import { useEffect, useRef, useState, type ComponentType } from "react"

import { AutoIcon, CheckIcon, GhostIcon, GhostOffIcon, KoiIcon, KoiOffIcon, MoonIcon, SunIcon } from "@/components/icons"
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
 * on outside press or Escape.
 */
function HeaderMenu<T extends string>({
  label,
  title,
  value,
  currentIcon: CurrentIcon,
  items,
  onPick,
}: {
  label: string
  title: string
  value: T
  currentIcon: MenuIcon
  items: readonly { value: T; label: string; Icon: MenuIcon }[]
  onPick: (value: T, at: { x: number; y: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  // Closed by a press anywhere else, or by Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        button.current?.focus()
      }
    }
    addEventListener("pointerdown", away)
    addEventListener("keydown", key)
    return () => {
      removeEventListener("pointerdown", away)
      removeEventListener("keydown", key)
    }
  }, [open])

  return (
    <div ref={root} data-pond-ignore="" data-sky-ignore="" className="relative">
      <button
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(!open)}
        className="inline-flex size-10 items-center sm:size-8 justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <CurrentIcon className="size-[18px]" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-[calc(100%+8px)] right-0 z-30 w-40 rounded-xl border bg-popover p-1 shadow-[0_10px_30px_rgb(0_0_0/0.12)]"
        >
          {items.map((item) => (
            <button
              key={item.value}
              role="menuitemradio"
              aria-checked={value === item.value}
              onClick={() => {
                const box = button.current!.getBoundingClientRect()
                setOpen(false)
                onPick(item.value, { x: box.left + box.width / 2, y: box.top + box.height / 2 })
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-secondary",
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
    />
  )
}
