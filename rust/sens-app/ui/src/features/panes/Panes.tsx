import { Fragment, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useStore } from "zustand";
import { closePane, focusPane } from "../../app/session";
import { sizing } from "../../app/shell";
import { stem } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Thread } from "../chat/Thread";
import { Composer } from "../composer/Composer";
import { failRail, rail, titleOf } from "../rail/store";
import { PaneContext } from "./context";
import { t } from "./copy";
import { slideShare } from "./motion";
import { LEAST_WIDTH, SHARE_LEAST, SHARE_MOST, panes, share, type Pane } from "./store";
import { Snap } from "./Snap";

const SNAP = 0.02;
const STEP = 0.02;

export function Panes() {
  const open = useStore(panes, (s) => s.open);
  const focus = useStore(panes, (s) => s.focus);
  const kept = useStore(panes, (s) => s.share);
  const host = useRef<HTMLDivElement>(null);
  const seen = useRef(open);
  const split = open.length > 1;

  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = open;
    host.current?.style.setProperty("--share", String(kept));
    if (open.length === 2 && before.length === 1) slideShare(open[0] === before[0] ? 1 : 0, kept);
  }, [open, kept]);

  return (
    <div className="panes" ref={host} data-split={split ? "true" : undefined}>
      {open.map((pane, at) => (
        <Fragment key={pane.id}>
          {at > 0 && <Divider host={host} />}
          <PaneView pane={pane} focused={split && pane.id === focus} split={split} />
        </Fragment>
      ))}
      <Snap />
    </div>
  );
}

function PaneView({ pane, focused, split }: { pane: Pane; focused: boolean; split: boolean }) {
  const wake = (event: { target: EventTarget }) => {
    if (!(event.target as Element).closest?.(".pane-close")) focusPane(pane).catch(failRail);
  };
  return (
    <PaneContext.Provider value={pane}>
      <section className="pane" data-focus={focused ? "true" : undefined} onPointerDownCapture={wake} onFocusCapture={wake}>
        {split && <PaneHead pane={pane} />}
        <Thread />
        <Composer />
      </section>
    </PaneContext.Provider>
  );
}

function PaneHead({ pane }: { pane: Pane }) {
  const root = useStore(pane.desk, (s) => s.root);
  const session = useStore(pane.desk, (s) => s.session);
  const busy = useStore(pane.chat, (s) => s.busy);
  const title = useStore(rail, () => titleOf(root, session));
  return (
    <header className="pane-head">
      <span className="pane-dot" data-busy={busy ? "true" : undefined} aria-hidden="true" />
      <span className="pane-title" title={title}>
        {title}
      </span>
      {root && <span className="pane-folder">{stem(root)}</span>}
      <button className="pane-close" title={t.closePane} aria-label={t.closeNamed(title)} onClick={() => closePane(pane)}>
        <Icon svg={ICONS.dismiss} />
      </button>
    </header>
  );
}

function Divider({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const kept = useStore(panes, (s) => s.share);

  const fit = (to: number) => {
    const width = host.current?.getBoundingClientRect().width || 0;
    const least = width ? LEAST_WIDTH / width : SHARE_LEAST;
    const clamped = Math.min(Math.min(1 - least, SHARE_MOST), Math.max(Math.max(least, SHARE_LEAST), to));
    return Math.abs(clamped - 0.5) < SNAP ? 0.5 : clamped;
  };

  function drag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !host.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const box = host.current.getBoundingClientRect();
    let now = kept;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "true";
    sizing(true);
    const move = (moved: PointerEvent) => {
      now = fit((moved.clientX - box.left) / box.width);
      handle.dataset.snapped = String(now === 0.5);
      host.current?.style.setProperty("--share", String(now));
    };
    const done = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      delete handle.dataset.dragging;
      delete handle.dataset.snapped;
      sizing(false);
      share(now);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  }

  return (
    <div
      className="split pane-split"
      role="separator"
      aria-orientation="vertical"
      aria-label={t.divider}
      aria-valuemin={Math.round(SHARE_LEAST * 100)}
      aria-valuemax={Math.round(SHARE_MOST * 100)}
      aria-valuenow={Math.round(kept * 100)}
      title={t.dividerHint}
      tabIndex={0}
      onDoubleClick={() => {
        slideShare(kept, 0.5);
        share(0.5);
      }}
      onPointerDown={drag}
      onKeyDown={(event) => {
        const step = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
        if (!step) return;
        event.preventDefault();
        share(fit(kept + step * STEP * (event.shiftKey ? 4 : 1)));
      }}
    />
  );
}
