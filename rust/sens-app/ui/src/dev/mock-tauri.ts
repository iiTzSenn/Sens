// Lets the shell run in a plain browser: `npm run dev -w sens-app-ui` and open
// the printed URL. vite.config.ts injects it only into the dev server, and
// inside Tauri the real IPC is already there, so it steps aside.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Capabilities, Found, News } from "../ipc/types";
import { lookOf } from "../shared/look";
import { store, stored } from "../shared/storage.js";

const now = Date.now();
const HOUR = 3_600_000;
const ROOT = "C:/Proyectos/demo";
const asking = new URLSearchParams(location.search);
const person = { name: "Demo", checkUpdates: false, welcomed: !asking.has("welcome"), seen: "" };
const LOOK = "sens.dev.look";
const asked = new URLSearchParams(location.search).get("look")?.split(".");
const kept = asked ? { mode: asked[0], accent: asked[1] } : stored(LOOK, null);
const DAY = 24 * HOUR;

const told: News[] = [
  {
    version: "0.0.0-dev",
    title: "Sens tells you what changed after it updates",
    notes: [
      "The first time Sens opens after an update, it shows what the new version brings, and once you close it, it stays closed.",
      "",
      "### New",
      "- **What changed, right after updating.** *Novedades* opens over the chat with the notes of the version you just installed, and of any you skipped on the way.",
      "- **Read them again whenever you like** from *Ajustes › General › Ver novedades*.",
      "",
      "### Fixed",
      "- **Opening the last project no longer covers a view already on screen.**",
    ].join("\n"),
    page: "https://github.com/iiTzSenn/Sens/releases",
    published: new Date(now).toISOString(),
  },
  {
    version: "0.19.2",
    title: "Sens keeps answering, and stopping a session stops what it started",
    notes: [
      "Sens keeps answering at the end of each turn, long chats stay fast, and stopping a session stops everything it started.",
      "",
      "### Fixed",
      "- **Stopping Claude Code stops what it started.** The MCP servers, dev servers and background tasks it launched now end with it.",
      "- **Long chats stay fast.** Each piece of a reply as it streams in redraws only that reply.",
      "- **Your conversations stay out of your project's git.** The `.sens` folder now ignores itself.",
    ].join("\n"),
    page: "https://github.com/iiTzSenn/Sens/releases/tag/v0.19.2",
    published: "2026-09-25T09:16:31Z",
  },
];

const found: Found = {
  claude: "C:/Users/demo/.claude",
  projects: [
    { root: "C:/Proyectos/tienda-web", name: "tienda-web", exists: true, sessions: 48, already: 2, last: now - 3 * HOUR, suggested: true },
    { root: "C:/Proyectos/api-pagos", name: "api-pagos", exists: true, sessions: 31, already: 0, last: now - DAY, suggested: true },
    { root: "C:/Proyectos/demo", name: "demo", exists: true, sessions: 0, already: 12, last: now - 2 * DAY, suggested: true },
    { root: "C:/Proyectos/juego-2d", name: "juego-2d", exists: true, sessions: 17, already: 0, last: now - 9 * DAY, suggested: true },
    { root: "C:/Users/demo/Downloads", name: "Downloads", exists: true, sessions: 3, already: 0, last: now - 20 * DAY, suggested: false },
    { root: "D:/viejo/prototipo", name: "prototipo", exists: false, sessions: 6, already: 0, last: now - 80 * DAY, suggested: false },
  ],
  skills: ["frontend-design", "gsap-core", "shadcn-ui", "web-design-guidelines"],
  servers: ["github"],
  plugins: ["superpowers@claude-plugins"],
  foreign: [
    { id: "claude-desktop:filesystem", source: "claude-desktop", app: "Claude Desktop", name: "filesystem", kind: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "C:/Proyectos"], url: "", envKeys: [], blocked: "" },
    { id: "cursor:linear", source: "cursor", app: "Cursor", name: "linear", kind: "http", command: "", args: [], url: "https://mcp.linear.app/mcp", envKeys: ["Authorization"], blocked: "" },
    { id: "vscode:postgres", source: "vscode", app: "VS Code", name: "postgres", kind: "stdio", command: "npx", args: ["-y", "mcp-postgres"], url: "", envKeys: ["PG_URL"], blocked: "usa variables ${input:…} de VS Code" },
    { id: "cursor:github", source: "cursor", app: "Cursor", name: "github", kind: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], url: "", envKeys: ["GITHUB_TOKEN"], blocked: "ya existe en Claude Code" },
  ],
};

const pause = (millis: number) => new Promise((done) => setTimeout(done, millis));

