import type { PointerEvent as ReactPointerEvent } from "react";
import { createStore } from "zustand/vanilla";
import { focusPane, openBeside } from "../../app/session";
import { holdStill } from "./motion";
import { LEAST_WIDTH, paneOf, panes, sideOf, type Side } from "./store";

export interface Dragged {
  home: string;
  id: string;
  title: string;
  folder: string;
}

export type Target = { kind: "open" | "replace" | "same"; side: Side } | { kind: "narrow" };

export type Phase = "idle" | "dragging" | "dropping" | "cancelling";

export const drag = createStore(() => ({
  dragged: null as Dragged | null,
  target: null as Target | null,
  phase: "idle" as Phase,
  x: 0,
  y: 0,
  from: { x: 0, y: 0 },
}));

const LIFT = 5;
const SETTLE = 240;

function targetAt(x: number, y: number, dragged: Dragged): Target | null {
  const chat = document.querySelector<HTMLElement>("section.chat");
  if (!chat || chat.hidden) return null;
  const box = chat.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
  const { open, share } = panes.getState();
  const shown = paneOf(dragged.id);
  if (shown) return { kind: "same", side: sideOf(shown) };
  if (open.length > 1) return { kind: "replace", side: x < box.left + box.width * share ? "left" : "right" };
  if (box.width < LEAST_WIDTH * 2) return { kind: "narrow" };
  return { kind: "open", side: x < box.left + box.width / 2 ? "left" : "right" };
}

const rest = () => drag.setState({ dragged: null, target: null, phase: "idle" });

function swallow(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function drop(dragged: Dragged, target: Target) {
  drag.setState({ phase: "dropping" });
  setTimeout(rest, SETTLE);
  if (target.kind === "narrow") return;
  if (target.kind === "same") {
    const shown = paneOf(dragged.id);
    return shown && focusPane(shown);
  }
  if (target.kind === "open") holdStill();
  return openBeside(dragged.home, dragged.id, target.side);
}

export function lift(event: ReactPointerEvent<HTMLElement>, dragged: Dragged) {
  if (event.button !== 0) return;
  const start = { x: event.clientX, y: event.clientY };
  const origin = event.currentTarget.getBoundingClientRect();
  let lifted = false;

  const move = (moved: PointerEvent) => {
    if (!lifted) {
      if (Math.hypot(moved.clientX - start.x, moved.clientY - start.y) < LIFT) return;
      lifted = true;
      document.documentElement.dataset.dragging = "session";
      window.addEventListener("click", swallow, true);
      drag.setState({ dragged, phase: "dragging", from: { x: origin.left, y: origin.top } });
    }
    drag.setState({ x: moved.clientX, y: moved.clientY, target: targetAt(moved.clientX, moved.clientY, dragged) });
  };

  const end = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    if (!lifted) return;
    delete document.documentElement.dataset.dragging;
    setTimeout(() => window.removeEventListener("click", swallow, true));
    const { target } = drag.getState();
    if (commit && target && target.kind !== "narrow") return drop(dragged, target);
    drag.setState({ phase: "cancelling" });
    setTimeout(rest, SETTLE);
  };

  const up = () => end(true);
  const cancel = () => end(false);
  const key = (pressed: KeyboardEvent) => {
    if (pressed.key !== "Escape") return;
    pressed.preventDefault();
    pressed.stopPropagation();
    cancel();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
}
