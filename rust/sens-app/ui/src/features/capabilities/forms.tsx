import { useState } from "react";
import { commands } from "../../ipc/commands";
import type { Detail } from "../../ipc/types";
import { legacy } from "../../legacy/bridge";
import { PanelForm, Pair, openPanel } from "../../shared/Panel";
import { project } from "../project/store";
import { envOf, listed, runsOf, type Spec } from "./kinds";
import { install, loadCapabilities } from "./store";

const home = () => project.getState().root;

export function RunRow({ name, code }: { name: string; code: string }) {
  return (
    <div className="run-row">
      <span className="run-name">{name}</span>
      {code && <code>{code}</code>}
    </div>
  );
}

function SkillForm() {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [steps, setSteps] = useState("");
  return (
    <PanelForm
      submit="Crear"
      act={() => commands.createSkill(home(), name.trim(), about.trim(), steps)}
      after={loadCapabilities}
    >
      <Pair
        id="skill-name"
        label="Nombre"
        note="Minúsculas, números y guiones, sin empezar por guion. Hasta 64 caracteres."
        control={(props) => (
          <input {...props} className="field verbatim" maxLength={64} data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        )}
      />
      <Pair
        id="skill-description"
        label="Descripción"
        control={(props) => (
          <input {...props} className="field" maxLength={1024} value={about} onChange={(event) => setAbout(event.target.value)} />
        )}
      />
      <Pair
        id="skill-body"
        label="Instrucciones"
        control={(props) => (
          <textarea {...props} className="field" rows={8} value={steps} onChange={(event) => setSteps(event.target.value)} />
        )}
      />
    </PanelForm>
  );
}

function ServerForm() {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  return (
    <PanelForm
      submit="Añadir"
      act={async () =>
        commands.addServer(home(), { name: name.trim(), command: command.trim(), args: listed(args), env: envOf(env) })
      }
      after={loadCapabilities}
    >
      <Pair
        id="server-name"
        label="Nombre"
        note="Letras, números, guiones y guiones bajos. Hasta 64 caracteres."
        control={(props) => (
          <input {...props} className="field verbatim" maxLength={64} data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        )}
      />
      <Pair
        id="server-command"
        label="Comando"
        control={(props) => (
          <input {...props} className="field verbatim" value={command} onChange={(event) => setCommand(event.target.value)} />
        )}
      />
      <Pair
        id="server-args"
        label="Argumentos"
        note="Uno por línea."
        control={(props) => (
          <textarea {...props} className="field verbatim" rows={3} value={args} onChange={(event) => setArgs(event.target.value)} />
        )}
      />
      <Pair
        id="server-env"
        label="Variables de entorno"
        note="CLAVE=valor, una por línea. Los valores no se vuelven a mostrar."
        control={(props) => (
          <textarea {...props} className="field verbatim" rows={3} value={env} onChange={(event) => setEnv(event.target.value)} />
        )}
      />
    </PanelForm>
  );
}

function InstallForm({ detail }: { detail: Detail }) {
  const runs = detail.listing.kind === "plugin" ? runsOf(detail) : [];
  const [values, setValues] = useState(() => Object.fromEntries(detail.needs.map((need) => [need.name, need.default || ""])));
  return (
    <PanelForm submit="Instalar" act={() => install(detail, values)}>
      {runs.length > 0 && (
        <>
          <p>Esto ejecuta código en tu equipo cuando el agente lo usa:</p>
          <div className="confirm-runs">
            {runs.map(([name, code], at) => (
              <RunRow key={at} name={name} code={code} />
            ))}
          </div>
        </>
      )}
      {detail.needs.map((need, at) => (
        <Pair
          key={need.name}
          id={`need-${at}`}
          label={need.name}
          note={[need.description, need.required ? "" : "Opcional."].filter(Boolean).join(" ")}
          control={(props) => (
            <input
              {...props}
              className="field verbatim"
              type={need.secret ? "password" : "text"}
              value={values[need.name]}
              onChange={(event) => setValues((now) => ({ ...now, [need.name]: event.target.value }))}
            />
          )}
        />
      ))}
    </PanelForm>
  );
}

export const skillForm = (back: HTMLElement) => openPanel("Crear skill", <SkillForm />, back);
export const serverForm = (back: HTMLElement) => openPanel("Añadir servidor MCP", <ServerForm />, back);

// Installs straight away unless it runs code or needs values.
export function needsAsking(detail: Detail) {
  const runs = detail.listing.kind === "plugin" ? runsOf(detail) : [];
  return runs.length > 0 || detail.needs.length > 0;
}

export const installForm = (detail: Detail, back: HTMLElement) =>
  openPanel(`Instalar ${detail.listing.title}`, <InstallForm detail={detail} />, back);

// Once removed, the card that opened this is gone: the focus goes to "Añadir".
export function confirmRemoval(spec: Spec, name: string, back: HTMLElement) {
  openPanel(
    `Quitar ${name}`,
    <PanelForm
      submit="Quitar"
      danger
      act={async () => {
        await commands.removeCapability(spec.origin, name);
        const add = document.getElementById("caps-add");
        if (add) legacy.panelReturnsTo(add);
      }}
      after={loadCapabilities}
    >
      <p>{spec.gone}</p>
    </PanelForm>,
    back,
  );
}
