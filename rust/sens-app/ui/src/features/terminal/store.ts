import type { FitAddon } from "@xterm/addon-fit";
import type { ITheme, Terminal } from "@xterm/xterm";
import { createStore } from "zustand/vanilla";
import { closeTools, panelShows, showTool } from "../../app/shell";
import { commands, events } from "../../ipc/commands";
import type { TerminalHeard, TerminalReading } from "../../ipc/types";
import { stem } from "../../shared/format.js";
import { look, tokenOf } from "../../shared/look";
import { warn } from "../chat/state";
import { addToMessage } from "../composer/store";
import { project } from "../project/store";

export interface Console {
  id: number;
  root: string;
  shell: string;
  ended: boolean;
}

export const consoles = createStore(() => ({
  open: [] as Console[],
  shown: 0,
  opening: false,
}));

const set = consoles.setState;

interface Screen {
  xterm: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
  queued: string;
  sending: boolean;
  sizing: number;
}

const screens = new Map<number, Screen>();
const early = new Map<number, TerminalHeard[]>();
let newest = 0;
let owed = false;

const FIRST_SIZE = { cols: 80, rows: 24 };
const RESIZE_PAUSE = 80;
const TOGGLES = new Set(["`", "ñ"]);

const PAINT: [keyof ITheme, string][] = [
  ["background", "--panel"],
  ["foreground", "--dim"],
  ["cursor", "--focus"],
  ["cursorAccent", "--panel"],
  ["selectionBackground", "--raise"],
  ["scrollbarSliderBackground", "--raise"],
  ["scrollbarSliderHoverBackground", "--edge"],
  ["scrollbarSliderActiveBackground", "--edge"],
  ["black", "--ansi-black"],
  ["red", "--red"],
  ["green", "--green"],
  ["yellow", "--amber"],
  ["blue", "--blue"],
  ["magenta", "--ansi-magenta"],
  ["cyan", "--ansi-cyan"],
  ["white", "--dim"],
  ["brightBlack", "--ghost"],
  ["brightRed", "--red"],
  ["brightGreen", "--green"],
  ["brightYellow", "--amber"],
  ["brightBlue", "--blue"],
  ["brightMagenta", "--ansi-magenta"],
  ["brightCyan", "--ansi-cyan"],
  ["brightWhite", "--text"],
];

export const themeNow = (): ITheme => Object.fromEntries(PAINT.map(([key, token]) => [key, tokenOf(token)]));

export const endedLine = (code: number | null) => (code === null ? "La terminal se cerró." : `El proceso terminó con el código ${code}.`);

export const runningConsoles = () => consoles.getState().open.filter((one) => !one.ended).length;

export const screenOf = (id: number) => screens.get(id)?.host;

const loadXterm = () => Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);

type Xterm = Awaited<ReturnType<typeof loadXterm>>;

function makeScreen([{ Terminal }, { FitAddon }]: Xterm, id: number, cols: number, rows: number) {
  const xterm = new Terminal({
    cols,
    rows,
    fontFamily: tokenOf("--mono"),
    fontSize: 12,
    lineHeight: 1.4,
    cursorBlink: true,
    scrollback: 5000,
    theme: themeNow(),
  });
  const fit = new FitAddon();
  xterm.loadAddon(fit);
  const host = document.createElement("div");
  host.className = "console-screen";
  const screen: Screen = { xterm, fit, host, opened: false, queued: "", sending: false, sizing: 0 };
  xterm.onData((data) => type(id, screen, data));
  xterm.onResize((size) => {
    clearTimeout(screen.sizing);
    screen.sizing = window.setTimeout(() => commands.terminalResize(id, size.cols, size.rows).catch(() => {}), RESIZE_PAUSE);
  });
  xterm.attachCustomKeyEventHandler((event) => keyed(xterm, event));
  screens.set(id, screen);
  return screen;
}

function keyed(xterm: Terminal, event: KeyboardEvent) {
  if (!event.ctrlKey || event.altKey || event.metaKey) return true;
  const key = event.key.toLowerCase();
  if (TOGGLES.has(key) || key === "v") return false;
  if (key !== "c" || !(event.shiftKey || xterm.hasSelection())) return true;
  if (event.type === "keydown") {
    event.preventDefault();
    const picked = xterm.getSelection();
    if (picked) navigator.clipboard?.writeText(picked).catch(() => {});
    xterm.clearSelection();
  }
  return false;
}

const endedOf = (id: number) => consoles.getState().open.find((one) => one.id === id)?.ended ?? true;

function type(id: number, screen: Screen, data: string) {
  if (endedOf(id)) return;
  screen.queued += data;
  if (!screen.sending) send(id, screen);
}

async function send(id: number, screen: Screen) {
  screen.sending = true;
  while (screen.queued) {
    const data = screen.queued;
    screen.queued = "";
    try {
      await commands.terminalWrite(id, data);
    } catch {
      screen.queued = "";
    }
  }
  screen.sending = false;
}

function sizeNow() {
  const screen = screens.get(consoles.getState().shown);
  return screen?.opened ? { cols: screen.xterm.cols, rows: screen.xterm.rows } : FIRST_SIZE;
}

