// Lets the shell run in a plain browser: `npm run dev -w sens-app-ui` and open
// the printed URL. vite.config.ts injects it only into the dev server, and
// inside Tauri the real IPC is already there, so it steps aside.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Capabilities, Found, News } from "../ipc/types";
import { store, stored } from "../shared/storage.js";

const now = Date.now();
const HOUR = 3_600_000;
const ROOT = "C:/Proyectos/demo";
const asking = new URLSearchParams(location.search);
const person = { name: "Demo", checkUpdates: false, welcomed: !asking.has("welcome"), seen: "", notify: true };
const LOOK = "sens.dev.look";
const asked = new URLSearchParams(location.search).get("look")?.split(".");
const kept = asked ? { mode: asked[0], accent: asked[1] } : stored(LOOK, null);
const LANGUAGE = "sens.dev.language";
const spoken = asking.get("language") ?? stored(LANGUAGE, null);
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

const shells = new Map<number, { root: string; line: string }>();
let shellsMade = 0;
const promptOf = (root: string) => `PS ${(root || "C:/Users/demo").replaceAll("/", "\\")}> `;
const said = (id: number, data: string) => emit("terminal", { kind: "out", id, data });

function openShell(root: string) {
  const id = ++shellsMade;
  shells.set(id, { root, line: "" });
  setTimeout(() => said(id, `Terminal simulada: la de verdad solo existe dentro de la app.\r\n\r\n${promptOf(root)}`), 60);
  return { id, shell: "pwsh" };
}

function endShell(id: number, code: number) {
  if (!shells.delete(id)) return;
  setTimeout(() => emit("terminal", { kind: "ended", id, code }), 30);
}

function typeInShell(id: number, data: string) {
  const one = shells.get(id);
  if (!one) throw "esa terminal ya se cerró";
  for (const key of data) {
    if (key === "\r") {
      const line = one.line.trim();
      one.line = "";
      if (line === "exit") return endShell(id, 0);
      said(id, `\r\n${line ? `\x1b[31m${line}: no existe en la terminal simulada.\x1b[0m\r\n` : ""}${promptOf(one.root)}`);
    } else if (key === "\x7f") {
      if (!one.line) continue;
      one.line = one.line.slice(0, -1);
      said(id, "\b \b");
    } else if (key >= " ") {
      one.line += key;
      said(id, key);
    }
  }
}

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
  name: id.split(/[:/]/).pop(),
  title,
  description: `${title}, de prueba`,
  author: "",
  badge,
  source: "demo",
  category: "",
  version: "1.0.0",
  homepage: "",
  installs: null,
  login: false,
  tools: [],
  installable: true,
  revision: "r1",
  ...extra,
});

const about = (description: string, extra: object = {}) => ({ description, ...extra });
const toolsOf = (count: number) => Array.from({ length: count }, (_, at) => `tool_${at + 1}`);
const OWN = { author: "Anthropic", source: "official", homepage: "https://github.com/anthropics/claude-plugins-official" };

