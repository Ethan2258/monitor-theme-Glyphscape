import * as React from "react"

import { cn } from "@/lib/utils"

// The shell only. shadcn's card ships a header, title, description, action,
// content and footer alongside it; this theme lays out its cards itself. The
// border, corners and shadow are the card's; direction, gap, padding and
// background are each caller's to set (cn does not merge, lib/utils.ts).
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      data-sky-ignore=""
      className={cn(
        "flex rounded-xl border text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        className
      )}
      {...props}
    />
  )
}

export { Card }
