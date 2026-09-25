// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Found, ProviderState } from "../../ipc/types";
import { profile } from "../profile/store";
import { rail } from "../rail/store";
import { settings } from "../settings/store";
import { greetAtStart, greetIfNew, openWelcome, welcome } from "./store";
import { Welcome } from "./Welcome";

const ipc = vi.hoisted(() => ({
  commands: {
    profile: vi.fn(),
    saveProfile: vi.fn(),
    setWelcomed: vi.fn(),
    welcomeScan: vi.fn(),
    welcomeAdopt: vi.fn(),
    welcomeServers: vi.fn(),
    providersState: vi.fn(),
    workspaces: vi.fn(),
  },
  heard: { welcome: (_done: number, _total: number) => {} },
  draft: vi.fn(async () => {}),
}));

vi.mock(import("../models/store"), async (original) => ({ ...(await original()), readAccount: vi.fn(async () => null), refreshModels: vi.fn(async () => {}) }));

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: {
    claudeCode: () => Promise.resolve(() => {}),
    welcome: (heard: (done: number, total: number) => void) => {
      ipc.heard.welcome = heard;
      return Promise.resolve(() => {});
    },
  },
}));

vi.mock("../../app/session", () => ({ draft: ipc.draft, showView: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isMaximized: async () => false, onResized: async () => () => {}, minimize: vi.fn(), toggleMaximize: vi.fn(async () => {}), close: vi.fn() }),
}));

const DAY = 86_400_000;

const claude = (over: Partial<ProviderState> = {}): ProviderState => ({
  id: "claude",
  vendor: "Anthropic",
  label: "Claude Code",
  method: "subscription",
  keyHint: "",
  version: "2.1.0",
  account: { billing: "subscription", plan: "max", source: "claude.ai", email: "ada@example.com" },
  error: "",
  installed: true,
  ...over,
});

const found = (over: Partial<Found> = {}): Found => ({
  claude: "C:/Users/ada/.claude",
  projects: [
    { root: "C:/code/shop", name: "shop", exists: true, sessions: 12, already: 0, last: Date.now() - DAY, suggested: true },
    { root: "C:/code/old", name: "old", exists: false, sessions: 4, already: 0, last: Date.now() - 90 * DAY, suggested: false },
    { root: "C:/Users/ada/Downloads", name: "Downloads", exists: true, sessions: 2, already: 0, last: Date.now() - 3 * DAY, suggested: false },
  ],
  skills: ["frontend-design"],
  servers: ["github"],
  plugins: [],
  foreign: [
    { id: "cursor:linear", source: "cursor", app: "Cursor", name: "linear", kind: "http", command: "", args: [], url: "https://mcp.linear.app/mcp", envKeys: [], blocked: "" },
    { id: "vscode:db", source: "vscode", app: "VS Code", name: "db", kind: "stdio", command: "npx", args: ["db"], url: "", envKeys: [], blocked: "usa variables ${input:…} de VS Code" },
  ],
  ...over,
});

async function flush() {
  await act(async () => {
    for (let round = 0; round < 6; round++) await Promise.resolve();
  });
}

async function press(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
}

beforeEach(() => {
  welcome.setState(welcome.getInitialState(), true);
  settings.setState(settings.getInitialState(), true);
  profile.setState({ person: { name: "", checkUpdates: true, welcomed: false, seen: "", notify: true }, fault: "" });
  rail.setState({ spaces: [] });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.draft.mockClear();
  ipc.commands.profile.mockImplementation(async () => profile.getState().person);
  ipc.commands.providersState.mockResolvedValue([claude()]);
  ipc.commands.workspaces.mockResolvedValue([]);
  ipc.commands.welcomeScan.mockResolvedValue(found());
  ipc.commands.welcomeAdopt.mockResolvedValue({ sessions: 12, projects: 1, skipped: [] });
  ipc.commands.welcomeServers.mockResolvedValue({ added: ["linear"], skipped: [] });
});

afterEach(cleanup);

