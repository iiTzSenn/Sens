import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { look, type Look } from "../../shared/look";
import { AccentPicker, ModePicker } from "../../shared/LookPicker";
import { chooseLook } from "../look/store";
import { profile, saveProfileName } from "../profile/store";
import { checkUpdates, setAutomatic, updateState, updates } from "../updates/store";
import { openUpdate } from "../updates/UpdatePanel";
import { openWelcome, type Step } from "../welcome/store";
import { ProvidersSection } from "./ProvidersSection";
import { settingsSheet } from "./sheet";
import { closeSettings, enterSettings, settings, settingsClosed, showSection, type Section } from "./store";

const SECTIONS: [Section, string, string][] = [
  ["general", "General", ICONS.gear],
  ["look", "Apariencia", ICONS.palette],
  ["providers", "Proveedores", ICONS.plug],
];

export function SettingsDialog() {
  const open = useStore(settingsSheet, (s) => s.open);
  const box = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const shown = box.current;
    if (!shown) return;
    if (open && !shown.open) shown.showModal();
    if (!open && shown.open) shown.close();
  }, [open]);

  return (
    <dialog
      className="settings"
      id="settings"
      aria-labelledby="settings-title"
      ref={box}
      onClose={settingsClosed}
      onClick={(event) => event.target === box.current && closeSettings()}
    >
      {open && <Settings />}
    </dialog>
  );
}

export function Settings() {
  const section = useStore(settings, (s) => s.section);
  const visits = useStore(settings, (s) => s.visits);
  const [, label] = SECTIONS.find(([id]) => id === section)!;
  return (
    <div className="settings-frame">
      <nav className="settings-nav" id="settings-nav" aria-label="Secciones de ajustes">
        <h2 className="label" id="settings-title">
          Ajustes
        </h2>
        {SECTIONS.map(([id, name, icon]) => (
          <button
            key={id}
            className="settings-link"
            data-section={id}
            aria-current={id === section ? "true" : "false"}
            onClick={() => {
              showSection(id);
              enterSettings();
            }}
          >
            <Icon svg={icon} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      <div className="settings-main">
        <header className="settings-head">
          <h3>{label}</h3>
          <button className="icon-btn" id="settings-close" title="Cerrar" aria-label="Cerrar ajustes" onClick={closeSettings}>
            <Icon svg={ICONS.dismiss} />
          </button>
        </header>
        <div className="settings-pane" id="settings-pane" aria-live="polite">
          {section === "general" && <GeneralSection key={visits} />}
          {section === "look" && <LookSection key={visits} />}
          {section === "providers" && <ProvidersSection key={visits} />}
        </div>
      </div>
    </div>
  );
}

function LookSection() {
  const chosen = useStore(look, (s) => s.chosen);
  const [fault, setFault] = useState("");

  async function choose(next: Look) {
    setFault("");
    try {
      await chooseLook(next);
    } catch (reason) {
      setFault(String(reason));
    }
  }

  return (
    <>
      <div className="pair">
        <span className="label">Modo</span>
        <ModePicker drawn chosen={chosen.mode} pick={(mode) => choose({ ...chosen, mode })} />
        <p className="note">Sistema sigue el modo claro u oscuro de Windows.</p>
      </div>
      <div className="pair">
        <span className="label">Color</span>
        <AccentPicker chosen={chosen.accent} pick={(accent) => choose({ ...chosen, accent })} />
        <p className="note">Marca lo que Sens está haciendo: el corte de la piedra, el botón de enviar, el paso en curso, el esfuerzo al máximo.</p>
      </div>
      <p className="note fault" role="alert" hidden={!fault}>
        {fault}
      </p>
    </>
  );
}

function GeneralSection() {
  const [name, setName] = useState(() => profile.getState().person.name);
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState({ text: "", failed: false });

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaid(({ text }) => ({ text, failed: false }));
    try {
      await saveProfileName(name);
      setSaid({ text: "Guardado.", failed: false });
    } catch (reason) {
      setSaid({ text: String(reason), failed: true });
    }
    setSaving(false);
  }

  return (
    <>
      <div className="pair">
        <label className="label" htmlFor="settings-name">
          Nombre
        </label>
        <form className="settings-row" onSubmit={save}>
          <input
            className="field"
            id="settings-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="primary" disabled={saving}>
            Guardar
          </button>
        </form>
        <p className={said.failed ? "note fault" : "note"} role="status">
          {said.text}
        </p>
      </div>
      <UpdatesBlock />
      <WelcomeBlock />
    </>
  );
}

function welcomeAgain(step?: Step) {
  closeSettings();
  openWelcome(step);
}

function WelcomeBlock() {
  return (
    <div className="pair">
      <span className="label">Bienvenida</span>
      <p className="note">Tu nombre, Claude Code y lo que traes de Claude Code y de otras apps.</p>
      <div className="settings-row">
        <button className="quiet" onClick={() => welcomeAgain()}>
          Volver a verla
        </button>
        <button className="quiet" onClick={() => welcomeAgain("import")}>
          Importar de Claude Code
        </button>
      </div>
    </div>
  );
}

function UpdatesBlock() {
  const known = useStore(updates);
  const { current, latest, installable, checking, fault } = known;
  const state = updateState(known);
  const version = [current && `Sens ${current}`, !installable && "build de desarrollo: comprueba pero no instala"]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="pair">
      <span className="label">Actualizaciones</span>
      <p className="note">{version}</p>
      <p className={fault && !checking ? "note fault" : "note"} role="status" hidden={!state}>
        {state}
      </p>
      <div className="settings-row">
        <button className="primary" hidden={!latest} onClick={(event) => openUpdate(event.currentTarget)}>
          {latest ? `Ver Sens ${latest.version}` : ""}
        </button>
        <button className="quiet" disabled={checking} onClick={() => checkUpdates(true)}>
          Buscar actualizaciones
        </button>
      </div>
      <UpdateSwitch />
    </div>
  );
}

function UpdateSwitch() {
  const [on, setOn] = useState(() => profile.getState().person.checkUpdates !== false);
  const [fault, setFault] = useState("");

  async function flip() {
    const next = !on;
    setOn(next);
    setFault("");
    try {
      await setAutomatic(next);
    } catch (reason) {
      setOn(!next);
      setFault(String(reason));
    }
  }

  return (
    <>
      <div className="settings-switch">
        <button className="switch" id="settings-update-check" role="switch" aria-checked={on} onClick={flip} />
        <label htmlFor="settings-update-check">Buscar al abrir Sens</label>
      </div>
      <p className="note fault" role="alert" hidden={!fault}>
        {fault}
      </p>
    </>
  );
}