async function adopt(roots: string[]) {
  const chosen = found.projects.filter((one) => roots.includes(one.root));
  const total = chosen.reduce((sum, one) => sum + one.sessions, 0);
  for (let done = 0; done <= total; done += 6) {
    await emit("welcome", { done: Math.min(done, total), total });
    await pause(60);
  }
  return { sessions: total, projects: chosen.length, skipped: [] };
}
const trusted = new Set<string>();

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

const demoModel = (id: string, label: string, description: string, latest: boolean) => ({
  id,
  label,
  description,
  latest,
  efforts: ["low", "medium", "high"],
  effort: "medium",
  thinking: "toggle",
});

const SQUARE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#c7ff4a"/></svg>')}`;

const DIFF = [
  "diff --git a/src/app.js b/src/app.js",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a };",
  "diff --git a/old.txt b/new.txt",
  "rename from old.txt",
  "rename to new.txt",
].join("\n");

// A project with a bit of everything, to see the file icons.
const FOLDERS: Record<string, string[]> = {
  "": ["src/", "docs/", ".gitignore", "Dockerfile", "package.json", "README.md", "main.py", "Cargo.toml", "datos.csv", "logo.png", "notas.xyz", "setup.exe"],
  src: ["components/", "app.tsx", "index.ts", "types.d.ts", "lib.rs", "styles.css", "query.sql", "build.ps1"],
  "src/components": ["Button.tsx", "Button.test.tsx"],
  docs: ["guia.md", "api.yaml", "config.toml"],
};

// A few files with real code, to see the viewer color each language.
const SAMPLES: Record<string, string> = {
  "main.py": [
    "#!/usr/bin/env python3",
    '"""Saluda a quien se lo pida."""',
    "from dataclasses import dataclass",
    "",
    "",
    "@dataclass",
    "class Greeter:",
    '    name: str = "mundo"',
    "",
    "    def greet(self, times: int = 1) -> str:",
    "        # Una línea por vez",
    '        return "\\n".join(f"Hola, {self.name}!" for _ in range(times))',
    "",
    "",
    'if __name__ == "__main__":',
    "    print(Greeter().greet(2))",
  ].join("\n"),
  "src/app.tsx": [
    'import { useState } from "react";',
    'import { Button } from "./components/Button";',
    "",
    "interface Props {",
    "  title: string;",
    "  start?: number;",
    "}",
    "",
    "// El contador de la portada.",
    "export function App({ title, start = 0 }: Props) {",
    "  const [count, setCount] = useState(start);",
    "  return (",
    '    <main className="app">',
    "      <h1>{title}</h1>",
    "      <Button onClick={() => setCount(count + 1)}>Sumar {count}</Button>",
    "    </main>",
    "  );",
    "}",
  ].join("\n"),
  "src/lib.rs": [
    "use std::collections::HashMap;",
    "",
    "/// Cuenta las palabras de un texto.",
    "pub fn count(text: &str) -> HashMap<&str, usize> {",
    "    let mut seen = HashMap::new();",
    "    for word in text.split_whitespace() {",
    "        *seen.entry(word).or_insert(0) += 1;",
    "    }",
    "    seen",
    "}",
    "",
    "#[cfg(test)]",
    "mod tests {",
    "    #[test]",
    "    fn counts() {",
    '        assert_eq!(super::count("a b a")["a"], 2);',
    "    }",
    "}",
  ].join("\n"),
  "src/styles.css": [
    ":root { --accent: #c7ff4a; }",
    "",
    "/* La tarjeta */",
    ".card:hover > .title {",
    "  color: var(--accent);",
    "  padding: 4px 8px !important;",
    "}",
  ].join("\n"),
  "src/query.sql": [
    "-- Los proyectos más activos",
    "SELECT p.name, COUNT(*) AS turns",
    "FROM projects p",
    "JOIN turns t ON t.project_id = p.id",
    "WHERE t.at > now() - INTERVAL '7 days'",
    "GROUP BY p.name",
    "ORDER BY turns DESC",
    "LIMIT 10;",
  ].join("\n"),
  "src/build.ps1": [
    "param([switch]$Release)",
    "",
    "# Compila la app",
    '$mode = if ($Release) { "release" } else { "debug" }',
    'Write-Host "Compilando en $mode..."',
    "cargo build --profile $mode",
  ].join("\n"),
  Dockerfile: ["FROM node:22-alpine", "WORKDIR /app", "COPY package*.json ./", "RUN npm ci", "COPY . .", 'CMD ["npm", "start"]'].join("\n"),
  "package.json": ['{', '  "name": "demo",', '  "private": true,', '  "scripts": { "dev": "vite" },', '  "version": "1.0.0"', "}"].join("\n"),
  "Cargo.toml": ["[package]", 'name = "demo"', 'version = "0.1.0"', "edition = \"2024\"", "", "[dependencies]", 'serde = { version = "1", features = ["derive"] }'].join("\n"),
};

