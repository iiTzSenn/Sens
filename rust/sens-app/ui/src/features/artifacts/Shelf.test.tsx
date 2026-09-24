// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "../../ipc/types";
import { dialog } from "../../app/modal";
import { resume } from "../../app/session";
import { shell } from "../../app/shell";
import { viewer } from "../files/view";
import { project } from "../project/store";
import { showSite } from "../web/store";
import { Shelf } from "./Shelf";
import { artifacts, loadShelf } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    artifacts: vi.fn(),
    artifactData: vi.fn(),
    artifactText: vi.fn(),
    openExternal: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));
vi.mock("../../app/session", () => ({ resume: vi.fn(), draft: vi.fn(async () => {}), fresh: vi.fn(), chooseFolder: vi.fn(), showView: vi.fn() }));
vi.mock(import("../web/store"), async (original) => ({ ...(await original()), showSite: vi.fn(async () => {}) }));

const artifact = (name: string, over: Partial<Artifact> = {}): Artifact => ({
  kind: "file",
  root: "C:/demo",
  project: "demo",
  name,
  target: `C:/demo/.sens/artifacts/${name}`,
  session: "s1",
  sessionTitle: "Migrar",
  at: Date.now(),
  bytes: 10,
  ...over,
});

// jsdom has no IntersectionObserver: this one sees every thumbnail it is given.
class Seeing {
  constructor(private heard: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.heard([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", Seeing);
  artifacts.setState(artifacts.getInitialState(), true);
  project.setState({ root: "C:/demo" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.artifacts.mockResolvedValue([
    artifact("foto.png", { kind: "image" }),
    artifact("plan.md"),
    artifact("informe.html", { session: null }),
    artifact("docs", { kind: "link", target: "https://example.com/docs", root: "C:/otro", project: "otro" }),
  ]);
  ipc.commands.artifactData.mockResolvedValue("data:image/png;base64,AAAA");
  ipc.commands.artifactText.mockResolvedValue("# Plan");
  shell.setState(shell.getInitialState(), true);
  dialog.setState(dialog.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<Shelf />);
  await act(async () => loadShelf());
}

const card = (name: string) => screen.getByText(name, { selector: ".card .name" }).closest(".card") as HTMLElement;

describe("the shelf", () => {
  it("counts this project's artifacts and every kind across projects", async () => {
    await open();
    expect(screen.getByText("3 artefactos de este proyecto")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Todo/ }).textContent).toBe("Todo 4");
    expect(screen.getByRole("tab", { name: /Ficheros/ }).textContent).toBe("Ficheros 2");
  });

  it("opens text in the file panel, pages in the browser, and the rest outside", async () => {
    await open();
    await act(async () => fireEvent.click(within(card("plan.md")).getByRole("button", { name: /plan.md/ })));
    expect(viewer.getState()).toMatchObject({ title: "C:/demo/.sens/artifacts/plan.md", text: "# Plan", home: "C:/demo", opened: "" });
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "files" });

    await act(async () => fireEvent.click(within(card("informe.html")).getByRole("button", { name: /informe.html/ })));
    expect(showSite).toHaveBeenCalledWith("C:/demo/.sens/artifacts/informe.html", "C:/demo");

    await act(async () => fireEvent.click(within(card("docs")).getByRole("button", { name: /docs/ })));
    expect(ipc.commands.openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("says why an artifact would not open", async () => {
    ipc.commands.artifactText.mockRejectedValue("ya no existe");
    await open();
    await act(async () => fireEvent.click(within(card("plan.md")).getByRole("button", { name: /plan.md/ })));
    expect(screen.getByRole("alert").textContent).toBe("ya no existe");
  });

  it("goes to the session an artifact came from", async () => {
    await open();
    fireEvent.click(within(card("plan.md")).getByText("Migrar"));
    expect(resume).toHaveBeenCalledWith("C:/demo", "s1");
    expect(within(card("informe.html")).getByText("sin sesión").tagName).toBe("SPAN");
  });

  it("reads each picture once, for its thumbnail and its preview", async () => {
    await open();
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: /Imágenes/ })));
    const thumb = screen.getByRole("button", { name: "foto.png" });
    expect(within(thumb).getByRole("img", { hidden: true }).getAttribute("src")).toBe("data:image/png;base64,AAAA");

    await act(async () => fireEvent.click(thumb));
    expect(dialog.getState()).toMatchObject({ open: true, title: "foto.png", wide: true });
    expect(ipc.commands.artifactData).toHaveBeenCalledOnce();
  });

  it("shows only the failure when the list cannot be read", async () => {
    ipc.commands.artifacts.mockRejectedValue("sin permiso");
    await open();
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
    expect(screen.queryByText("No hay artefactos")).toBeNull();
  });
});
