import { ChoiceMenu, type MenuIcon } from "@/components/ChoiceMenu"
import { AutoIcon, GhostIcon, GhostOffIcon, KoiIcon, KoiOffIcon, MoonIcon, SunIcon } from "@/components/icons"
import { preloadPond } from "@/lib/pond"
import { preloadRealm } from "@/lib/realm"

export type ThemeChoice = "light" | "dark" | "auto"
export type SceneChoice = "pond" | "wraith" | "off"

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

// A round icon button in the header, the menu's choice in force drawn on it.
const ICON_BUTTON =
  "inline-flex size-10 items-center sm:size-8 justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"

/**
 * The visitor's palette: light, dark, or whatever the system is set to. A
 * button showing the choice in force, and under it a small menu of the three.
 * The menu reports where the button sits, which is where the ripple of a
 * palette change spreads from.
 */
export function ThemeMenu({ choice, onPick }: { choice: ThemeChoice; onPick: (choice: ThemeChoice, at: { x: number; y: number }) => void }) {
  const current = CHOICES.find((c) => c.value === choice)!
  return (
    <ChoiceMenu label="配色" title={`配色：${current.label}`} value={choice} items={CHOICES} onPick={onPick} buttonClassName={ICON_BUTTON}>
      <current.Icon className="size-[18px]" />
    </ChoiceMenu>
  )
}

/**
 * The visitor's scene: koi pond, ghost realm, or collapsed. Matches ThemeMenu
 * in the header; when collapsed, shows the active scene's struck-through icon.
 */
export function SceneMenu({ choice, scene, onPick }: { choice: SceneChoice; scene: "pond" | "wraith"; onPick: (choice: SceneChoice) => void }) {
  const offIcon: MenuIcon = scene === "wraith" ? GhostOffIcon : KoiOffIcon
  const current = SCENES.find((c) => c.value === choice)!
  const CurrentIcon = current.Icon ?? offIcon
  const items = SCENES.map((item) => ({ ...item, Icon: item.Icon ?? offIcon }))
  return (
    <ChoiceMenu
      label="场景"
      title={`场景：${current.label}`}
      value={choice}
      items={items}
      onPick={(next) => onPick(next)}
      // The scene a choice switches to is fetched as the menu opens, if the
      // idle prefetch has not already brought it, so the switch itself does
      // not wait on the network.
      onOpen={() => {
        preloadPond()
        preloadRealm()
      }}
      buttonClassName={ICON_BUTTON}
    >
      <CurrentIcon className="size-[18px]" />
    </ChoiceMenu>
  )
}
