import type { RefObject } from "react";
import { keepSize, sizing } from "./shell";

// Arrow keys move a splitter this much; with Shift, four times as much.
const SIZE_STEP = 16;

// A handle between two panes: dragged, or moved with the arrow keys, it sets
// the width `name` on `host` (a CSS variable its layout clamps); a double
// click gives the layout its own width back. The width kept is the one the
// pane ended up with.
export function Splitter({
  id,
  label,
  name,
  host,
  pane,
  grow,
}: {
  id: string;
  label: string;
  name: string;
  host: RefObject<HTMLElement | null>;
  pane: RefObject<HTMLElement | null>;
  grow: 1 | -1;
}) {
  const width = () => Math.round(pane.current?.getBoundingClientRect().width ?? 0);
  const set = (px: number) => host.current?.style.setProperty(name, `${Math.round(px)}px`);
  const settle = () => {
    const now = width();
    keepSize(name, now);
    return now;
  };

  return (
    <div
      className="split"
      id={id}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onFocus={(event) => event.currentTarget.setAttribute("aria-valuenow", String(width()))}
      onDoubleClick={() => {
        host.current?.style.removeProperty(name);
        keepSize(name, 0);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const from = event.clientX;
        const start = width();
        handle.setPointerCapture(event.pointerId);
        handle.dataset.dragging = "true";
        sizing(true);
        const move = (moved: PointerEvent) => set(start + (moved.clientX - from) * grow);
        const done = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", done);
          handle.removeEventListener("pointercancel", done);
          delete handle.dataset.dragging;
          handle.setAttribute("aria-valuenow", String(settle()));
          sizing(false);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", done);
        handle.addEventListener("pointercancel", done);
      }}
      onKeyDown={(event) => {
        const step = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
        if (!step) return;
        event.preventDefault();
        sizing(true);
        set(width() + step * grow * SIZE_STEP * (event.shiftKey ? 4 : 1));
        event.currentTarget.setAttribute("aria-valuenow", String(settle()));
        sizing(false);
      }}
    />
  );
}
