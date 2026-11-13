import type { SVGProps } from "react"

/**
 * The theme's own icons, drawn for it on one 24-unit grid with one stroke: a
 * 1.6 line, round at the ends and the joins, and here and there a solid dot --
 * the pond's grain, the same dot as the globe's land and the ripple's rings.
 * Everything takes the colour of the text around it.
 */
type Props = SVGProps<SVGSVGElement> & { size?: number | string }

function Icon({ size, className, children, ...props }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      {...props}
    >
      {children}
    </svg>
  )
}

const Dot = ({ x, y, r = 1.15 }: { x: number; y: number; r?: number }) => (
  <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />
)

/** A koi from above, tail swept to one side: the pond is out. */
export const KoiIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4.5 12.2c2.6-4.4 8.2-5.7 12.1-2.6 1 .8 1.8 1.7 2.4 2.6-.6.9-1.4 1.8-2.4 2.6-3.9 3.1-9.5 1.8-12.1-2.6Z" />
    <path d="M4.5 12.2 2.2 9.6M4.5 12.2l-2.3 2.7" />
    <path d="M11 9.3c.8 1.7.8 4 0 5.8" opacity={0.55} />
    <Dot x={16.3} y={11.5} r={0.95} />
  </Icon>
)

/** The same koi, struck through: the pond is put away. */
export const KoiOffIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M7.4 8.4c2.9-1.5 6.5-1.2 9.2 1.2 1 .8 1.8 1.7 2.4 2.6-.5.7-1 1.4-1.7 2M13.8 16.7c-3.3.7-7-.6-9.3-4.5.7-1.2 1.6-2.2 2.6-3" />
    <path d="M4.5 12.2 2.2 9.6M4.5 12.2l-2.3 2.7" />
    <path d="m3.5 3.5 17 17" />
  </Icon>
)

/** A sun ringed with dots rather than rays. */
export const SunIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx={12} cy={12} r={4} />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <Dot key={a} x={12 + 8 * Math.cos((a * Math.PI) / 180)} y={12 + 8 * Math.sin((a * Math.PI) / 180)} r={a % 90 ? 0.95 : 1.2} />
    ))}
  </Icon>
)

/** A crescent, two stars beside it as dots. */
export const MoonIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M19.2 14.6A7.6 7.6 0 0 1 9.4 4.8a7.6 7.6 0 1 0 9.8 9.8Z" />
    <Dot x={16.6} y={5.4} r={1.1} />
    <Dot x={20} y={9} r={0.8} />
  </Icon>
)

/** A disc half dark, half light: follow the system. */
export const AutoIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx={12} cy={12} r={7.5} />
    <path d="M12 4.5a7.5 7.5 0 0 1 0 15Z" fill="currentColor" stroke="none" />
  </Icon>
)

/** A doorway with an arrow going in: sign in, or the panel. */
export const DoorIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M13.5 4.5h3.8a1.7 1.7 0 0 1 1.7 1.7v11.6a1.7 1.7 0 0 1-1.7 1.7h-3.8" />
    <path d="M4.5 12h9.5M10.8 8.6 14.2 12l-3.4 3.4" />
  </Icon>
)

/** A dot with rings spreading from it: something said to everyone. */
export const RippleIcon = (p: Props) => (
  <Icon {...p}>
    <Dot x={12} y={12} r={1.8} />
    <path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4" />
    <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" opacity={0.5} />
  </Icon>
)

/** Down, the way data comes in. Plain and a little heavier: it is mostly drawn at 12px. */
export const InIcon = (p: Props) => (
  <Icon strokeWidth={2.1} {...p}>
    <path d="M12 4.5v15M6.5 14 12 19.5l5.5-5.5" />
  </Icon>
)

/** Up, the way data goes out. */
export const OutIcon = (p: Props) => (
  <Icon strokeWidth={2.1} {...p}>
    <path d="M12 19.5v-15M6.5 10 12 4.5l5.5 5.5" />
  </Icon>
)

/** A price tag. */
export const TagIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4.5 5.9v5.2c0 .5.2.9.5 1.2l7.2 7.2a1.6 1.6 0 0 0 2.3 0l4.8-4.8a1.6 1.6 0 0 0 0-2.3L12.1 5a1.7 1.7 0 0 0-1.2-.5H5.9c-.8 0-1.4.6-1.4 1.4Z" />
    <Dot x={8.6} y={8.6} r={1.2} />
  </Icon>
)

/** A lens. */
export const SearchIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx={10.8} cy={10.8} r={5.8} />
    <path d="m15.2 15.2 4.3 4.3" />
  </Icon>
)

/** Up and down: an order to pick. */
export const SortIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />
  </Icon>
)

/** Four tiles: the cards. */
export const GridIcon = (p: Props) => (
  <Icon {...p}>
    <rect x={4.5} y={4.5} width={6.2} height={6.2} rx={1.6} />
    <rect x={13.3} y={4.5} width={6.2} height={6.2} rx={1.6} />
    <rect x={4.5} y={13.3} width={6.2} height={6.2} rx={1.6} />
    <rect x={13.3} y={13.3} width={6.2} height={6.2} rx={1.6} />
  </Icon>
)

/** Rows, a dot leading each: the table. */
export const RowsIcon = (p: Props) => (
  <Icon {...p}>
    <Dot x={5.5} y={7} />
    <Dot x={5.5} y={12} />
    <Dot x={5.5} y={17} />
    <path d="M9.5 7h9M9.5 12h9M9.5 17h9" />
  </Icon>
)

/** Back to the list. */
export const BackIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M19 12H5.5M10.5 7 5.5 12l5 5" />
  </Icon>
)

/** A small check, for the chosen item of a menu. */
export const CheckIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Icon>
)
