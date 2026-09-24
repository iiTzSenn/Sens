import { useState, type FormEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { Window } from "../../app/Topbar";
import type { ForeignServer, Found, FoundProject, ProviderState } from "../../ipc/types";
import { ago, plural } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { StoneCanvas } from "../../shared/StoneCanvas";
import type { StoneState } from "../../shared/stone";
import { profile } from "../profile/store";
import { initials } from "../rail/Me";
import { providerLine } from "../settings/providers";
import { ProviderCard } from "../settings/ProvidersSection";
import { settings } from "../settings/store";
import {
  STEPS,
  chooseAllRoots,
  chooseFirst,
  chooseRoot,
  chooseServer,
  enter,
  next,
  pickFolder,
  places,
  scan,
  setName,
  skip,
  welcome,
  type Line,
  type Step,
} from "./store";

const SHORTCUTS: [string, string][] = [
  ["N", "Sesión nueva"],
  ["O", "Abrir carpeta"],
  ["B", "Barra lateral"],
];

const submit = (then: () => unknown) => (event: FormEvent) => {
  event.preventDefault();
  then();
};

const importable = (project: FoundProject) => project.exists && project.sessions > 0;

const lastSeen = (millis: number) => (new Date(millis).toDateString() === new Date().toDateString() ? "hoy" : ago(millis));

function stoneOf(step: Step, scanning: boolean, applying: boolean, finished: boolean, busy: boolean): StoneState {
  if (step === "hello") return "focus";
  if (step === "import" && scanning) return "scan";
  if (step === "claude" && busy) return "scan";
  if (step === "ready") return finished ? "done" : applying ? "scan" : "idle";
  return "idle";
}

export function Welcome() {
  const open = useStore(welcome, (s) => s.open);
  if (!open) return null;
  return <Stage />;
}

function Stage() {
  const step = useStore(welcome, (s) => s.step);
  const scanning = useStore(welcome, (s) => s.scanning);
  const applying = useStore(welcome, (s) => s.applying);
  const finished = useStore(welcome, (s) => s.finished);
  const busy = useStore(settings, (s) => Boolean(s.progress) || s.connecting);
  return (
    <div className="welcome stage" role="dialog" aria-modal="true" aria-label="Bienvenida a Sens">
      <header className="bar">
        <b className="wordmark">sens</b>
        <Progress step={step} />
        <Window tools={false} />
      </header>
      <figure className="welcome-stone">
        <StoneCanvas state={stoneOf(step, scanning, applying, finished, busy)} />
      </figure>
      <main className="welcome-words" key={step}>
        {step === "hello" && <Hello />}
        {step === "name" && <Name />}
        {step === "claude" && <Claude />}
        {step === "import" && <Bring />}
        {step === "project" && <First />}
        {step === "ready" && <Ready />}
      </main>
      <footer className="welcome-foot">
        {step !== "ready" && (
          <button type="button" className="link small" onClick={skip}>
            Saltar la bienvenida
          </button>
        )}
      </footer>
    </div>
  );
}

function Progress({ step }: { step: Step }) {
  const at = STEPS.indexOf(step);
  const shown = STEPS.slice(0, -1);
  return (
    <ol className="welcome-steps" aria-label={`Paso ${Math.min(at + 1, shown.length)} de ${shown.length}`}>
      {shown.map((one, index) => (
        <li key={one} data-state={index < at ? "done" : index === at ? "now" : "next"} />
      ))}
    </ol>
  );
}

function Go({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  return (
    <button type="submit" className="go" autoFocus={focus}>
      <span>{children}</span>
      <Icon svg={ICONS.advance} />
    </button>
  );
}

function Hello() {
  return (
    <form onSubmit={submit(next)}>
      <h1>Te damos la bienvenida.</h1>
      <p className="lead">Entiende más. Lee menos.</p>
      <p className="welcome-note">En un minuto dejamos Sens a tu gusto: tu nombre, Claude Code y lo que ya tienes.</p>
      <div className="actions">
        <Go focus>Empezar</Go>
      </div>
    </form>
  );
}

function Name() {
  const name = useStore(welcome, (s) => s.name);
  const letters = initials(name.trim());
  return (
    <form onSubmit={submit(next)}>
      <h1>¿Cómo te llamas?</h1>
      <div className="name-row">
        <span className="avatar big" aria-hidden="true">
          {letters || <Icon svg={ICONS.user} />}
        </span>
        <input
          className="name-field"
          autoFocus
          value={name}
          maxLength={60}
          placeholder="Tu nombre"
          aria-label="Tu nombre"
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <p className="hint">Sale en la barra lateral. Puedes dejarlo en blanco.</p>
      <div className="actions">
        <Go>Continuar</Go>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setName(profile.getState().person.name);
            next();
          }}
        >
          Ahora no
        </button>
      </div>
    </form>
  );
}

