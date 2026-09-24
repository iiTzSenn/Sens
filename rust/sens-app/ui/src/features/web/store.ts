import { createStore } from "zustand/vanilla";
import { commands, events } from "../../ipc/commands";
import type { Frame, Heard } from "../../ipc/types";
import { dialog } from "../../app/modal";
import { panelShows, shell, showTool } from "../../app/shell";
import { PAGE } from "../../shared/format.js";
import { sheets } from "../../shared/sheets.js";
import { warn as notice } from "../chat/state";
import { project } from "../project/store";
import { settingsSheet } from "../settings/sheet";

export interface Said {
  level: string;
  text: string;
}

// The web panel: the page it shows; for a page of the project, the address
// the preview server serves the project under, so the bar shows the file; the
// width it is drawn at (0 for the panel's own); whether it is loading; its
// title; and what its console said, with `fault` set when an error came in
// while the console was shut.
export const web = createStore(() => ({
  url: "",
  base: "",
  width: 0,
  loading: false,
  title: "",
  log: [] as Said[],
  logShown: false,
  fault: false,
}));

const set = web.setState;

// Only this many console lines are kept.
const CONSOLE_CAP = 500;

const PLAIN_HTTP = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[::1\])(:\d+)?([/?#]|$)/i;
const WEBBED = /^https?:\/\//i;
const SCHEMED = /^[a-z][\w+.-]*:\/\//i;
const HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?$/;
const PATHED = /[/\\]/;
const SEARCH = "https://www.google.com/search?q=";

// The page is a native webview Rust lays over the panel, not part of this
// page: it has to be told where the frame is, and to hide whenever the panel
// is away or a menu or the dialog covers it.
let frame: HTMLElement | null = null;
let browsing = false;
let browserShown = false;
let browserSpot = "";
let browserFrame = 0;

export const holdFrame = (element: HTMLElement | null) => void (frame = element);

const warn = (reason: unknown) => notice(String(reason));

// What the address bar shows: a page of the project by its path.
export function addressOf(url: string, base: string) {
  if (!base || !url.startsWith(base)) return url;
  try {
    return decodeURIComponent(url.slice(base.length));
  } catch {
    return url;
  }
}

export const onProject = () => {
  const { url, base } = web.getState();
  return Boolean(base) && url.startsWith(base);
};

// What is typed in the bar: a local server, an address, a host, a page of the
// project, or else a search.
export function aim(typed: string) {
  const text = typed.trim();
  if (!text) return;
  if (PLAIN_HTTP.test(text)) return aimSite(`http://${text}`);
  if (WEBBED.test(text)) return aimSite(text);
  if (SCHEMED.test(text)) return warn("El navegador solo abre direcciones http y https.");
  const first = text.split(/[/\\?#]/)[0];
  if (HOST.test(first) && !PAGE.test(first)) return aimSite(`https://${text}`);
  const { root } = project.getState();
  if (root && (PAGE.test(text) || PATHED.test(text))) return showSite(text.replace(/^\.?[/\\]/, ""), root);
  aimSite(`${SEARCH}${encodeURIComponent(text)}`);
}

// A page of a project (by default the open one), through its preview server.
export async function showSite(path: string, home = project.getState().root) {
  let url: string;
  try {
    url = await commands.previewUrl(home, path);
  } catch (reason) {
    return warn(reason);
  }
  const served = new URL(url);
  set({ base: `${served.origin}/${served.pathname.split("/")[1]}/` });
  await aimSite(url);
}

export async function aimSite(url: string) {
  set({ url, log: [], fault: false });
  showTool("web");
  const [where, zoom] = spotOf();
  try {
    await commands.browserOpen(url, where, zoom);
  } catch (reason) {
    return warn(reason);
  }
  if (!browsing) browserShown = true;
  browsing = true;
  browserSpot = JSON.stringify([where, zoom]);
  syncBrowser();
}

// The bar takes the focus when there is nothing to show yet.
export function enterSite() {
  if (!web.getState().url) document.getElementById("site-url")?.focus();
}

export function reloadSite() {
  if (browsing) commands.browserAct("reload").catch(warn);
}

export const goBack = () => commands.browserAct("back").catch(warn);
export const goForward = () => commands.browserAct("forward").catch(warn);

export function pickWidth(width: number) {
  set({ width });
  syncBrowser();
}

export const toggleLog = () => set(({ logShown, fault }) => ({ logShown: !logShown, fault: logShown && fault }));

// A narrower width is centred in the frame; a wider one is zoomed out to fit.
function spotOf(): [Frame, number] {
  const box = frame?.getBoundingClientRect() ?? new DOMRect();
  const { width: wanted } = web.getState();
  const width = wanted > 0 && wanted < box.width ? wanted : box.width;
  return [{ x: box.left + (box.width - width) / 2, y: box.top, width, height: box.height }, wanted > box.width ? box.width / wanted : 1];
}

const overlaps = (one: DOMRect, two: DOMRect) => one.left < two.right && one.right > two.left && one.top < two.bottom && one.bottom > two.top;

function covered() {
  if (dialog.getState().open || settingsSheet.getState().open) return true;
  const box = frame?.getBoundingClientRect();
  return Boolean(box) && sheets.some(({ sheet }) => sheet && !sheet.hidden && overlaps(sheet.getBoundingClientRect(), box!));
}

// Anything that moves the frame or covers it asks for this; it runs once a frame.
export function syncBrowser() {
  if (!browserFrame) browserFrame = requestAnimationFrame(placeBrowser);
}

function placeBrowser() {
  browserFrame = 0;
  if (!browsing) return;
  const shown = panelShows("web") && Boolean(web.getState().url) && !covered();
  const [where, zoom] = spotOf();
  const spot = JSON.stringify([where, zoom]);
  if (shown && spot !== browserSpot) {
    browserSpot = spot;
    commands.browserPlace(where, zoom).catch(warn);
  }
  if (shown === browserShown) return;
  browserShown = shown;
  commands.browserShow(shown).catch(warn);
}

function hear(heard: Heard) {
  if (heard.kind === "said") return say(heard);
  if (heard.kind === "titled") return set({ title: heard.title });
  const loading = heard.kind === "loading";
  set(loading ? { url: heard.url, loading, log: [], fault: false } : { url: heard.url, loading });
}

function say({ level, text }: Said) {
  set(({ log, logShown, fault }) => ({
    log: [...log, { level, text }].slice(-CONSOLE_CAP),
    fault: fault || (level === "error" && !logShown),
  }));
}

// A new project closes the page.
export function forgetSite() {
  if (browsing) commands.browserAct("close").catch(warn);
  browsing = false;
  browserShown = false;
  browserSpot = "";
  set({ url: "", base: "", loading: false, title: "", log: [], logShown: false, fault: false });
}

// The panel opening or closing, the dialog over it: the page follows.
shell.subscribe(syncBrowser);
dialog.subscribe(syncBrowser);
settingsSheet.subscribe(syncBrowser);

// Once, when the panel is mounted: the page tells where it went and what its
// console said.
export const hearBrowser = () => events.browser(hear);
