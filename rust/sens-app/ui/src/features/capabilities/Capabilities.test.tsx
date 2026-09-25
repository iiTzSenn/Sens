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
  name: id.split(/[:/]/).pop()!,
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
  listings: [
    listing("official:code-review", { kind: "plugin", title: "Code review", badge: "anthropic", category: "development", description: "Reviews pull requests" }),
    listing("market/fmt", { kind: "plugin", title: "Formatter", badge: "anthropic", description: "Formats code on save" }),
    listing("market/tests", { title: "Tests", description: "Writes unit tests for your code" }),
    listing("connectors:figma", { kind: "connector", title: "Figma", badge: "partner", description: "Design files", login: true, installable: false, tools: ["get_file"] }),
    listing("community:ledger", { kind: "plugin", title: "Ledger", description: "Accounting and invoices" }),
  ],
  sources: [{ id: "demo", fetchedAt: 0, error: "" }],
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

async function explore() {
  await open();
  await act(async () => showMode("explore"));
}

const row = (name: string) => screen.getByText(name, { selector: ".cap-row .cap-row-name" }).closest(".cap-row") as HTMLElement;
const card = (name: string) => screen.getByText(name, { selector: ".mk-card .mk-card-name" }).closest(".mk-card") as HTMLElement;
const cards = () => [...document.querySelectorAll("#caps-explore .mk-card-name")].map((one) => one.textContent);
const place = (name: RegExp) => within(screen.getByRole("navigation", { name: "Secciones" })).getByRole("button", { name });

describe("installed capabilities", () => {
  it("shows what the project has on, grouped, with a count per tab", async () => {
    await open();
    expect(screen.getByText("1 plugin y 1 MCP activos en este proyecto")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Skills/ }).textContent).toBe("Skills 1");
    expect(screen.getByRole("heading", { name: "Activas en demo 2" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sin activar en demo 1" })).toBeTruthy();
    expect(within(row("github")).getByText("npx server · TOKEN")).toBeTruthy();
    expect(within(row("fmt")).getByText(/Plugin · Formatter · v1\.0\.0/)).toBeTruthy();
    expect(within(row("notas")).getByText(/Skill · Local/)).toBeTruthy();
  });

  it("flips a switch at once and puts it back when Rust refuses", async () => {
    ipc.commands.setCapability.mockRejectedValue("sin permiso");
    await open();
    const toggle = within(row("notas")).getByRole("switch", { name: "Activar notas en demo" });
    await act(async () => fireEvent.click(toggle));
    expect(ipc.commands.setCapability).toHaveBeenCalledWith("skill", "C:/Proyectos/demo", "notas", true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
  });

  it("cannot switch anything on without a project, and lists everything together", async () => {
    project.setState({ root: "" });
    await open();
    expect(screen.getByText("Abre un proyecto para activar capacidades.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Instaladas 3" })).toBeTruthy();
    expect(within(row("notas")).getByRole("switch")).toHaveProperty("disabled", true);
  });

  it("says when the tab is empty and when nothing matches", async () => {
    ipc.commands.capabilities.mockResolvedValue({ ...NO_CAPS });
    await open();
    expect(screen.getByText("No hay capacidades")).toBeTruthy();

    ipc.commands.capabilities.mockResolvedValue(installed());
    await act(async () => enterCapabilities());
    fireEvent.change(screen.getByLabelText("Buscar una skill, plugin o servidor"), { target: { value: "zzz" } });
    expect(within(document.getElementById("caps-list")!).getByText("Nada coincide.")).toBeTruthy();
  });

  it("makes Añadir open the MCP form on the MCP tab, and checks the variables before sending", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /MCP/ }));
    const add = screen.getByText("Añadir", { selector: "#caps-add" });
    expect(add.getAttribute("aria-haspopup")).toBeNull();
    act(() => fireEvent.click(add));
    expect(shown()?.title).toBe("Añadir servidor MCP");

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "db" } });
    fireEvent.change(screen.getByLabelText("Variables de entorno"), { target: { value: "sin igual" } });
    await act(async () => fireEvent.click(screen.getByText("Añadir", { selector: "button[type=submit]" })));
    expect(ipc.commands.addServer).not.toHaveBeenCalled();
    expect(screen.getByText("Variables de entorno, línea 1: escribe CLAVE=valor.")).toBeTruthy();
  });

  it("removes from the row menu after asking, and sends the focus to Añadir", async () => {
    await open();
    fireEvent.click(within(row("notas")).getByRole("button", { name: "Acciones de notas" }));
    act(() => fireEvent.click(within(row("notas")).getByRole("menuitem", { name: "Quitar", hidden: true })));
    expect(shown()?.title).toBe("Quitar notas");

    await act(async () => fireEvent.click(screen.getByText("Quitar", { selector: "button[type=submit]" })));
    expect(ipc.commands.removeCapability).toHaveBeenCalledWith("skill", "notas");
    expect(dialog.getState().open).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("caps-add"));
  });

  it("says when the catalogue has a newer version and updates from the row", async () => {
    ipc.commands.market.mockResolvedValue({ ...market, listings: market.listings.map((one) => (one.id === "market/fmt" ? { ...one, revision: "r2" } : one)) });
    await open();
    expect(within(row("fmt")).getByText("Actualización disponible")).toBeTruthy();
    fireEvent.click(within(row("fmt")).getByRole("button", { name: "Acciones de fmt" }));
    await act(async () => fireEvent.click(within(row("fmt")).getByRole("menuitem", { name: "Actualizar", hidden: true })));
    expect(ipc.commands.marketUpdate).toHaveBeenCalledWith("market/fmt", "fmt");
  });
});

