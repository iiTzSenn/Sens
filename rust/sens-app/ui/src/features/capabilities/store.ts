import { open } from "@tauri-apps/plugin-dialog";
import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { Capabilities, Detail, Listing, Market } from "../../ipc/types";
import { showTool } from "../../app/shell";
import { store, stored } from "../../shared/storage.js";
import { createDebouncedSearch, createMarketRanker } from "../market/search.js";
import { present } from "../files/view";
import { project } from "../project/store";
import { t } from "./copy";
import {
  CAP_TAB_IDS,
  KIND_IDS,
  MARKET_PAGE,
  NO_CAPS,
  SOURCE_IDS,
  searchesSkillsSh,
  type CapTab,
  type DetailTab,
  type Item,
  type KindFilter,
  type Place,
  type SourceFilter,
  type Spec,
} from "./kinds";
import { SECTION_IDS } from "./sections";

export type Mode = "installed" | "explore";

const MODE_KEY = "sens.capabilities.mode";
const TAB_KEY = "sens.capabilities.tab";
const KIND_KEY = "sens.market.kind";
const SOURCE_KEY = "sens.market.source";
const PLACE_KEY = "sens.market.place";
const MARKET_SEEK_WAIT = 300;
const PLACES: Place[] = ["home", "all", ...SECTION_IDS];

function kept<T extends string>(key: string, options: readonly T[], fallback: T): T {
  const value = stored(key, "");
  return options.includes(value) ? value : fallback;
}

export interface Reading {
  path: string;
  text: string | null;
  fault: string;
}

export interface Detailing {
  id: string;
  listing: Listing | null;
  detail: Detail | null;
  fault: string;
  tab: DetailTab;
  file: string;
  reading: Reading | null;
  back: { mode: Mode; scroll: number };
}

export type Where = "listFault" | "detailFault" | "exploreFault";

// `loadFault` replaces the installed list; `listFault` and `detailFault` sit on
// top of what they failed on, until the next try there. `scrollTo` is where
// the view scrolls once the next screen has painted.
export const capabilities = createStore(() => ({
  caps: NO_CAPS as Capabilities,
  loadFault: "",
  listFault: "",
  tab: kept<CapTab>(TAB_KEY, CAP_TAB_IDS, "all"),
  mode: kept<Mode>(MODE_KEY, ["installed", "explore"], "installed"),
  kind: kept<KindFilter>(KIND_KEY, KIND_IDS, "all"),
  source: kept<SourceFilter>(SOURCE_KEY, SOURCE_IDS, "all"),
  place: kept<Place>(PLACE_KEY, PLACES, "home"),
  market: null as Market | null,
  marketAsking: false,
  marketFault: "",
  exploreFault: "",
  query: "",
  hits: [] as Listing[],
  hitsFault: "",
  seeking: false,
  shown: MARKET_PAGE,
  adding: [] as string[],
  detailing: null as Detailing | null,
  detailFault: "",
  installing: false,
  scrollTo: null as number | null,
}));

const set = capabilities.setState;
const get = capabilities.getState;
const home = () => project.getState().root;

export const rank = createMarketRanker();

async function attempt(where: Where, work: () => Promise<unknown>) {
  set({ [where]: "" });
  try {
    await work();
  } catch (reason) {
    set({ [where]: String(reason) });
  }
}

export async function loadCapabilities() {
  const asked = home();
  try {
    const found = await commands.capabilities(asked);
    if (asked === home()) set({ caps: found, loadFault: "" });
  } catch (reason) {
    if (asked === home()) set({ caps: NO_CAPS, loadFault: String(reason) });
  }
}

export function enterCapabilities() {
  loadCapabilities();
  loadMarket(false);
}

export function showMode(mode: Mode) {
  store(MODE_KEY, mode);
  set({ mode, detailing: null, scrollTo: 0 });
  loadMarket(false);
}

export function pickTab(tab: CapTab) {
  store(TAB_KEY, tab);
  set({ tab, listFault: "" });
}

function flip(spec: Spec, name: string) {
  set(({ caps }) => ({
    caps: {
      ...caps,
      [spec.list]: (caps[spec.list] as Item[]).map((item) => (item.name === name ? { ...item, enabled: !item.enabled } : item)),
    },
  }));
}

// Flips the switch at once and puts it back if Rust refuses.
export async function toggle(spec: Spec, name: string, where: Where = "listFault") {
  const root = home();
  if (!root) return;
  flip(spec, name);
  const enabled = (get().caps[spec.list] as Item[]).find((item) => item.name === name)?.enabled ?? false;
  await attempt(where, () =>
    commands.setCapability(spec.origin, root, name, enabled).catch((reason) => {
      flip(spec, name);
      throw reason;
    }),
  );
}