export async function openConsole(root = project.getState().work) {
  if (consoles.getState().opening) return;
  set({ opening: true });
  const { cols, rows } = sizeNow();
  try {
    const modules = await loadXterm();
    const { id, shell } = await commands.terminalOpen(root, cols, rows);
    newest = Math.max(newest, id);
    makeScreen(modules, id, cols, rows);
    set(({ open }) => ({ open: [...open, { id, root, shell, ended: false }], shown: id }));
    const waiting = early.get(id) ?? [];
    early.delete(id);
    waiting.forEach(hear);
  } catch (reason) {
    warn(String(reason));
  } finally {
    set({ opening: false });
  }
}

export const showConsole = (id: number) => set({ shown: id });

export function closeConsole(id: number) {
  const screen = screens.get(id);
  screens.delete(id);
  clearTimeout(screen?.sizing);
  screen?.xterm.dispose();
  screen?.host.remove();
  const { open, shown } = consoles.getState();
  const at = open.findIndex((one) => one.id === id);
  const left = open.filter((one) => one.id !== id);
  set({ open: left, shown: shown === id ? (left[Math.min(at, left.length - 1)]?.id ?? 0) : shown });
  commands.terminalClose(id).catch(() => {});
}

export function settle(focus = true) {
  owed ||= focus;
  const screen = screens.get(consoles.getState().shown);
  if (!screen || !panelShows("terminal") || !screen.host.isConnected || !screen.host.clientWidth) return;
  if (!screen.opened) {
    screen.xterm.open(screen.host);
    screen.opened = true;
  }
  screen.fit.fit();
  if (owed) screen.xterm.focus();
  owed = false;
}

function textBetween(xterm: Terminal, from: number, to: number) {
  const buffer = xterm.buffer.active;
  const lines: string[] = [];
  for (let at = Math.max(0, from); at < Math.min(to, buffer.length); at++) {
    const line = buffer.getLine(at);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.join("\n").trimEnd();
}

const onScreen = (xterm: Terminal) => textBetween(xterm, xterm.buffer.active.viewportY, xterm.buffer.active.viewportY + xterm.rows);

export function lastLines(xterm: Terminal, count: number) {
  const buffer = xterm.buffer.active;
  let end = buffer.length;
  while (end > 0 && !buffer.getLine(end - 1)?.translateToString(true).trim()) end--;
  return textBetween(xterm, end - count, end);
}

export function fenced(text: string, language = "") {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

export function shareConsole() {
  const screen = screens.get(consoles.getState().shown);
  if (!screen) return;
  const text = (screen.xterm.getSelection() || onScreen(screen.xterm)).trimEnd();
  if (!text.trim()) return;
  screen.xterm.clearSelection();
  addToMessage(fenced(text, "console"));
}

export function enterConsole() {
  if (!consoles.getState().open.length) openConsole();
}

export function toggleConsole() {
  if (!panelShows("terminal")) return showTool("terminal");
  const inside = document.activeElement?.closest(".console-screen");
  closeTools();
  if (inside) document.getElementById("task")?.focus();
}

function hear(heard: TerminalHeard) {
  const screen = screens.get(heard.id);
  if (!screen) {
    if (heard.id > newest) early.set(heard.id, [...(early.get(heard.id) ?? []), heard]);
    return;
  }
  if (heard.kind === "out") return screen.xterm.write(heard.data);
  screen.xterm.write(`\x1b[?25l\r\n\x1b[2m${endedLine(heard.code)}\x1b[0m\r\n`);
  set(({ open }) => ({ open: open.map((one) => (one.id === heard.id ? { ...one, ended: true } : one)) }));
}

export const nameOf = (one: Console) => stem(one.root) || one.shell;

const told = (one: Console) => `${one.id} · ${nameOf(one)} (${one.shell}${one.ended ? ", terminada" : ""})`;

const folded = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const inside = (root: string, folders: string[]) =>
  Boolean(root) && folders.map(folded).some((folder) => folded(root) === folder || folded(root).startsWith(`${folder}/`));

export function readScreen({ terminal, lines, within }: Omit<TerminalReading, "ask">) {
  const { shown } = consoles.getState();
  const open = consoles.getState().open.filter((one) => inside(one.root, within));
  if (!open.length) return "No hay ninguna terminal abierta en la carpeta de esta sesión.";
  const wanted = terminal ?? (open.some((one) => one.id === shown) ? shown : open[open.length - 1].id);
  const chosen = open.find((one) => one.id === wanted);
  const listed = open.map(told).join("; ");
  if (!chosen) return `No hay ninguna terminal ${wanted}. Abiertas: ${listed}.`;
  const screen = screens.get(chosen.id);
  const text = screen ? lastLines(screen.xterm, lines) : "";
  return [
    `Terminal ${chosen.id} · ${chosen.shell} en ${chosen.root || "la carpeta de usuario"}${chosen.ended ? " · el proceso ya terminó" : ""}`,
    ...(open.length > 1 ? [`Abiertas: ${listed}`] : []),
    "",
    text || "(no hay nada en pantalla)",
  ].join("\n");
}

const answerRead = (reading: TerminalReading) => commands.terminalScreen(reading.ask, readScreen(reading)).catch(() => {});

function repaint() {
  const theme = themeNow();
  for (const { xterm } of screens.values()) xterm.options.theme = theme;
}

look.subscribe(repaint);

export function hearTerminal() {
  events.terminal(hear);
  events.terminalRead(answerRead);
}
