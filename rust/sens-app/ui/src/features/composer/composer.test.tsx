// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../../ipc/types";
import { dialog } from "../../app/modal";
import { chooseFolder, showView } from "../../app/session";
import { blank } from "../chat/store";
import { focused } from "../panes/store";
import { accountLine, choose, loadCatalog, models, noteLimits } from "../models/store";
import { project } from "../project/store";
import { Composer } from "./Composer";
import { BYPASS, composer, currentSettings, readRepo, readTrust } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    providers: vi.fn(),
    models: vi.fn(),
    claudeAccount: vi.fn(),
    claudeCodeNewer: vi.fn(),
    repo: vi.fn(),
    checkout: vi.fn(),
    openSession: vi.fn(),
    chatSend: vi.fn(),
    chatStop: vi.fn(),
    chatWarm: vi.fn(),
    newSessionId: vi.fn(),
    workspaces: vi.fn(),
    tree: vi.fn(),
    folder: vi.fn(),
    trustProject: vi.fn(),
    projectTrusted: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands, events: { claudeCode: () => Promise.resolve(() => {}) } }));
vi.mock("../../app/session", () => ({ resume: vi.fn(), draft: vi.fn(async () => {}), fresh: vi.fn(), chooseFolder: vi.fn(), showView: vi.fn() }));

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  label: id.replace("claude-", "").replace(/^\w/, (first) => first.toUpperCase()),
  description: "Best for everyday, complex tasks",
  latest: true,
  efforts: ["low", "medium", "high", "max"],
  effort: "medium",
  thinking: "toggle",
  ...over,
});

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

beforeEach(async () => {
  localStorage.clear();
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.providers.mockResolvedValue([{ id: "claude", vendor: "Anthropic", label: "Claude Code" }]);
  ipc.commands.models.mockResolvedValue([card("claude-sonnet"), card("claude-opus", { thinking: "always" }), card("claude-haiku", { latest: false, efforts: [] })]);
  ipc.commands.claudeAccount.mockResolvedValue({ billing: "subscription", plan: "max", source: "claude.ai", email: "ada@example.com" });
  ipc.commands.openSession.mockResolvedValue("s1");
  ipc.commands.workspaces.mockResolvedValue([]);
  ipc.commands.tree.mockResolvedValue([]);
  ipc.commands.folder.mockResolvedValue([]);
  models.setState(models.getInitialState(), true);
  models.setState({ known: {}, hidden: new Set() });
  composer.setState(composer.getInitialState(), true);
  dialog.setState(dialog.getInitialState(), true);
  project.setState({ view: "", touched: new Map() });
  focused().chat.setState(focused().chat.getInitialState(), true);
  focused().desk.setState(focused().desk.getInitialState(), true);
  focused().desk.setState({ root: "C:/demo" });
  blank("");
  await loadCatalog();
  await act(async () => new Promise((settle) => setTimeout(settle)));
});

afterEach(cleanup);

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const field = () => screen.getByRole("textbox", { name: "Mensaje para Claude" });

