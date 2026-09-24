import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Choice, Progress, SetupState, Step } from "./ipc";

const asked = new URLSearchParams(location.search);
const mode = (asked.get("mode") as SetupState["mode"]) || "install";
const installed = asked.get("installed") ?? (mode === "install" ? "" : "0.16.0");
const failAt = asked.get("fail") as Step | null;
const saved = asked.get("look")?.split(".");
const DIR = "C:\\Users\\Sofia\\AppData\\Local\\Sens";

let cancelled = false;
let open = asked.get("running") === "1";

const state: SetupState = {
  mode,
  version: "0.17.0",
  installed: installed ? { version: installed, dir: DIR } : null,
  dir: DIR,
  size: 7_329_792,
  free: 128_849_018_880,
  passive: mode === "update",
  relaunch: mode === "update",
  desktop: false,
  demo: true,
  look: saved ? { mode: saved[0], accent: saved[1] } as SetupState["look"] : null,
};

const pause = (millis: number) => new Promise((done) => setTimeout(done, millis));

const INSTALL: [Step, number, string][] = [
  ["check", 0.06, "Comprobando espacio · 120 GB libres"],
  ["close", 0.12, "Sens no está abierta"],
  ["extract", 0.3, "Descomprimiendo sens-app.exe · 2,1 MB de 7 MB"],
  ["extract", 0.52, "Descomprimiendo sens-app.exe · 4,4 MB de 7 MB"],
  ["extract", 0.68, "Descomprimiendo sens-app.exe · 7 MB de 7 MB"],
  ["swap", 0.76, "Colocando sens-app.exe"],
  ["register", 0.86, "Registrando Sens en Windows"],
  ["register", 0.9, "Guardando tu apariencia"],
  ["shortcuts", 0.94, "Acceso directo en el menú Inicio"],
  ["done", 1, "Listo en 1,9 s"],
];

const UNINSTALL: [Step, number, string][] = [
  ["close", 0.15, "Sens no está abierta"],
  ["remove", 0.4, "Quitando los accesos directos"],
  ["remove", 0.65, "Quitando Sens del registro de Windows"],
  ["remove", 0.9, "Borrando sens-app.exe y uninstall.exe"],
  ["done", 1, "Listo en 0,8 s"],
];

async function walk(steps: [Step, number, string][]) {
  cancelled = false;
  for (const [step, progress, line] of steps) {
    if (cancelled && step !== "done" && ["check", "close", "extract"].includes(step)) throw "cancelado";
    if (step === failAt) throw `no pude escribir ${DIR}\\sens-app.exe.new: Acceso denegado. (os error 5)`;
    if (step === "close" && open) {
      await emit("setup-running", { running: true });
      while (open) {
        if (cancelled) throw "cancelado";
        await pause(250);
      }
    }
    await emit("setup", { step, progress, line } satisfies Progress);
    await pause(120);
  }
}

const fixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  setup_state: () => state,
  setup_dir: ({ dir }) => ({ free: state.free, problem: String(dir).startsWith("C:\\Windows") ? "Ahí no se puede escribir sin permisos de administrador" : "" }),
  setup_install: ({ choice }) => walk(INSTALL.filter(([, , line]) => (choice as Choice).look || !line.includes("apariencia"))),
  setup_uninstall: () => walk(UNINSTALL),
  setup_cancel: () => void (cancelled = true),
  setup_close_app: async () => {
    await pause(900);
    open = false;
    return true;
  },
  setup_launch: () => console.info("[mock-setup] abrir Sens"),
  setup_quit: () => console.info("[mock-setup] salir"),
  "plugin:dialog|open": () => "D:\\Programas",
  "plugin:window|show": () => null,
  "plugin:window|minimize": () => null,
  "plugin:window|set_theme": () => null,
  "plugin:window|set_background_color": () => null,
};

if (!("__TAURI_INTERNALS__" in window)) {
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const fixture = fixtures[cmd];
      if (fixture) return fixture((args ?? {}) as Record<string, unknown>);
      console.info(`[mock-setup] ${cmd}`, args);
      return null;
    },
    { shouldMockEvents: true },
  );
}
