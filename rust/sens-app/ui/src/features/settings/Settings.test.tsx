// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeCodeProgress, ProviderState } from "../../ipc/types";
import { dialog } from "../../app/modal";
import { models, readAccount, refreshModels } from "../models/store";
import { project } from "../project/store";
import { profile } from "../profile/store";
import { look } from "../../shared/look";
import { updates } from "../updates/store";
import { Settings, SettingsDialog } from "./Settings";
import { settingsSheet } from "./sheet";
import { enterSettings, openSettings, settings, showSection, type Section } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    profile: vi.fn(),
    saveProfile: vi.fn(),
    setUpdateCheck: vi.fn(),
    setNotify: vi.fn(),
    updateCheck: vi.fn(),
    providersState: vi.fn(),
    setProviderMethod: vi.fn(),
    saveApiKey: vi.fn(),
    forgetApiKey: vi.fn(),
    providerSignIn: vi.fn(),
    providerSignOut: vi.fn(),
    claudeCodeInstall: vi.fn(),
    claudeCodeNewer: vi.fn(),
    claudeCodeUpdate: vi.fn(),
    setLook: vi.fn(),
    news: vi.fn(),
  },
  heard: { claudeCode: (_: ClaudeCodeProgress) => {} },
}));

vi.mock(import("../models/store"), async (original) => ({ ...(await original()), readAccount: vi.fn(async () => null), refreshModels: vi.fn(async () => {}) }));

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: {
    claudeCode: (heard: (progress: ClaudeCodeProgress) => void) => {
      ipc.heard.claudeCode = heard;
      return Promise.resolve(() => {});
    },
  },
}));

const claude = (over: Partial<ProviderState> = {}): ProviderState => ({
  id: "claude",
  vendor: "Anthropic",
  label: "Claude Code",
  method: "subscription",
  keyHint: "",
  version: "2.1.0",
  account: { billing: "subscription", plan: "max", source: "claude.ai", email: "demo@example.com" },
  error: "",
  installed: true,
  ...over,
});

function later<T = void>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

async function open(section: Section) {
  render(<Settings />);
  await act(async () => {
    showSection(section);
    enterSettings();
  });
}

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
  settings.setState(settings.getInitialState(), true);
  profile.setState(profile.getInitialState(), true);
  updates.setState(updates.getInitialState(), true);
  models.setState({ behind: "" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.providersState.mockResolvedValue([claude()]);
  dialog.setState(dialog.getInitialState(), true);
  look.setState(look.getInitialState(), true);
  settingsSheet.setState(settingsSheet.getInitialState(), true);
  delete document.documentElement.dataset.mode;
  delete document.documentElement.dataset.accent;
});

afterEach(cleanup);

