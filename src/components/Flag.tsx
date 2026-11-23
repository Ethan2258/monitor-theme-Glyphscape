import { cn } from "@/lib/utils"

import CODES from "virtual:flag-codes"

// Fetched on first use from `/flags/{code}.svg` (vite.config.ts, flags()), so a
// page carries only the flags its nodes are in rather than all 265. The
// simplified set: flag-icons' detailed emblems total 1.95 MiB against 174 KiB
// here, a difference invisible at 18 by 12 pixels.
const HAVE = new Set(CODES.split(" "))

/** A country's flag, or nothing for a code the set lacks; the caller decides what stands in. */
export function Flag({ code, className }: { code: string; className?: string }) {
  const upper = code.toUpperCase()
  if (!HAVE.has(upper)) return null
  const src = `/flags/${upper}.svg`
  return (
    <img
      src={src}
      alt={code}
      data-tip={code}
      // Size and corners as given, or a card's 18 by 12 (cn does not merge).
      className={cn("shrink-0 ring-1 ring-foreground/10", className ?? "h-3 w-4.5 rounded-[2px]")}
    />
  )
}

/** Whether the set has a flag for `code`. */
export const hasFlag = (code: string) => HAVE.has(code.toUpperCase())
