import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { copy, localeNow } from "../shared/i18n";
import type { Choice, Progress, SetupState, Step, Stopped } from "./ipc";

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
  look: saved ? ({ mode: saved[0], accent: saved[1] } as SetupState["look"]) : null,
};

const said = copy({
  en: {
    space: (free: string) => `Checking space · ${free} GB free`,
    notOpen: "Sens isn’t open",
    unpacking: (done: string) => `Unpacking sens-app.exe · ${done} MB of 7 MB`,
    placing: "Placing sens-app.exe",
    registering: "Registering Sens with Windows",
    look: "Saving your appearance",
    language: "Saving your language",
    startMenu: "Start menu shortcut",
    done: (seconds: string) => `Done in ${seconds} s`,
    unlinking: "Removing the shortcuts",
    unregistering: "Removing Sens from Windows",
    deleting: "Deleting sens-app.exe and uninstall.exe",
    denied: (path: string) => `couldn’t write ${path}: Access is denied. (os error 5)`,
    admin: "You can’t write there without administrator rights",
  },
  es: {
    space: (free: string) => `Comprobando espacio · ${free} GB libres`,
    notOpen: "Sens no está abierta",
    unpacking: (done: string) => `Descomprimiendo sens-app.exe · ${done} MB de 7 MB`,
    placing: "Colocando sens-app.exe",
    registering: "Registrando Sens en Windows",
    look: "Guardando tu apariencia",
    language: "Guardando tu idioma",
    startMenu: "Acceso directo en el menú Inicio",
    done: (seconds: string) => `Listo en ${seconds} s`,
    unlinking: "Quitando los accesos directos",
    unregistering: "Quitando Sens de Windows",
    deleting: "Borrando sens-app.exe y uninstall.exe",
    denied: (path: string) => `no pude escribir ${path}: Acceso denegado. (os error 5)`,
    admin: "Ahí no se puede escribir sin permisos de administrador",
  },
  fr: {
    space: (free: string) => `Vérification de l’espace · ${free} Go libres`,
    notOpen: "Sens n’est pas ouvert",
    unpacking: (done: string) => `Décompression de sens-app.exe · ${done} Mo sur 7 Mo`,
    placing: "Mise en place de sens-app.exe",
    registering: "Inscription de Sens dans Windows",
    look: "Enregistrement de votre apparence",
    language: "Enregistrement de votre langue",
    startMenu: "Raccourci dans le menu Démarrer",
    done: (seconds: string) => `Terminé en ${seconds} s`,
    unlinking: "Suppression des raccourcis",
    unregistering: "Retrait de Sens de Windows",
    deleting: "Suppression de sens-app.exe et de uninstall.exe",
    denied: (path: string) => `impossible d’écrire ${path} : Accès refusé. (os error 5)`,
    admin: "Impossible d’écrire ici sans droits d’administrateur",
  },
  de: {
    space: (free: string) => `Speicherplatz wird geprüft · ${free} GB frei`,
    notOpen: "Sens ist nicht geöffnet",
    unpacking: (done: string) => `sens-app.exe wird entpackt · ${done} MB von 7 MB`,
    placing: "sens-app.exe wird abgelegt",
    registering: "Sens wird in Windows registriert",
    look: "Deine Darstellung wird gespeichert",
    language: "Deine Sprache wird gespeichert",
    startMenu: "Verknüpfung im Startmenü",
    done: (seconds: string) => `Fertig in ${seconds} s`,
    unlinking: "Verknüpfungen werden entfernt",
    unregistering: "Sens wird aus Windows entfernt",
    deleting: "sens-app.exe und uninstall.exe werden gelöscht",
    denied: (path: string) => `${path} konnte nicht geschrieben werden: Zugriff verweigert (os error 5)`,
    admin: "Dort kann ohne Administratorrechte nicht geschrieben werden",
  },
  ja: {
    space: (free: string) => `空き容量を確認しています · 空き ${free} GB`,
    notOpen: "Sens は開いていません",
    unpacking: (done: string) => `sens-app.exe を展開しています · ${done} MB / 7 MB`,
    placing: "sens-app.exe を配置しています",
    registering: "Sens を Windows に登録しています",
    look: "外観を保存しています",
    language: "言語を保存しています",
    startMenu: "スタートメニューのショートカット",
    done: (seconds: string) => `${seconds} 秒で完了しました`,
    unlinking: "ショートカットを削除しています",
    unregistering: "Windows から Sens を削除しています",
    deleting: "sens-app.exe と uninstall.exe を削除しています",
    denied: (path: string) => `${path} に書き込めませんでした: アクセスが拒否されました。(os error 5)`,
    admin: "管理者権限がないとここには書き込めません",
  },
  zh: {
    space: (free: string) => `正在检查空间 · 可用 ${free} GB`,
    notOpen: "Sens 未在运行",
    unpacking: (done: string) => `正在解压 sens-app.exe · ${done} MB / 7 MB`,
    placing: "正在放置 sens-app.exe",
    registering: "正在向 Windows 注册 Sens",
    look: "正在保存你的外观",
    language: "正在保存你的语言",
    startMenu: "“开始”菜单快捷方式",
    done: (seconds: string) => `已完成，用时 ${seconds} 秒`,
    unlinking: "正在删除快捷方式",
    unregistering: "正在从 Windows 中移除 Sens",
    deleting: "正在删除 sens-app.exe 和 uninstall.exe",
    denied: (path: string) => `无法写入 ${path}：拒绝访问。(os error 5)`,
    admin: "没有管理员权限无法写入此处",
  },
});