describe("general settings", () => {
  it("saves the name and reloads the profile the rail footer paints from", async () => {
    profile.setState({ person: { name: "Demo", checkUpdates: true, welcomed: true, seen: "", notify: true } });
    ipc.commands.profile.mockResolvedValue({ name: "Nuevo", checkUpdates: true });
    await open("general");

    const name = screen.getByLabelText("Nombre");
    expect(name).toHaveProperty("value", "Demo");
    fireEvent.change(name, { target: { value: "Nuevo" } });
    await act(async () => fireEvent.click(screen.getByText("Guardar")));

    expect(ipc.commands.saveProfile).toHaveBeenCalledWith("Nuevo");
    expect(profile.getState().person.name).toBe("Nuevo");
    expect(screen.getByText("Guardado.")).toBeTruthy();
  });

  it("says why the name was not saved", async () => {
    ipc.commands.saveProfile.mockRejectedValue("disco lleno");
    await open("general");
    await act(async () => fireEvent.click(screen.getByText("Guardar")));
    expect(screen.getByText("disco lleno").className).toBe("note fault");
  });

  it("puts the switch back when the preference cannot be saved", async () => {
    ipc.commands.setUpdateCheck.mockRejectedValue("sin permiso");
    await open("general");
    const toggle = screen.getByRole("switch", { name: "Buscar al abrir Sens" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => fireEvent.click(toggle));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
  });

  it("switches the notices off, and keeps them on when that cannot be saved", async () => {
    profile.setState({ person: { name: "Demo", checkUpdates: true, welcomed: true, seen: "", notify: true } });
    await open("general");
    const toggle = screen.getByRole("switch", { name: /Avisar cuando Claude termina/ });
    await act(async () => fireEvent.click(toggle));
    expect(ipc.commands.setNotify).toHaveBeenCalledWith(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(profile.getState().person.notify).toBe(false);

    ipc.commands.setNotify.mockRejectedValue("sin permiso");
    await act(async () => fireEvent.click(toggle));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
  });

  it("opens the update panel", async () => {
    updates.setState({ latest: { version: "9.9.9", notes: "", page: "", size: 0 } });
    await open("general");
    fireEvent.click(screen.getByText("Ver Sens 9.9.9"));
    expect(dialog.getState()).toMatchObject({ open: true, title: "Sens 9.9.9" });
  });

  it("shows the news of this version over the chat, and gets out of the way", async () => {
    ipc.commands.news.mockResolvedValue([]);
    project.setState({ view: "" });
    await act(async () => openSettings("general"));
    render(<SettingsDialog />);

    await act(async () => fireEvent.click(screen.getByText("Ver novedades")));
    expect(project.getState().view).toBe("news");
    expect(settingsSheet.getState().open).toBe(false);
    expect(ipc.commands.news).toHaveBeenCalledTimes(1);
    project.setState({ view: "" });
  });
});

describe("the settings sheet", () => {
  it("opens over the window on the section asked for, and gives the focus back when it closes", async () => {
    const opener = Object.assign(document.createElement("button"), { textContent: "Ajustes" });
    document.body.append(opener);
    render(<SettingsDialog />);
    expect(screen.queryByRole("tablist", { name: "Secciones de ajustes" })).toBeNull();

    await act(async () => openSettings("look", opener));
    expect(screen.getByRole("tab", { name: "Apariencia" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Oscuro · Señal");

    await act(async () => fireEvent.keyDown(screen.getByRole("tab", { name: "Apariencia" }), { key: "ArrowRight" }));
    expect(settings.getState().section).toBe("providers");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Proveedores" }));

    await act(async () => fireEvent.click(screen.getByLabelText("Cerrar ajustes")));
    expect(settingsSheet.getState().open).toBe(false);
    expect(screen.queryByRole("tablist", { name: "Secciones de ajustes" })).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("appearance settings", () => {
  it("shows the chosen look at once and keeps it", async () => {
    await open("look");
    expect(screen.getByRole("radio", { name: /Oscuro/ })).toHaveProperty("checked", true);

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: /Claro/ })));
    expect(document.documentElement.dataset).toMatchObject({ mode: "light", accent: "signal" });
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Rosa" })));

    expect(ipc.commands.setLook).toHaveBeenLastCalledWith({ mode: "light", accent: "rose" });
    expect(document.documentElement.dataset.accent).toBe("rose");
    expect(screen.getByText("Claro · Rosa")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Rosa" })).toHaveProperty("checked", true);
  });

  it("goes back to the look it had when the new one cannot be kept", async () => {
    ipc.commands.setLook.mockRejectedValue("sin permiso");
    await open("look");

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Iris" })));

    expect(document.documentElement.dataset.accent).toBe("signal");
    expect(screen.getByRole("radio", { name: "Señal" })).toHaveProperty("checked", true);
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
  });
});

describe("providers settings", () => {
  it("asks for a key before telling Rust to use one", async () => {
    await open("providers");
    await act(async () => fireEvent.click(screen.getByLabelText(/Clave de API/)));
    expect(ipc.commands.setProviderMethod).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("sk-ant-…")).toBeTruthy();
  });

  it("clears the key field once the key is saved", async () => {
    ipc.commands.providersState.mockResolvedValue([claude({ method: "apiKey" })]);
    await open("providers");
    const key = screen.getByLabelText("Clave de API", { selector: "input" });
    fireEvent.change(key, { target: { value: "sk-ant-secreto" } });
    await act(async () => fireEvent.click(screen.getByText("Guardar clave")));
    expect(ipc.commands.saveApiKey).toHaveBeenCalledWith("claude", "sk-ant-secreto");
    expect(key).toHaveProperty("value", "");
  });

  it("holds the sign-in button and tells the model picker while the browser is open", async () => {
    const signing = later();
    ipc.commands.providerSignIn.mockReturnValue(signing.promise);
    await open("providers");

    await act(async () => fireEvent.click(screen.getByText("Iniciar sesión con Claude")));
    const button = screen.getByText("Esperando a que termines…");
    expect(button).toHaveProperty("disabled", true);
    expect(settings.getState().connecting).toBe(true);

    await act(async () => signing.settle());
    expect(settings.getState().connecting).toBe(false);
    expect(readAccount).toHaveBeenCalled();
    expect(refreshModels).toHaveBeenCalled();
  });

  it("follows the Claude Code download and locks the card meanwhile", async () => {
    const installing = later<string>();
    ipc.commands.claudeCodeInstall.mockReturnValue(installing.promise);
    ipc.commands.providersState.mockResolvedValue([claude({ installed: false, account: null })]);
    await open("providers");

    await act(async () => fireEvent.click(screen.getByText("Instalar ahora")));
    await act(async () => ipc.heard.claudeCode({ stage: "downloading", done: 50, total: 100 * 1048576 }));
    expect(screen.getByRole("status").textContent).toMatch(/^Descargando Claude Code… 0 % de 100 MB$/);
    expect(screen.getByText("Comprobar otra vez")).toHaveProperty("disabled", true);

    await act(async () => installing.settle("2.1.0"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a newer Claude Code, updates it, and asks again for its models", async () => {
    const updating = later<string>();
    ipc.commands.claudeCodeUpdate.mockReturnValue(updating.promise);
    models.setState({ behind: "2.1.281" });
    await open("providers");

    expect(screen.getByText(/Hay una versión nueva de Claude Code: v2\.1\.281\./)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Actualizar Claude Code")));
    expect(screen.getByRole("status").textContent).toBe("Actualizando Claude Code…");
    expect(screen.getByText("Actualizar Claude Code")).toHaveProperty("disabled", true);

    await act(async () => updating.settle("2.1.281"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(ipc.commands.claudeCodeNewer).toHaveBeenCalled();
    expect(refreshModels).toHaveBeenCalled();
    expect(screen.queryByText("Actualizar Claude Code")).toBeNull();
  });
});