describe("explore", () => {
  it("opens on picks from Anthropic and a row per section, with every section counted", async () => {
    await explore();
    const featured = screen.getByRole("region", { name: "Para empezar" });
    expect(within(featured).getByText("Code review")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Código y desarrollo" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Finanzas" })).getByText("Ledger")).toBeTruthy();
    expect(place(/Todo/).textContent).toBe("Todo5");
    expect(place(/Diseño y medios/).textContent).toBe("Diseño y medios1");
    expect(screen.queryByRole("region", { name: "Conecta tus herramientas" })).toBeNull();
  });

  it("browses one section, and marks what is installed and on", async () => {
    await explore();
    fireEvent.click(place(/Código y desarrollo/));
    expect(screen.getByRole("heading", { name: "Código y desarrollo" })).toBeTruthy();
    expect(cards()).toEqual(["Code review", "Formatter", "Tests"]);
    expect(within(card("Formatter")).getByText("Activa aquí")).toBeTruthy();
    expect(within(card("Formatter")).getByRole("switch", { name: "Activar fmt en demo" })).toBeTruthy();
  });

  it("filters by kind across the catalogue", async () => {
    await explore();
    fireEvent.click(place(/Todo/));
    fireEvent.click(screen.getByText("Skills", { selector: ".chip" }));
    expect(cards()).toEqual(["Tests"]);
    expect(within(card("Tests")).getByText("Código y desarrollo")).toBeTruthy();
  });

  it("says what a connector brings and why it cannot be added", async () => {
    await explore();
    fireEvent.click(place(/Diseño y medios/));
    const figma = card("Figma");
    expect(within(figma).getByText("1 herramienta")).toBeTruthy();
    expect(within(figma).getByText("Pide iniciar sesión")).toBeTruthy();
    expect(within(figma).getByText("Oficial")).toBeTruthy();
    expect(within(figma).queryByRole("button", { name: /Añadir/ })).toBeNull();
  });

  it("searches everything, adding skills.sh hits once they arrive", async () => {
    vi.useFakeTimers();
    ipc.commands.marketSearch.mockResolvedValue([listing("skills.sh:acme/skills/react", { title: "React", badge: "skillsSh", installs: 12_300 })]);
    await explore();
    fireEvent.change(screen.getByLabelText("Buscar en el mercado"), { target: { value: "react" } });
    expect(screen.getByText("Buscando también en skills.sh…")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(ipc.commands.marketSearch).toHaveBeenCalledWith("react");
    expect(within(card("React")).getByText("12,3k instalaciones")).toBeTruthy();
    expect(screen.getByText("1 resultado para «react»")).toBeTruthy();
    vi.useRealTimers();
  });

  it("adds from a card in one click what asks for nothing", async () => {
    ipc.commands.marketDetail.mockResolvedValue(detail("market/tests"));
    await explore();
    fireEvent.click(place(/Todo/));
    await act(async () => fireEvent.click(within(card("Tests")).getByRole("button", { name: "Añadir Tests a demo" })));
    expect(ipc.commands.marketDetail).toHaveBeenCalledWith("market/tests");
    expect(ipc.commands.marketInstall).toHaveBeenCalledWith("C:/Proyectos/demo", "market/tests", {});
    expect(shown()).toBeNull();
  });

  it("asks before adding from a card what runs code", async () => {
    ipc.commands.marketDetail.mockResolvedValue(
      detail("community:ledger", { parts: { skills: [], commands: [], agents: [], hooks: [{ event: "PostToolUse", command: "ledger sync" }], servers: [], lsp: [], bin: [] } }),
    );
    await explore();
    fireEvent.click(place(/Todo/));
    await act(async () => fireEvent.click(within(card("Ledger")).getByRole("button", { name: "Añadir Ledger a demo" })));
    expect(shown()?.title).toBe("Instalar Ledger");
    expect(screen.getByText("ledger sync")).toBeTruthy();
    expect(ipc.commands.marketInstall).not.toHaveBeenCalled();
  });

  it("says why a card could not be added", async () => {
    ipc.commands.marketDetail.mockRejectedValue("sin red");
    await explore();
    fireEvent.click(place(/Todo/));
    await act(async () => fireEvent.click(within(card("Tests")).getByRole("button", { name: "Añadir Tests a demo" })));
    expect(screen.getByRole("alert").textContent).toBe("No pude añadir Tests: sin red");
  });
});

