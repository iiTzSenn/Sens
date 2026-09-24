import { useState, type FormEvent } from "react";
import { useStore } from "zustand";
import type { Method, ProviderState } from "../../ipc/types";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import {
  CLAUDE_CODE_WEIGHT,
  PROVIDER_METHODS,
  SIGN_IN_DOORS,
  claudeCodeStatus,
  providerLine,
  signedIn,
} from "./providers";
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
} from "./store";

type Card = { state: ProviderState; busy: boolean };

export function ProvidersSection() {
  const providers = useStore(settings, (s) => s.providers);
  const fault = useStore(settings, (s) => s.fault);
  return (
    <>
      <h2 className="label">Proveedores</h2>
      <p className="note">
        Con quién trabaja Sens. Sens nunca ve tus credenciales: el inicio de sesión lo hace cada herramienta.
      </p>
      {fault ? (
        <p className="none fault">{fault}</p>
      ) : !providers ? (
        <p className="none">Comprobando…</p>
      ) : (
        providers.map((state) => <ProviderCard key={state.id} state={state} />)
      )}
      <p className="settings-later">Más proveedores, pronto.</p>
    </>
  );
}

function ProviderCard({ state }: { state: ProviderState }) {
  const progress = useStore(settings, (s) => s.progress);
  const method = useStore(settings, (s) => s.choosing[state.id]) ?? state.method;
  const failed = useStore(settings, (s) => s.faults[state.id]);
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
      <p className="note">
        {`Sens trabaja a través de Claude Code, el agente oficial de Anthropic. Al conectar, Sens lo descarga de Anthropic (${CLAUDE_CODE_WEIGHT}) y lo instala solo para tu usuario, sin permisos de administrador.`}
      </p>
      <div className="settings-row">
        <button className="quiet" disabled={busy} onClick={() => install(state)}>
          Instalar ahora
        </button>
        <button className="quiet" disabled={busy} onClick={() => loadProviders()}>
          Comprobar otra vez
        </button>
      </div>
    </>
  );
}

function MethodChoices({ state, method, busy }: Card & { method: Method }) {
  return (
    <fieldset className="choices">
      <legend className="label">Cómo entra</legend>
      {PROVIDER_METHODS.map((option) => (
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
  const door = SIGN_IN_DOORS[method];
  return (
    <>
      <div className="settings-row">
        <button className="primary" disabled={busy || connecting} onClick={() => signIn(state, method)}>
          <Icon svg={ICONS.external} />
          {connecting ? "Esperando a que termines…" : door.button}
        </button>
      </div>
      <ol className="sign-steps">
        {!state.installed && <li>{`Sens instala Claude Code desde Anthropic (${CLAUDE_CODE_WEIGHT}).`}</li>}
        <li>{`Se abre tu navegador en ${door.site}.`}</li>
        <li>Autorizas a Claude Code y te da un código.</li>
        <li>Si te lo pide, pégalo en la ventana de Claude Code. Sens se entera solo.</li>
      </ol>
      <p className="note">El código y tu sesión los maneja Claude Code; Sens nunca los ve.</p>
      {signedIn(state) && !connecting && (
        <div className="settings-row">
          <button className="quiet" disabled={busy} onClick={() => signOut(state)}>
            Cerrar sesión
          </button>
          <button className="quiet" disabled={busy} onClick={() => recheck(state)}>
            Comprobar
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
          <span className="note">{`Clave guardada: ${state.keyHint}`}</span>
          <button className="quiet" disabled={busy} onClick={() => forgetKey(state)}>
            Quitar clave
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
          placeholder={state.keyHint ? "Pega una clave nueva para cambiarla" : "sk-ant-…"}
          aria-label="Clave de API"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={busy}
        />
        <button className="primary" disabled={busy}>
          Guardar clave
        </button>
      </form>
      <p className="note">Se guarda cifrada con tu usuario de Windows y nunca se vuelve a mostrar.</p>
      {!state.installed && (
        <p className="note">{`Al guardarla, Sens instala también Claude Code desde Anthropic (${CLAUDE_CODE_WEIGHT}).`}</p>
      )}
    </>
  );
}
