import { useEffect, useState, type CSSProperties } from "react";
import { useStore } from "zustand";
import { compact } from "../../shared/format.js";
import { spentOf } from "../chat/state";
import type { Pane } from "../panes/store";
import { t } from "./copy";
import { limitsShown, models, planName } from "./store";
import { asOf, overageOf, rowsOf, workedFor, type Level, type Row } from "./limits";
import "./usage.css";

const FULLISH = 0.7;
const FULL = 0.9;
const TICK = 30_000;

export const contextLevel = (share: number) => (share >= FULL ? "full" : share >= FULLISH ? "high" : undefined);

const BAR_LEVEL: Record<string, Level> = { high: "warn", full: "over" };

export function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function Mark({ level }: { level: Level }) {
  if (!level) return null;
  return <span className="usage-mark" data-level={level} role="img" aria-label={level === "over" ? t.over : t.near} />;
}

function Bar({ share, level, label }: { share: number; level: Level; label: string }) {
  const percent = Math.round(share * 100);
  return (
    <div className="usage-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-level={level || undefined}>
      <span style={{ "--share": String(share) } as CSSProperties} />
    </div>
  );
}

function ContextPart({ pane, onCompact }: { pane: Pane; onCompact: () => void }) {
  const context = useStore(pane.chat, (s) => s.context);
  const busy = useStore(pane.chat, (s) => s.busy);
  if (!context?.used) return null;
  const share = Math.min(1, context.used / context.window);
  return (
    <section className="usage-part" aria-label={t.context}>
      <div className="usage-head">
        <span>{t.context}</span>
        <b>{t.percent(Math.round(share * 100))}</b>
      </div>
      <Bar share={share} level={BAR_LEVEL[contextLevel(share) ?? ""] ?? ""} label={t.context} />
      <p className="usage-said">{t.contextOf(compact(context.used), compact(context.window))}</p>
      <p className="usage-note">{t.compactSaid}</p>
      <button className="quiet usage-act" disabled={busy} onClick={onCompact}>
        {t.compactNow}
      </button>
    </section>
  );
}

function SessionPart({ pane }: { pane: Pane }) {
  const spent = useStore(spentOf(pane));
  if (!spent.replies) return null;
  const stats: [string, string][] = [
    [t.tokensIn, compact(spent.tokensIn)],
    [t.tokensOut, compact(spent.tokensOut)],
    [t.replies, String(spent.replies)],
    [t.working, workedFor(spent.millis)],
  ];
  return (
    <section className="usage-part" aria-label={t.session}>
      <div className="usage-head">
        <span>{t.session}</span>
      </div>
      <dl className="usage-stats">
        {stats.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LimitRow({ row }: { row: Row }) {
  return (
    <div className="usage-limit" data-key={row.key} data-level={row.level || undefined}>
      <div className="usage-head">
        <span>{row.name}</span>
        <b>
          <Mark level={row.level} />
          {row.percent}
        </b>
      </div>
      <Bar share={row.share} level={row.level} label={row.name} />
      {row.resets && <p className="usage-note">{row.resets}</p>}
    </div>
  );
}

export function PlanPart({ now }: { now: number }) {
  const limits = useStore(models, (s) => s.limits);
  const account = useStore(models, (s) => s.account);
  if (!limitsShown()) return null;
  const rows = rowsOf(limits, now);
  const plan = planName(account);
  const overage = overageOf(limits);
  const stale = asOf(limits, now);
  return (
    <section className="usage-part usage-plan" aria-label={t.plan}>
      <div className="usage-head">
        <span>{plan ? t.planOf(plan) : t.plan}</span>
      </div>
      {rows.length ? rows.map((row) => <LimitRow key={row.key} row={row} />) : <p className="usage-note">{t.pending}</p>}
      {overage && (
        <p className="usage-note usage-overage" data-level={overage.level || undefined}>
          {overage.text}
        </p>
      )}
      {stale && <p className="usage-note usage-stale">{stale}</p>}
    </section>
  );
}

export function Usage({ pane, open, onCompact }: { pane: Pane; open: boolean; onCompact: () => void }) {
  const now = useNow(open);
  return (
    <>
      <ContextPart pane={pane} onCompact={onCompact} />
      <SessionPart pane={pane} />
      <PlanPart now={now} />
    </>
  );
}