function Claude() {
  const providers = useStore(settings, (s) => s.providers);
  const fault = useStore(settings, (s) => s.fault);
  const [changing, setChanging] = useState(false);
  const state = providers?.[0];
  const [line, mood] = state ? providerLine(state) : ["", "off"];
  const connected = mood === "on";
  return (
    <form onSubmit={submit(next)}>
      <h1>Sens usa Claude Code.</h1>
      <p className="lead small">Con tu propia cuenta. Tus credenciales y tu sesión se quedan en Claude Code; Sens nunca las ve.</p>
      <div className="settings-pane welcome-claude">
        {!state ? (
          <p className={fault ? "note fault" : "note"}>{fault || "Comprobando Claude Code…"}</p>
        ) : connected && !changing ? (
          <Connected state={state} line={line} change={() => setChanging(true)} />
        ) : (
          <ProviderCard state={state} />
        )}
      </div>
      <div className="actions">
        {connected ? (
          <Go focus>Continuar</Go>
        ) : (
          <button type="submit" className="ghost">
            Hacerlo más tarde
          </button>
        )}
      </div>
    </form>
  );
}

function Connected({ state, line, change }: { state: ProviderState; line: string; change: () => void }) {
  return (
    <div className="connected">
      <span className="connected-mark" aria-hidden="true">
        <Icon svg={ICONS.check} />
      </span>
      <span className="connected-text">
        <b>{["Claude Code", state.version && `v${state.version}`].filter(Boolean).join(" ")}</b>
        <span>{line}</span>
      </span>
      <button type="button" className="link small" onClick={change}>
        Cambiar
      </button>
    </div>
  );
}

function Bring() {
  const found = useStore(welcome, (s) => s.found);
  const scanning = useStore(welcome, (s) => s.scanning);
  const fault = useStore(welcome, (s) => s.fault);
  const roots = useStore(welcome, (s) => s.roots);
  const servers = useStore(welcome, (s) => s.servers);

  if (scanning || !found) {
    return (
      <div>
        <h1>Trae lo que ya tienes.</h1>
        {fault ? (
          <>
            <p className="fault" role="alert">
              <Icon svg={ICONS.info} />
              {fault}
            </p>
            <div className="actions">
              <button type="button" className="go plain" onClick={scan}>
                Buscar otra vez
              </button>
              <button type="button" className="ghost" onClick={next}>
                Continuar sin importar
              </button>
            </div>
          </>
        ) : (
          <p className="lead small" role="status">
            Buscando en <span className="mono">~/.claude</span>…
          </p>
        )}
      </div>
    );
  }

  const chosen = roots.size + servers.size > 0;
  const already = found.skills.length + found.servers.length + found.plugins.length;
  const nothing = !found.projects.length && !already && !found.foreign.length;
  const leave = () => {
    chooseAllRoots(false);
    for (const id of servers) chooseServer(id, false);
    next();
  };
  return (
    <form className="bring" onSubmit={submit(next)}>
      <h1>Trae lo que ya tienes.</h1>
      {nothing ? (
        <p className="lead small">No hay nada que traer. Empiezas de cero.</p>
      ) : (
        <div className="bring-list">
          {found.projects.length > 0 && <Sessions found={found} roots={roots} />}
          {already > 0 && <Already found={found} />}
          {found.foreign.length > 0 && <Foreign foreign={found.foreign} servers={servers} />}
        </div>
      )}
      <div className="actions">
        <Go focus>{chosen ? "Importar" : "Continuar"}</Go>
        {chosen && (
          <button type="button" className="ghost" onClick={leave}>
            Continuar sin importar
          </button>
        )}
      </div>
    </form>
  );
}

