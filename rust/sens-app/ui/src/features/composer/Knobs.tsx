import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Card, Provider } from "../../ipc/types";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { look } from "../../shared/look";
import { PanelForm, openPanel } from "../../shared/Panel";
import { useSheet, type Sheet } from "../../shared/useSheet";
import { accountLine, chosenCard, chosenLabel, choose, models, modelsOf, offeredBy, readAccount, refreshModels, refreshWhenDue, saidOf, signInWanted, toggleHidden } from "../models/store";
import { useIds, usePane } from "../panes/context";
import type { Pane } from "../panes/store";
import { openSettings, settings } from "../settings/store";
import { t } from "./knobs.copy";
import { BYPASS, MODES, chooseMode, composer, effortLevels, effortNow, modeNow, pickEffort, toggleThinking, trustProject, trustedHere } from "./store";

const modeName = (id: string) => (t.modes as Record<string, string>)[id] ?? id;
const modeSaid = (id: string) => (t.modesSaid as Record<string, string>)[id] ?? "";
const effortName = (level: string) => (t.efforts as Record<string, string>)[level] || level;

// A choice in a knob's menu: its name, what it means, and a tick when chosen.
function KnobRow({ label, sub, checked, risky, onPick }: { label: string; sub?: string; checked: boolean; risky?: boolean; onPick: () => void }) {
  return (
    <button className="menu-item" tabIndex={-1} role="menuitemradio" aria-checked={checked} data-risky={risky ? "true" : undefined} onClick={onPick}>
      <span className="mode-text">
        <span>{label}</span>
        {sub && <span className="mode-sub">{sub}</span>}
      </span>
      <span className="model-tick">
        <Icon svg={ICONS.check} />
      </span>
    </button>
  );
}

function PickerButton({ sheet, id, title, risky, children }: { sheet: Sheet; id: string; title?: string; risky?: boolean; children: ReactNode }) {
  return (
    <button className="picker-btn" id={id} ref={sheet.anchor} aria-haspopup="true" aria-expanded={sheet.open} title={title} data-risky={risky ? "true" : undefined} onClick={sheet.toggle}>
      <span>{children}</span>
      <Icon svg={ICONS.caret} />
    </button>
  );
}

// The models of each provider, newest first; the account under them; and, in
// edit mode, which models the picker hides.
export function ModelPicker() {
  const pane = usePane();
  const id = useIds();
  const sheet = useSheet();
  const catalog = useStore(models, (s) => s.catalog);
  useStore(models, (s) => s.known);
  useStore(models, (s) => s.hidden);
  useStore(pane.desk, (s) => s.choice);
  const fetching = useStore(models, (s) => s.fetching);
  const note = useStore(models, (s) => s.note);
  useStore(models, (s) => s.account);
  useStore(models, (s) => s.accountFault);
  useStore(models, (s) => s.limits);
  const behind = useStore(models, (s) => s.behind);
  const connecting = useStore(settings, (s) => s.connecting);
  const [editing, setEditing] = useState(false);
  const toProviders = () => {
    sheet.shut();
    openSettings("providers", sheet.anchor.current);
  };

  useEffect(() => {
    if (!sheet.open) return;
    setEditing(false);
    refreshWhenDue();
    if (!settings.getState().connecting) readAccount();
  }, [sheet.open]);

  const account = accountLine();
  return (
    <div className="pick-anchor">
      <PickerButton sheet={sheet} id={id("pick")}>
        <span id={id("crew")}>{chosenLabel(pane)}</span>
      </PickerButton>
      <div className="sheet menu models knob-sheet model-sheet" id={id("picker")} role="menu" aria-label={t.models} {...sheet.sheet}>
        <div id={id("model-rows")}>
          {catalog.map((provider) => (
            <ProviderRows key={provider.id} provider={provider} editing={editing} fetching={fetching} picked={() => sheet.shut()} />
          ))}
        </div>
        <div className={account.warn ? "model-quiet warn" : "model-quiet"} id={id("model-account")} hidden={!account.text}>
          {account.text}
        </div>
        <div className="model-quiet warn" id={id("model-note")} hidden={!note}>
          {note}
        </div>
        <div className="model-rule" />
        <button
          className="menu-item tool"
          role="menuitem"
          tabIndex={-1}
          id={id("models-connect")}
          hidden={!(connecting || signInWanted())}
          disabled={connecting}
          onClick={toProviders}
        >
          <Icon svg={ICONS.logIn} />
          <span>{connecting ? t.signingIn : t.connect}</span>
        </button>
        <button className="menu-item tool" role="menuitem" tabIndex={-1} id={id("models-update")} hidden={!behind} title={t.newer(behind)} onClick={toProviders}>
          <Icon svg={ICONS.update} />
          <span>{t.update}</span>
        </button>
        <button className="menu-item tool models-refresh" role="menuitem" tabIndex={-1} id={id("models-refresh")} disabled={fetching} aria-busy={fetching} onClick={refreshModels}>
          <Icon svg={ICONS.refresh} />
          <span>{fetching ? t.refreshing : t.refresh}</span>
        </button>
        <button className="menu-item tool" role="menuitem" tabIndex={-1} id={id("models-edit")} onClick={() => setEditing(!editing)}>
          <Icon svg={editing ? ICONS.check : ICONS.settings} />
          <span>{editing ? t.done : t.edit}</span>
        </button>
      </div>
    </div>
  );
}

