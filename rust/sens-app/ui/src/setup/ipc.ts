import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Look } from "../shared/look";

export type Mode = "install" | "update" | "uninstall";

export type Step = "check" | "close" | "extract" | "swap" | "register" | "shortcuts" | "done" | "remove";

export interface SetupState {
  mode: Mode;
  version: string;
  installed: { version: string; dir: string } | null;
  dir: string;
  size: number;
  free: number | null;
  passive: boolean;
  relaunch: boolean;
  desktop: boolean;
  demo: boolean;
  look: Look | null;
}

export interface Choice {
  dir: string;
  desktop: boolean;
  startMenu: boolean;
  look: Look | null;
}

export interface Progress {
  step: Step;
  progress: number;
  line: string;
}

export interface Place {
  free: number | null;
  problem: string;
}

export const setup = {
  state: () => invoke<SetupState>("setup_state"),
  dir: (dir: string) => invoke<Place>("setup_dir", { dir }),
  install: (choice: Choice) => invoke<void>("setup_install", { choice }),
  uninstall: (removeData: boolean) => invoke<void>("setup_uninstall", { removeData }),
  cancel: () => invoke<void>("setup_cancel"),
  closeApp: (force: boolean) => invoke<boolean>("setup_close_app", { force }),
  launch: () => invoke<void>("setup_launch"),
  quit: () => invoke<void>("setup_quit"),
};

export const heard = {
  progress: (then: (progress: Progress) => void): Promise<UnlistenFn> => listen<Progress>("setup", ({ payload }) => then(payload)),
  running: (then: () => void): Promise<UnlistenFn> => listen("setup-running", () => then()),
};