describe("the welcome", () => {
  it("opens only for someone the profile says has not seen it", () => {
    profile.setState({ person: { name: "", checkUpdates: true, welcomed: true, seen: "", notify: true } });
    greetIfNew();
    expect(welcome.getState().open).toBe(false);

    profile.setState({ person: { name: "", checkUpdates: true, welcomed: false, seen: "", notify: true } });
    greetIfNew();
    expect(welcome.getState().open).toBe(true);
  });

  it("is there from the first frame when Rust says a fresh install has not seen it", async () => {
    window.__SENS_WELCOMED__ = true;
    greetAtStart();
    expect(welcome.getState().open).toBe(false);

    window.__SENS_WELCOMED__ = false;
    greetAtStart();
    render(<Welcome />);
    expect(welcome.getState()).toMatchObject({ open: true, still: true, step: "hello", name: "" });
    expect(screen.getByRole("dialog", { name: "Bienvenida a Sens" }).dataset.still).toBe("true");

    await press(/Empezar/);
    profile.setState({ person: { name: "Ada", checkUpdates: true, welcomed: false, seen: "", notify: true } });
    greetIfNew();
    expect(welcome.getState()).toMatchObject({ open: true, step: "name", name: "Ada" });
    delete window.__SENS_WELCOMED__;
  });

  it("walks from hello to a finished import and opens the chosen project", async () => {
    openWelcome();
    render(<Welcome />);

    await press(/Empezar/);
    fireEvent.change(screen.getByLabelText("Tu nombre"), { target: { value: "Ada Lovelace" } });
    expect(screen.getByText("AL")).toBeTruthy();
    await press(/Continuar/);

    expect(await screen.findByText(/Suscripción Max/)).toBeTruthy();
    await press(/Continuar/);

    expect(await screen.findByText("14 sesiones en 2 proyectos")).toBeTruthy();
    const shop = screen.getByText("shop").closest("label")!;
    expect(within(shop).getByRole("checkbox")).toHaveProperty("checked", true);
    await press(/Importar/);

    expect(screen.getByRole("radio", { name: /shop/ }).getAttribute("aria-checked")).toBe("true");
    await press(/Continuar/);
    await flush();

    expect(ipc.commands.saveProfile).toHaveBeenCalledWith("Ada Lovelace");
    expect(ipc.commands.welcomeAdopt).toHaveBeenCalledWith(["C:/code/shop"]);
    expect(ipc.commands.welcomeServers).toHaveBeenCalledWith(["cursor:linear"], ["C:/code/shop"]);
    expect(ipc.commands.setWelcomed).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Todo listo, Ada.")).toBeTruthy();

    await press(/Abrir Sens/);
    expect(ipc.draft).toHaveBeenCalledWith("C:/code/shop");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks itself seen and closes when skipped", async () => {
    openWelcome();
    render(<Welcome />);

    await press("Saltar la bienvenida");

    expect(ipc.commands.setWelcomed).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not offer projects whose folder is gone, nor servers it cannot bring", async () => {
    openWelcome("import");
    render(<Welcome />);
    await flush();

    const old = screen.getByText("old").closest("label")!;
    expect(within(old).getByRole("checkbox")).toHaveProperty("disabled", true);
    expect(within(old).getByText("la carpeta ya no existe")).toBeTruthy();
    const db = screen.getByText("db").closest("label")!;
    expect(within(db).getByRole("checkbox")).toHaveProperty("disabled", true);
    expect(screen.getByText(/ya funcionan en Sens/)).toBeTruthy();
  });

  it("says there is nothing to bring when Claude Code left nothing behind", async () => {
    ipc.commands.welcomeScan.mockResolvedValue(found({ projects: [], skills: [], servers: [], foreign: [] }));
    openWelcome("import");
    render(<Welcome />);
    await flush();

    expect(screen.getByText("No hay nada que traer. Empiezas de cero.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeTruthy();
  });

  it("keeps going when the import fails and shows why", async () => {
    ipc.commands.welcomeAdopt.mockRejectedValue("no pude leer C:/code/shop");
    openWelcome("import");
    render(<Welcome />);
    await flush();

    await press(/Importar/);
    await press(/Continuar/);
    await flush();

    expect(await screen.findByText("Todo listo.")).toBeTruthy();
    expect(screen.getByText("no pude leer C:/code/shop")).toBeTruthy();
    expect(ipc.commands.setWelcomed).toHaveBeenCalledWith(true);
  });
});
