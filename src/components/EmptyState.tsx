import type { ComponentType, ReactNode } from "react"

/**
 * What stands in for a list or a page with nothing to show -- no node matches,
 * no such node, nothing could be loaded: a quiet dashed box in the content's
 * place, an icon, a line saying what happened, a line on why or what next, and
 * the one thing to do about it. Where a single grey sentence used to sit at
 * the top of an empty page.
 */
export function EmptyState({ icon: Icon, title, children, action, alert = false }: {
  icon?: ComponentType<{ className?: string }>
  title: string
  children?: ReactNode
  action?: { label: string; onClick: () => void; icon?: ComponentType<{ className?: string }> }
  /** Announced at once to a screen reader, for a failure. */
  alert?: boolean
}) {
  const ActionIcon = action?.icon
  return (
    <div
      role={alert ? "alert" : undefined}
      data-pond-avoid=""
      data-sky-avoid=""
      className="mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center"
    >
      {Icon && (
        <span className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="size-[18px]" />
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm transition-colors outline-none hover:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8 sm:text-xs"
        >
          {ActionIcon && <ActionIcon className="size-3.5" />}
          {action.label}
        </button>
      )}
    </div>
  )
}
