import { useEffect, useRef, useState } from "react"

import { AutoIcon, CheckIcon, MoonIcon, SunIcon } from "@/components/icons"
import { cn } from "@/lib/utils"

export type ThemeChoice = "light" | "dark" | "auto"

const CHOICES = [
  { value: "light", label: "浅色", Icon: SunIcon },
  { value: "dark", label: "深色", Icon: MoonIcon },
  { value: "auto", label: "跟随系统", Icon: AutoIcon },
] as const

/**
 * The visitor's palette: light, dark, or whatever the system is set to. A
 * button showing the choice in force, and under it a small menu of the three.
 * The menu reports where the button sits, which is where the ripple of a
 * palette change spreads from.
 */
export function ThemeMenu({ choice, onPick }: { choice: ThemeChoice; onPick: (choice: ThemeChoice, at: { x: number; y: number }) => void }) {
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

  const current = CHOICES.find((c) => c.value === choice)!
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`配色：${current.label}`}
        onClick={() => setOpen(!open)}
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <current.Icon className="size-[18px]" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="配色"
          className="absolute top-[calc(100%+8px)] right-0 z-30 w-40 rounded-xl border bg-popover p-1 shadow-[0_10px_30px_rgb(0_0_0/0.12)]"
        >
          {CHOICES.map(({ value, label, Icon }) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={choice === value}
              onClick={() => {
                const box = button.current!.getBoundingClientRect()
                setOpen(false)
                onPick(value, { x: box.left + box.width / 2, y: box.top + box.height / 2 })
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-secondary",
                choice === value ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1 text-left">{label}</span>
              {choice === value && <CheckIcon className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
