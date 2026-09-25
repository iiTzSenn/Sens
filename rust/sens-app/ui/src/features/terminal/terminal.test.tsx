// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalHeard, TerminalReading } from "../../ipc/types";
import { shell } from "../../app/shell";
import { focused } from "../panes/store";
import { project } from "../project/store";
import { ConsolePanel, ConsoleTabs } from "./Consoles";
import { closeConsole, consoles, endedLine, enterConsole, fenced, hearTerminal, openConsole, readScreen, runningConsoles, shareConsole, toggleConsole } from "./store";

interface Fake {
  options: Record<string, unknown>;
  cols: number;
  rows: number;
  written: string;
  selection: string;
  disposed: boolean;
  lines: { text: string; wrapped?: boolean }[];
  typed: (data: string) => void;
  key: (event: KeyboardEvent) => boolean;
}

const ipc = vi.hoisted(() => ({
  commands: {
    terminalOpen: vi.fn(),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalClose: vi.fn(),
    terminalScreen: vi.fn(),
  },
  heard: null as ((what: TerminalHeard) => void) | null,
  read: null as ((reading: TerminalReading) => void) | null,
  xterms: [] as Fake[],
}));

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: {
    terminal: (heard: (what: TerminalHeard) => void) => ((ipc.heard = heard), Promise.resolve(() => {})),
    terminalRead: (read: (reading: TerminalReading) => void) => ((ipc.read = read), Promise.resolve(() => {})),
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols: number;
    rows: number;
    written = "";
    selection = "";
    disposed = false;
    lines: { text: string; wrapped?: boolean }[] = [];
    typed: (data: string) => void = () => {};
    key: (event: KeyboardEvent) => boolean = () => true;
    get buffer() {
      const lines = this.lines;
      return {
        active: {
          length: lines.length,
          viewportY: Math.max(0, lines.length - this.rows),
          getLine: (at: number) => lines[at] && { isWrapped: Boolean(lines[at].wrapped), translateToString: () => lines[at].text },
        },
      };
    }
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      this.cols = options.cols as number;
      this.rows = options.rows as number;
      ipc.xterms.push(this);
    }
    loadAddon() {}
    onData(typed: (data: string) => void) {
      this.typed = typed;
    }
    onResize() {}
    attachCustomKeyEventHandler(key: (event: KeyboardEvent) => boolean) {
      this.key = key;
    }
    write(data: string) {
      this.written += data;
    }
    open() {}
    focus() {}
    dispose() {
      this.disposed = true;
    }
    hasSelection() {
      return Boolean(this.selection);
    }
    getSelection() {
      return this.selection;
    }
    clearSelection() {
      this.selection = "";
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

const hear = (what: TerminalHeard) => act(() => ipc.heard!(what));
const last = () => ipc.xterms[ipc.xterms.length - 1];
const opened = (id: number) => ipc.commands.terminalOpen.mockResolvedValueOnce({ id, shell: "pwsh" });
const settleDown = () => act(() => new Promise((done) => setTimeout(done, 0)));

beforeAll(() => {
  hearTerminal();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

beforeEach(() => {
  for (const one of consoles.getState().open) closeConsole(one.id);
  consoles.setState(consoles.getInitialState(), true);
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  project.setState({ root: "C:/Proyectos/demo", work: "C:/Proyectos/demo" });
  shell.setState({ ...shell.getInitialState(), toolsOpen: true, tool: "terminal" }, true);
});

afterEach(cleanup);

describe("a terminal", () => {
  it("opens in the project, at the size it will be drawn, and shows what the shell printed before it was ready", async () => {
    let answer: (value: { id: number; shell: string }) => void = () => {};
    ipc.commands.terminalOpen.mockReturnValueOnce(new Promise((done) => (answer = done)));
    const opening = openConsole();
    hear({ kind: "out", id: 41, data: "PS C:\\Proyectos\\demo> " });
    answer({ id: 41, shell: "pwsh" });
    await act(() => opening);

    expect(ipc.commands.terminalOpen).toHaveBeenCalledWith("C:/Proyectos/demo", 80, 24);
    expect(consoles.getState()).toMatchObject({ open: [{ id: 41, root: "C:/Proyectos/demo", shell: "pwsh", ended: false }], shown: 41 });
    expect(last().written).toBe("PS C:\\Proyectos\\demo> ");
  });

  it("sends what is typed in order, one write at a time", async () => {
    opened(42);
    await act(() => openConsole());
    let release: () => void = () => {};
    ipc.commands.terminalWrite.mockReturnValueOnce(new Promise<void>((done) => (release = done)));
    last().typed("l");
    last().typed("s");
    last().typed("\r");
    expect(ipc.commands.terminalWrite).toHaveBeenCalledTimes(1);
    release();
    await settleDown();
    expect(ipc.commands.terminalWrite.mock.calls).toEqual([
      [42, "l"],
      [42, "s\r"],
    ]);
  });

  it("says how the shell ended and stops taking keys", async () => {
    opened(43);
    await act(() => openConsole());
    hear({ kind: "ended", id: 43, code: 0 });
    expect(last().written).toContain(endedLine(0));
    expect(consoles.getState().open[0].ended).toBe(true);
    expect(runningConsoles()).toBe(0);
    last().typed("x");
    expect(ipc.commands.terminalWrite).not.toHaveBeenCalled();
  });

  it("copies a selection with Ctrl+C and leaves the rest of the keys to the shell", async () => {
    opened(44);
    await act(() => openConsole());
    const copied = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: copied }, configurable: true });
    const press = (key: string, extra: KeyboardEventInit = {}) => last().key(new KeyboardEvent("keydown", { key, ctrlKey: true, ...extra }));

    expect(press("c")).toBe(true);
    last().selection = "npm run dev";
    expect(press("c")).toBe(false);
    expect(copied).toHaveBeenCalledWith("npm run dev");
    expect(last().selection).toBe("");
    expect(press("v")).toBe(false);
    expect(press("`")).toBe(false);
    expect(press("ñ")).toBe(false);
    expect(press("b")).toBe(true);
    expect(last().key(new KeyboardEvent("keydown", { key: "a" }))).toBe(true);
  });
});

