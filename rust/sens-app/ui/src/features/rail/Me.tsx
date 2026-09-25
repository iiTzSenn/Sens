import { useStore } from "zustand";
import { shared } from "../../shared/copy";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { openPanel } from "../../shared/Panel";
import { useSheet } from "../../shared/useSheet";
import { limitsShown, models } from "../models/store";
import { Mark, PlanPart, useNow } from "../models/Usage";
import { planLevel } from "../models/limits";
import { profile } from "../profile/store";
import { openSettings } from "../settings/store";
import { updates } from "../updates/store";
import { t } from "./me.copy";

const shortcuts = () => [
  ["Enter", t.send],
  [`${t.shift}+Enter`, t.newLine],
  [`${shared.ctrl}+V`, t.paste],
  [`${shared.ctrl}+B`, t.sidebar],
  [`${shared.ctrl}+N`, shared.newSession],
  [`${shared.ctrl}+O`, t.openFolder],
  [`${shared.ctrl}+\` / ${shared.ctrl}+Ñ`, t.terminal],
  [`${shared.ctrl}+,`, t.settings],
  ["Esc", shared.close],
];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join("")
    .toUpperCase();

// The rail's foot: who uses Sens, and a menu to settings, the keyboard
// shortcuts and what Sens is.
export function Me() {
  const name = useStore(profile, (s) => s.person.name.trim());
  const fault = useStore(profile, (s) => s.fault);
  const limits = useStore(models, (s) => s.limits);
  useStore(models, (s) => s.account);
  const menu = useSheet();
  const now = useNow(menu.open);
  const level = limitsShown() ? planLevel(limits, menu.open ? now : Date.now()) : "";

  const pick = (open: (back: HTMLElement) => void) => () => {
    menu.shut();
    if (menu.anchor.current) open(menu.anchor.current);
  };

  return (
    <div className="rail-foot" id="rail-foot">
      {fault && (
        <p className="none fault" role="alert">
          {fault}
        </p>
      )}
      <div className="sheet menu me-sheet" id="menu" {...menu.sheet}>
        {menu.open && <PlanPart now={now} />}
        <div className="me-items" role="menu" aria-label={t.profile}>
          <button className="menu-item" role="menuitem" tabIndex={-1} onClick={pick((back) => openSettings(undefined, back))}>
            <Icon svg={ICONS.gear} />
            <span>{t.settings}</span>
          </button>
          <button className="menu-item" role="menuitem" tabIndex={-1} onClick={pick((back) => openPanel(t.shortcuts, <Keys />, back))}>
            <Icon svg={ICONS.keyboard} />
            <span>{t.shortcuts}</span>
          </button>
          <button className="menu-item" role="menuitem" tabIndex={-1} onClick={pick((back) => openPanel(t.about, <About />, back))}>
            <Icon svg={ICONS.info} />
            <span>{t.about}</span>
          </button>
        </div>
      </div>
      <button className="me" id="profile" ref={menu.anchor} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <span className="avatar" aria-hidden="true">
          {name ? initials(name) : <Icon svg={ICONS.user} />}
        </span>
        <span className="me-name" data-empty={String(!name)}>
          {name || t.noName}
        </span>
        <Mark level={level} />
        <Icon svg={ICONS.upDown} />
      </button>
    </div>
  );
}

function Keys() {
  return (
    <table className="keys">
      <tbody>
        {shortcuts().map(([keys, does]) => (
          <tr key={keys}>
            <td>
              <kbd>{keys}</kbd>
            </td>
            <td>{does}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function About() {
  const version = useStore(updates, (s) => s.current);
  return (
    <>
      <p className="about">
        <b>sens</b>
        <span className="mono">{version}</span>
      </p>
      <p className="mono selectable">github.com/iiTzSenn/Sens</p>
    </>
  );
}
