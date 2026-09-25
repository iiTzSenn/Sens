import { useState, type FormEvent } from "react";
import { useStore } from "zustand";
import type { Method, ProviderState } from "../../ipc/types";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { models } from "../models/store";
import { t } from "./copy";
import { claudeCodeStatus, providerLine, providerMethods, signInDoor, signedIn } from "./providers";
import {
  forgetKey,
  install,
  loadProviders,
  pickMethod,
  recheck,
  saveKey,
  settings,
  signIn,
  signOut,
  updateClaudeCode,
} from "./store";

type Card = { state: ProviderState; busy: boolean };

export function ProvidersSection() {
  const providers = useStore(settings, (s) => s.providers);
  const fault = useStore(settings, (s) => s.fault);
  return (
    <>
      <p className="note">{t.providersLead}</p>
      {fault ? (
        <p className="none fault">{fault}</p>
      ) : !providers ? (
        <p className="none">{t.checking}</p>
      ) : (
        providers.map((state) => <ProviderCard key={state.id} state={state} />)
      )}
      <p className="settings-later">{t.moreProviders}</p>
    </>
  );
}

export function ProviderCard({ state }: { state: ProviderState }) {
  const progress = useStore(settings, (s) => s.progress);
  const method = useStore(settings, (s) => s.choosing[state.id]) ?? state.method;
  const failed = useStore(settings, (s) => s.faults[state.id]);
  const behind = useStore(models, (s) => s.behind);
  const busy = Boolean(progress);
  const [line, mood] = providerLine(state);
  return (
    <div className="card provider">
      <div className="provider-head">
        <span className="label">{state.vendor}</span>
        <span className="name">{state.label}</span>
        {state.version && <span className="version">{`v${state.version}`}</span>}
      </div>
      <p className="provider-state" data-state={mood}>
        {line}
      </p>
      {!state.installed && <ClaudeCodeMissing state={state} busy={busy} />}
      {state.installed && behind && <ClaudeCodeBehind state={state} busy={busy} behind={behind} />}
      {progress && (
        <p className="note" id="claude-code-status" role="status">
          {claudeCodeStatus(progress)}
        </p>
      )}
      <MethodChoices state={state} method={method} busy={busy} />
      {method === "apiKey" ? (
        <KeyActions state={state} busy={busy} />
      ) : (
        <SignInActions state={state} method={method} busy={busy} />
      )}
      {failed && <p className="none fault">{failed}</p>}
    </div>
  );
}

function ClaudeCodeMissing({ state, busy }: Card) {
  return (
    <>
      <p className="note">{t.missing(t.weight)}</p>
      <div className="settings-row">
        <button className="quiet" disabled={busy} onClick={() => install(state)}>
          {t.installNow}
        </button>
        <button className="quiet" disabled={busy} onClick={() => loadProviders()}>
          {t.checkAgain}
        </button>
      </div>
    </>
  );
}

function ClaudeCodeBehind({ state, busy, behind }: Card & { behind: string }) {
  return (
    <>
      <p className="note">{t.newer(behind)}</p>
      <div className="settings-row">
        <button className="quiet" disabled={busy} onClick={() => updateClaudeCode(state)}>
          {t.updateClaudeCode}
        </button>
      </div>
    </>
  );
}

function MethodChoices({ state, method, busy }: Card & { method: Method }) {
  return (
    <fieldset className="choices">
      <legend className="label">{t.signsIn}</legend>
      {providerMethods().map((option) => (
        <label className="choice" key={option.id}>
          <input
            type="radio"
            name={`method-${state.id}`}
            value={option.id}
            checked={option.id === method}
            disabled={busy}
            onChange={() => pickMethod(state, option.id)}
          />
          <span className="choice-text">
            <b>{option.label}</b>
            <span>{option.said}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function SignInActions({ state, method, busy }: Card & { method: Exclude<Method, "apiKey"> }) {
  const connecting = useStore(settings, (s) => s.connecting);
  const door = signInDoor(method);
  return (
    <>
      <div className="settings-row">
        <button className="primary" disabled={busy || connecting} onClick={() => signIn(state, method)}>
          <Icon svg={ICONS.external} />
          {connecting ? t.waiting : door.button}
        </button>
      </div>
      <ol className="sign-steps">
        {!state.installed && <li>{t.installsFirst(t.weight)}</li>}
        <li>{t.browserOpens(door.site)}</li>
        <li>{t.authorize}</li>
        <li>{t.paste}</li>
      </ol>
      <p className="note">{t.codeNote}</p>
      {signedIn(state) && !connecting && (
        <div className="settings-row">
          <button className="quiet" disabled={busy} onClick={() => signOut(state)}>
            {t.signOut}
          </button>
          <button className="quiet" disabled={busy} onClick={() => recheck(state)}>
            {t.check}
          </button>
        </div>
      )}
    </>
  );
}

function KeyActions({ state, busy }: Card) {
  const [key, setKey] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    await saveKey(state, key);
    setKey("");
  }

  return (
    <>
      {state.keyHint && (
        <div className="settings-row">
          <span className="note">{t.keySaved(state.keyHint)}</span>
          <button className="quiet" disabled={busy} onClick={() => forgetKey(state)}>
            {t.removeKey}
          </button>
        </div>
      )}
      <form className="settings-row" onSubmit={save}>
        <input
          className="field verbatim"
          type="password"
          id={`key-${state.id}`}
          autoComplete="off"
          spellCheck={false}
          placeholder={state.keyHint ? t.newKey : "sk-ant-…"}
          aria-label={t.apiKey}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={busy}
        />
        <button className="primary" disabled={busy}>
          {t.saveKey}
        </button>
      </form>
      <p className="note">{t.keyNote}</p>
      {!state.installed && <p className="note">{t.keyInstalls(t.weight)}</p>}
    </>
  );
}
