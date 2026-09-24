// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Progress, SetupState } from "./ipc";
import { Setup } from "./Setup";
import { boot, installer } from "./store";

const fake = vi.hoisted(() => ({
  state: null as unknown as SetupState,
  progress: (_: Progress) => {},
  running: () => {},
  install: vi.fn(),
  uninstall: vi.fn(),
  launch: vi.fn(),
  quit: vi.fn(),
  cancel: vi.fn(),
  closeApp: vi.fn(),
}));

vi.mock("./ipc", () => ({
  setup: {
    state: async () => fake.state,
    dir: async () => ({ free: 1e11, problem: "" }),
    install: fake.install,
    uninstall: fake.uninstall,
    cancel: fake.cancel,
    closeApp: fake.closeApp,
    launch: fake.launch,
    quit: fake.quit,
  },
  heard: {
    progress: async (then: (progress: Progress) => void) => {
      fake.progress = then;
      return () => {};
    },
    running: async (then: () => void) => {
      fake.running = then;
      return () => {};
    },
  },
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: vi.fn(), minimize: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

const base = (over: Partial<SetupState> = {}): SetupState => ({
  mode: "install",
  version: "0.17.0",
  installed: null,
  dir: "C:\\Users\\ada\\AppData\\Local\\Sens",
  size: 7_329_792,
  free: 1e11,
  passive: false,
  relaunch: false,
  desktop: false,
  demo: false,
  ...over,
});

const shown = () => installer.getState().screen;

async function open(over: Partial<SetupState> = {}) {
  fake.state = base(over);
  render(<Setup />);
  await act(boot);
}

async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

beforeEach(() => {
  installer.setState(installer.getInitialState(), true);
  for (const one of [fake.install, fake.uninstall, fake.launch, fake.quit, fake.cancel, fake.closeApp]) one.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("the installer", () => {
  it("greets a first install and says which version it carries", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Instala Sens." })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Instalar Sens/ })).toBeTruthy();
    expect(screen.getByText(/v0\.17\.0/)).toBeTruthy();
  });

  it("offers to update an older Sens and to reinstall the same one", async () => {
    await open({ installed: { version: "0.16.0", dir: "C:\\Sens" } });
    expect(screen.getByRole("heading", { name: "Actualiza Sens." })).toBeTruthy();
    expect(screen.getByText("Tienes la 0.16.0. Esta es la 0.17.0.")).toBeTruthy();
    cleanup();

    installer.setState(installer.getInitialState(), true);
    await open({ installed: { version: "0.17.0", dir: "C:\\Sens" } });
    expect(screen.getByRole("heading", { name: "Reinstala Sens." })).toBeTruthy();
  });

  it("installs with the chosen shortcuts and lands on the finished screen", async () => {
    await open();
    fake.install.mockImplementation(async () => {
      fake.progress({ step: "extract", progress: 0.5, line: "Descomprimiendo sens-app.exe" });
      fake.progress({ step: "done", progress: 1, line: "Listo en 1,2 s" });
    });

    await press("Personalizar instalación");
    fireEvent.click(screen.getByLabelText("Acceso directo en el escritorio"));
    await press(/Instalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });

    expect(fake.install).toHaveBeenCalledWith({ dir: "C:\\Users\\ada\\AppData\\Local\\Sens", desktop: false, startMenu: true });
    expect(await screen.findByRole("heading", { name: "Sens está lista." })).toBeTruthy();
    expect(installer.getState().lines).toContain("Listo en 1,2 s");
  });

  it("shows why it could not finish and goes back when cancelled", async () => {
    await open();
    fake.install.mockRejectedValueOnce("no pude escribir C:\\Sens: acceso denegado");

    await press(/Instalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("error"), { timeout: 5000 });
    expect(await screen.findByText("No pude escribir C:\\Sens: acceso denegado")).toBeTruthy();

    fake.install.mockRejectedValueOnce("cancelado");
    await press("Reintentar");
    await vi.waitFor(() => expect(shown()).toBe("welcome"), { timeout: 5000 });
  });

  it("asks to close Sens when it is open and returns to the progress once it closes", async () => {
    await open();
    let finish = () => {};
    fake.install.mockImplementation(
      () =>
        new Promise<void>((done) => {
          fake.running();
          finish = done;
        }),
    );
    fake.closeApp.mockResolvedValue(true);

    await press(/Instalar Sens/);
    expect(await screen.findByRole("heading", { name: "Sens está abierta." })).toBeTruthy();
    await press("Cerrar Sens");
    expect(fake.closeApp).toHaveBeenCalledWith(false);

    await act(async () => fake.progress({ step: "extract", progress: 0.4, line: "Descomprimiendo sens-app.exe" }));
    await vi.waitFor(() => expect(shown()).toBe("busy"), { timeout: 5000 });
    await act(async () => finish());
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });
  });

  it("updates on its own, reopens Sens and quits when launched by the app", async () => {
    await open({ mode: "update", installed: { version: "0.16.0", dir: "C:\\Sens" }, passive: true, relaunch: true });

    expect(screen.getByText("0.16.0 → 0.17.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    await vi.waitFor(() => expect(fake.quit).toHaveBeenCalled(), { timeout: 5000 });
    expect(fake.install).toHaveBeenCalled();
    expect(fake.launch).toHaveBeenCalled();
  });

  it("uninstalls keeping the data unless asked, with a destructive button", async () => {
    await open({ mode: "uninstall", installed: { version: "0.17.0", dir: "C:\\Sens" } });

    expect(screen.getByRole("heading", { name: "Desinstalar Sens." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desinstalar" }).className).toContain("danger");
    expect(screen.queryByRole("button", { name: "Personalizar instalación" })).toBeNull();

    await press("Desinstalar");
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });
    expect(fake.uninstall).toHaveBeenCalledWith(false);
    expect(await screen.findByRole("heading", { name: "Sens se ha desinstalado." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Abrir Sens/ })).toBeNull();
  });
});
