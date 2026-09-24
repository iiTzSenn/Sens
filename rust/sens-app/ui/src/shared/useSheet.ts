import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { syncBrowser } from "../features/web/store";
import { sheets } from "./sheets.js";

// A menu over the shell that behaves like the legacy ones, because it joins
// the same list: one open at a time, a click outside or Escape shuts it (app.js
// listens for both), arrows move between its items, and focus leaving shuts it.
export function useSheet<Anchor extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const anchor = useRef<Anchor>(null);

  useEffect(() => {
    const one = {
      get sheet() {
        return sheet.current;
      },
      get anchor() {
        return anchor.current;
      },
      shut: () => setOpen(false),
    };
    sheets.push(one);
    return () => {
      sheets.splice(sheets.indexOf(one), 1);
    };
  }, []);

  useEffect(() => {
    if (open) sheet.current?.querySelector<HTMLElement>('input, [role^="menuitem"]')?.focus();
    syncBrowser();
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    for (const other of sheets) if (other.sheet !== sheet.current) other.shut();
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[event.key];
    if (!step || !sheet.current) return;
    event.preventDefault();
    const items = [...sheet.current.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled):not([hidden])')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  }

  function onBlur(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && !sheet.current?.contains(next) && next !== anchor.current) setOpen(false);
  }

  return {
    open,
    toggle,
    shut: () => setOpen(false),
    anchor,
    sheet: { ref: sheet, hidden: !open, onKeyDown, onBlur },
  };
}

// A sheet opened from a button, as components pass it along.
export type Sheet = ReturnType<typeof useSheet<HTMLButtonElement>>;
