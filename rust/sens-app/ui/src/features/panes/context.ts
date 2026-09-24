import { createContext, useContext, useEffect, useReducer } from "react";
import { useStore } from "zustand";
import { focused, panes, type Pane } from "./store";

export const PaneContext = createContext<Pane | null>(null);

export const usePane = () => useContext(PaneContext) ?? focused();

export function useIds() {
  const pane = usePane();
  const here = useStore(panes, (s) => s.open.length < 2 || s.focus === pane.id);
  return (name: string) => (here ? name : `${name}-${pane.id}`);
}

export function useShown() {
  const open = useStore(panes, (s) => s.open);
  const focus = useStore(panes, (s) => s.focus);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const offs = open.map((pane) => pane.desk.subscribe((now, before) => now.session !== before.session && bump()));
    return () => offs.forEach((off) => off());
  }, [open]);
  const sessions = open.map((pane) => pane.desk.getState().session).filter(Boolean);
  const beside = open.length > 1 ? (open.find((pane) => pane.id !== focus)?.desk.getState().session ?? "") : "";
  return { sessions, beside };
}
