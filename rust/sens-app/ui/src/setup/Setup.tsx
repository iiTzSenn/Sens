import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "zustand";
import { looks, shared } from "../shared/copy";
import { LANGUAGES, language, localeNow } from "../shared/i18n";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { LanguagePicker } from "../shared/LanguagePicker";
import { accentName } from "../shared/look";
import { AccentPicker, ModePicker } from "../shared/LookPicker";
import { StoneCanvas } from "../shared/StoneCanvas";
import type { StoneState } from "../shared/stone";
import { t } from "./copy";
import { setup, type SetupState } from "./ipc";
import {
  back,
  cancel,
  chooseLanguage,
  chooseLook,
  choosing,
  closeApp,
  compare,
  customize,
  installer,
  leaveLanguage,
  leaveLook,
  openSens,
  pickDir,
  quit,
  run,
  speaking,
  toLanguage,
  toLook,
  toggleDetails,
  unattended,
  uninstalling,
  type Screen,
} from "./store";

const TAIL = 4;

function bytes(size: number) {
  const number = new Intl.NumberFormat(localeNow(), { maximumFractionDigits: 1 });
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < 4) {
    value /= 1024;
    unit += 1;
  }
  return `${number.format(value >= 100 ? Math.round(value) : value)} ${t.unit(unit)}`;
}

function stoneFor(screen: Screen, leaving: boolean, opening: boolean): StoneState {
  if (screen === "look") return "focus";
  if (screen === "busy") return "scan";
  if (screen === "error" || leaving) return "rest";
  if (opening) return "scan";
  if (screen === "done") return "done";
  return "idle";
}

function welcomeWords(info: SetupState): [string, string, string] {
  if (info.mode === "uninstall") return [t.uninstallTitle, t.uninstallLead, t.uninstallGo];
  const had = info.installed;
  if (!had) return [t.installTitle, t.installLead, t.installGo];
  const order = compare(had.version, info.version);
  if (order < 0) return [t.updateTitle, t.updateLead(had.version, info.version), t.updateGo];
  if (order === 0) return [t.reinstallTitle, t.reinstallLead(info.version), t.reinstallGo];
  return [t.newerTitle, t.newerLead(had.version, info.version), t.newerGo];
}

function busyTitle(info: SetupState) {
  if (info.mode === "uninstall") return t.uninstalling;
  if (info.mode === "update") return t.updating;
  return t.preparing;
}

