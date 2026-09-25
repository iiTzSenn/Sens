// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { focused } from "../features/panes/store";
import { project } from "../features/project/store";
import { showLanguage } from "../shared/i18n";
import { App } from "./App";
import { dialog } from "./modal";
import { boot, draft, resume, showView } from "./session";
import { shell, showTool } from "./shell";

const ipc = vi.hoisted(() => ({
  commands: new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (known, name: string) => (known[name] ??= vi.fn(async () => undefined)),
  }),
  window: { isMaximized: vi.fn(async () => false), onResized: vi.fn(async () => () => {}), minimize: vi.fn(), toggleMaximize: vi.fn(async () => {}), close: vi.fn() },
}));

vi.mock("../ipc/commands", () => ({ commands: ipc.commands, events: { claudeCode: () => Promise.resolve(() => {}) } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ipc.window }));

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  localStorage.clear();
  shell.setState(shell.getInitialState(), true);
  dialog.setState(dialog.getInitialState(), true);
  project.setState({ root: "", work: "", session: "", view: "", touched: new Map() });
  focused().desk.setState({ root: "", session: "" });
  ipc.commands.workspaces.mockResolvedValue([]);
  ipc.commands.replay.mockResolvedValue([{ kind: "task", at: 1, text: "Hola", files: [], images: [] }]);
  ipc.commands.chatTasks.mockResolvedValue([]);
  ipc.commands.chatBusy.mockResolvedValue(false);
  ipc.commands.folder.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  showLanguage("es");
});

const body = () => document.getElementById("body")!;

describe("the shell", () => {
  it("folds the rail from the title bar and with Ctrl+B, and remembers it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar la barra lateral" }));
    expect(body().dataset.rail).toBe("closed");
    expect(document.getElementById("rail")?.hasAttribute("inert")).toBe(true);
    expect(localStorage.getItem("sens.rail.closed")).toBe("true");
    fireEvent.keyDown(document, { key: "b", ctrlKey: true });
    expect(body().dataset.rail).toBe("open");
  });

  it("folds the rail for a tool in a narrow window, without forgetting it was open", () => {
    render(<App />);
    act(() => shell.setState({ narrow: true }));
    act(() => showTool("changes"));
    expect(body().dataset).toMatchObject({ rail: "closed", code: "open" });
    expect(document.getElementById("rail")?.hasAttribute("inert")).toBe(true);
    act(() => shell.setState({ narrow: false }));
    expect(body().dataset).toMatchObject({ rail: "open", code: "open" });
    act(() => shell.setState({ narrow: true }));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar la barra lateral" }));
    expect(body().dataset).toMatchObject({ rail: "open", code: "closed" });
    expect(localStorage.getItem("sens.rail.closed")).toBe("false");
  });

  it("opens a tool from the tools menu, and closes the panel", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Herramientas" }));
    fireEvent.click(within(document.getElementById("tool-menu")!).getByRole("menuitemradio", { name: /Cambios/ }));
    expect(body().dataset.code).toBe("open");
    expect(document.querySelector<HTMLElement>('.tool[data-tool="changes"]')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.tool[data-tool="files"]')?.hidden).toBe(true);
    fireEvent.click(within(document.querySelector<HTMLElement>('.tool[data-tool="changes"]')!).getByRole("button", { name: "Cerrar" }));
    expect(body().dataset.code).toBe("closed");
  });

  it("puts a view over the chat, and a new session brings the chat back", async () => {
    render(<App />);
    act(() => showView("artifacts"));
    expect(document.querySelector<HTMLElement>("section.chat")?.hidden).toBe(true);
    expect(document.getElementById("shelf")?.hidden).toBe(false);
    await act(async () => draft("C:/demo"));
    expect(project.getState()).toMatchObject({ root: "C:/demo", session: "", view: "" });
    expect(ipc.commands.remember).toHaveBeenCalledWith("C:/demo");
    expect(document.querySelector<HTMLElement>("section.chat")?.hidden).toBe(false);
  });

  it("opens the last project at start under a view already on screen", async () => {
    ipc.commands.lastProject.mockResolvedValue("C:/demo");
    ipc.commands.news.mockResolvedValue([]);
    project.setState({ view: "news" });
    render(<App />);
    await act(async () => boot());
    expect(project.getState()).toMatchObject({ root: "C:/demo", session: "", view: "news" });
    expect(document.querySelector<HTMLElement>("section.chat")?.hidden).toBe(true);
    expect(document.getElementById("news-view")?.hidden).toBe(false);
  });

  it("opens a saved session of the project", async () => {
    render(<App />);
    await act(async () => resume("C:/demo", "s7"));
    expect(project.getState().session).toBe("s7");
    expect(focused().chat.getState().turns).toMatchObject([{ kind: "you", text: "Hola" }]);
  });

  it("names the project of the session in focus in the title bar", async () => {
    render(<App />);
    expect(document.getElementById("project-title")).toBeNull();
    await act(async () => resume("C:/trabajo/demo", "s7"));
    expect(document.getElementById("project-title")?.textContent).toBe("demo");
    await act(async () => resume("C:\\trabajo\\web\\", "s8"));
    expect(document.getElementById("project-title")?.textContent).toBe("web");
  });

  it("shows a dialog, closes it on Escape's close, and gives the focus back", () => {
    render(<App />);
    const me = screen.getByRole("button", { name: /Sin nombre/ });
    fireEvent.click(me);
    fireEvent.click(screen.getByRole("menuitem", { name: "Atajos de teclado" }));
    const panel = document.getElementById("panel") as HTMLDialogElement;
    expect(panel.open).toBe(true);
    expect(panel.querySelector("table.keys")).toBeTruthy();
    act(() => panel.close());
    expect(dialog.getState().open).toBe(false);
    expect(document.activeElement).toBe(me);
  });

  it("keeps the width a splitter was moved to", () => {
    render(<App />);
    const split = screen.getByRole("separator", { name: "Ancho de la barra lateral" });
    document.getElementById("rail")!.getBoundingClientRect = () => new DOMRect(0, 0, 280, 600);
    fireEvent.keyDown(split, { key: "ArrowRight" });
    expect(shell.getState().sizes["--rail-width"]).toBe(280);
    expect(body().style.getPropertyValue("--rail-width")).toBe("280px");
    fireEvent.doubleClick(split);
    expect(shell.getState().sizes["--rail-width"]).toBeUndefined();
  });

  it("speaks the language chosen", () => {
    showLanguage("en");
    render(<App />);
    expect(screen.getByRole("button", { name: "Hide sidebar" }).title).toBe("Hide sidebar (Ctrl+B)");
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(within(document.getElementById("tool-menu")!).getByRole("menuitemradio", { name: /Changes/ }).textContent).toContain("What differs from the last commit");
    expect(screen.getByRole("separator", { name: "Sidebar width" })).toBeTruthy();
  });
});
