import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { openPanel } from "../../shared/Panel";
import { useSheet } from "../../shared/useSheet";
import { profile } from "../profile/store";
import { openSettings } from "../settings/store";
import { updates } from "../updates/store";

const SHORTCUTS = [
  ["Enter", "Enviar"],
  ["Mayús+Enter", "Nueva línea"],
  ["Ctrl+V", "Pegar una imagen en el mensaje"],
  ["Ctrl+B", "Mostrar u ocultar la barra lateral"],
  ["Ctrl+N", "Sesión nueva"],
  ["Ctrl+O", "Abrir carpeta"],
  ["Ctrl+,", "Ajustes"],
  ["Esc", "Cerrar"],
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
  const menu = useSheet();

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
      <div className="sheet menu" id="menu" role="menu" aria-label="Perfil" {...menu.sheet}>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={pick((back) => openSettings(undefined, back))}>
          <Icon svg={ICONS.gear} />
          <span>Ajustes</span>
        </button>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={pick((back) => openPanel("Atajos de teclado", <Keys />, back))}>
          <Icon svg={ICONS.keyboard} />
          <span>Atajos de teclado</span>
        </button>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={pick((back) => openPanel("Acerca de Sens", <About />, back))}>
          <Icon svg={ICONS.info} />
          <span>Acerca de Sens</span>
        </button>
      </div>
      <button className="me" id="profile" ref={menu.anchor} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <span className="avatar" aria-hidden="true">
          {name ? initials(name) : <Icon svg={ICONS.user} />}
        </span>
        <span className="me-name" data-empty={String(!name)}>
          {name || "Sin nombre"}
        </span>
        <Icon svg={ICONS.upDown} />
      </button>
    </div>
  );
}

function Keys() {
  return (
    <table className="keys">
      <tbody>
        {SHORTCUTS.map(([keys, does]) => (
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