function ProviderRows({ provider, editing, fetching, picked }: { provider: Provider; editing: boolean; fetching: boolean; picked: () => void }) {
  const cards = editing ? modelsOf(provider) : offeredBy(provider);
  const row = (card: Card) => <ModelRow key={card.id} provider={provider} card={card} editing={editing} picked={picked} />;
  const latest = cards.filter((card) => card.latest);
  const older = cards.filter((card) => !card.latest);
  const empty = fetching ? t.finding : modelsOf(provider).length ? t.allHidden : t.noModels;
  return (
    <>
      <div className="menu-head">
        <span className="vendor">{provider.vendor}</span> · {provider.label}
      </div>
      {cards.length ? (
        <>
          {latest.map(row)}
          {older.length > 0 && <div className="menu-head">{t.older}</div>}
          {older.map(row)}
        </>
      ) : (
        <div className="model-quiet">{empty}</div>
      )}
    </>
  );
}

function ModelRow({ provider, card, editing, picked }: { provider: Provider; card: Card; editing: boolean; picked: () => void }) {
  const pane = usePane();
  const hidden = useStore(models, (s) => s.hidden.has(card.id));
  const chosen = useStore(pane.desk, (s) => s.choice.provider === provider.id && s.choice.model === card.id);
  if (editing) {
    return (
      <button className="menu-item" tabIndex={-1} data-id={card.id} role="menuitemcheckbox" aria-checked={!hidden} onClick={() => toggleHidden(card.id)}>
        <span className="model-box">
          <Icon svg={ICONS.check} />
        </span>
        <span>{card.label}</span>
      </button>
    );
  }
  return (
    <KnobRow
      label={card.label}
      sub={saidOf(card)}
      checked={chosen}
      onPick={() => {
        choose(provider.id, card.id, pane);
        picked();
      }}
    />
  );
}

function askTrust(pane: Pane, back: HTMLElement | null) {
  openPanel(
    t.trustTitle,
    <PanelForm submit={t.trustGo} danger act={() => trustProject(pane)}>
      <p>{t.trustSaid}</p>
      <p className="mono trust-root">{pane.desk.getState().root}</p>
      <p>{t.trustKept}</p>
    </PanelForm>,
    back ?? undefined,
  );
}