describe("adding the terminal to the message", () => {
  beforeEach(() => focused().desk.setState({ text: "" }));

  it("takes the selection, fenced, after what was already written", async () => {
    opened(80);
    await act(() => openConsole());
    focused().desk.setState({ text: "Mira esto:  " });
    last().selection = "npm ERR! missing script: dev  ";
    shareConsole();
    expect(focused().desk.getState().text).toBe("Mira esto:\n\n```console\nnpm ERR! missing script: dev\n```");
    expect(last().selection).toBe("");
  });

  it("takes what is on screen when nothing is selected, joining the lines the width wrapped", async () => {
    opened(81);
    await act(() => openConsole());
    last().rows = 4;
    last().lines = [{ text: "antes" }, { text: "PS C:\\demo> git st" }, { text: "atus", wrapped: true }, { text: "On branch main" }, { text: "" }];
    shareConsole();
    expect(focused().desk.getState().text).toBe("```console\nPS C:\\demo> git status\nOn branch main\n```");
  });

  it("adds nothing from an empty screen", async () => {
    opened(82);
    await act(() => openConsole());
    shareConsole();
    expect(focused().desk.getState().text).toBe("");
  });

  it("fences past any backticks the text carries", () => {
    expect(fenced("a ``` b", "console")).toBe("````console\na ``` b\n````");
    expect(fenced("plain")).toBe("```\nplain\n```");
  });
});

