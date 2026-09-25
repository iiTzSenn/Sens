import { useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { titleOf } from "../rail/store";
import { t } from "./copy";
import { drag, type Target } from "./drag";
import { focused, panes, type Pane } from "./store";

type Span = { left: number; width: number };

const HINTS: Record<Target["kind"], (leaving: string) => string> = {
  open: () => t.dropOpen,
  replace: (leaving) => t.dropReplace(leaving),
  same: () => t.dropSame,
  narrow: () => t.dropNarrow,
};

function spanOf(target: Target, split: boolean, share: number): Span {
  if (target.kind === "narrow" || (target.kind === "same" && !split)) return { left: 0, width: 1 };
  if (target.kind === "open") return { left: target.side === "left" ? 0 : 0.5, width: 0.5 };
  return target.side === "left" ? { left: 0, width: share } : { left: share, width: 1 - share };
}

const place = ({ left, width }: Span) => ({ "--at": String(left), "--span": String(width) }) as CSSProperties;

function paneTitle(pane?: Pane) {
  if (!pane) return "";
  const { root, session } = pane.desk.getState();
  return titleOf(root, session);
}

export function Snap() {
  const phase = useStore(drag, (s) => s.phase);
  const dragged = useStore(drag, (s) => s.dragged);
  const target = useStore(drag, (s) => s.target);
  const open = useStore(panes, (s) => s.open);
  const share = useStore(panes, (s) => s.share);
  const split = open.length > 1;
  const last = useRef<Target | null>(null);
  if (target) last.current = target;
  if (phase === "idle" || !dragged) {
    last.current = null;
    return null;
  }

  const aim = target ?? last.current;
  const span = aim ? spanOf(aim, split, share) : { left: 0.25, width: 0.5 };
  const stay = target?.kind === "open" ? { left: target.side === "left" ? 0.5 : 0, width: 0.5 } : null;
  const leaving = aim?.kind === "replace" ? paneTitle(open[aim.side === "left" ? 0 : 1]) : "";
  return (
    <>
      <div className="snap" data-phase={phase} data-kind={target?.kind ?? "none"} aria-hidden="true">
        <div className="snap-stay" data-shown={stay ? "true" : undefined} style={place(stay ?? { left: aim?.kind === "open" && aim.side === "left" ? 0.5 : 0, width: 0.5 })}>
          <span className="snap-stay-title">{paneTitle(focused())}</span>
        </div>
        <div className="snap-slot" data-shown={target ? "true" : undefined} data-kind={aim?.kind} style={place(span)}>
          <span className="snap-icon">
            <Icon svg={aim?.kind === "narrow" ? ICONS.info : ICONS.splitView} />
          </span>
          <span className="snap-title">{dragged.title}</span>
          <span className="snap-hint">{aim ? HINTS[aim.kind](leaving) : ""}</span>
        </div>
      </div>
      <Ghost />
    </>
  );
}

function Ghost() {
  const phase = useStore(drag, (s) => s.phase);
  const dragged = useStore(drag, (s) => s.dragged);
  const over = useStore(drag, (s) => Boolean(s.target));
  const x = useStore(drag, (s) => s.x);
  const y = useStore(drag, (s) => s.y);
  const from = useStore(drag, (s) => s.from);
  if (!dragged) return null;
  const back = phase === "cancelling";
  const style = { transform: back ? `translate(${from.x}px, ${from.y}px)` : `translate(${x + 14}px, ${y + 12}px)` };
  return createPortal(
    <div className="snap-ghost" data-phase={phase} data-over={over ? "true" : undefined} style={style} aria-hidden="true">
      <Icon svg={ICONS.splitView} />
      <span className="snap-ghost-title">{dragged.title}</span>
      <span className="snap-ghost-folder">{dragged.folder}</span>
    </div>,
    document.body,
  );
}