export function ModePicker() {
  const pane = usePane();
  const id = useIds();
  const sheet = useSheet();
  useStore(composer, (s) => s.mode);
  useStore(pane.desk, (s) => s.trusted);
  useStore(pane.desk, (s) => s.root);
  const mode = modeNow(pane);
  const now = MODES.find((one) => one.id === mode)!;
  return (
    <div className="pick-anchor">
      <PickerButton sheet={sheet} id={id("mode-pick")} title={modeSaid(now.id)} risky={now.risky}>
        <span id={id("mode-label")}>{modeName(now.id)}</span>
      </PickerButton>
      <div className="sheet menu models knob-sheet" id={id("mode-sheet")} role="menu" aria-label={t.permissions} {...sheet.sheet}>
        <div className="menu-head">{t.permissions}</div>
        {MODES.map((one) => (
          <KnobRow
            key={one.id}
            label={modeName(one.id)}
            sub={modeSaid(one.id)}
            checked={one.id === mode}
            risky={one.risky}
            onPick={() => {
              sheet.shut();
              if (one.id === BYPASS && !trustedHere(pane)) return askTrust(pane, sheet.anchor.current);
              chooseMode(one.id, pane);
              sheet.anchor.current?.focus();
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Thinking before answering, unless the model always does.
export function Think() {
  const pane = usePane();
  const id = useIds();
  useStore(pane.desk, (s) => s.choice);
  useStore(models, (s) => s.known);
  const thinking = useStore(pane.desk, (s) => s.thinking);
  const card = chosenCard(pane);
  if (!card) return null;
  const always = card.thinking === "always";
  const on = always || thinking;
  const title = always ? t.thinkAlways : on ? t.thinkOn : t.thinkOff;
  return (
    <button className="toggle" id={id("think")} aria-pressed={on} aria-disabled={always} aria-label={t.thinking} title={title} onClick={() => toggleThinking(pane)}>
      <span className="toggle-icon" aria-hidden="true">
        <Icon svg={ICONS.brain} />
      </span>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </button>
  );
}

// How hard the model thinks, on a slider of the levels it offers. At the top,
// the track fills with Signal pixels.
export function Effort() {
  const pane = usePane();
  const id = useIds();
  useStore(pane.desk, (s) => s.choice);
  useStore(models, (s) => s.known);
  useStore(pane.desk, (s) => s.effort);
  const sheet = useSheet();
  const track = useRef<HTMLDivElement>(null);
  const card = chosenCard(pane);
  const levels = effortLevels(card);
  if (levels.length < 2) return null;

  const at = Math.max(0, levels.indexOf(effortNow(card, pane)));
  const last = levels.length - 1;
  const level = effortName(levels[at]);
  const top = at === last;
  const atPointer = (x: number) => {
    const box = track.current!.getBoundingClientRect();
    return Math.round(((x - box.left) / box.width) * last);
  };

  return (
    <div className="pick-anchor effort" id={id("effort")} data-max={String(top)}>
      <PickerButton sheet={sheet} id={id("effort-pick")} title={t.effortIs(level)}>
        <span className="effort-label" id={id("effort-label")}>
          {level}
        </span>
      </PickerButton>
      <div className="sheet effort-sheet" id={id("effort-sheet")} aria-label={t.effort} {...sheet.sheet}>
        <div className="effort-head">
          <span className="effort-name">
            {t.effort} <b id={id("effort-now")}>{level}</b>
          </span>
          <span className="effort-help" id={id("effort-help")} tabIndex={0} role="note" title={t.effortHelp} aria-label={t.effortHelp}>
            <Icon svg={ICONS.question} />
          </span>
        </div>
        <div className="effort-ends">
          <span>{t.faster}</span>
          <span>{t.smarter}</span>
        </div>
        <div
          className="effort-track"
          id={id("effort-track")}
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={t.effort}
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={at}
          aria-valuetext={level}
          title={t.effortIs(level)}
          style={{ "--at": String(at / last) } as CSSProperties}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            pickEffort(atPointer(event.clientX), pane);
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {}
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            if (!(event.buttons & 1)) return event.currentTarget.releasePointerCapture(event.pointerId);
            pickEffort(atPointer(event.clientX), pane);
          }}
          onKeyDown={(event) => {
            const to = { ArrowLeft: at - 1, ArrowDown: at - 1, ArrowRight: at + 1, ArrowUp: at + 1, Home: 0, End: last }[event.key];
            if (to === undefined) return;
            event.preventDefault();
            pickEffort(to, pane);
          }}
        >
          <Pixels running={top && sheet.open} />
          <div className="effort-ticks" id={id("effort-ticks")} aria-hidden="true">
            {levels.map((level) => (
              <span key={level} />
            ))}
          </div>
          <div className="effort-knob" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// Signal pixels, ordered-dithered denser to the right, swelling slowly; they
// sweep in from the left the first time. Still with reduced motion.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((step) => (step + 0.5) / 16);
const CELL = 3;
const ENTER = 1500;
const FRONT_SOFT = 0.18;

function Pixels({ running }: { running: boolean }) {
  const id = useIds();
  const canvas = useRef<HTMLCanvasElement>(null);
  const tone = useStore(look, (s) => `${s.shown} ${s.chosen.accent}`);

  useEffect(() => {
    const board = canvas.current;
    const ctx = board?.getContext("2d");
    if (!running || !board || !ctx) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim();
    let phases: Float32Array | null = null;
    let grid = "";
    let start = 0;
    let frame = 0;

    const draw = (millis: number) => {
      start ||= millis;
      const ratio = window.devicePixelRatio || 1;
      const wide = Math.max(1, Math.round(board.clientWidth));
      const tall = Math.max(1, Math.round(board.clientHeight));
      if (board.width !== wide * ratio || board.height !== tall * ratio) {
        board.width = wide * ratio;
        board.height = tall * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, wide, tall);
      ctx.fillStyle = ink;
      const cols = Math.ceil(wide / CELL);
      const rows = Math.ceil(tall / CELL);
      if (grid !== `${cols}x${rows}`) {
        grid = `${cols}x${rows}`;
        phases = new Float32Array(cols * rows);
        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < rows; row++) {
            const seed = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
            phases[col * rows + row] = (seed - Math.floor(seed)) * Math.PI * 2;
          }
        }
      }
      const time = millis / 1000;
      const entered = calm ? 1 : Math.min((millis - start) / ENTER, 1);
      const eased = entered * entered * (3 - 2 * entered);
      const front = (1 - eased) * (1 + FRONT_SOFT) - FRONT_SOFT;
      for (let col = 0; col < cols; col++) {
        const across = (col + 0.5) / cols;
        const gate = Math.min(Math.max((across - front) / FRONT_SOFT, 0), 1);
        if (gate <= 0) continue;
        const density = (0.28 + across ** 2.6 * 2.1) * gate;
        const glow = (0.16 + 0.84 * across) * gate;
        for (let row = 0; row < rows; row++) {
          const swell = 0.14 * gate * Math.sin(time * 1.1 + phases![col * rows + row]);
          const lit = (density + swell - BAYER[(col % 4) * 4 + (row % 4)]) * 2.6;
          if (lit <= 0.02) continue;
          ctx.globalAlpha = Math.min(lit, 1) * glow;
          ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
        }
      }
      ctx.globalAlpha = 1;
      frame = calm ? 0 : requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [running, tone]);

  return <canvas className="effort-fill" id={id("effort-pixels")} ref={canvas} aria-hidden="true" />;
}