describe("Claude reading the terminal", () => {
  const everywhere = ["C:/Proyectos"];

  it("says so when there is none", () => {
    expect(readScreen({ terminal: null, lines: 200, within: everywhere })).toBe("No hay ninguna terminal abierta en la carpeta de esta sesión.");
  });

  it("reads the last lines of the one on screen, and names the others", async () => {
    opened(90);
    await act(async () => openConsole());
    last().lines = [{ text: "PS C:\\Proyectos\\demo> npm run dev" }, { text: "Error: el puerto 5173 ya está en uso" }, { text: "" }];
    project.setState({ root: "C:/Proyectos/api", work: "C:/Proyectos/api" });
    opened(91);
    await act(async () => openConsole());
    hear({ kind: "ended", id: 91, code: 1 });
    act(() => consoles.setState({ shown: 90 }));

    expect(readScreen({ terminal: null, lines: 1, within: everywhere })).toBe(
      ["Terminal 90 · pwsh en C:/Proyectos/demo", "Abiertas: 90 · demo (pwsh); 91 · api (pwsh, terminada)", "", "Error: el puerto 5173 ya está en uso"].join("\n"),
    );
    expect(readScreen({ terminal: 91, lines: 5, within: everywhere })).toContain("Terminal 91 · pwsh en C:/Proyectos/api · el proceso ya terminó");
    expect(readScreen({ terminal: 91, lines: 5, within: everywhere })).toContain("(no hay nada en pantalla)");
    expect(readScreen({ terminal: 7, lines: 5, within: everywhere })).toBe("No hay ninguna terminal 7. Abiertas: 90 · demo (pwsh); 91 · api (pwsh, terminada).");
  });

  it("never reads a terminal of another project, however its folder is written", async () => {
    opened(92);
    await act(async () => openConsole());
    last().lines = [{ text: "secreto de demo" }];
    project.setState({ root: "C:/Proyectos/api", work: "C:/Proyectos/api" });
    opened(93);
    await act(async () => openConsole());
    last().lines = [{ text: "salida de api" }];
    act(() => consoles.setState({ shown: 92 }));

    const api = ["c:\\proyectos\\API\\"];
    expect(readScreen({ terminal: null, lines: 5, within: api })).toBe("Terminal 93 · pwsh en C:/Proyectos/api\n\nsalida de api");
    expect(readScreen({ terminal: 92, lines: 5, within: api })).toBe("No hay ninguna terminal 92. Abiertas: 93 · api (pwsh).");
    expect(readScreen({ terminal: null, lines: 5, within: ["C:/Proyectos/dem"] })).toBe("No hay ninguna terminal abierta en la carpeta de esta sesión.");
  });

  it("answers the bridge with what it read", async () => {
    opened(95);
    await act(async () => openConsole());
    last().lines = [{ text: "hola" }];
    ipc.read!({ ask: 7, terminal: null, lines: 10, within: ["C:/Proyectos/demo"] });
    expect(ipc.commands.terminalScreen).toHaveBeenCalledWith(7, "Terminal 95 · pwsh en C:/Proyectos/demo\n\nhola");
  });
});

describe("the terminal panel", () => {
  it("opens one the first time it is shown, and only then", async () => {
    opened(50);
    enterConsole();
    enterConsole();
    await settleDown();
    enterConsole();
    expect(ipc.commands.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("names each tab after its folder, switches between them and closes the one asked", async () => {
    opened(60);
    await act(() => openConsole());
    project.setState({ root: "C:/Proyectos/api", work: "C:/Proyectos/api" });
    opened(61);
    await act(() => openConsole());
    render(
      <>
        <ConsoleTabs />
        <ConsolePanel />
      </>,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["demo", "api"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tabs[0]);
    expect(consoles.getState().shown).toBe(60);
    expect(document.getElementById("console-60")?.hidden).toBe(false);
    expect(document.getElementById("console-61")?.hidden).toBe(true);

    const shut = ipc.xterms[ipc.xterms.length - 2];
    fireEvent.click(screen.getByRole("button", { name: "Cerrar la terminal demo" }));
    expect(ipc.commands.terminalClose).toHaveBeenCalledWith(60);
    expect(shut.disposed).toBe(true);
    expect(consoles.getState()).toMatchObject({ open: [{ id: 61 }], shown: 61 });
  });

  it("offers to open another once the last one is closed", async () => {
    opened(70);
    await act(() => openConsole());
    render(<ConsolePanel />);
    act(() => closeConsole(70));
    opened(71);
    fireEvent.click(screen.getByRole("button", { name: "Abrir una en demo" }));
    await settleDown();
    expect(consoles.getState().shown).toBe(71);
  });

  it("comes and goes with its shortcut", () => {
    shell.setState({ toolsOpen: false });
    toggleConsole();
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "terminal" });
    toggleConsole();
    expect(shell.getState().toolsOpen).toBe(false);
  });
});
