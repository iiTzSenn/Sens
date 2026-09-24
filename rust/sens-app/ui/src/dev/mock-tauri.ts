// Lets the shell run in a plain browser: `npm run dev -w sens-app-ui` and open
// the printed URL. vite.config.ts injects it only into the dev server, and
// inside Tauri the real IPC is already there, so it steps aside.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();
const HOUR = 3_600_000;
const ROOT = "C:/Proyectos/demo";
const person = { name: "Demo", checkUpdates: false };

const fixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  last_project: () => null,
  workspaces: () => [
    {
      root: ROOT,
      name: "demo",
      activeAt: now - HOUR,
      sessions: [
        { id: "demo-1", title: "Migrar la interfaz a React", startedAt: now - HOUR, tasks: 3, archived: false },
        { id: "demo-2", title: "Revisar el catálogo", startedAt: now - 5 * HOUR, tasks: 1, archived: false },
      ],
    },
  ],
  providers: () => [{ id: "claude", vendor: "Anthropic", label: "Claude Code" }],
  models: () => [
    {
      id: "demo-model",
      label: "Modelo de prueba",
      description: "Datos simulados del navegador",
      latest: true,
      efforts: ["low", "medium", "high"],
      effort: "medium",
      thinking: "toggle",
    },
  ],
  claude_account: () => ({ billing: "subscription", plan: "max", source: "claude.ai", email: "demo@example.com" }),
  providers_state: () => [
    {
      id: "claude",
      vendor: "Anthropic",
      label: "Claude Code",
      method: "subscription",
      keyHint: "",
      version: "2.1.0",
      account: { billing: "subscription", plan: "max", source: "claude.ai", email: "demo@example.com" },
      error: "",
      installed: true,
    },
  ],
  profile: () => ({ ...person }),
  save_profile: ({ name }) => void (person.name = String(name).trim()),
  set_update_check: ({ on }) => void (person.checkUpdates = Boolean(on)),
  update_check: () => ({ latest: null, installable: false }),
  "plugin:app|version": () => "0.0.0-dev",
  "plugin:window|is_maximized": () => false,
};

if (!("__TAURI_INTERNALS__" in window)) {
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const fixture = fixtures[cmd];
      if (fixture) return fixture((args ?? {}) as Record<string, unknown>);
      console.info(`[mock-tauri] ${cmd}`, args);
      return null;
    },
    { shouldMockEvents: true },
  );
}
