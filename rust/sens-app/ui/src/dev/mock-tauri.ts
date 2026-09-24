// Lets the shell run in a plain browser: `npm run dev -w sens-app-ui` and open
// the printed URL. vite.config.ts injects it only into the dev server, and
// inside Tauri the real IPC is already there, so it steps aside.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Capabilities } from "../ipc/types";

const now = Date.now();
const HOUR = 3_600_000;
const ROOT = "C:/Proyectos/demo";
const person = { name: "Demo", checkUpdates: false };

const caps: Capabilities = {
  skills: [
    { name: "revisar-pr", description: "Revisa un pull request con la guía del equipo", enabled: true },
    { name: "notas", description: "Resume la sesión en notas", enabled: false },
  ],
  servers: [
    { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], envKeys: ["GITHUB_TOKEN"], kind: "stdio", url: "", enabled: false },
  ],
  plugins: [{ name: "formatter", description: "Formatea al guardar", version: "1.2.0", enabled: true }],
  origins: { "plugin:formatter": { listing: "demo/formatter", revision: "r1", version: "1.2.0", installedAt: now - HOUR } },
};
type List = "skills" | "servers" | "plugins";

const listing = (id: string, kind: string, title: string, badge: string, extra: object = {}) => ({
  id,
  kind,
  name: id.split("/").pop(),
  title,
  description: `${title}, de prueba`,
  author: "Demo",
  badge,
  source: "demo",
  category: "",
  version: "1.0.0",
  homepage: "https://example.com",
  installs: 1234,
  login: false,
  tools: [],
  installable: true,
  revision: "r1",
  ...extra,
});

const listings = [
  listing("demo/formatter", "plugin", "Formatter", "anthropic", { revision: "r2", tools: ["format"] }),
  listing("demo/tests", "skill", "Escribir tests", "community"),
  listing("demo/calendar", "connector", "Calendario", "partner", { login: true, installable: false }),
];

const setCapability = (list: List) => ({ name, enabled }: Record<string, unknown>) => {
  const item = caps[list].find((one) => one.name === name);
  if (item) item.enabled = Boolean(enabled);
};
const removeCapability = (list: List) => ({ name }: Record<string, unknown>) => {
  const at = caps[list].findIndex((one) => one.name === name);
  if (at >= 0) caps[list].splice(at, 1);
};

const artifact = (kind: string, name: string, hoursAgo: number, session: string | null = "demo-1") => ({
  kind,
  root: ROOT,
  project: "demo",
  name,
  target: kind === "link" ? `https://example.com/${name}` : `${ROOT}/.sens/artifacts/${name}`,
  session,
  sessionTitle: session ? "Migrar la interfaz a React" : null,
  at: now - hoursAgo * HOUR,
  bytes: 2048,
});

const SQUARE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#c7ff4a"/></svg>')}`;

const fixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  last_project: () => ROOT,
  artifacts: () => [
    artifact("image", "captura.png", 1),
    artifact("file", "plan.md", 3),
    artifact("file", "informe.html", 30, null),
    artifact("link", "docs", 50),
    artifact("file", "datos.xlsx", 80, null),
  ],
  artifact_data: () => SQUARE,
  preview_url: ({ path }) => `http://127.0.0.1:4321/demo/${String(path).split("/").pop()}`,
  artifact_text: ({ path }) => `# ${String(path).split("/").pop()}\n\nTexto de prueba.`,
  tree: () => [],
  folder: () => [],
  capabilities: () => structuredClone(caps),
  set_skill: setCapability("skills"),
  set_server: setCapability("servers"),
  set_plugin: setCapability("plugins"),
  remove_skill: removeCapability("skills"),
  remove_server: removeCapability("servers"),
  remove_plugin: removeCapability("plugins"),
  skill_text: ({ name }) => `---\nname: ${name}\n---\n# ${name}\n\nInstrucciones de prueba.`,
  market: () => ({ listings, sources: [{ id: "demo", label: "Demo", fetchedAt: now - HOUR, error: "" }] }),
  market_search: ({ query }) => [listing(`skills.sh/${query}`, "skill", `Skill sobre ${query}`, "skillsSh")],
  market_detail: ({ id }) => ({
    listing: listings.find((one) => one.id === id) ?? listing(String(id), "skill", String(id), "skillsSh"),
    readme: "# Léeme\n\nUna ficha **de prueba** con una lista:\n\n- uno\n- dos",
    license: "MIT",
    files: [
      { path: "README.md", size: 1200 },
      { path: "skills/format/SKILL.md", size: 800 },
      { path: "hooks/format.sh", size: 90 },
    ],
    parts: {
      skills: [{ name: "format", path: "skills/format/SKILL.md", description: "" }],
      commands: [],
      agents: [],
      hooks: [{ event: "PostToolUse", command: "sh hooks/format.sh" }],
      servers: [],
      lsp: [],
      bin: [],
    },
    needs: [],
  }),
  market_file: ({ path }) => (String(path).endsWith(".md") ? `# ${path}\n\nContenido de prueba.` : "echo formatea"),
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
