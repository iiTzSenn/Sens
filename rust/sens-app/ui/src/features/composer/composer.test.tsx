// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../../ipc/types";
import { legacy } from "../../legacy/bridge";
import { blank, chat } from "../chat/store";
import { accountLine, loadCatalog, models, noteLimits } from "../models/store";
import { project } from "../project/store";
import { Composer } from "./Composer";
import { composer, currentSettings, readRepo } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    providers: vi.fn(),
    models: vi.fn(),
    claudeAccount: vi.fn(),
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
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands, events: { claudeCode: () => Promise.resolve(() => {}) } }));

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
  project.setState({ root: "C:/demo", session: "", view: "", touched: new Map() });
  blank("");
  Object.assign(legacy, { chooseFolder: vi.fn(), showView: vi.fn(), panelShows: () => false });
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
    act(() => composer.setState({ attached: [{ path: "src/app.ts", name: "app.ts", bytes: 2048, outside: false }] }));
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
    act(() => chat.setState({ busy: false, stopping: false }));
  });

  it("drops an attached file, and asks for a folder from its chip", () => {
    act(() => composer.setState({ attached: [{ path: "C:/fuera/plan.pdf", name: "plan.pdf", bytes: 10, outside: true }] }));
    render(<Composer />);
    fireEvent.click(button("Quitar plan.pdf"));
    expect(composer.getState().attached).toEqual([]);
    fireEvent.click(button(/demo/));
    expect(legacy.chooseFolder).toHaveBeenCalled();
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

  it("sets the permission mode, thinking and effort for the next turn", () => {
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
    expect(chat.getState().turns.at(-1)).toMatchObject({ kind: "notice", parts: ["rama · ", { bold: "feat/ui" }] });
  });
});
