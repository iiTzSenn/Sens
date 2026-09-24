import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "zustand";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { StoneCanvas } from "../shared/StoneCanvas";
import type { StoneState } from "../shared/stone";
import { setup, type SetupState } from "./ipc";
import {
  back,
  cancel,
  closeApp,
  compare,
  customize,
  installer,
  openSens,
  pickDir,
  quit,
  run,
  toggleDetails,
  unattended,
  uninstalling,
  type Screen,
} from "./store";

const TAIL = 4;
const number = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

function bytes(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${number.format(value >= 100 ? Math.round(value) : value)} ${units[unit]}`;
}

function stoneFor(screen: Screen, leaving: boolean): StoneState {
  if (screen === "busy") return "scan";
  if (screen === "error" || leaving) return "rest";
  if (screen === "done") return "done";
  return "idle";
}

function welcomeWords(info: SetupState): [string, string, string] {
  if (info.mode === "uninstall") return ["Desinstalar Sens.", "Se quita la aplicación. Tus proyectos y sus sesiones no se tocan.", "Desinstalar"];
  const had = info.installed;
  if (!had) return ["Instala Sens.", "Todo empieza con claridad.", "Instalar Sens"];
  const order = compare(had.version, info.version);
  if (order < 0) return ["Actualiza Sens.", `Tienes la ${had.version}. Esta es la ${info.version}.`, "Actualizar Sens"];
  if (order === 0) return ["Reinstala Sens.", `Ya tienes la ${info.version}.`, "Reinstalar Sens"];
  return ["Ya tienes una Sens más nueva.", `Tienes la ${had.version}; esta es la ${info.version}.`, "Instalar esta versión"];
}

function busyTitle(info: SetupState) {
  if (info.mode === "uninstall") return "Desinstalando Sens";
  if (info.mode === "update") return "Actualizando Sens";
  return "Preparando Sens";
}

function doneWords(info: SetupState): [string, string] {
  if (info.mode === "uninstall") return ["Sens se ha desinstalado.", "Tus proyectos y sus sesiones siguen donde estaban."];
  if (unattended()) return [info.mode === "update" ? "Sens está al día." : "Sens está lista.", info.relaunch ? "Abriendo Sens…" : "Ya puedes abrirla."];
  return ["Sens está lista.", info.installed ? "Ábrela y sigue donde lo dejaste." : "En un minuto la dejamos a tu gusto."];
}

function useCount(target: number) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown === target) return;
    const frame = requestAnimationFrame(() =>
      setShown((now) => (now > target ? target : Math.min(target, now + Math.max(1, Math.round((target - now) / 6))))),
    );
    return () => cancelAnimationFrame(frame);
  }, [shown, target]);
  return shown;
}

type Look = "signal" | "plain" | "danger";

function Go({ children, look = "signal", focus = false, disabled = false, onClick }: { children: ReactNode; look?: Look; focus?: boolean; disabled?: boolean; onClick: () => unknown }) {
  return (
    <button type="button" className={look === "signal" ? "go" : `go ${look}`} autoFocus={focus} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {look === "signal" && <Icon svg={ICONS.advance} />}
    </button>
  );
}

export function Setup() {
  const info = useStore(installer, (s) => s.info);
  const screen = useStore(installer, (s) => s.screen);
  if (!info) return screen === "error" ? <Broken /> : null;
  return (
    <div className="setup stage" data-screen={screen} data-mode={info.mode}>
      <Bar />
      <figure className="stone" aria-hidden="true">
        <StoneCanvas state={stoneFor(screen, info.mode === "uninstall")} />
      </figure>
      <main className="words" key={screen}>
        {screen === "welcome" && <Welcome info={info} />}
        {screen === "custom" && <Custom info={info} />}
        {screen === "busy" && <Busy info={info} />}
        {screen === "running" && <Running />}
        {screen === "done" && <Done info={info} />}
        {screen === "error" && <Failed />}
      </main>
      <Foot info={info} screen={screen} />
    </div>
  );
}

function Broken() {
  const fault = useStore(installer, (s) => s.fault);
  return (
    <div className="setup stage" data-screen="error">
      <Bar />
      <main className="words">
        <section className="screen">
          <h2>No se pudo abrir el instalador.</h2>
          <p className="fault" role="alert">
            <Icon svg={ICONS.info} />
            <span>{fault}</span>
          </p>
          <div className="actions">
            <Go look="plain" focus onClick={() => setup.quit()}>
              Cerrar
            </Go>
          </div>
        </section>
      </main>
    </div>
  );
}

function Bar() {
  return (
    <header className="bar" data-tauri-drag-region>
      <b className="wordmark" data-tauri-drag-region>
        sens
      </b>
      <div className="win">
        <button type="button" aria-label="Minimizar" onClick={() => getCurrentWindow().minimize()}>
          <Icon svg={ICONS.minimize} />
        </button>
        <button type="button" className="shut" aria-label="Cerrar" onClick={quit}>
          <Icon svg={ICONS.shutWindow} />
        </button>
      </div>
    </header>
  );
}

function Welcome({ info }: { info: SetupState }) {
  const removeData = useStore(installer, (s) => s.removeData);
  const [title, lead, action] = welcomeWords(info);
  const leaving = info.mode === "uninstall";
  return (
    <section className="screen">
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {leaving && (
        <label className="check">
          <input type="checkbox" checked={removeData} onChange={(event) => installer.setState({ removeData: event.target.checked })} />
          <span>Borrar también mis ajustes, skills y plugins de Sens</span>
        </label>
      )}
      <div className="actions">
        <Go look={leaving ? "danger" : "signal"} focus onClick={run}>
          {action}
        </Go>
        {leaving && (
          <button type="button" className="ghost" onClick={() => setup.quit()}>
            Cancelar
          </button>
        )}
      </div>
      {!leaving && (
        <button type="button" className="link" onClick={customize}>
          Personalizar instalación
        </button>
      )}
    </section>
  );
}

function Custom({ info }: { info: SetupState }) {
  const dir = useStore(installer, (s) => s.dir);
  const desktop = useStore(installer, (s) => s.desktop);
  const startMenu = useStore(installer, (s) => s.startMenu);
  const place = useStore(installer, (s) => s.place);
  const problem = useStore(installer, (s) => s.placeFault);
  const free = place?.free != null ? ` · libres ${bytes(place.free)}` : "";
  return (
    <section className="screen">
      <h2>Personalizar</h2>
      <div className="field-row">
        <span className="label">Carpeta</span>
        <div className="folder">
          <span className="path" title={dir}>
            {dir}
          </span>
          <button type="button" className="ghost small" disabled={Boolean(info.installed)} onClick={pickDir}>
            Cambiar…
          </button>
        </div>
        <p className="hint" data-mood={problem ? "fault" : ""}>
          {problem || (place ? `Necesita ${bytes(info.size)}${free}` : "")}
        </p>
      </div>
      <label className="check">
        <input type="checkbox" checked={desktop} onChange={(event) => installer.setState({ desktop: event.target.checked })} />
        <span>Acceso directo en el escritorio</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={startMenu} onChange={(event) => installer.setState({ startMenu: event.target.checked })} />
        <span>Añadir al menú Inicio</span>
      </label>
      <div className="actions">
        <Go focus disabled={Boolean(problem)} onClick={run}>
          Instalar Sens
        </Go>
        <button type="button" className="ghost" onClick={back}>
          Volver
        </button>
      </div>
    </section>
  );
}

function Busy({ info }: { info: SetupState }) {
  const progress = useStore(installer, (s) => s.progress);
  const status = useStore(installer, (s) => s.status);
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  const shown = useCount(percent);
  return (
    <section className="screen">
      <h2>{busyTitle(info)}</h2>
      {info.mode === "update" && info.installed && <p className="versions">{`${info.installed.version} → ${info.version}`}</p>}
      <div className="meter">
        <div className="track" role="progressbar" aria-label="Progreso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <span className="percent">{`${shown} %`}</span>
      </div>
      <p className="status" role="status">
        {status}
      </p>
      <Log />
    </section>
  );
}

function Log() {
  const lines = useStore(installer, (s) => s.lines);
  const details = useStore(installer, (s) => s.details);
  const list = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    if (details && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [details, lines]);
  const shown = details ? lines : lines.slice(-TAIL);
  const skipped = lines.length - shown.length;
  return (
    <ol className="log" id="log" ref={list} data-open={String(details)}>
      {shown.map((line, at) => (
        <li key={skipped + at}>{line}</li>
      ))}
    </ol>
  );
}

function Running() {
  const closing = useStore(installer, (s) => s.closing);
  const force = useStore(installer, (s) => s.force);
  return (
    <section className="screen">
      <h2>Sens está abierta.</h2>
      <p className="lead small">Ciérrala para seguir. Las sesiones que estén trabajando se detendrán.</p>
      <div className="actions">
        <Go look="plain" focus onClick={() => closeApp(false)}>
          Cerrar Sens
        </Go>
        {force && (
          <button type="button" className="ghost" onClick={() => closeApp(true)}>
            Forzar el cierre
          </button>
        )}
      </div>
      <p className="hint" role="status">
        {closing}
      </p>
    </section>
  );
}

function Done({ info }: { info: SetupState }) {
  const dir = useStore(installer, (s) => s.dir);
  const [title, lead] = doneWords(info);
  const leaving = uninstalling();
  return (
    <section className="screen">
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {!unattended() && (
        <div className="actions">
          {leaving ? (
            <Go look="plain" focus onClick={() => setup.quit()}>
              Cerrar
            </Go>
          ) : (
            <>
              <Go focus onClick={openSens}>
                Abrir Sens
              </Go>
              <button type="button" className="ghost" onClick={() => setup.quit()}>
                Cerrar
              </button>
            </>
          )}
        </div>
      )}
      {!leaving && <p className="hint mono">{dir}</p>}
    </section>
  );
}

function Failed() {
  const fault = useStore(installer, (s) => s.fault);
  const lines = useStore(installer, (s) => s.lines);
  return (
    <section className="screen">
      <h2>No se pudo terminar.</h2>
      <p className="fault" role="alert">
        <Icon svg={ICONS.info} />
        <span>{fault}</span>
      </p>
      <div className="actions">
        <Go look="plain" focus onClick={run}>
          Reintentar
        </Go>
        <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(lines.join("\n"))}>
          Copiar registro
        </button>
      </div>
    </section>
  );
}

function Foot({ info, screen }: { info: SetupState; screen: Screen }) {
  const details = useStore(installer, (s) => s.details);
  const cancelling = useStore(installer, (s) => s.cancelling);
  const cancellable = (screen === "busy" || screen === "running") && info.mode !== "update";
  return (
    <footer className="foot">
      {(screen === "welcome" || screen === "custom") && (
        <span className="made">{[`Sens para Windows · v${info.version}`, info.demo ? "demo" : ""].filter(Boolean).join(" · ")}</span>
      )}
      {screen === "busy" && (
        <button type="button" className="link small" aria-expanded={details} aria-controls="log" onClick={toggleDetails}>
          <Icon svg={ICONS.open} />
          Ver detalles
        </button>
      )}
      {cancellable && (
        <button type="button" className="ghost cancel" disabled={cancelling} onClick={cancel}>
          {cancelling ? "Cancelando…" : "Cancelar"}
        </button>
      )}
    </footer>
  );
}