const pause = (millis: number) => new Promise((done) => setTimeout(done, millis));
const number = (value: number) => new Intl.NumberFormat(localeNow()).format(value);
const stop = (cancelled: boolean, reason: string): Stopped => ({ cancelled, reason });

type Line = [Step, number, () => string, string?];

const INSTALL: Line[] = [
  ["check", 0.06, () => said.space("120")],
  ["close", 0.12, () => said.notOpen],
  ["extract", 0.3, () => said.unpacking(number(2.1))],
  ["extract", 0.52, () => said.unpacking(number(4.4))],
  ["extract", 0.68, () => said.unpacking(number(7))],
  ["swap", 0.76, () => said.placing],
  ["register", 0.86, () => said.registering],
  ["register", 0.9, () => said.look, "look"],
  ["register", 0.92, () => said.language, "language"],
  ["shortcuts", 0.94, () => said.startMenu],
  ["done", 1, () => said.done(number(1.9))],
];

const UNINSTALL: Line[] = [
  ["close", 0.15, () => said.notOpen],
  ["remove", 0.4, () => said.unlinking],
  ["remove", 0.65, () => said.unregistering],
  ["remove", 0.9, () => said.deleting],
  ["done", 1, () => said.done(number(0.8))],
];

async function walk(steps: Line[]) {
  cancelled = false;
  for (const [step, progress, line] of steps) {
    if (cancelled && step !== "done" && ["check", "close", "extract"].includes(step)) throw stop(true, "cancelled");
    if (step === failAt) throw stop(false, said.denied(`${DIR}\\sens-app.exe.new`));
    if (step === "close" && open) {
      await emit("setup-running", { running: true });
      while (open) {
        if (cancelled) throw stop(true, "cancelled");
        await pause(250);
      }
    }
    await emit("setup", { step, progress, line: line() } satisfies Progress);
    await pause(120);
  }
}

const fixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  setup_state: () => state,
  setup_dir: ({ dir }) => ({ free: state.free, problem: String(dir).startsWith("C:\\Windows") ? said.admin : "" }),
  setup_language: ({ language }) => console.info(`[mock-setup] language ${language}`),
  setup_install: ({ choice }) => walk(INSTALL.filter(([, , , asked]) => !asked || (choice as Choice)[asked as "look" | "language"])),
  setup_uninstall: () => walk(UNINSTALL),
  setup_cancel: () => void (cancelled = true),
  setup_close_app: async () => {
    await pause(900);
    open = false;
    return true;
  },
  setup_launch: () => pause(1400).then(() => console.info("[mock-setup] Sens is on screen")),
  setup_quit: () => console.info("[mock-setup] quit"),
  "plugin:dialog|open": () => "D:\\Programas",
  "plugin:window|show": () => null,
  "plugin:window|minimize": () => null,
  "plugin:window|set_theme": () => null,
  "plugin:window|set_background_color": () => null,
};

if (!("__TAURI_INTERNALS__" in window)) {
  window.__SENS_LANGUAGE__ = asked.get("language");
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
