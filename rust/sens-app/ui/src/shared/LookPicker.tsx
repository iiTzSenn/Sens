import { Icon } from "./Icon";
import { ICONS } from "./icons.js";
import { ACCENTS, MODES, type Accent, type Mode } from "./look";

const MODE_ICONS: Record<Mode, string> = { dark: ICONS.moon, light: ICONS.sun, system: ICONS.monitor };

export function ModePicker({ chosen, pick, drawn = false }: { chosen: Mode; pick: (mode: Mode) => void; drawn?: boolean }) {
  return (
    <div className="modes" role="radiogroup" aria-label="Modo">
      {MODES.map(({ id, label }) => (
        <label key={id} className="mode-choice">
          <input type="radio" name="look-mode" value={id} checked={chosen === id} onChange={() => pick(id)} />
          {drawn && <ModeArt mode={id} />}
          <span className="mode-name">
            <Icon svg={MODE_ICONS[id]} />
            {label}
          </span>
        </label>
      ))}
    </div>
  );
}

function ModeArt({ mode }: { mode: Mode }) {
  return (
    <span className="mode-art" aria-hidden="true">
      <Miniature mode={mode === "light" ? "light" : "dark"} />
      {mode === "system" && <Miniature mode="light" half />}
    </span>
  );
}

function Miniature({ mode, half = false }: { mode: "dark" | "light"; half?: boolean }) {
  return (
    <span className="miniature" data-mode={mode} data-half={half ? "true" : undefined}>
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}

export function AccentPicker({ chosen, pick, named = true }: { chosen: Accent; pick: (accent: Accent) => void; named?: boolean }) {
  return (
    <div className="accents" role="radiogroup" aria-label="Color">
      {ACCENTS.map(({ id, label }) => (
        <label key={id} className="accent-choice" title={label}>
          <input type="radio" name="look-accent" value={id} checked={chosen === id} aria-label={named ? undefined : label} onChange={() => pick(id)} />
          <span className="swatch" data-accent={id} aria-hidden="true" />
          {named && <span className="accent-name">{label}</span>}
        </label>
      ))}
    </div>
  );
}
