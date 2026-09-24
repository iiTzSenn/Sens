import type { CapabilityKind } from "../../ipc/commands";
import type { Capabilities, Detail, Listing, Plugin, Provenance, Server, Skill } from "../../ipc/types";
import { ICONS } from "../../shared/icons.js";
import { plain } from "../market/search.js";

export const FRONT_MATTER = /^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type List = "plugins" | "skills" | "servers";
export type Item = Skill | Plugin | Server;

export interface Spec {
  list: List;
  label: string;
  icon: string;
  origin: CapabilityKind;
  words: (item: Item) => unknown[];
  detail: (item: Item) => string;
  mono?: boolean;
  // A skill opens its SKILL.md in the file panel.
  readable?: boolean;
  gone: string;
}

export interface Entry {
  spec: Spec;
  item: Item;
}

const commandLine = (server: Server) => [server.command, ...server.args].join(" ");
export const launchLine = (server: Server) => server.url || commandLine(server);

// In this order on screen: plugins, skills, then MCP servers.
export const CAP_KINDS: Record<List, Spec> = {
  plugins: {
    list: "plugins",
    label: "Plugin",
    icon: ICONS.package,
    origin: "plugin",
    words: (item) => [item.name, (item as Plugin).description],
    detail: (item) => {
      const plugin = item as Plugin;
      return [plugin.description, plugin.version && `v${plugin.version}`].filter(Boolean).join(" · ");
    },
    gone: "Se borra su carpeta y las variables que guardaste para él.",
  },
  skills: {
    list: "skills",
    label: "Skill",
    icon: ICONS.book,
    origin: "skill",
    words: (item) => [item.name, (item as Skill).description],
    detail: (item) => (item as Skill).description,
    readable: true,
    gone: "Se borra su carpeta con todo lo que contiene.",
  },
  servers: {
    list: "servers",
    label: "MCP",
    icon: ICONS.plug,
    origin: "server",
    words: (item) => [item.name, launchLine(item as Server)],
    detail: (item) => {
      const server = item as Server;
      return [launchLine(server), server.envKeys.join(", ")].filter(Boolean).join(" · ");
    },
    mono: true,
    gone: "Se borra su configuración, variables de entorno incluidas.",
  },
};

const SPEC_OF: Record<CapabilityKind, Spec> = Object.fromEntries(
  Object.values(CAP_KINDS).map((spec) => [spec.origin, spec]),
) as Record<CapabilityKind, Spec>;

export type CapTab = "all" | "plugins" | "skills" | "servers" | "active";
export type AddAction = "menu" | "explore" | "server";

export const CAP_TABS: Record<CapTab, { label: string; keeps: (entry: Entry) => boolean; empty: [string, string]; add: AddAction }> = {
  all: {
    label: "Todas",
    keeps: () => true,
    empty: ["No hay capacidades", "Explora el mercado, o crea o importa una skill, o añade un servidor MCP."],
    add: "menu",
  },
  plugins: {
    label: "Plugins",
    keeps: ({ spec }) => spec === CAP_KINDS.plugins,
    empty: ["No hay plugins", "Explora el mercado para instalar uno."],
    add: "explore",
  },
  skills: {
    label: "Skills",
    keeps: ({ spec }) => spec === CAP_KINDS.skills,
    empty: ["No hay skills", "Añade una skill para darle instrucciones reutilizables al agente."],
    add: "menu",
  },
  servers: {
    label: "MCP",
    keeps: ({ spec }) => spec === CAP_KINDS.servers,
    empty: ["No hay servidores MCP", "Añade un servidor MCP para darle herramientas nuevas al agente."],
    add: "server",
  },
  active: {
    label: "Activas",
    keeps: ({ item }) => item.enabled,
    empty: ["Nada activo en este proyecto", "Activa una skill, un plugin o un servidor desde su tarjeta."],
    add: "menu",
  },
};

export const CAP_TAB_IDS = Object.keys(CAP_TABS) as CapTab[];
export const CAP_TAB_LIST = CAP_TAB_IDS.map((id): [CapTab, string] => [id, CAP_TABS[id].label]);

export const NO_CAPS: Capabilities = { skills: [], servers: [], plugins: [], origins: {} };

export const entriesOf = (caps: Capabilities): Entry[] =>
  Object.values(CAP_KINDS).flatMap((spec) => (caps[spec.list] as Item[]).map((item) => ({ spec, item })));

export const matching = (needle: string) => ({ spec, item }: Entry) =>
  plain(spec.words(item).filter(Boolean).join("\n")).includes(needle);

const activeCount = (list: Item[]) => list.filter((item) => item.enabled).length;

