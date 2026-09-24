// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capabilities as Caps, Detail, Listing, Market } from "../../ipc/types";
import { Dialog } from "../../app/Dialog";
import { dialog } from "../../app/modal";
import { project } from "../project/store";
import { Capabilities } from "./Capabilities";
import { NO_CAPS } from "./kinds";
import { capabilities, enterCapabilities, openDetail, showMode } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    capabilities: vi.fn(),
    setCapability: vi.fn(),
    removeCapability: vi.fn(),
    skillText: vi.fn(),
    createSkill: vi.fn(),
    importSkill: vi.fn(),
    addServer: vi.fn(),
    market: vi.fn(),
    marketSearch: vi.fn(),
    marketDetail: vi.fn(),
    marketFile: vi.fn(),
    marketInstall: vi.fn(),
    marketUpdate: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const installed = (): Caps => ({
  skills: [{ name: "notas", description: "Resume la sesión", enabled: false }],
  servers: [{ name: "github", command: "npx", args: ["server"], envKeys: ["TOKEN"], kind: "stdio", url: "", enabled: true }],
  plugins: [{ name: "fmt", description: "Formatea", version: "1.0.0", enabled: true }],
  origins: { "plugin:fmt": { listing: "market/fmt", revision: "r1", version: "1.0.0", installedAt: 1 } },
});

const listing = (id: string, over: Partial<Listing> = {}): Listing => ({
  id,
  kind: "skill",
  name: id,
  title: id,
  description: `sobre ${id}`,
  author: "Demo",
  badge: "community",
  source: "",
  category: "",
  version: "1.0.0",
  homepage: "",
  installs: null,
  login: false,
  tools: [],
  installable: true,
  revision: "r1",
  ...over,
});

const market: Market = {
  listings: [listing("market/fmt", { kind: "plugin", title: "Formatter", badge: "anthropic" }), listing("market/tests", { title: "Tests" })],
  sources: [{ id: "demo", label: "Demo", fetchedAt: 0, error: "" }],
};

const detail = (id: string, over: Partial<Detail> = {}): Detail => ({
  listing: market.listings.find((one) => one.id === id)!,
  readme: "# Léeme",
  license: "MIT",
  files: [],
  parts: { skills: [], commands: [], agents: [], hooks: [], servers: [], lsp: [], bin: [] },
  needs: [],
  ...over,
});

// The dialog's title while it is open.
const shown = () => (dialog.getState().open ? { title: dialog.getState().title } : null);

// jsdom has no modal dialogs: these open and close it, as the WebView does.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  capabilities.setState(capabilities.getInitialState(), true);
  project.setState({ root: "C:/Proyectos/demo" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.capabilities.mockResolvedValue(installed());
  ipc.commands.market.mockResolvedValue(market);
  ipc.commands.marketSearch.mockResolvedValue([]);
  dialog.setState(dialog.getInitialState(), true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

async function open() {
  render(
    <>
      <Capabilities />
      <Dialog />
    </>,
  );
  await act(async () => enterCapabilities());
}

const card = (name: string) => screen.getByText(name, { selector: ".card .name" }).closest(".card") as HTMLElement;

describe("installed capabilities", () => {
  it("shows what the project has on, with a count per tab", async () => {
    await open();
    expect(screen.getByText("1 plugin y 1 MCP activos en este proyecto")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Skills/ }).textContent).toBe("Skills 1");
    expect(screen.getByRole("tab", { name: /Activas/ }).textContent).toBe("Activas 2");
    expect(within(card("github")).getByText("npx server · TOKEN")).toBeTruthy();
  });

  it("flips a switch at once and puts it back when Rust refuses", async () => {
    ipc.commands.setCapability.mockRejectedValue("sin permiso");
    await open();
    const toggle = within(card("notas")).getByRole("switch");
    await act(async () => fireEvent.click(toggle));
    expect(ipc.commands.setCapability).toHaveBeenCalledWith("skill", "C:/Proyectos/demo", "notas", true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
  });

  it("cannot switch anything on without a project", async () => {
    project.setState({ root: "" });
    await open();
    expect(screen.getByText("Abre un proyecto para activar capacidades.")).toBeTruthy();
    expect(within(card("notas")).getByRole("switch")).toHaveProperty("disabled", true);
  });

  it("says when the tab is empty and when nothing matches", async () => {
    ipc.commands.capabilities.mockResolvedValue({ ...NO_CAPS });
    await open();
    expect(screen.getByText("No hay capacidades")).toBeTruthy();

    ipc.commands.capabilities.mockResolvedValue(installed());
    await act(async () => enterCapabilities());
    fireEvent.change(screen.getByLabelText("Buscar una skill, plugin o servidor"), { target: { value: "zzz" } });
    expect(screen.getByText("Nada coincide.")).toBeTruthy();
  });

  it("makes Añadir open the MCP form on the MCP tab, and checks the variables before sending", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /MCP/ }));
    const add = screen.getByText("Añadir");
    expect(add.getAttribute("aria-haspopup")).toBeNull();
    act(() => fireEvent.click(add));
    expect(shown()?.title).toBe("Añadir servidor MCP");

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "db" } });
    fireEvent.change(screen.getByLabelText("Variables de entorno"), { target: { value: "sin igual" } });
    await act(async () => fireEvent.click(screen.getByText("Añadir", { selector: "button[type=submit]" })));
    expect(ipc.commands.addServer).not.toHaveBeenCalled();
    expect(screen.getByText("Variables de entorno, línea 1: escribe CLAVE=valor.")).toBeTruthy();
  });

  it("removes from the card menu after asking, and sends the focus to Añadir", async () => {
    await open();
    fireEvent.click(within(card("notas")).getByRole("button", { name: "Acciones de notas" }));
    act(() => fireEvent.click(within(card("notas")).getByRole("menuitem", { hidden: true })));
    expect(shown()?.title).toBe("Quitar notas");

    await act(async () => fireEvent.click(screen.getByText("Quitar", { selector: "button[type=submit]" })));
    expect(ipc.commands.removeCapability).toHaveBeenCalledWith("skill", "notas");
    expect(dialog.getState().open).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("caps-add"));
  });
});

