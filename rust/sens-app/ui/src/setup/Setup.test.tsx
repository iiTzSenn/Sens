// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { languageNow, showLanguage } from "../shared/i18n";
import { look } from "../shared/look";
import type { Progress, SetupState } from "./ipc";
import { Installer } from "./Setup";
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
  language: vi.fn(),
  dir: vi.fn(),
}));

vi.mock("./ipc", () => ({
  setup: {
    state: async () => fake.state,
    dir: fake.dir,
    language: fake.language,
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
  look: null,
  ...over,
});

const shown = () => installer.getState().screen;

async function open(over: Partial<SetupState> = {}) {
  fake.state = base(over);
  render(<Installer />);
  await act(boot);
}

async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

async function pick(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name }));
  });
}

beforeEach(() => {
  installer.setState(installer.getInitialState(), true);
  look.setState(look.getInitialState(), true);
  for (const one of [fake.install, fake.uninstall, fake.launch, fake.quit, fake.cancel, fake.closeApp, fake.language]) one.mockReset().mockResolvedValue(undefined);
  fake.dir.mockReset().mockResolvedValue({ free: 1e11, problem: "" });
});

afterEach(() => {
  cleanup();
  showLanguage("es");
});

describe("the installer", () => {
  it("asks for the language first, in the one already shown, and says which version it carries", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Elige tu idioma." })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Español" })).toHaveProperty("checked", true);
    expect(screen.getByText(/v0\.17\.0/)).toBeTruthy();
    expect(fake.language).toHaveBeenCalledWith("es");
    expect(document.title).toBe("Instalar Sens");

    await press(/Continuar/);
    expect(screen.getByRole("heading", { name: "Instala Sens." })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Empezar/ })).toBeTruthy();
  });

  it("switches every word at once when another language is chosen, and tells Rust", async () => {
    await open();

    await pick("Deutsch");
    expect(languageNow()).toBe("de");
    expect(screen.getByRole("heading", { name: "Wähle deine Sprache." })).toBeTruthy();
    expect(fake.language).toHaveBeenLastCalledWith("de");
    expect(document.title).toBe("Sens installieren");
    expect(document.documentElement.lang).toBe("de-DE");
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Deutsch" })));

    await pick("日本語");
    expect(screen.getByRole("heading", { name: "言語を選んでください。" })).toBeTruthy();
    await press(/続ける/);
    expect(screen.getByRole("heading", { name: "Sens をインストールします。" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
  });

  it("carries the chosen language with the install of a fresh Sens", async () => {
    await open();
    await pick("Français");
    await press(/Continuer/);
    await press(/Commencer/);
    await press(/Installer Sens/);
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });

    expect(fake.install).toHaveBeenCalledWith(expect.objectContaining({ language: "fr" }));
    expect(await screen.findByRole("heading", { name: "Sens est prêt." })).toBeTruthy();
  });

  it("lets a first install choose how Sens looks, and shows it at once", async () => {
    await open();
    await press(/Continuar/);
    await press(/Empezar/);

    expect(screen.getByRole("heading", { name: "Elige cómo se ve." })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Oscuro/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Señal" })).toHaveProperty("checked", true);

    fireEvent.click(screen.getByRole("radio", { name: /Claro/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Iris" }));

    expect(document.documentElement.dataset).toMatchObject({ mode: "light", accent: "iris" });
    expect(screen.getByText("Iris")).toBeTruthy();

    await press("Volver");
    expect(shown()).toBe("welcome");
    await press(/Empezar/);
    expect(screen.getByRole("radio", { name: "Iris" })).toHaveProperty("checked", true);
  });

  it("opens a reinstall in the look and language already saved and asks neither again", async () => {
    await open({ installed: { version: "0.17.0", dir: "C:\\Sens" }, look: { mode: "light", accent: "rose" } });

    expect(document.documentElement.dataset).toMatchObject({ mode: "light", accent: "rose" });
    expect(shown()).toBe("welcome");
    await press(/Reinstalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });
    expect(fake.install).toHaveBeenCalledWith(expect.objectContaining({ look: null, language: null }));
  });

  it("lets a reinstall change the language from the foot, and keeps that one", async () => {
    await open({ installed: { version: "0.17.0", dir: "C:\\Sens" } });

    await press("Idioma: Español");
    expect(screen.getByRole("heading", { name: "Elige tu idioma." })).toBeTruthy();
    await pick("English");
    await press(/Continue/);
    expect(screen.getByRole("heading", { name: "Reinstall Sens." })).toBeTruthy();
    await press(/Reinstall Sens/);
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });

    expect(fake.install).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
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

    await press(/Continuar/);
    await press("Personalizar instalación");
    expect(await screen.findByText("Necesita 7 MB · libres 93,1 GB")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Acceso directo en el escritorio"));
    await press(/Continuar/);
    fireEvent.click(screen.getByRole("radio", { name: /Sistema/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Hielo" }));
    await press("Volver");
    expect(shown()).toBe("custom");
    await press(/Continuar/);
    await press(/Instalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });

    expect(fake.install).toHaveBeenCalledWith({
      dir: "C:\\Users\\ada\\AppData\\Local\\Sens",
      desktop: false,
      startMenu: true,
      look: { mode: "system", accent: "ice" },
      language: "es",
    });
    expect(await screen.findByRole("heading", { name: "Sens está lista." })).toBeTruthy();
    expect(installer.getState().lines).toContain("Listo en 1,2 s");
  });

  it("asks Rust again about the folder when the language changes, so its words follow", async () => {
    fake.dir.mockResolvedValueOnce({ free: 1e11, problem: "ahí no se puede escribir" }).mockResolvedValueOnce({ free: 1e11, problem: "you can’t write there" });
    await open();
    await press(/Continuar/);
    await press("Personalizar instalación");
    expect(await screen.findByText("ahí no se puede escribir")).toBeTruthy();

    await press("Idioma: Español");
    await pick("English");
    await press(/Continue/);

    expect(await screen.findByText("you can’t write there")).toBeTruthy();
    expect(fake.dir).toHaveBeenCalledTimes(2);
  });

  it("shows why it could not finish and goes back when cancelled, by the flag and not by the words", async () => {
    await open();
    fake.install.mockRejectedValueOnce({ cancelled: false, reason: "no pude escribir C:\\Sens: acceso denegado" });

    await press(/Continuar/);
    await press(/Empezar/);
    await press(/Instalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("error"), { timeout: 5000 });
    expect(await screen.findByText("No pude escribir C:\\Sens: acceso denegado")).toBeTruthy();

    fake.install.mockRejectedValueOnce({ cancelled: true, reason: "cancelled" });
    await press("Reintentar");
    await vi.waitFor(() => expect(shown()).toBe("welcome"), { timeout: 5000 });

    fake.install.mockRejectedValueOnce("cancelado");
    await press(/Empezar/);
    await press(/Instalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("error"), { timeout: 5000 });
    expect(await screen.findByText("Cancelado")).toBeTruthy();
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
    fake.closeApp.mockResolvedValueOnce(false).mockResolvedValue(true);

    await press(/Continuar/);
    await press(/Empezar/);
    await press(/Instalar Sens/);
    expect(await screen.findByRole("heading", { name: "Sens está abierta." })).toBeTruthy();
    await press("Cerrar Sens");
    expect(fake.closeApp).toHaveBeenCalledWith(false);
    expect(screen.getByRole("status").textContent).toBe("Sens no se ha cerrado todavía.");
    await press("Forzar el cierre");
    expect(fake.closeApp).toHaveBeenLastCalledWith(true);

    await act(async () => fake.progress({ step: "extract", progress: 0.4, line: "Descomprimiendo sens-app.exe" }));
    await vi.waitFor(() => expect(shown()).toBe("busy"), { timeout: 5000 });
    expect(screen.getByRole("status").textContent).toBe("Copiando ficheros…");
    await act(async () => finish());
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });
  });

  it("stays until Sens is on screen, and says why when it cannot open it", async () => {
    await open();
    await press(/Continuar/);
    await press(/Empezar/);
    await press(/Instalar Sens/);
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });

    fake.launch.mockRejectedValueOnce("no pude abrir Sens: acceso denegado");
    await press(/Abrir Sens/);
    expect(screen.getByRole("alert").textContent).toBe("no pude abrir Sens: acceso denegado");
    expect(fake.quit).not.toHaveBeenCalled();

    let appeared = () => {};
    fake.launch.mockImplementationOnce(() => new Promise<void>((done) => (appeared = done)));
    await press(/Abrir Sens/);
    const opening = screen.getByRole("button", { name: /Abriendo Sens/ });
    expect(opening.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Cerrar", { selector: "button.ghost" })).toHaveProperty("disabled", true);
    expect(fake.quit).not.toHaveBeenCalled();

    await act(async () => appeared());
    expect(fake.quit).toHaveBeenCalled();
  });

  it("updates on its own, reopens Sens and quits when launched by the app, leaving the language alone", async () => {
    await open({ mode: "update", installed: { version: "0.16.0", dir: "C:\\Sens" }, passive: true, relaunch: true });

    expect(screen.getByText("0.16.0 → 0.17.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    await vi.waitFor(() => expect(fake.quit).toHaveBeenCalled(), { timeout: 5000 });
    expect(fake.install).toHaveBeenCalledWith(expect.objectContaining({ look: null, language: null }));
    expect(fake.launch).toHaveBeenCalled();
  });

  it("uninstalls keeping the data unless asked, with a destructive button", async () => {
    await open({ mode: "uninstall", installed: { version: "0.17.0", dir: "C:\\Sens" } });

    expect(screen.getByRole("heading", { name: "Desinstalar Sens." })).toBeTruthy();
    expect(document.title).toBe("Desinstalar Sens");
    expect(screen.getByRole("button", { name: "Desinstalar" }).className).toContain("danger");
    expect(screen.queryByRole("button", { name: "Personalizar instalación" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Idioma/ })).toBeNull();

    await press("Desinstalar");
    await vi.waitFor(() => expect(shown()).toBe("done"), { timeout: 5000 });
    expect(fake.uninstall).toHaveBeenCalledWith(false);
    expect(await screen.findByRole("heading", { name: "Sens se ha desinstalado." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Abrir Sens/ })).toBeNull();
  });
});
