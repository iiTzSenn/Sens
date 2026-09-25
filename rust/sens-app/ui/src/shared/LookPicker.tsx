import { looks } from "./copy";
import { Icon } from "./Icon";
import { ICONS } from "./icons.js";
import { ACCENTS, MODES, accentName, modeName, type Accent, type Mode } from "./look";

const MODE_ICONS: Record<Mode, string> = { dark: ICONS.moon, light: ICONS.sun, system: ICONS.monitor };

export function ModePicker({ chosen, pick }: { chosen: Mode; pick: (mode: Mode) => void }) {
  return (
    <div className="modes" role="radiogroup" aria-label={looks.mode}>
      {MODES.map((id) => (
        <label key={id} className="mode-choice">
          <input type="radio" name="look-mode" value={id} checked={chosen === id} onChange={() => pick(id)} />
          <Icon svg={MODE_ICONS[id]} />
          <span>{modeName(id)}</span>
        </label>
      ))}
    </div>
  );
}

export function AccentPicker({ chosen, pick }: { chosen: Accent; pick: (accent: Accent) => void }) {
  return (
    <div className="accents" role="radiogroup" aria-label={looks.color}>
      {ACCENTS.map((id) => (
        <label key={id} className="accent-choice" title={accentName(id)}>
          <input type="radio" name="look-accent" value={id} checked={chosen === id} aria-label={accentName(id)} onChange={() => pick(id)} />
          <span className="swatch" data-accent={id} aria-hidden="true" />
        </label>
      ))}
    </div>
  );
}