function doneWords(info: SetupState): [string, string] {
  if (info.mode === "uninstall") return [t.uninstalled, t.stillThere];
  if (unattended()) return [info.mode === "update" ? t.upToDate : t.ready, info.relaunch ? t.opening : t.canOpen];
  return [t.ready, info.installed ? t.pickUp : t.tailor];
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

function Go({
  children,
  look = "signal",
  focus = false,
  disabled = false,
  busy = false,
  onClick,
}: {
  children: ReactNode;
  look?: Look;
  focus?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => unknown;
}) {
  return (
    <button
      type="button"
      className={look === "signal" ? "go" : `go ${look}`}
      autoFocus={focus}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      <span>{children}</span>
      {look === "signal" && <Icon svg={ICONS.advance} />}
    </button>
  );
}

export function Installer() {
  const current = useStore(language, (s) => s.current);
  return <Setup key={current} />;
}

export function Setup() {
  const info = useStore(installer, (s) => s.info);
  const screen = useStore(installer, (s) => s.screen);
  const accent = useStore(installer, (s) => s.look.accent);
  const opening = useStore(installer, (s) => s.opening);
  if (!info) return screen === "error" ? <Broken /> : null;
  return (
    <div className="setup stage" data-screen={screen} data-mode={info.mode}>
      <Bar />
      <figure className="stone" aria-hidden="true">
        <StoneCanvas state={stoneFor(screen, info.mode === "uninstall", opening)} replay={screen === "look" ? accent : ""} />
      </figure>
      <main className="words" key={screen}>
        {screen === "language" && <LanguageStep />}
        {screen === "welcome" && <Welcome info={info} />}
        {screen === "custom" && <Custom info={info} />}
        {screen === "look" && <LookStep />}
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
          <h2>{t.broken}</h2>
          <p className="fault" role="alert">
            <Icon svg={ICONS.info} />
            <span>{fault}</span>
          </p>
          <div className="actions">
            <Go look="plain" focus onClick={() => setup.quit()}>
              {shared.close}
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
        <button type="button" aria-label={t.minimize} onClick={() => getCurrentWindow().minimize()}>
          <Icon svg={ICONS.minimize} />
        </button>
        <button type="button" className="shut" aria-label={shared.close} onClick={quit}>
          <Icon svg={ICONS.shutWindow} />
        </button>
      </div>
    </header>
  );
}

function LanguageStep() {
  const current = useStore(language, (s) => s.current);
  return (
    <section className="screen">
      <h2>{t.languageTitle}</h2>
      <p className="lead small">{t.languageLead}</p>
      <div className="look-field">
        <LanguagePicker chosen={current} pick={chooseLanguage} />
      </div>
      <div className="actions">
        <Go focus onClick={leaveLanguage}>
          {t.next}
        </Go>
      </div>
    </section>
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
          <span>{t.removeData}</span>
        </label>
      )}
      <div className="actions">
        <Go look={leaving ? "danger" : "signal"} focus onClick={choosing() ? toLook : run}>
          {action}
        </Go>
        {leaving && (
          <button type="button" className="ghost" onClick={() => setup.quit()}>
            {shared.cancel}
          </button>
        )}
      </div>
      {!leaving && (
        <button type="button" className="link" onClick={customize}>
          {t.customize}
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
  return (
    <section className="screen">
      <h2>{t.custom}</h2>
      <div className="field-row">
        <span className="label">{t.folder}</span>
        <div className="folder">
          <span className="path" title={dir}>
            {dir}
          </span>
          <button type="button" className="ghost small" disabled={Boolean(info.installed)} onClick={pickDir}>
            {t.change}
          </button>
        </div>
        <p className="hint" data-mood={problem ? "fault" : ""}>
          {problem || (place ? t.needs(bytes(info.size), place.free != null ? bytes(place.free) : "") : "")}
        </p>
      </div>
      <label className="check">
        <input type="checkbox" checked={desktop} onChange={(event) => installer.setState({ desktop: event.target.checked })} />
        <span>{t.desktop}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={startMenu} onChange={(event) => installer.setState({ startMenu: event.target.checked })} />
        <span>{t.startMenu}</span>
      </label>
      <div className="actions">
        <Go focus disabled={Boolean(problem)} onClick={choosing() ? toLook : run}>
          {choosing() ? t.next : t.install}
        </Go>
        <button type="button" className="ghost" onClick={back}>
          {t.back}
        </button>
      </div>
    </section>
  );
}

function LookStep() {
  const chosen = useStore(installer, (s) => s.look);
  return (
    <section className="screen">
      <h2>{t.lookTitle}</h2>
      <p className="lead small">{t.lookLead}</p>
      <div className="look-field">
        <span className="label">{looks.mode}</span>
        <ModePicker chosen={chosen.mode} pick={(mode) => chooseLook({ ...chosen, mode })} />
      </div>
      <div className="look-field">
        <span className="label">
          {looks.color} <b>{accentName(chosen.accent)}</b>
        </span>
        <AccentPicker chosen={chosen.accent} pick={(accent) => chooseLook({ ...chosen, accent })} />
      </div>
      <div className="actions">
        <Go focus onClick={run}>
          {t.install}
        </Go>
        <button type="button" className="ghost" onClick={leaveLook}>
          {t.back}
        </button>
      </div>
    </section>
  );
}

function Busy({ info }: { info: SetupState }) {
  const progress = useStore(installer, (s) => s.progress);
  const step = useStore(installer, (s) => s.step);
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  const shown = useCount(percent);
  return (
    <section className="screen">
      <h2>{busyTitle(info)}</h2>
      {info.mode === "update" && info.installed && <p className="versions">{`${info.installed.version} → ${info.version}`}</p>}
      <div className="meter">
        <div className="track" role="progressbar" aria-label={t.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <span className="percent">{t.percent(shown)}</span>
      </div>
      <p className="status" role="status">
        {t.steps[step]}
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
  const closeFault = useStore(installer, (s) => s.closeFault);
  const force = useStore(installer, (s) => s.force);
  return (
    <section className="screen">
      <h2>{t.open}</h2>
      <p className="lead small">{t.openLead}</p>
      <div className="actions">
        <Go look="plain" focus onClick={() => closeApp(false)}>
          {t.closeSens}
        </Go>
        {force && (
          <button type="button" className="ghost" onClick={() => closeApp(true)}>
            {t.force}
          </button>
        )}
      </div>
      <p className="hint" role="status">
        {closing ? t[closing] : closeFault}
      </p>
    </section>
  );
}

function Done({ info }: { info: SetupState }) {
  const dir = useStore(installer, (s) => s.dir);
  const opening = useStore(installer, (s) => s.opening);
  const openFault = useStore(installer, (s) => s.openFault);
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
              {shared.close}
            </Go>
          ) : (
            <>
              <Go focus busy={opening} onClick={openSens}>
                {opening ? t.opening : t.openSens}
              </Go>
              <button type="button" className="ghost" disabled={opening} onClick={() => setup.quit()}>
                {shared.close}
              </button>
            </>
          )}
        </div>
      )}
      {!leaving && (openFault ? <p className="hint" data-mood="fault" role="alert">{openFault}</p> : <p className="hint mono">{dir}</p>)}
    </section>
  );
}