const listings = [
  listing("demo/formatter", "plugin", "Formatter", "anthropic", about("Formats code on save with the project's own style.", { ...OWN, revision: "r2" })),
  listing("official:code-review", "plugin", "Code review", "anthropic", about("Automated code review for pull requests using several specialised agents with confidence-based scoring.", { ...OWN, category: "development" })),
  listing("official:feature-dev", "plugin", "Feature development", "anthropic", about("A feature workflow with agents for codebase exploration, architecture design and quality review.", { ...OWN, category: "development" })),
  listing("official:frontend-design", "plugin", "Frontend design", "anthropic", about("Create distinctive, production-grade frontend interfaces with high design quality.", { ...OWN, category: "design" })),
  listing("official:security-guidance", "plugin", "Security guidance", "anthropic", about("Security review for generated code: pattern-based warnings on every edit.", { ...OWN, category: "security" })),
  listing("official:pr-review-toolkit", "plugin", "PR review toolkit", "anthropic", about("Review agents for comments, tests, error handling and type design.", { ...OWN, category: "development" })),
  listing("official:commit-commands", "plugin", "Commit commands", "anthropic", about("Commands for git commit workflows: commit, push and pull request creation.", { ...OWN, category: "development" })),
  listing("official:typescript-lsp", "plugin", "typescript-lsp", "anthropic", about("TypeScript and JavaScript language server for code intelligence.", { ...OWN, category: "development" })),
  listing("skills:webapp-testing", "skill", "webapp-testing", "anthropic", about("Toolkit for interacting with and testing local web applications using Playwright.", { author: "Anthropic", source: "skills", homepage: "https://github.com/anthropics/skills" })),
  listing("skills:mcp-builder", "skill", "mcp-builder", "anthropic", about("Guide for creating high-quality MCP servers that let an LLM use outside services.", { author: "Anthropic", source: "skills", homepage: "https://github.com/anthropics/skills" })),
  listing("skills:canvas-design", "skill", "canvas-design", "anthropic", about("Create visual art in .png and .pdf documents from a design philosophy.", { author: "Anthropic", source: "skills", homepage: "https://github.com/anthropics/skills" })),
  listing("official:stripe", "plugin", "Stripe", "partner", about("Payments, subscriptions and invoices through the Stripe API.", { author: "Stripe", source: "official", homepage: "https://github.com/stripe/agent-toolkit" })),
  listing("official:supabase", "plugin", "Supabase", "partner", about("Manage Postgres databases, auth and storage in your Supabase projects.", { source: "official", category: "database", homepage: "https://supabase.com/docs" })),
  listing("official:vercel", "plugin", "Vercel", "partner", about("Deploy projects and read build logs on Vercel.", { source: "official", category: "deployment", homepage: "https://vercel.com/docs" })),
  listing("official:sentry", "plugin", "Sentry", "partner", about("Find and fix errors with the issue context Sentry keeps.", { author: "Sentry", source: "official", category: "monitoring", homepage: "https://sentry.io" })),
  listing("official:figma", "plugin", "Figma", "partner", about("Turn Figma designs into code with frames, variables and components.", { source: "official", category: "design", homepage: "https://www.figma.com" })),
  listing("official:semgrep", "plugin", "Semgrep", "partner", about("Static analysis that finds security bugs before they ship.", { source: "official", category: "security", homepage: "https://semgrep.dev" })),
  listing("official:notion", "plugin", "Notion", "partner", about("Search and update pages and databases in Notion.", { source: "official", category: "productivity", homepage: "https://github.com/makenotion/notion-mcp-server" })),
  listing("official:slack", "plugin", "Slack", "partner", about("Read channels and send messages in Slack.", { source: "official", category: "productivity", homepage: "https://slack.com" })),
  listing("official:hubspot", "plugin", "HubSpot Sales", "partner", about("Contacts, deals and sales pipelines in HubSpot CRM.", { author: "HubSpot", source: "official", homepage: "https://www.hubspot.com" })),
  listing("connectors:com.microsoft/microsoft-learn-mcp", "connector", "Microsoft Learn", "partner", about("Search official Microsoft documentation.", { source: "connectors", author: "learn.microsoft.com", homepage: "https://learn.microsoft.com", tools: toolsOf(3) })),
  listing("connectors:io.github.antonpk1/excalidraw-mcp-app", "connector", "Excalidraw", "partner", about("Draw hand-drawn diagrams and whiteboards.", { source: "connectors", homepage: "https://excalidraw.com", tools: toolsOf(5) })),
  listing("connectors:com.mermaidchart/mermaid-mcp", "connector", "Mermaid Chart", "partner", about("Validate and render Mermaid diagrams.", { source: "connectors", author: "mermaid.ai", homepage: "https://docs.mermaidchart.com", tools: toolsOf(1) })),
  listing("connectors:com.tldraw/tldraw", "connector", "tldraw", "partner", about("Sketch ideas on an infinite canvas.", { source: "connectors", homepage: "https://tldraw.com", tools: toolsOf(6) })),
  listing("connectors:com.wolfram/wolfram", "connector", "Wolfram", "partner", about("Precise, real-time computation and knowledge.", { source: "connectors", homepage: "https://www.wolfram.com", tools: toolsOf(1) })),
  listing("connectors:com.claude.mcp.pubmed/pubmed", "connector", "PubMed", "partner", about("Search the biomedical literature in PubMed.", { source: "connectors", author: "pubmed.mcp.claude.com", homepage: "https://pubmed.ncbi.nlm.nih.gov", tools: toolsOf(7) })),
  listing("connectors:app.linear/linear", "connector", "Linear", "partner", about("Manage issues, projects and team workflows.", { source: "connectors", author: "mcp.linear.app", homepage: "https://linear.app", tools: toolsOf(22), login: true, installable: false })),
  listing("connectors:com.notion/notion", "connector", "Notion", "partner", about("Search and edit pages in your Notion workspace.", { source: "connectors", author: "mcp.notion.com", homepage: "https://developers.notion.com", tools: toolsOf(13), login: true, installable: false })),
  listing("connectors:com.booking/booking", "connector", "Booking.com", "partner", about("Find hotels, homes and more.", { source: "connectors", author: "mcp.booking.com", homepage: "https://www.booking.com", tools: toolsOf(1) })),
  listing("community:statusline", "plugin", "statusline", "community", about("Themeable status line for Claude Code: project, git branch, context usage and rate limits.", { source: "community", homepage: "https://github.com/someone/statusline" })),
  listing("community:memory-bank", "plugin", "memory-bank", "community", about("Persistent memory for agents across sessions, kept as local Markdown.", { source: "community" })),
  listing("community:daily-journal", "plugin", "daily-journal", "community", about("Conversational daily journaling for Obsidian vaults.", { source: "community" })),
  listing("community:ledger", "plugin", "ledger", "community", about("Accounting helpers: invoices, expenses and bookkeeping exports.", { source: "community" })),
  listing("community:k8s-helper", "plugin", "k8s-helper", "community", about("Kubernetes and Docker helpers to deploy and debug clusters.", { source: "community" })),
  listing("community:local-seo-audit", "plugin", "local-seo-audit", "community", about("Local business SEO audit: technical SEO, content strategy and rankings.", { source: "community", homepage: "https://myceliumai.co" })),
  listing("community:flashcards", "plugin", "flashcards", "community", about("Turn notes into flashcards and quiz yourself while you study.", { source: "community" })),
  listing("community:trip-planner", "plugin", "trip-planner", "community", about("Plan trips with flights, hotels and restaurants.", { source: "community" })),
  listing("community:bio-research", "plugin", "bio-research", "community", about("Genomics and protein analysis for life sciences research.", { source: "community" })),
  listing("community:dataink", "plugin", "dataink", "community", about("Data visualisation and dashboards that follow Tufte's principles.", { source: "community" })),
  listing("community:i-ching", "plugin", "i-ching", "community", about("I Ching divination with the three coins method.", { source: "community" })),
];