describe("detail", () => {
  it("installs at once what asks for nothing, into the open project", async () => {
    ipc.commands.marketDetail.mockResolvedValue(detail("market/tests"));
    await open();
    await act(async () => openDetail("market/tests"));
    expect(screen.getByText("No ejecuta código: solo instrucciones.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Añadir a demo")));
    expect(ipc.commands.marketInstall).toHaveBeenCalledWith("C:/Proyectos/demo", "market/tests", {});
    expect(shown()).toBeNull();
  });

  it("asks first when the install needs values", async () => {
    ipc.commands.marketDetail.mockResolvedValue(
      detail("market/tests", { needs: [{ name: "TOKEN", description: "El token", secret: true, required: true, default: "" }] }),
    );
    await open();
    await act(async () => openDetail("market/tests"));
    act(() => fireEvent.click(screen.getByText("Añadir a demo")));
    expect(shown()?.title).toBe("Instalar Tests");
    const token = screen.getByLabelText("TOKEN");
    expect(token.getAttribute("type")).toBe("password");
    fireEvent.change(token, { target: { value: "abc" } });
    await act(async () => fireEvent.click(screen.getByText("Instalar", { selector: "button[type=submit]" })));
    expect(ipc.commands.marketInstall).toHaveBeenCalledWith("C:/Proyectos/demo", "market/tests", { TOKEN: "abc" });
  });

  it("says up front what it runs, and how it connects", async () => {
    ipc.commands.marketDetail.mockResolvedValue(
      detail("market/fmt", { parts: { skills: [], commands: [], agents: [], hooks: [{ event: "PostToolUse", command: "fmt" }], servers: [], lsp: [], bin: [] } }),
    );
    await open();
    await act(async () => openDetail("market/fmt"));
    expect(screen.getByText("Ejecuta código en tu equipo: 1 hook.")).toBeTruthy();
    const journey = screen.getByRole("list", { name: "Cómo se conecta" });
    expect(within(journey).getByText("Instalada · v1.0.0")).toBeTruthy();
    expect(within(journey).getByText("Activada")).toBeTruthy();
    expect(within(journey).getByText("Desde tu próximo mensaje")).toBeTruthy();
    fireEvent.click(screen.getByText("Ver qué ejecuta"));
    expect(screen.getByRole("tab", { name: "Qué ejecuta" }).getAttribute("aria-selected")).toBe("true");
  });

  it("offers the switch, an update and uninstall for what is installed", async () => {
    ipc.commands.marketDetail.mockResolvedValue(detail("market/fmt", { listing: { ...market.listings[1], revision: "r2" } }));
    await open();
    await act(async () => openDetail("market/fmt"));
    expect(screen.getByText("Activa en demo")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Actualizar")));
    expect(ipc.commands.marketUpdate).toHaveBeenCalledWith("market/fmt", "fmt");
    expect(screen.getByRole("button", { name: "Desinstalar" })).toBeTruthy();
  });

  it("lets an update that failed be tried again", async () => {
    ipc.commands.marketDetail.mockResolvedValue(detail("market/fmt", { listing: { ...market.listings[1], revision: "r2" } }));
    ipc.commands.marketUpdate.mockRejectedValue("sin red");
    await open();
    await act(async () => openDetail("market/fmt"));
    await act(async () => fireEvent.click(screen.getByText("Actualizar")));
    expect(screen.getByRole("alert").textContent).toBe("sin red");
    expect(screen.getByText("Actualizar").closest("button")).toHaveProperty("disabled", false);
  });
});