// A turn with code in its answer and an edit, to see the chat color them.
const FENCE = "```";
const agent = (event: Record<string, unknown>) => ({ kind: "agent", at: now - HOUR, event });
const REPLAY = [
  { kind: "task", text: "Añade un saludo configurable", files: [], images: [], at: now - HOUR },
  agent({ kind: "started", model: "demo-model" }),
  agent({
    kind: "tool",
    id: "t1",
    name: "Edit",
    input: { file_path: `${ROOT}/src/app.tsx`, old_string: "", new_string: "" },
  }),
  agent({
    kind: "toolDone",
    id: "t1",
    output: "",
    error: false,
    detail: {
      filePath: `${ROOT}/src/app.tsx`,
      structuredPatch: [
        {
          oldStart: 9,
          newStart: 9,
          lines: [
            " // El contador de la portada.",
            "-export function App({ title, start = 0 }: Props) {",
            '+export function App({ title, start = 0, greeting = "Hola" }: Props) {',
            "   const [count, setCount] = useState(start);",
          ],
        },
      ],
    },
  }),
  agent({
    kind: "said",
    text: [
      "Listo. Ahora `App` acepta un saludo:",
      "",
      FENCE + "tsx",
      '<App title="Sens" greeting="Buenas" />',
      FENCE,
      "",
      "Y desde la terminal:",
      "",
      FENCE + "console",
      "$ npm run dev -- --port 5173",
      FENCE,
    ].join("\n"),
  }),
  agent({ kind: "finished", millis: 4200, tokensOut: 812 }),
];

// Two projects whose sessions can be renamed, archived and deleted.
const SPACES = [
  {
    root: ROOT,
    name: "demo",
    activeAt: now - HOUR,
    sessions: [
      { id: "demo-1", title: "Migrar la interfaz a React", startedAt: now - HOUR, tasks: 3, archived: false },
      { id: "demo-2", title: "Revisar el catálogo", startedAt: now - 5 * HOUR, tasks: 1, archived: false },
      { id: "demo-3", title: "Probar el instalador", startedAt: now - 30 * HOUR, tasks: 2, archived: true },
    ],
  },
  {
    root: "C:/Proyectos/web",
    name: "web",
    activeAt: now - 48 * HOUR,
    sessions: [{ id: "web-1", title: "Arreglar el formulario de contacto", startedAt: now - 48 * HOUR, tasks: 4, archived: false }],
  },
];

const sessionOf = (id: unknown) => SPACES.flatMap((space) => space.sessions).find((one) => one.id === id)!;

const entries = (path: string) =>
  (FOLDERS[path] ?? []).map((name) => {
    const dir = name.endsWith("/");
    const bare = dir ? name.slice(0, -1) : name;
    return { name: bare, path: path ? `${path}/${bare}` : bare, dir, ignored: bare === "logo.png" };
  });

const fixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  last_project: () => ROOT,
  trust_project: ({ root, trusted: sure }) => void (sure ? trusted.add(String(root)) : trusted.delete(String(root))),
  project_trusted: ({ root }) => trusted.has(String(root)),
  folder: ({ path }) => entries(String(path ?? "")),
  find_files: ({ needle }) =>
    Object.keys(FOLDERS)
      .flatMap(entries)
      .filter((entry) => !entry.dir && entry.name.toLowerCase().includes(String(needle).toLowerCase())),
  changes: () => ({ diff: DIFF, fresh: ["notas/idea.md"] }),
  open_file: ({ path }) =>
    String(path).endsWith(".png")
      ? { kind: "picture", data: SQUARE, bytes: 2048 }
      : String(path).endsWith(".exe")
        ? { kind: "binary", bytes: 1_234_567 }
        : { kind: "text", text: SAMPLES[String(path)] ?? `# ${path}\n\nUna idea.\nOtra línea.` },
  task_output: () => "compilando…\nlisto en 3 s",
  artifacts: () => [
    artifact("image", "captura.png", 1),
    artifact("file", "plan.md", 3),
    artifact("file", "informe.html", 30, null),
    artifact("link", "docs", 50),
    artifact("file", "datos.xlsx", 80, null),
  ],
  artifact_data: () => SQUARE,
  // No page is drawn here, but the panel hears it load, as from the real one.
  browser_open: ({ url }) => {
    const at = String(url);
    setTimeout(() => emit("browser", { kind: "loading", url: at }), 50);
    setTimeout(() => {
      emit("browser", { kind: "loaded", url: at });
      emit("browser", { kind: "titled", title: `Página simulada · ${new URL(at).host}` });
      emit("browser", { kind: "said", level: "log", text: "El navegador de verdad solo existe dentro de la app." });
      emit("browser", { kind: "said", level: "error", text: "Uncaught ReferenceError: demo is not defined" });
    }, 400);
  },
  preview_url: ({ path }) => `http://127.0.0.1:4321/demo/${String(path).split("/").pop()}`,
  artifact_text: ({ path }) => `# ${String(path).split("/").pop()}\n\nTexto de prueba.`,
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
  workspaces: () => structuredClone(SPACES).map((space) => ({ ...space, trusted: trusted.has(space.root) })),
  rename_session: ({ id, title }) => (sessionOf(id).title = String(title)),
  archive_session: ({ id, archived }) => void (sessionOf(id).archived = Boolean(archived)),
  delete_session: ({ id }) => {
    for (const space of SPACES) space.sessions = space.sessions.filter((one) => one.id !== id);
  },
  title_session: () => null,
  replay: ({ id }) => (id === "demo-1" ? REPLAY : []),
  new_session_id: () => "demo-new",
  open_session: ({ id }) => id ?? "demo-new",
  chat_busy: () => false,
  chat_tasks: () => [],
  // A reply as the real one arrives: text in pieces, a command, the end.
  chat_send: ({ sessionId, message }) => {
    const session = String(sessionId);
    const said = `Recibido: «${(message as { text: string }).text}». Te cuento lo que he mirado:\n\n- El **árbol** del proyecto\n- Los ficheros \`src/app.tsx\` y \`main.py\`\n\n${FENCE}ts\nconst listo = true;\n${FENCE}\n\nListo.`;
    const thought = "Miro primero cómo está montado el proyecto y qué ficheros toca la petición.";
    const events: [number, unknown][] = [[80, { kind: "started", model: "demo-model" }]];
    for (let at = 0; at < thought.length; at += 6) events.push([120 + at * 30, { kind: "delta", thinking: true, text: thought.slice(at, at + 6) }]);
    const start = 200 + thought.length * 30;
    for (let at = 0; at < said.length; at += 9) events.push([start + at * 6, { kind: "delta", thinking: false, text: said.slice(at, at + 9) }]);
    const end = start + said.length * 6;
    const edit = { file_path: `${ROOT}/src/app.tsx`, old_string: "const listo = false;", new_string: "const listo = true;" };
    events.push(
      [end, { kind: "said", text: said }],
      [end + 100, { kind: "tool", id: "run-1", name: "Bash", input: { command: "npm test" } }],
      [end + 2500, { kind: "toolDone", id: "run-1", output: "", error: false, detail: { stdout: "✓ 12 tests", stderr: "" } }],
      [end + 2600, { kind: "tool", id: "edit-1", name: "Edit", input: edit }],
      [end + 3000, { kind: "toolDone", id: "edit-1", output: "", error: false, detail: null }],
      [end + 3100, { kind: "finished", ok: true, stopped: false, millis: 2400, turns: 1, tokensIn: 10, tokensOut: 180, error: "" }],
    );
    for (const [after, event] of events) setTimeout(() => emit("chat", { session, event }), after);
  },
  providers: () => [{ id: "claude", vendor: "Anthropic", label: "Claude Code" }],
  models: () =>
    new Promise((done) =>
      setTimeout(
        () =>
          done([
            demoModel("claude-opus-5-5[1m]", "Opus 5.5 (1M)", "Opus 5.5 with 1M context · Best for everyday, complex tasks", true),
            demoModel("claude-sonnet-5", "Sonnet 5", "Sonnet 5 · Efficient for routine tasks", true),
            demoModel("claude-opus-5", "Opus 5", "", false),
            demoModel("claude-opus-4-8", "Opus 4.8", "", false),
          ]),
        1500,
      ),
    ),
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
  set_welcomed: ({ on }) => void (person.welcomed = Boolean(on)),
  look: () => lookOf(stored(LOOK, kept)),
  set_look: ({ look }) => store(LOOK, look),
  welcome_scan: () => pause(1400).then(() => found),
  welcome_adopt: ({ roots }) => adopt(roots as string[]),
  welcome_servers: ({ ids }) => pause(500).then(() => ({ added: (ids as string[]).map((id) => id.split(":")[1]), skipped: [] })),
  save_profile: ({ name }) => void (person.name = String(name).trim()),
  set_update_check: ({ on }) => void (person.checkUpdates = Boolean(on)),
  update_check: () => ({ latest: null, installable: false }),
  news: () => pause(600).then(() => told),
  saw_news: () => void (person.seen = "0.0.0-dev"),
  "plugin:app|version": () => "0.0.0-dev",
  "plugin:window|is_maximized": () => false,
};

if (!("__TAURI_INTERNALS__" in window)) {
  window.__SENS_LOOK__ = kept;
  window.__SENS_WELCOMED__ = person.welcomed;
  window.__SENS_NEWS__ = asking.has("news");
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
