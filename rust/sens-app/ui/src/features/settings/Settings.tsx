import { StrictMode, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { profile, saveProfileName } from "../profile/store";
import { checkUpdates, setAutomatic, updateState, updates } from "../updates/store";
import { openUpdate } from "../updates/UpdatePanel";
import { ProvidersSection } from "./ProvidersSection";
import { enterSettings, settings, showSection, type Section } from "./store";

const SECTIONS: [Section, string][] = [
  ["general", "General"],
  ["providers", "Proveedores"],
];

export function Settings() {
  const section = useStore(settings, (s) => s.section);
  const visits = useStore(settings, (s) => s.visits);
  return (
    <>
      <nav className="settings-nav" id="settings-nav" aria-label="Secciones de ajustes">
        {SECTIONS.map(([id, label]) => (
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
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-pane" id="settings-pane" aria-live="polite">
        {section === "general" ? <GeneralSection key={visits} /> : <ProvidersSection key={visits} />}
      </div>
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
      <h2 className="label">General</h2>
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
    </>
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