describe("market", () => {
  it("marks what is installed and filters by kind", async () => {
    await open();
    await act(async () => showMode("explore"));
    expect(within(card("Formatter")).getByText("Instalada")).toBeTruthy();
    fireEvent.click(screen.getByText("Skills", { selector: ".chip" }));
    expect(screen.queryByText("Formatter", { selector: ".card .name" })).toBeNull();
    expect(card("Tests")).toBeTruthy();
  });

  it("adds skills.sh hits to a search once they arrive", async () => {
    vi.useFakeTimers();
    ipc.commands.marketSearch.mockResolvedValue([listing("skills.sh/react", { title: "React", badge: "skillsSh" })]);
    await open();
    await act(async () => showMode("explore"));
    fireEvent.change(screen.getByLabelText("Buscar en el mercado"), { target: { value: "react" } });
    expect(screen.getByText("Buscando también en skills.sh…")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(ipc.commands.marketSearch).toHaveBeenCalledWith("react");
    expect(card("React")).toBeTruthy();
    vi.useRealTimers();
  });

  it("installs at once what asks for nothing", async () => {
    ipc.commands.marketDetail.mockResolvedValue(detail("market/tests"));
    await open();
    await act(async () => openDetail("market/tests"));
    await act(async () => fireEvent.click(screen.getByText("Instalar")));
    expect(ipc.commands.marketInstall).toHaveBeenCalledWith("C:/Proyectos/demo", "market/tests", {});
    expect(shown()).toBeNull();
  });

  it("asks first when the install needs values", async () => {
    ipc.commands.marketDetail.mockResolvedValue(
      detail("market/tests", { needs: [{ name: "TOKEN", description: "El token", secret: true, required: true, default: "" }] }),
    );
    await open();
    await act(async () => openDetail("market/tests"));
    act(() => fireEvent.click(screen.getByText("Instalar")));
    expect(shown()?.title).toBe("Instalar Tests");
    const token = screen.getByLabelText("TOKEN");
    expect(token.getAttribute("type")).toBe("password");
    fireEvent.change(token, { target: { value: "abc" } });
    await act(async () => fireEvent.click(screen.getByText("Instalar", { selector: "button[type=submit]" })));
    expect(ipc.commands.marketInstall).toHaveBeenCalledWith("C:/Proyectos/demo", "market/tests", { TOKEN: "abc" });
  });

  it("offers the switch, an update and uninstall for what is installed", async () => {
    ipc.commands.marketDetail.mockResolvedValue(detail("market/fmt", { listing: { ...market.listings[0], revision: "r2" } }));
    await open();
    await act(async () => openDetail("market/fmt"));
    expect(screen.getByText("Activa en demo")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Actualizar")));
    expect(ipc.commands.marketUpdate).toHaveBeenCalledWith("market/fmt", "fmt");
    expect(screen.getByText("Desinstalar")).toBeTruthy();
  });
});