const noParts = { skills: [], commands: [], agents: [], hooks: [], servers: [], lsp: [], bin: [] };

function installFrom({ root, id }: Record<string, unknown>) {
  const found = listings.find((one) => one.id === id);
  if (!found) throw `no encuentro ${id} en el catálogo`;
  const name = String(found.name);
  const enabled = Boolean(root);
  if (found.kind === "connector") caps.servers.push({ name, command: "", args: [], envKeys: [], kind: "http", url: `https://${found.author || "mcp.example.com"}/mcp`, enabled });
  else if (found.kind === "skill") caps.skills.push({ name, description: found.description, enabled });
  else caps.plugins.push({ name, description: found.description, version: found.version, enabled });
  const kind = found.kind === "connector" ? "server" : found.kind;
  caps.origins[`${kind}:${name}`] = { listing: found.id, revision: found.revision, version: found.version, installedAt: Date.now() };
  return name;
}

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
  { kind: "task", text: "Añade un saludo configurable", files: ["src/app.tsx", ".sens/artifacts/demo-1/pasted-text.txt", "docs/"], images: [], at: now - HOUR },
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
  agent({ kind: "finished", millis: 4200, tokensOut: 812, context: 148_300, window: 200_000 }),
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

function planLimits() {
  const sunday = new Date();
  sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7 || 7));
  sunday.setHours(7, 0, 0, 0);
  const week = Math.round(sunday.getTime() / 1000);
  const hours = Math.round((Date.now() + 4 * HOUR + 38 * 60_000) / 1000);
  return {
    kind: "limits",
    status: "allowed_warning",
    window: "seven_day",
    utilization: 0.8,
    resetsAt: week,
    threshold: 0.75,
    overage: { status: "", using: false, resetsAt: null, disabled: "" },
    windows: { five_hour: { utilization: 0.03, resetsAt: hours }, seven_day: { utilization: 0.8, resetsAt: week }, seven_day_fable: { utilization: 0.19, resetsAt: week } },
  };
}

const fixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  last_project: () => ROOT,
  trust_project: ({ root, trusted: sure }) => void (sure ? trusted.add(String(root)) : trusted.delete(String(root))),
  project_trusted: ({ root }) => trusted.has(String(root)),
  repo: ({ root }) => ({ branch: String(root).includes("/.sens/worktrees/") ? `sens/${String(root).split("/").pop()}` : "main", detached: false, dirty: 0, branches: ["main", "feat/ui"] }),
  isolate_session: ({ id }) => {
    const short = String(id).replace(/[^0-9a-f]/gi, "").slice(0, 8) || "demo0001";
    return { path: `${ROOT}/.sens/worktrees/${short}`, branch: `sens/${short}`, base: "main" };
  },
  chat_warm: () => [
    { name: "compact", description: "Clear conversation history but keep a summary in context", hint: "<optional custom summarization instructions>" },
    { name: "context", description: "Show current context usage", hint: "" },
    { name: "init", description: "Initialize a new CLAUDE.md file with codebase documentation", hint: "" },
    { name: "review", description: "Review a pull request", hint: "[pr]" },
    { name: "frontend-design", description: "Create distinctive, production-grade frontend interfaces (user)", hint: "" },
  ],
  folder: ({ path }) => entries(String(path ?? "")),
  find_files: ({ needle }) =>
    Object.keys(FOLDERS)
      .flatMap(entries)
      .filter((entry) => !entry.dir && entry.name.toLowerCase().includes(String(needle).toLowerCase())),
  changes: () => ({ diff: DIFF, fresh: ["notas/idea.md"] }),
  attach: ({ paths }) => ({
    items: (paths as string[]).map((path) => {
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      if (/[\\/]$/.test(path) || !name.includes(".")) return { kind: "folder", path: `${path.replace(/[\\/]+$/, "")}/`, name, entries: 12, outside: false };
      if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name)) return { kind: "picture", path, name, mediaType: "image/svg+xml", data: btoa(decodeURIComponent(SQUARE.slice(SQUARE.indexOf(",") + 1))), bytes: 180, outside: false };
      return { kind: "file", path, name, bytes: 18_432, outside: /^([a-z]:)?[\\/]/i.test(path) };
    }),
    refused: [],
  }),
  stage_file: ({ name, data }) => ({ kind: "file", path: `C:/Users/demo/AppData/Roaming/sens/staged/${Date.now()}-0/${name}`, name, bytes: Math.floor((String(data).length * 3) / 4), outside: true }),
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
  terminal_open: ({ root }) => openShell(String(root ?? "")),
  terminal_write: ({ id, data }) => typeInShell(Number(id), String(data)),
  terminal_close: ({ id }) => endShell(Number(id), 1),
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
  market: () => ({
    listings,
    sources: [
      { id: "official", fetchedAt: now - HOUR, error: "" },
      { id: "community", fetchedAt: now - HOUR, error: "" },
      { id: "connectors", fetchedAt: now - HOUR, error: "" },
    ],
  }),
  market_search: ({ query }) =>
    [["vercel-labs/agent-skills", 48210], ["anthropics-community/skills", 3120], ["someone/tools", 87]].map(([repo, installs]) =>
      listing(`skills.sh:${repo}/${query}-helper`, "skill", `${query}-helper`, "skillsSh", { author: String(repo).split("/")[0], category: repo, installs, homepage: `https://skills.sh/${repo}` }),
    ),
  market_detail: ({ id }) => {
    const found = listings.find((one) => one.id === id) ?? listing(String(id), "skill", String(id).split("/").pop()!, "skillsSh", { description: "" });
    if (found.kind === "connector") return { listing: found, readme: found.description, license: "", files: [], parts: noParts, needs: [] };
    const runs = found.id === "demo/formatter" || found.id === "official:security-guidance";
    return {
      listing: found,
      readme: `# ${found.title}\n\n${found.description}\n\n## Qué incluye\n\n- Una skill con instrucciones\n- Un comando para lanzarla`,
      license: "MIT",
      files: [
        { path: "README.md", size: 1200 },
        { path: "skills/main/SKILL.md", size: 800 },
        ...(runs ? [{ path: "hooks/check.sh", size: 90 }] : []),
      ],
      parts: { ...noParts, skills: [{ name: "main", path: "skills/main/SKILL.md", description: "" }], hooks: runs ? [{ event: "PostToolUse", command: "sh hooks/check.sh" }] : [] },
      needs: found.id === "official:stripe" ? [{ name: "STRIPE_SECRET_KEY", description: "Clave secreta de la API", secret: true, required: true, default: "" }] : [],
    };
  },
  market_install: installFrom,
  market_update: ({ id }) => {
    const found = listings.find((one) => one.id === id);
    const origin = Object.values(caps.origins).find((one) => one.listing === id);
    if (found && origin) Object.assign(origin, { revision: found.revision, installedAt: Date.now() });
    return null;
  },
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
    if ((message as { text: string }).text.startsWith("/compact")) {
      setTimeout(() => emit("chat", { session, event: { kind: "started", model: "demo-model" } }), 80);
      setTimeout(() => emit("chat", { session, event: { kind: "compacted", before: 148_300, auto: false } }), 900);
      setTimeout(() => emit("chat", { session, event: { kind: "finished", ok: true, stopped: false, millis: 900, turns: 1, tokensIn: 0, tokensOut: 0, context: 0, window: 200_000, error: "" } }), 1000);
      return;
    }
    const said = `Recibido: «${(message as { text: string }).text}». Te cuento lo que he mirado:\n\n- El **árbol** del proyecto\n- Los ficheros \`src/app.tsx\` y \`main.py\`\n\n${FENCE}ts\nconst listo = true;\n${FENCE}\n\nListo.`;
    const thoughts = [
      "**Leyendo cómo está montado el proyecto**\n\nMiro primero el árbol y qué ficheros toca la petición.",
      "**Comprobando los tests**\n\nAntes de tocar nada, confirmo que la suite pasa.",
      "**Aplicando el cambio**\n\nEl cambio es pequeño: una constante en `src/app.tsx`.",
    ];
    const edit = { file_path: `${ROOT}/src/app.tsx`, old_string: "const listo = false;", new_string: "const listo = true;" };
    const ansi = "\u001b[1m\u001b[32m ✓\u001b[0m src/app.test.tsx \u001b[2m(12 tests)\u001b[0m\n\u001b[33mwarning:\u001b[0m unused import in src/main.tsx:3\n\n\u001b[1m Test Files \u001b[0m \u001b[1m\u001b[32m1 passed\u001b[0m\n\u001b[1m      Tests \u001b[0m \u001b[1m\u001b[32m12 passed\u001b[0m";
    const work: [number, unknown][] = [
      [0, { kind: "tool", id: "read-1", name: "Read", input: { file_path: `${ROOT}/src/app.tsx` } }],
      [300, { kind: "toolDone", id: "read-1", output: "", error: false, detail: { file: { numLines: 42 } } }],
      [400, { kind: "tool", id: "grep-1", name: "Grep", input: { pattern: "listo", path: `${ROOT}/src` } }],
      [700, { kind: "toolDone", id: "grep-1", output: "src/app.tsx:3:const listo = false;", error: false, detail: null }],
      [800, "thought-1"],
      [1500, { kind: "tool", id: "run-1", name: "Bash", input: { command: "npm test -- --reporter=dot 2>&1 | tee test.log" } }],
      [2600, { kind: "toolDone", id: "run-1", output: "", error: false, detail: { stdout: ansi, stderr: "" } }],
      [2700, { kind: "tool", id: "ps-1", name: "PowerShell", input: { command: "Get-ChildItem -Path src -Filter *.tsx | Select-Object Name, Length" } }],
      [3200, { kind: "toolDone", id: "ps-1", output: "", error: true, detail: { stdout: "", stderr: "Get-ChildItem : Cannot find path 'C:\\Proyectos\\demo\\src' because it does not exist." } }],
      [3300, "thought-2"],
      [4000, { kind: "tool", id: "edit-1", name: "Edit", input: edit }],
      [4400, { kind: "toolDone", id: "edit-1", output: "", error: false, detail: null }],
    ];
    const events: [number, unknown][] = [[80, { kind: "started", model: "demo-model" }], [120, planLimits()]];
    let clock = 120;
    const think = (text: string) => {
      for (let at = 0; at < text.length; at += 6) events.push([clock + (at / 6) * 40, { kind: "delta", thinking: true, text: text.slice(at, at + 6) }]);
      clock += (text.length / 6) * 40 + 60;
      events.push([clock, { kind: "thought", text }]);
      clock += 60;
    };
    think(thoughts[0]);
    const began = clock;
    for (const [after, event] of work) {
      if (event === "thought-1" || event === "thought-2") {
        clock = Math.max(clock, began + after);
        think(thoughts[event === "thought-1" ? 1 : 2]);
        continue;
      }
      clock = Math.max(clock, began + after);
      events.push([clock, event]);
    }
    const start = clock + 200;
    for (let at = 0; at < said.length; at += 9) events.push([start + at * 6, { kind: "delta", thinking: false, text: said.slice(at, at + 9) }]);
    const end = start + said.length * 6;
    events.push(
      [end, { kind: "said", text: said }],
      [end + 100, { kind: "finished", ok: true, stopped: false, millis: end, turns: 1, tokensIn: 10, tokensOut: 180, context: 31_400, window: 200_000, error: "" }],
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
  set_look: ({ look }) => store(LOOK, look),
  set_language: ({ language }) => store(LANGUAGE, language),
  welcome_scan: () => pause(1400).then(() => found),
  welcome_adopt: ({ roots }) => adopt(roots as string[]),
  welcome_servers: ({ ids }) => pause(500).then(() => ({ added: (ids as string[]).map((id) => id.split(":")[1]), skipped: [] })),
  save_profile: ({ name }) => void (person.name = String(name).trim()),
  set_update_check: ({ on }) => void (person.checkUpdates = Boolean(on)),
  set_notify: ({ on }) => void (person.notify = Boolean(on)),
  notify: ({ title, body }) => console.info(`[aviso] ${title}: ${body}`),
  update_check: () => ({ latest: null, installable: false }),
  news: () => pause(600).then(() => told),
  saw_news: () => void (person.seen = "0.0.0-dev"),
  "plugin:app|version": () => "0.0.0-dev",
  "plugin:window|is_maximized": () => false,
};

if (!("__TAURI_INTERNALS__" in window)) {
  window.__SENS_LOOK__ = kept;
  window.__SENS_LANGUAGE__ = spoken;
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
