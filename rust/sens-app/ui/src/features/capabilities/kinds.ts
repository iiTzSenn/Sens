import type { CapabilityKind } from "../../ipc/commands";
import type { Capabilities, Detail, Listing, Plugin, Provenance, Server, Skill } from "../../ipc/types";
import { FRONT_MATTER } from "../../shared/format.js";
import { ICONS } from "../../shared/icons.js";
import { plain } from "../market/search.js";
import { t } from "./copy";
import { ordered } from "./picks";
import { sectionOf, type SectionId } from "./sections";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type List = "plugins" | "skills" | "servers";
export type Item = Skill | Plugin | Server;

export interface Spec {
  list: List;
  label: () => string;
  icon: string;
  origin: CapabilityKind;
  words: (item: Item) => unknown[];
  detail: (item: Item) => string;
  mono?: boolean;
  // A skill opens its SKILL.md in the file panel.
  readable?: boolean;
  gone: () => string;
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
    label: () => t.plugin,
    icon: ICONS.package,
    origin: "plugin",
    words: (item) => [item.name, (item as Plugin).description],
    detail: (item) => (item as Plugin).description,
    gone: () => t.gonePlugin,
  },
  skills: {
    list: "skills",
    label: () => t.skill,
    icon: ICONS.book,
    origin: "skill",
    words: (item) => [item.name, (item as Skill).description],
    detail: (item) => (item as Skill).description,
    readable: true,
    gone: () => t.goneSkill,
  },
  servers: {
    list: "servers",
    label: () => t.mcp,
    icon: ICONS.plug,
    origin: "server",
    words: (item) => [item.name, launchLine(item as Server)],
    detail: (item) => {
      const server = item as Server;
      return [launchLine(server), server.envKeys.join(", ")].filter(Boolean).join(" · ");
    },
    mono: true,
    gone: () => t.goneServer,
  },
};

const SPEC_OF: Record<CapabilityKind, Spec> = Object.fromEntries(
  Object.values(CAP_KINDS).map((spec) => [spec.origin, spec]),
) as Record<CapabilityKind, Spec>;

export type CapTab = "all" | "plugins" | "skills" | "servers";
export type AddAction = "menu" | "explore" | "server";

export const CAP_TABS: Record<CapTab, { label: () => string; keeps: (entry: Entry) => boolean; empty: () => [string, string]; add: AddAction }> = {
  all: { label: () => t.tabAll, keeps: () => true, empty: () => [t.emptyAll, t.emptyAllSaid], add: "menu" },
  plugins: { label: () => t.tabPlugins, keeps: ({ spec }) => spec === CAP_KINDS.plugins, empty: () => [t.emptyPlugins, t.emptyPluginsSaid], add: "explore" },
  skills: { label: () => t.tabSkills, keeps: ({ spec }) => spec === CAP_KINDS.skills, empty: () => [t.emptySkills, t.emptySkillsSaid], add: "menu" },
  servers: { label: () => t.tabServers, keeps: ({ spec }) => spec === CAP_KINDS.servers, empty: () => [t.emptyServers, t.emptyServersSaid], add: "server" },
};

export const CAP_TAB_IDS = Object.keys(CAP_TABS) as CapTab[];
export const capTabList = () => CAP_TAB_IDS.map((id): [CapTab, string] => [id, CAP_TABS[id].label()]);

export const NO_CAPS: Capabilities = { skills: [], servers: [], plugins: [], origins: {} };

export const entriesOf = (caps: Capabilities): Entry[] =>
  Object.values(CAP_KINDS).flatMap((spec) => (caps[spec.list] as Item[]).map((item) => ({ spec, item })));

export const matching = (needle: string) => ({ spec, item }: Entry) =>
  plain(spec.words(item).filter(Boolean).join("\n")).includes(needle);

const activeCount = (list: Item[]) => list.filter((item) => item.enabled).length;

export function tallyOf(caps: Capabilities) {
  const [skills, servers, plugins] = [caps.skills, caps.servers, caps.plugins].map(activeCount);
  return skills + servers + plugins ? t.tally(plugins, skills, servers) : t.nothingOn;
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
    if (!ENV_KEY.test(key)) throw t.envLine(at + 1);
    if (env.has(key)) throw t.envTwice(key);
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
    ...hooks.map((hook): [string, string] => [t.hook(hook.event), hook.command]),
    ...servers.map((server): [string, string] => [t.serverPart(server.name), server.launch]),
    ...bin.map((path): [string, string] => [t.executable, path]),
  ];
}

export const MARKET_PAGE = 48;
export const FILE_ROWS = 300;

export type KindFilter = "all" | Listing["kind"];
export type SourceFilter = "all" | "anthropic" | "community" | "skillsSh";
export type Place = "home" | "all" | SectionId;

export const badgeName = (badge: Listing["badge"]) =>
  ({ anthropic: t.badgeAnthropic, partner: t.badgePartner, community: t.badgeCommunity, skillsSh: t.badgeSkillsSh })[badge];

export const kindName = (kind: Listing["kind"]) => ({ plugin: t.plugin, skill: t.skill, connector: t.connector })[kind];

export const KIND_IDS: KindFilter[] = ["all", "plugin", "skill", "connector"];
export const kindChip = (kind: KindFilter) => ({ all: t.kindAll, plugin: t.kindPlugins, skill: t.kindSkills, connector: t.kindConnectors })[kind];

export const SOURCE_IDS: SourceFilter[] = ["all", "anthropic", "community", "skillsSh"];
export const sourceChip = (source: SourceFilter) =>
  ({ all: t.sourceAll, anthropic: t.sourceAnthropic, community: t.sourceCommunity, skillsSh: t.sourceSkillsSh })[source];

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
  place: Place = "all",
) {
  const needle = plain(query.trim());
  const known = new Set(needle ? listings.map((listing) => listing.id) : []);
  const pool = needle ? [...listings, ...hits.filter((hit) => !known.has(hit.id))] : listings;
  const kept = pool.filter((listing) => (kind === "all" || listing.kind === kind) && SOURCE_GROUPS[source](listing));
  const matched = needle ? rank(kept, needle) : ordered(kept);
  const found = place === "all" || place === "home" ? matched : matched.filter((listing) => sectionOf(listing) === place);
  return { needle, matched, found };
}

export type DetailTab = "summary" | "contents" | "runs";

export const detailTabs = (): [DetailTab, string][] => [
  ["summary", t.summary],
  ["contents", t.contents],
  ["runs", t.runs],
];