export const openSkill = (name: string) =>
  attempt("listFault", async () => {
    const text = await commands.skillText(name);
    present(`skills/${name}/SKILL.md`, text, "");
    showTool("files");
  });

export const importSkill = () =>
  attempt("listFault", async () => {
    const picked = await open({ directory: true, title: t.chooseSkillFolder });
    if (typeof picked !== "string") return;
    await commands.importSkill(home(), picked);
    await loadCapabilities();
  });

let asking: Promise<void> | null = null;

export function loadMarket(refresh: boolean) {
  if (asking) return asking;
  if (get().market && !refresh) return Promise.resolve();
  set({ marketAsking: true });
  asking = commands
    .market(refresh)
    .then(
      (found) => set({ market: found, marketFault: "" }),
      (reason) => set({ marketFault: String(reason) }),
    )
    .finally(() => {
      asking = null;
      set({ marketAsking: false });
    });
  return asking;
}

const searchTask = createDebouncedSearch({
  search: commands.marketSearch,
  delay: MARKET_SEEK_WAIT,
  changed: ({ pending, hits, error }: { pending: boolean; hits: Listing[]; error: string }) =>
    set({ seeking: pending, hits, hitsFault: error }),
});

export function seek(query = get().query) {
  const { kind, source } = get();
  set({ query, shown: MARKET_PAGE });
  searchTask.schedule(query.trim(), searchesSkillsSh(kind, source));
}

export function pickKind(kind: KindFilter) {
  store(KIND_KEY, kind);
  set({ kind });
  seek();
}

export function pickSource(source: SourceFilter) {
  store(SOURCE_KEY, source);
  set({ source });
  seek();
}

export function pickPlace(place: Place) {
  store(PLACE_KEY, place);
  set({ place, shown: MARKET_PAGE, scrollTo: 0 });
  if (place === "home" && get().query) seek("");
}

export const showMore = () => set(({ shown }) => ({ shown: shown + MARKET_PAGE }));

export const marking = (id: string, busy: boolean) =>
  set(({ adding }) => ({ adding: busy ? [...adding.filter((one) => one !== id), id] : adding.filter((one) => one !== id) }));

export const failExplore = (reason: string) => set({ exploreFault: reason });

const view = () => document.getElementById("capabilities-view");

export async function openDetail(id: string, listing: Listing | null = null) {
  const back = { mode: get().mode, scroll: view()?.scrollTop ?? 0 };
  const known = listing || get().market?.listings.find((one) => one.id === id) || get().hits.find((one) => one.id === id) || null;
  set({ detailing: { id, listing: known, detail: null, fault: "", tab: "summary", file: "", reading: null, back }, detailFault: "", scrollTo: 0 });
  let detail: Detail | null = null;
  let fault = "";
  try {
    detail = await commands.marketDetail(id);
  } catch (reason) {
    fault = String(reason);
  }
  const now = get().detailing;
  if (now?.id === id) set({ detailing: { ...now, listing: detail?.listing || now.listing, detail, fault } });
}

export function closeDetail() {
  const back = get().detailing?.back;
  set({ detailing: null, detailFault: "", scrollTo: back?.scroll || 0 });
}

function changeDetail(change: Partial<Detailing>) {
  const now = get().detailing;
  if (now) set({ detailing: { ...now, ...change } });
}

export const pickDetailTab = (tab: DetailTab) => changeDetail({ tab });

export async function readFile(path: string) {
  const id = get().detailing?.id;
  if (!id) return;
  changeDetail({ file: path, reading: { path, text: null, fault: "" } });
  let reading: Reading;
  try {
    reading = { path, text: await commands.marketFile(id, path), fault: "" };
  } catch (reason) {
    reading = { path, text: null, fault: String(reason) };
  }
  const now = get().detailing;
  if (now?.id === id && now.file === path) changeDetail({ reading });
}

export async function install(detail: Detail, values: Record<string, string>) {
  set({ installing: true });
  try {
    await commands.marketInstall(home(), detail.listing.id, values);
  } finally {
    set({ installing: false });
  }
  await loadCapabilities();
}

export const installNow = (detail: Detail) => attempt("detailFault", () => install(detail, {}));

export const updateInstalled = (listing: Listing, name: string, where: Where = "detailFault") =>
  attempt(where, async () => {
    await commands.marketUpdate(listing.id, name);
    await loadCapabilities();
  });

export const consumeScroll = () => set({ scrollTo: null });