describe("the composer", () => {
  it("picks the first model offered, and knows its account", () => {
    render(<Composer />);
    expect(document.getElementById("crew")?.textContent).toBe("Sonnet");
    expect(currentSettings()).toEqual({ provider: "claude", model: "claude-sonnet", effort: "medium", thinking: true, mode: "default" });
    act(() => noteLimits({ five_hour: { utilization: 0.42 } }));
    expect(accountLine()).toEqual({ text: "Suscripción Max · claude.ai · ada@example.com · 42 % usado en 5 h", warn: false });
  });

  it("sends what is written with what is attached, and stops Claude while it works", async () => {
    render(<Composer />);
    expect((button("Enviar") as HTMLButtonElement).disabled).toBe(true);
    act(() => focused().desk.setState({ attached: [{ path: "src/app.ts", name: "app.ts", bytes: 2048, outside: false }] }));
    expect(screen.getByText("src/app.ts", { selector: ".clip span" })).toBeTruthy();
    fireEvent.change(field(), { target: { value: "  Revisa esto  " } });
    await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
    expect(ipc.commands.chatSend).toHaveBeenCalledWith("C:/demo", "s1", { text: "Revisa esto", files: ["src/app.ts"], images: [] }, currentSettings());
    expect((field() as HTMLTextAreaElement).value).toBe("");
    expect(document.querySelector(".clips")).toBeNull();

    expect(document.querySelector(".box")?.getAttribute("data-busy")).toBe("true");
    await act(async () => fireEvent.click(button("Parar")));
    expect(ipc.commands.chatStop).toHaveBeenCalledWith("s1");
    expect(button("Parando…")).toHaveProperty("disabled", true);
    act(() => focused().chat.setState({ busy: false, stopping: false }));
  });

  it("drops an attached file, and asks for a folder from its chip", () => {
    act(() => focused().desk.setState({ attached: [{ path: "C:/fuera/plan.pdf", name: "plan.pdf", bytes: 10, outside: true }] }));
    render(<Composer />);
    fireEvent.click(button("Quitar plan.pdf"));
    expect(focused().desk.getState().attached).toEqual([]);
    fireEvent.click(button(/demo/));
    expect(chooseFolder).toHaveBeenCalled();
  });

  it("chooses a model, and hides models while editing the list", () => {
    render(<Composer />);
    fireEvent.click(button(/Sonnet/));
    const picker = document.getElementById("picker")!;
    expect([...picker.querySelectorAll(".menu-head")].map((head) => head.textContent)).toEqual(["Anthropic · Claude Code", "Anteriores"]);
    fireEvent.click(within(picker).getByRole("menuitemradio", { name: /Opus/ }));
    expect(document.getElementById("crew")?.textContent).toBe("Opus");
    expect(button("Razonamiento").getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(button(/Opus/));
    fireEvent.click(within(picker).getByRole("menuitem", { name: "Editar modelos…" }));
    fireEvent.click(within(picker).getByRole("menuitemcheckbox", { name: "Opus" }));
    expect(models.getState().hidden.has("claude-opus")).toBe(true);
    expect(document.getElementById("crew")?.textContent).toBe("Sonnet");
  });

  it("describes a model by its tagline, in Spanish, and spins while asking for models", () => {
    const offered = [
      card("claude-opus-5-5[1m]", { label: "Opus 5.5 (1M)", description: "Opus 5.5 with 1M context · Best for everyday, complex tasks" }),
      card("claude-opus-4-8", { label: "Opus 4.8", description: "", latest: false }),
    ];
    act(() => {
      models.setState({ known: { claude: offered } });
      choose("claude", "claude-opus-5-5[1m]");
    });
    render(<Composer />);
    fireEvent.click(button(/Opus 5\.5/));
    const picker = document.getElementById("picker")!;
    expect([...picker.querySelectorAll(".mode-sub")].map((said) => said.textContent)).toEqual(["El mejor para el trabajo complejo de cada día"]);

    act(() => models.setState({ fetching: true }));
    const refresh = document.getElementById("models-refresh")!;
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(refresh.textContent).toBe("Actualizando…");
  });

  it("asks to trust the folder before Sin control, and Sin control acts only in that folder", async () => {
    render(<Composer />);
    fireEvent.click(button(/Preguntar/));
    const sheet = document.getElementById("mode-sheet")!;
    fireEvent.click(within(sheet).getByRole("menuitemradio", { name: /Sin control/ }));
    expect(dialog.getState().title).toBe("¿Confías en este proyecto?");
    expect(currentSettings().mode).toBe("default");

    render(<>{dialog.getState().content}</>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confiar y activar" })));
    expect(ipc.commands.trustProject).toHaveBeenCalledWith("C:/demo", true);
    expect(currentSettings().mode).toBe(BYPASS);
    expect(document.getElementById("mode-label")?.textContent).toBe("Sin control");
    fireEvent.click(button(/Sin control/));
    expect(within(sheet).getByRole("menuitemradio", { checked: true }).textContent).toMatch(/^Sin control/);

    act(() => focused().desk.setState({ root: "C:/otra" }));
    expect(currentSettings().mode).toBe("default");
    expect(document.getElementById("mode-label")?.textContent).toBe("Preguntar");
  });

  it("switches to Sin control without asking in a folder already trusted", async () => {
    ipc.commands.projectTrusted.mockResolvedValue(true);
    await act(async () => readTrust());
    expect(ipc.commands.projectTrusted).toHaveBeenCalledWith("C:/demo");
    render(<Composer />);
    fireEvent.click(button(/Preguntar/));
    fireEvent.click(within(document.getElementById("mode-sheet")!).getByRole("menuitemradio", { name: /Sin control/ }));
    expect(dialog.getState().open).toBe(false);
    expect(currentSettings().mode).toBe(BYPASS);
  });

  it("points to the newer Claude Code from the picker only when there is one", async () => {
    render(<Composer />);
    fireEvent.click(button(/Sonnet/));
    const picker = document.getElementById("picker")!;
    expect(document.getElementById("models-update")?.hidden).toBe(true);

    ipc.commands.claudeCodeNewer.mockResolvedValue("2.1.281");
    await act(async () => loadCatalog());
    const update = within(picker).getByRole("menuitem", { name: "Actualizar Claude Code…" });
    expect(update.title).toBe("Hay una versión nueva: v2.1.281");
    fireEvent.click(update);
    expect(showView).toHaveBeenCalledWith("settings");
  });

  it("sets the permission mode, thinking and effort for the next turn", async () => {
    ipc.commands.projectTrusted.mockResolvedValue(true);
    await act(async () => readTrust());
    render(<Composer />);
    fireEvent.click(button(/Preguntar/));
    fireEvent.click(within(document.getElementById("mode-sheet")!).getByRole("menuitemradio", { name: /Sin control/ }));
    expect(document.getElementById("mode-pick")?.dataset.risky).toBe("true");
    expect(currentSettings().mode).toBe("bypassPermissions");

    fireEvent.click(button("Razonamiento"));
    expect(currentSettings().thinking).toBe(false);

    fireEvent.click(button(/Medio/));
    const track = screen.getByRole("slider", { name: "Esfuerzo" });
    fireEvent.keyDown(track, { key: "End" });
    expect(document.getElementById("effort")?.dataset.max).toBe("true");
    expect(currentSettings().effort).toBe("max");
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(track.getAttribute("aria-valuetext")).toBe("Alto");
  });

  it("shows the branch, and switches to another", async () => {
    ipc.commands.repo.mockResolvedValue({ branch: "main", detached: false, dirty: 2, branches: ["main", "feat/ui", "fix/css"] });
    ipc.commands.checkout.mockResolvedValue({ branch: "feat/ui", detached: false, dirty: 0, branches: ["main", "feat/ui", "fix/css"] });
    await act(async () => readRepo());
    render(<Composer />);
    expect(button(/main/).title).toBe("main · 2 ficheros sin confirmar");
    fireEvent.click(button(/main/));
    fireEvent.change(screen.getByPlaceholderText("Buscar ramas…"), { target: { value: "feat" } });
    expect([...document.querySelectorAll("#branch-rows .name")].map((name) => name.textContent)).toEqual(["feat/ui"]);
    await act(async () => fireEvent.click(button("feat/ui")));
    expect(ipc.commands.checkout).toHaveBeenCalledWith("C:/demo", "feat/ui");
    expect(document.getElementById("branch-name")?.textContent).toBe("feat/ui");
    expect(focused().chat.getState().turns.at(-1)).toMatchObject({ kind: "notice", parts: ["rama · ", { bold: "feat/ui" }] });
  });
});
