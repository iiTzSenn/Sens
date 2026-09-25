import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { showView } from "../../app/session";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { ACCENTS, MODES, look, type Look } from "../../shared/look";
import { AccentPicker, ModePicker } from "../../shared/LookPicker";
import { Mark } from "../../shared/Mark";
import { chooseLook } from "../look/store";
import { setNotices } from "../notify/store";
import { profile, saveProfileName } from "../profile/store";
import { checkUpdates, setAutomatic, updateState, updates } from "../updates/store";
import { openUpdate } from "../updates/UpdatePanel";
import { openWelcome, type Step } from "../welcome/store";
import { ProvidersSection } from "./ProvidersSection";
import { settingsSheet } from "./sheet";
import { closeSettings, enterSettings, settings, settingsClosed, showSection, type Section } from "./store";

const SECTIONS: [Section, string][] = [
  ["general", "General"],
  ["look", "Apariencia"],
  ["providers", "Proveedores"],
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
  return (
    <div className="settings-frame">
      <header className="settings-head">
        <div className="settings-top">
          <div>
            <h2 className="label" id="settings-title">
              Ajustes
            </h2>
            <p>Tu perfil, cómo se ve Sens y con quién trabaja.</p>
          </div>
          <span className="settings-keys" aria-hidden="true">
            <kbd>Esc</kbd>
          </span>
          <button className="icon-btn" id="settings-close" title="Cerrar (Esc)" aria-label="Cerrar ajustes" onClick={closeSettings}>
            <Icon svg={ICONS.dismiss} />
          </button>
        </div>
        <SectionTabs at={section} />
      </header>
      <div className="settings-pane" id="settings-pane" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
        {section === "general" && <GeneralSection key={visits} />}
        {section === "look" && <LookSection key={visits} />}
        {section === "providers" && <ProvidersSection key={visits} />}
      </div>
    </div>
  );
}

function SectionTabs({ at }: { at: Section }) {
  const bar = useRef<HTMLDivElement>(null);
  const ids = SECTIONS.map(([id]) => id);

  function go(section: Section) {
    showSection(section);
    enterSettings();
  }

  function onKeyDown(event: KeyboardEvent) {
    const from = ids.indexOf(at);
    const to = ({ ArrowRight: from + 1, ArrowLeft: from - 1, Home: 0, End: ids.length - 1 } as Record<string, number>)[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = ids[(to + ids.length) % ids.length];
    go(next);
    bar.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <div className="tabs settings-tabs" id="settings-tabs" role="tablist" aria-label="Secciones de ajustes" ref={bar} onKeyDown={onKeyDown}>
      {SECTIONS.map(([id, name]) => (
        <button
          key={id}
          className="tab"
          role="tab"
          id={`settings-tab-${id}`}
          data-tab={id}
          aria-controls="settings-pane"
          aria-selected={id === at}
          tabIndex={id === at ? 0 : -1}
          onClick={() => go(id)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function LookSection() {
  const chosen = useStore(look, (s) => s.chosen);
  const [fault, setFault] = useState("");
  const mode = MODES.find((one) => one.id === chosen.mode)!.label;
  const accent = ACCENTS.find((one) => one.id === chosen.accent)!.label;

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
      <div className="view-focus look-now">
        <div>
          <span className="label">Ahora</span>
          <p className="tally" aria-live="polite">{`${mode} · ${accent}`}</p>
          <p className="note">El color marca lo que Sens está haciendo: el corte, enviar, el paso en curso, el esfuerzo al máximo.</p>
        </div>
        <Mark key={chosen.accent} className="look-mark" />
      </div>
      <div className="pair">
        <span className="label">Modo</span>
        <ModePicker chosen={chosen.mode} pick={(next) => choose({ ...chosen, mode: next })} />
        <p className="note">Sistema sigue el modo claro u oscuro de Windows.</p>
      </div>
      <div className="pair">
        <span className="label">Color</span>
        <AccentPicker chosen={chosen.accent} pick={(next) => choose({ ...chosen, accent: next })} />
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
      <NoticesBlock />
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
        <button
          className="quiet"
          onClick={() => {
            closeSettings();
            showView("news");
          }}
        >
          Ver novedades
        </button>
      </div>
      <UpdateSwitch />
    </div>
  );
}

function NoticesBlock() {
  const on = useStore(profile, (s) => s.person.notify !== false);
  const [fault, setFault] = useState("");

  async function flip() {
    setFault("");
    try {
      await setNotices(!on);
    } catch (reason) {
      setFault(String(reason));
    }
  }

  return (
    <div className="pair">
      <span className="label">Avisos</span>
      <div className="settings-switch">
        <button className="switch" id="settings-notify" role="switch" aria-checked={on} onClick={flip} />
        <label htmlFor="settings-notify">Avisar cuando Claude termina o te necesita y Sens no está delante</label>
      </div>
      <p className="note fault" role="alert" hidden={!fault}>
        {fault}
      </p>
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
