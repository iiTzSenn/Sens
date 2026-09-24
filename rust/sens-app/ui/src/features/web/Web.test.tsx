// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Heard } from "../../ipc/types";
import { shell } from "../../app/shell";
import { focused } from "../panes/store";
import { sheets } from "../../shared/sheets.js";
import { project } from "../project/store";
import { aimSite, forgetSite, hearBrowser, onProject, syncBrowser, web } from "./store";
import { Address, Outside, Web } from "./Web";

const ipc = vi.hoisted(() => ({
  commands: {
    previewUrl: vi.fn(),
    browserOpen: vi.fn(),
    browserPlace: vi.fn(),
    browserShow: vi.fn(),
    browserAct: vi.fn(),
    openExternal: vi.fn(),
  },
  heard: null as ((what: Heard) => void) | null,
}));

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: { browser: (heard: (what: Heard) => void) => ((ipc.heard = heard), Promise.resolve(() => {})) },
}));

let address: HTMLElement;
let out: HTMLElement;
const frame = () => new Promise((settle) => requestAnimationFrame(settle));

beforeAll(() => {
  hearBrowser();
  // jsdom has no ResizeObserver: the frame just never resizes.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

beforeEach(() => {
  address = document.body.appendChild(document.createElement("div"));
  out = document.body.appendChild(document.createElement("div"));
  web.setState(web.getInitialState(), true);
  project.setState({ root: "C:/demo" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.previewUrl.mockResolvedValue("http://127.0.0.1:4321/p7/docs/index.html");
  shell.setState({ ...shell.getInitialState(), toolsOpen: true, tool: "web" }, true);
  focused().chat.setState({ turns: [] });
});

afterEach(() => {
  cleanup();
  address.remove();
  out.remove();
  forgetSite();
});

const show = () => {
  render(<Address />, { container: address });
  render(<Outside />, { container: out });
  return render(<Web />);
};
const bar = () => screen.getByRole("textbox", { name: "Dirección o página del proyecto" }) as HTMLInputElement;

async function type(text: string) {
  fireEvent.change(bar(), { target: { value: text } });
  await act(async () => fireEvent.submit(bar()));
}

describe("web panel", () => {
  it("waits for an address, with nothing to press yet", () => {
    show();
    expect(screen.getByText(/Busca en la web o escribe una dirección/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Recargar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(out.childElementCount).toBe(0);
  });

  it("reads what is typed as a local server, an address, a host, or a search", async () => {
    show();
    const opened = () => ipc.commands.browserOpen.mock.calls.at(-1)?.[0];
    await type("localhost:5173");
    expect(opened()).toBe("http://localhost:5173");
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "web" });
    await type("example.com/docs");
    expect(opened()).toBe("https://example.com/docs");
    await type("cómo centrar un div");
    expect(opened()).toBe("https://www.google.com/search?q=c%C3%B3mo%20centrar%20un%20div");
    await type("ftp://viejo.net");
    expect(focused().chat.getState().turns.at(-1)).toMatchObject({ kind: "notice", parts: ["El navegador solo abre direcciones http y https."], tone: "warn" });
  });

  it("serves a page of the project, and shows it by its path", async () => {
    show();
    await type("./docs/index.html");
    expect(ipc.commands.previewUrl).toHaveBeenCalledWith("C:/demo", "docs/index.html");
    expect(ipc.commands.browserOpen.mock.calls[0][0]).toBe("http://127.0.0.1:4321/p7/docs/index.html");
    expect(bar().value).toBe("docs/index.html");
    expect(onProject()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Abrir en el navegador" }));
    expect(ipc.commands.openExternal).toHaveBeenCalledWith("http://127.0.0.1:4321/p7/docs/index.html");
  });

  it("follows the page, and keeps its console with the errors flagged", async () => {
    show();
    await act(async () => aimSite("https://example.com"));
    act(() => ipc.heard!({ kind: "loading", url: "https://example.com/a" }));
    expect(screen.getByRole("button", { name: "Recargar" }).dataset.loading).toBe("true");
    act(() => {
      ipc.heard!({ kind: "loaded", url: "https://example.com/a" });
      ipc.heard!({ kind: "titled", title: "Ejemplo" });
      ipc.heard!({ kind: "said", level: "error", text: "x is not defined" });
    });
    expect(bar().value).toBe("https://example.com/a");
    expect(bar().title).toBe("Ejemplo");
    const console = screen.getByRole("button", { name: "Consola" });
    expect(console.dataset.fault).toBe("true");

    fireEvent.click(console);
    expect(console.getAttribute("aria-pressed")).toBe("true");
    expect(console.dataset.fault).toBe("false");
    expect(document.querySelector('#site-log p[data-level="error"]')?.textContent).toBe("x is not defined");

    // A new page starts a clean console.
    act(() => ipc.heard!({ kind: "loading", url: "https://example.com/b" }));
    expect(document.querySelectorAll("#site-log p")).toHaveLength(0);
  });

  it("keeps what is being typed while the page moves on", async () => {
    show();
    await act(async () => aimSite("https://example.com"));
    bar().focus();
    fireEvent.change(bar(), { target: { value: "otra" } });
    act(() => ipc.heard!({ kind: "loaded", url: "https://example.com/z" }));
    expect(bar().value).toBe("otra");
  });

  it("lays the page over the frame, and hides it when a menu covers it", async () => {
    show();
    await act(async () => aimSite("https://example.com"));
    fireEvent.click(screen.getByRole("button", { name: "768" }));
    expect(screen.getByRole("button", { name: "768" }).getAttribute("aria-pressed")).toBe("true");
    expect(web.getState().width).toBe(768);

    // jsdom lays nothing out: the frame and a menu over it are given boxes.
    document.getElementById("site-frame")!.getBoundingClientRect = () => new DOMRect(300, 100, 400, 600);
    const sheet = document.createElement("div");
    sheet.getBoundingClientRect = () => new DOMRect(280, 80, 200, 150);
    const one = { sheet, anchor: sheet, shut: () => {} };
    sheets.push(one);
    syncBrowser();
    await frame();
    expect(ipc.commands.browserShow).toHaveBeenLastCalledWith(false);
    sheet.hidden = true;
    syncBrowser();
    await frame();
    expect(ipc.commands.browserShow).toHaveBeenLastCalledWith(true);
    sheets.splice(sheets.indexOf(one), 1);
  });

  it("closes the page when the project changes", async () => {
    show();
    await act(async () => aimSite("https://example.com"));
    act(() => forgetSite());
    expect(ipc.commands.browserAct).toHaveBeenCalledWith("close");
    expect(screen.getByText(/Busca en la web/)).toBeTruthy();
  });
});
