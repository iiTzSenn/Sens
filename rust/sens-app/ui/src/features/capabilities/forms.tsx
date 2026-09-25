import { useState } from "react";
import { commands } from "../../ipc/commands";
import type { Detail, Listing } from "../../ipc/types";
import { returnTo } from "../../app/modal";
import { shared } from "../../shared/copy";
import { PanelForm, Pair, openPanel } from "../../shared/Panel";
import { project } from "../project/store";
import { t } from "./copy";
import { envOf, listed, runsOf, type Spec } from "./kinds";
import { capabilities, failExplore, install, loadCapabilities, marking } from "./store";

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
    <PanelForm submit={t.create} act={() => commands.createSkill(home(), name.trim(), about.trim(), steps)} after={loadCapabilities}>
      <Pair
        id="skill-name"
        label={t.name}
        note={t.skillNameNote}
        control={(props) => (
          <input {...props} className="field verbatim" maxLength={64} data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        )}
      />
      <Pair
        id="skill-description"
        label={t.description}
        control={(props) => (
          <input {...props} className="field" maxLength={1024} value={about} onChange={(event) => setAbout(event.target.value)} />
        )}
      />
      <Pair
        id="skill-body"
        label={t.instructions}
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
      submit={t.add}
      act={async () => commands.addServer(home(), { name: name.trim(), command: command.trim(), args: listed(args), env: envOf(env) })}
      after={loadCapabilities}
    >
      <Pair
        id="server-name"
        label={t.name}
        note={t.serverNameNote}
        control={(props) => (
          <input {...props} className="field verbatim" maxLength={64} data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        )}
      />
      <Pair
        id="server-command"
        label={t.command}
        control={(props) => (
          <input {...props} className="field verbatim" value={command} onChange={(event) => setCommand(event.target.value)} />
        )}
      />
      <Pair
        id="server-args"
        label={t.args}
        note={t.argsNote}
        control={(props) => (
          <textarea {...props} className="field verbatim" rows={3} value={args} onChange={(event) => setArgs(event.target.value)} />
        )}
      />
      <Pair
        id="server-env"
        label={t.env}
        note={t.envNote}
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
    <PanelForm submit={t.install} act={() => install(detail, values)}>
      {runs.length > 0 && (
        <>
          <p>{t.runsWarning}</p>
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
          note={[need.description, need.required ? "" : t.optionalNote].filter(Boolean).join(" ")}
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

export const skillForm = (back: HTMLElement) => openPanel(t.createSkill, <SkillForm />, back);
export const serverForm = (back: HTMLElement) => openPanel(t.addServer, <ServerForm />, back);

// Installs straight away unless it runs code or needs values.
export function needsAsking(detail: Detail) {
  const runs = detail.listing.kind === "plugin" ? runsOf(detail) : [];
  return runs.length > 0 || detail.needs.length > 0;
}

export const installForm = (detail: Detail, back: HTMLElement) => openPanel(t.installTitle(detail.listing.title), <InstallForm detail={detail} />, back);

export async function addListing(listing: Listing, back: HTMLElement) {
  if (capabilities.getState().adding.includes(listing.id)) return;
  marking(listing.id, true);
  failExplore("");
  try {
    const detail = await commands.marketDetail(listing.id);
    if (needsAsking(detail)) installForm(detail, back);
    else await install(detail, {});
  } catch (reason) {
    failExplore(t.addFailed(listing.title, String(reason)));
  } finally {
    marking(listing.id, false);
  }
}

// Once removed, the card that opened this is gone: the focus goes to "Añadir".
export function confirmRemoval(spec: Spec, name: string, back: HTMLElement) {
  openPanel(
    shared.remove(name),
    <PanelForm
      submit={t.remove}
      danger
      act={async () => {
        await commands.removeCapability(spec.origin, name);
        const add = document.getElementById("caps-add");
        if (add) returnTo(add);
      }}
      after={loadCapabilities}
    >
      <p>{spec.gone()}</p>
    </PanelForm>,
    back,
  );
}
