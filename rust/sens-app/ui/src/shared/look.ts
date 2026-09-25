import { getCurrentWindow } from "@tauri-apps/api/window";
import { createStore } from "zustand/vanilla";
import { looks } from "./copy";

export type Mode = "dark" | "light" | "system";
export type Accent = "signal" | "ice" | "iris" | "rose" | "neutral";
export type Shown = "dark" | "light";

export interface Look {
  mode: Mode;
  accent: Accent;
}

declare global {
  interface Window {
    __SENS_LOOK__?: unknown;
  }
}

export const MODES: readonly Mode[] = ["dark", "light", "system"];

export const ACCENTS: readonly Accent[] = ["signal", "ice", "iris", "rose", "neutral"];

export const modeName = (mode: Mode) => looks[mode];

export const accentName = (accent: Accent) => looks[accent];

export const FIRST_LOOK: Look = { mode: "dark", accent: "signal" };

const LIGHT_SYSTEM = "(prefers-color-scheme: light)";

export function lookOf(value: unknown): Look {
  const given = (value ?? {}) as Partial<Record<keyof Look, unknown>>;
  const mode = MODES.find((one) => one === given.mode) ?? FIRST_LOOK.mode;
  const accent = ACCENTS.find((one) => one === given.accent) ?? FIRST_LOOK.accent;
  return { mode, accent };
}

const systemIsLight = () => window.matchMedia?.(LIGHT_SYSTEM).matches ?? false;

export const shownOf = (mode: Mode): Shown => (mode === "system" ? (systemIsLight() ? "light" : "dark") : mode);

export const look = createStore(() => ({ chosen: FIRST_LOOK, shown: "dark" as Shown }));

export function showLook(chosen: Look) {
  const shown = shownOf(chosen.mode);
  const root = document.documentElement;
  root.dataset.mode = shown;
  root.dataset.accent = chosen.accent;
  look.setState({ chosen, shown });
}

export const tokenOf = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function linearRgb(hex: string): [number, number, number] {
  const digits = hex.replace("#", "");
  const channel = (at: number) => {
    const value = parseInt(digits.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4)];
}

export function followLook() {
  const frame = getCurrentWindow();
  window.matchMedia?.(LIGHT_SYSTEM).addEventListener("change", () => {
    if (look.getState().chosen.mode === "system") showLook(look.getState().chosen);
  });
  look.subscribe((now, was) => {
    if (now.chosen.mode !== was.chosen.mode) {
      frame
        .setTheme(now.chosen.mode === "system" ? null : now.chosen.mode)
        .then(() => showLook(look.getState().chosen))
        .catch(() => {});
    }
    if (now.shown !== was.shown) frame.setBackgroundColor(tokenOf("--ground")).catch(() => {});
  });
}