function Failed() {
  const fault = useStore(installer, (s) => s.fault);
  const lines = useStore(installer, (s) => s.lines);
  return (
    <section className="screen">
      <h2>{t.failed}</h2>
      <p className="fault" role="alert">
        <Icon svg={ICONS.info} />
        <span>{fault}</span>
      </p>
      <div className="actions">
        <Go look="plain" focus onClick={run}>
          {shared.retry}
        </Go>
        <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(lines.join("\n"))}>
          {t.copyLog}
        </button>
      </div>
    </section>
  );
}

function LanguageLink() {
  const current = useStore(language, (s) => s.current);
  const { name, tag } = LANGUAGES.find((one) => one.id === current)!;
  return (
    <button type="button" className="link small spoken" aria-label={t.languageIs(name)} onClick={toLanguage}>
      <Icon svg={ICONS.globe} />
      <span lang={tag}>{name}</span>
    </button>
  );
}

function Foot({ info, screen }: { info: SetupState; screen: Screen }) {
  const details = useStore(installer, (s) => s.details);
  const cancelling = useStore(installer, (s) => s.cancelling);
  const cancellable = (screen === "busy" || screen === "running") && info.mode !== "update";
  const resting = screen === "language" || screen === "welcome" || screen === "custom" || screen === "look";
  return (
    <footer className="foot">
      {resting && <span className="made">{[t.made(info.version), info.demo ? t.demo : ""].filter(Boolean).join(" · ")}</span>}
      {resting && screen !== "language" && speaking() && <LanguageLink />}
      {screen === "busy" && (
        <button type="button" className="link small" aria-expanded={details} aria-controls="log" onClick={toggleDetails}>
          <Icon svg={ICONS.open} />
          {t.details}
        </button>
      )}
      {cancellable && (
        <button type="button" className="ghost cancel" disabled={cancelling} onClick={cancel}>
          {cancelling ? t.cancelling : shared.cancel}
        </button>
      )}
    </footer>
  );
}