function projectMeta(project: FoundProject) {
  if (!project.exists) return "la carpeta ya no existe";
  if (!project.sessions && project.already) return "ya están en Sens";
  return [plural(project.sessions, "sesión", "sesiones"), lastSeen(project.last), project.already ? `${project.already} ya en Sens` : ""].filter(Boolean).join(" · ");
}

function Sessions({ found, roots }: { found: Found; roots: Set<string> }) {
  const listed = [...found.projects].sort((a, b) => Number(importable(b)) - Number(importable(a)) || b.last - a.last);
  const offered = listed.filter(importable);
  const sessions = offered.reduce((sum, one) => sum + one.sessions, 0);
  const all = offered.length > 0 && offered.every((one) => roots.has(one.root));
  return (
    <section className="bring-group" aria-label="Sesiones de Claude Code">
      <header className="bring-head">
        <span className="label">Sesiones de Claude Code</span>
        <span className="bring-count">{`${plural(sessions, "sesión", "sesiones")} en ${plural(offered.length, "proyecto", "proyectos")}`}</span>
        {offered.length > 1 && (
          <button type="button" className="link small" onClick={() => chooseAllRoots(!all)}>
            {all ? "Ninguno" : "Marcar todos"}
          </button>
        )}
      </header>
      <ul className="bring-rows">
        {listed.map((project) => (
          <li key={project.root}>
            <label className="bring-row" data-off={String(!importable(project))}>
              <input
                type="checkbox"
                className="box"
                checked={roots.has(project.root)}
                disabled={!importable(project)}
                onChange={(event) => chooseRoot(project.root, event.target.checked)}
              />
              <span className="bring-main">
                <b>{project.name}</b>
                <span className="mono">{project.root}</span>
              </span>
              <span className="bring-meta">{projectMeta(project)}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function listing(parts: string[]) {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

function Already({ found }: { found: Found }) {
  const total = found.skills.length + found.servers.length + found.plugins.length;
  const parts = [
    found.skills.length ? plural(found.skills.length, "skill", "skills") : "",
    found.servers.length ? plural(found.servers.length, "servidor MCP", "servidores MCP") : "",
    found.plugins.length ? plural(found.plugins.length, "plugin", "plugins") : "",
  ].filter(Boolean);
  const names = [...found.skills, ...found.servers, ...found.plugins];
  return (
    <section className="bring-group" aria-label="De Claude Code, ya activo">
      <header className="bring-head">
        <span className="label">De Claude Code, ya activo</span>
      </header>
      <p className="bring-note">
        <Icon svg={ICONS.check} />
        <span>{`${listing(parts)} ya ${total === 1 ? "funciona" : "funcionan"} en Sens: Claude Code ${total === 1 ? "lo carga" : "los carga"} en cada sesión.`}</span>
      </p>
      <details className="bring-names">
        <summary>Ver nombres</summary>
        <p>
          {names.map((name) => (
            <span className="name-chip mono" key={name}>
              {name}
            </span>
          ))}
        </p>
      </details>
    </section>
  );
}

function serverMeta(server: ForeignServer) {
  if (server.blocked) return server.blocked;
  return [server.app, server.envKeys.length ? `lleva ${server.envKeys.join(", ")}` : ""].filter(Boolean).join(" · ");
}

function Foreign({ foreign, servers }: { foreign: ForeignServer[]; servers: Set<string> }) {
  return (
    <section className="bring-group" aria-label="Servidores MCP de otras apps">
      <header className="bring-head">
        <span className="label">Servidores MCP de otras apps</span>
      </header>
      <ul className="bring-rows">
        {foreign.map((server) => (
          <li key={server.id}>
            <label className="bring-row" data-off={String(Boolean(server.blocked))}>
              <input
                type="checkbox"
                className="box"
                checked={servers.has(server.id)}
                disabled={Boolean(server.blocked)}
                onChange={(event) => chooseServer(server.id, event.target.checked)}
              />
              <span className="bring-main">
                <b>{server.name}</b>
                <span className="mono">{server.kind === "stdio" ? [server.command, ...server.args].join(" ") : server.url}</span>
              </span>
              <span className="bring-meta">{serverMeta(server)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="hint">Se añaden a Capacidades y se activan en los proyectos que traes.</p>
    </section>
  );
}

function First() {
  const first = useStore(welcome, (s) => s.first);
  useStore(welcome, (s) => s.picked);
  const listed = places();
  return (
    <form onSubmit={submit(next)}>
      <h1>¿Con qué proyecto empezamos?</h1>
      {listed.length > 0 ? (
        <ul className="places" role="radiogroup" aria-label="Proyecto">
          {listed.map((place) => (
            <li key={place.root}>
              <button type="button" role="radio" aria-checked={first === place.root} className="place" onClick={() => chooseFirst(place.root)}>
                <span className="place-dot" aria-hidden="true" />
                <span className="bring-main">
                  <b>{place.name}</b>
                  <span className="mono">{place.root}</span>
                </span>
                {place.last > 0 && <span className="bring-meta">{lastSeen(place.last)}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead small">Elige la carpeta de un proyecto. Podrás abrir otros cuando quieras.</p>
      )}
      <button type="button" className="link" onClick={pickFolder}>
        Elegir otra carpeta…
      </button>
      <div className="actions">
        <Go focus>Continuar</Go>
      </div>
    </form>
  );
}

function Mood({ line }: { line: Line }) {
  if (line.mood === "done") return <Icon svg={ICONS.check} />;
  if (line.mood === "warn") return <Icon svg={ICONS.info} />;
  return <span className="pulse-dot" />;
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <ol className="doing">
      {lines.map((line) => (
        <li key={line.id} data-mood={line.mood}>
          <span className="mood" aria-hidden="true">
            <Mood line={line} />
          </span>
          <span>{line.said}</span>
          {line.detail && <pre>{line.detail}</pre>}
        </li>
      ))}
    </ol>
  );
}

function Ready() {
  const finished = useStore(welcome, (s) => s.finished);
  const lines = useStore(welcome, (s) => s.lines);
  const name = useStore(welcome, (s) => s.name.trim());

  if (!finished) {
    return (
      <div role="status">
        <h1>Preparando tu espacio.</h1>
        <Lines lines={lines} />
      </div>
    );
  }

  const first = name.split(/\s+/)[0];
  const warned = lines.filter((line) => line.mood === "warn");
  return (
    <form onSubmit={submit(enter)}>
      <h1>{first ? `Todo listo, ${first}.` : "Todo listo."}</h1>
      <Yours name={name} />
      <ul className="keys-row" aria-label="Atajos">
        {SHORTCUTS.map(([key, does]) => (
          <li key={key}>
            <span className="keycaps">
              <kbd>Ctrl</kbd>
              <kbd>{key}</kbd>
            </span>
            <span>{does}</span>
          </li>
        ))}
      </ul>
      {warned.length > 0 && <Lines lines={warned} />}
      <div className="actions">
        <Go focus>Abrir Sens</Go>
      </div>
    </form>
  );
}

function Yours({ name }: { name: string }) {
  const adopted = useStore(welcome, (s) => s.adopted);
  const imported = useStore(welcome, (s) => s.imported);
  const state = useStore(settings, (s) => s.providers?.[0]);
  const letters = initials(name);
  const numbers: [number, string][] = [
    [adopted?.sessions ?? 0, adopted?.sessions === 1 ? "sesión" : "sesiones"],
    [adopted?.projects ?? 0, adopted?.projects === 1 ? "proyecto" : "proyectos"],
    [imported?.added.length ?? 0, "MCP"],
  ];
  const shown = numbers.filter(([count]) => count > 0);
  return (
    <div className="yours">
      <span className="avatar big" aria-hidden="true">
        {letters || <Icon svg={ICONS.user} />}
      </span>
      <span className="yours-who">
        <b>{name || "Sin nombre"}</b>
        <span>{state ? providerLine(state)[0] : "Claude Code sin comprobar"}</span>
      </span>
      {shown.length > 0 && (
        <dl className="yours-numbers">
          {shown.map(([count, said]) => (
            <div key={said}>
              <dt>{said}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