export function tallyOf(caps: Capabilities) {
  const [skills, servers, plugins] = [caps.skills, caps.servers, caps.plugins].map(activeCount);
  const parts = [
    plugins && `${plugins} ${plugins === 1 ? "plugin" : "plugins"}`,
    skills && `${skills} ${skills === 1 ? "skill" : "skills"}`,
    servers && `${servers} MCP`,
  ].filter(Boolean);
  if (!parts.length) return "Nada activo en este proyecto";
  const one = skills + servers + plugins === 1;
  const said = servers || plugins ? (one ? "activo" : "activos") : one ? "activa" : "activas";
  const listed = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
  return `${listed} ${said} en este proyecto`;
}

export const listed = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

// KEY=value, one per line. The message is what the form shows.
export function envOf(text: string) {
  const env = new Map<string, string>();
  text.split(/\r?\n/).forEach((line, at) => {
    if (!line.trim()) return;
    const cut = line.indexOf("=");
    const key = line.slice(0, Math.max(cut, 0)).trim();
    if (!ENV_KEY.test(key)) throw `Variables de entorno, línea ${at + 1}: escribe CLAVE=valor.`;
    if (env.has(key)) throw `Variables de entorno: ${key} está repetida.`;
    env.set(key, line.slice(cut + 1).trim());
  });
  return Object.fromEntries(env);
}

export type Origin = Provenance & { kind: CapabilityKind; name: string };

// What the market installed from this listing, if anything.
export function originFor(caps: Capabilities, listingId: string): Origin | null {
  const found = Object.entries(caps.origins || {}).find(([, origin]) => origin.listing === listingId);
  if (!found) return null;
  const [key, origin] = found;
  const cut = key.indexOf(":");
  return { kind: key.slice(0, cut) as CapabilityKind, name: key.slice(cut + 1), ...origin };
}

export const specOf = (origin: Origin) => SPEC_OF[origin.kind];

export const installedItem = (caps: Capabilities, origin: Origin) =>
  (caps[specOf(origin).list] as Item[]).find((item) => item.name === origin.name) || null;

export const firstLine = (text: string) =>
  (text || "")
    .replace(FRONT_MATTER, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean) || "";

// What a plugin runs on this machine, asked before installing it.
export function runsOf(detail: Detail): [string, string][] {
  const { hooks, servers, bin } = detail.parts;
  return [
    ...hooks.map((hook): [string, string] => [`Hook · ${hook.event}`, hook.command]),
    ...servers.map((server): [string, string] => [`MCP · ${server.name}`, server.launch]),
    ...bin.map((path): [string, string] => ["Ejecutable", path]),
  ];
}

export const MARKET_PAGE = 60;
export const FILE_ROWS = 300;

export type KindFilter = "all" | Listing["kind"];
export type SourceFilter = "all" | "anthropic" | "community" | "skillsSh";

export const BADGES: Record<Listing["badge"], string> = {
  anthropic: "Anthropic",
  partner: "Oficial",
  community: "Comunidad",
  skillsSh: "skills.sh",
};
export const KIND_NAMES: Record<Listing["kind"], string> = { plugin: "Plugin", skill: "Skill", connector: "Conector" };
export const KIND_ICONS: Record<Listing["kind"], string> = { plugin: ICONS.package, skill: ICONS.book, connector: ICONS.plug };

export const KIND_CHIPS: [KindFilter, string][] = [
  ["all", "Todo"],
  ["plugin", "Plugins"],
  ["skill", "Skills"],
  ["connector", "Conectores"],
];

export const SOURCE_CHIPS: [SourceFilter, string][] = [
  ["all", "Todas"],
  ["anthropic", "Anthropic"],
  ["community", "Comunidad"],
  ["skillsSh", "skills.sh"],
];

export const SOURCE_GROUPS: Record<SourceFilter, (listing: Pick<Listing, "badge">) => boolean> = {
  all: () => true,
  anthropic: (listing) => listing.badge === "anthropic" || listing.badge === "partner",
  community: (listing) => listing.badge === "community",
  skillsSh: (listing) => listing.badge === "skillsSh",
};

// skills.sh only has skills, so it is only searched when they can show up.
export const searchesSkillsSh = (kind: KindFilter, source: SourceFilter) =>
  SOURCE_GROUPS[source]({ badge: "skillsSh" }) && (kind === "all" || kind === "skill");

// The catalogue plus the skills.sh hits it does not already list, filtered and,
// when there is a search, ranked.
export function exploreList(
  listings: Listing[],
  hits: Listing[],
  query: string,
  kind: KindFilter,
  source: SourceFilter,
  rank: (list: Listing[], needle: string) => Listing[],
) {
  const needle = plain(query.trim());
  const known = new Set(listings.map((listing) => listing.id));
  const pool = [...listings, ...(needle ? hits.filter((hit) => !known.has(hit.id)) : [])];
  const kept = pool.filter((listing) => (kind === "all" || listing.kind === kind) && SOURCE_GROUPS[source](listing));
  return { needle, found: needle ? rank(kept, needle) : kept };
}

export type DetailTab = "summary" | "contents" | "runs";

export const DETAIL_TABS: [DetailTab, string][] = [
  ["summary", "Resumen"],
  ["contents", "Contenido"],
  ["runs", "Qué ejecuta"],
];
