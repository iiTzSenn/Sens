import type { ReactNode } from "react";
import { createStore } from "zustand/vanilla";

// The one dialog over the window: a form, a panel, a picture (`wide`). When it
// closes, the focus goes back to what opened it.
export const dialog = createStore(() => ({
  open: false,
  title: "",
  content: null as ReactNode,
  wide: false,
}));

let back: HTMLElement | null = null;

export function openDialog(title: string, content: ReactNode, from?: HTMLElement | null, wide = false) {
  back = from ?? (document.activeElement as HTMLElement | null);
  dialog.setState({ open: true, title, content, wide });
}

export const closeDialog = () => dialog.setState({ open: false });

// After a form adds something, the focus goes to it instead.
export const returnTo = (element: HTMLElement) => void (back = element);

// The dialog closed (by a button, Escape or the backdrop): its content goes
// and the focus goes back.
export function closed() {
  dialog.setState({ open: false, content: null, wide: false });
  if (back?.isConnected) back.focus();
  back = null;
}
