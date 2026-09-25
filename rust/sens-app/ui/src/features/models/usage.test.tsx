// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, ChatEvent, Finished, Limits, SessionEntry } from "../../ipc/types";
import { showLanguage } from "../../shared/i18n";
import { spentOf } from "../chat/state";
import { blank, hearChat, load } from "../chat/store";
import { focused } from "../panes/store";
import { profile } from "../profile/store";
import { Me } from "../rail/Me";
import { ContextMeter } from "./ContextMeter";
import { asOf, rowsOf, workedFor } from "./limits";
import { accountLine, models, noteLimits } from "./store";
import { PlanPart, Usage } from "./Usage";

const ipc = vi.hoisted(() => ({
  commands: {
    replay: vi.fn(),
    chatBusy: vi.fn(),
    chatTasks: vi.fn(),
    workspaces: vi.fn(),
    titleSession: vi.fn(),
    folder: vi.fn(),
    notify: vi.fn(),
    repo: vi.fn(),
  },
  heard: null as ((session: string, event: ChatEvent) => void) | null,
}));

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: { chat: (heard: (session: string, event: ChatEvent) => void) => ((ipc.heard = heard), Promise.resolve(() => {})), claudeCode: () => Promise.resolve(() => {}) },
}));

const NOW = new Date(2026, 8, 25, 12, 0).getTime();
const FIVE = Math.round((NOW + (4 * 60 + 38) * 60_000) / 1000);
const WEEK = new Date(2026, 8, 27, 7, 0).getTime() / 1000;
const MAX: Account = { billing: "subscription", plan: "max", source: "claude.ai", email: "ada@example.com" };

const limits = (over: Partial<Limits> = {}): Limits => ({
  kind: "limits",
  status: "allowed_warning",
  window: "seven_day",
  utilization: 0.8,
  resetsAt: WEEK,
  threshold: 0.75,
  overage: { status: "", using: false, resetsAt: null, disabled: "" },
  windows: { seven_day_fable: { utilization: 0.19, resetsAt: WEEK }, seven_day: { utilization: 0.8, resetsAt: WEEK }, five_hour: { utilization: 0.03, resetsAt: FIVE } },
  ...over,
});

const finished = (over: Partial<Finished> = {}): Finished => ({ kind: "finished", ok: true, stopped: false, millis: 100_000, turns: 3, tokensIn: 600, tokensOut: 90, context: 50_000, window: 200_000, error: "", ...over });

beforeAll(() => hearChat());

beforeEach(() => {
  localStorage.clear();
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.workspaces.mockResolvedValue([]);
  ipc.commands.folder.mockResolvedValue([]);
  ipc.commands.chatBusy.mockResolvedValue(false);
  ipc.commands.chatTasks.mockResolvedValue([]);
  models.setState({ ...models.getInitialState(), limits: null, account: MAX }, true);
  focused().chat.setState(focused().chat.getInitialState(), true);
  focused().desk.setState({ root: "C:/demo", session: "" });
  blank("");
  profile.setState({ person: { name: "Ada Lovelace", checkUpdates: true, welcomed: true, seen: "", notify: true }, fault: "" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  showLanguage("es");
});

const rows = () => rowsOf(models.getState().limits, NOW).map(({ name, percent, level, resets }) => ({ name, percent, level, resets }));

describe("the plan's usage limits", () => {
  it("names each window, in order, with how much is used and when it resets", () => {
    noteLimits(limits(), NOW);
    expect(rows()).toEqual([
      { name: "Límite de 5 horas", percent: "3 %", level: "", resets: "Se restablece en 4 h 38 min" },
      { name: "Semanal · todos los modelos", percent: "80 %", level: "warn", resets: "Se restablece el dom, 7:00" },
      { name: "Semanal · Fable", percent: "19 %", level: "", resets: "Se restablece el dom, 7:00" },
    ]);
  });

  it("speaks the chosen language", () => {
    showLanguage("en");
    noteLimits(limits(), NOW);
    const [five, week] = rows();
    expect(five).toMatchObject({ name: "5-hour limit", percent: "3%", resets: "Resets in 4 h 38 min" });
    expect(week.name).toBe("Weekly · all models");
    expect(week.resets).toMatch(/^Resets Sun 7:00\sAM$/);
    expect(accountLine(NOW).text).toBe("Max subscription · claude.ai · ada@example.com · 80% used this week");
  });

  it("reads a window whose reset has passed as reset, and one refused as reached", () => {
    noteLimits(limits({ status: "rejected", window: "five_hour", windows: { five_hour: { utilization: 1, resetsAt: FIVE }, seven_day: { utilization: 0.5, resetsAt: NOW / 1000 - 60 } } }), NOW);
    expect(rows().slice(0, 2)).toEqual([
      { name: "Límite de 5 horas", percent: "100 %", level: "over", resets: "Límite alcanzado · Se restablece en 4 h 38 min" },
      { name: "Semanal · todos los modelos", percent: "0 %", level: "", resets: "Ya se ha restablecido" },
    ]);
  });

  it("keeps the last reading across launches, adding the windows a later one leaves out", async () => {
    noteLimits(limits(), NOW - 2 * 3_600_000);
    noteLimits(limits({ windows: { five_hour: { utilization: 0.1, resetsAt: FIVE } } }), NOW - 2 * 3_600_000);
    vi.resetModules();
    const again = await import("./store");
    const kept = again.models.getState().limits!;
    expect(Object.keys(kept.windows).sort()).toEqual(["five_hour", "seven_day", "seven_day_fable"]);
    expect(kept.windows.five_hour.utilization).toBe(0.1);
    expect(asOf(kept, NOW)).toBe("Actualizado a las 10:00");
    expect(asOf({ ...kept, seen: NOW - 60_000 }, NOW)).toBe("");
  });

  it("puts the window nearest its limit on the model picker's account line", () => {
    noteLimits(limits(), NOW);
    expect(accountLine(NOW)).toEqual({ text: "Suscripción Max · claude.ai · ada@example.com · 80 % usado en la semana", warn: true });
    noteLimits(limits({ status: "allowed", window: "five_hour", windows: { five_hour: { utilization: 0.42, resetsAt: FIVE }, seven_day: { utilization: 0.1, resetsAt: WEEK }, seven_day_fable: { utilization: 0.1, resetsAt: WEEK } } }), NOW);
    expect(accountLine(NOW)).toEqual({ text: "Suscripción Max · claude.ai · ada@example.com · 42 % usado en 5 h", warn: false });
  });

  it("shows the plan and a bar per window, waits for the first reply, and stays away from an API key", () => {
    const { rerender } = render(<PlanPart now={NOW} />);
    expect(screen.getByText("Los límites aparecen tras la primera respuesta de Claude.")).toBeTruthy();

    act(() => noteLimits(limits(), NOW));
    rerender(<PlanPart now={NOW} />);
    expect(screen.getByText("Límites de uso del plan · Max")).toBeTruthy();
    expect(screen.getAllByRole("meter").map((bar) => [bar.getAttribute("aria-label"), bar.getAttribute("aria-valuenow")])).toEqual([
      ["Límite de 5 horas", "3"],
      ["Semanal · todos los modelos", "80"],
      ["Semanal · Fable", "19"],
    ]);
    expect(document.querySelector('[data-key="seven_day"]')?.getAttribute("data-level")).toBe("warn");
    expect(screen.getByRole("img", { name: "Cerca de un límite del plan" })).toBeTruthy();

    act(() => models.setState({ account: { billing: "elsewhere", plan: "", source: "ANTHROPIC_API_KEY", email: "" } }));
    rerender(<PlanPart now={NOW} />);
    expect(screen.queryByText(/Límites de uso del plan/)).toBeNull();
  });

  it("counts down while it is open, and stops when it closes", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
    noteLimits(limits(), NOW);
    const { unmount } = render(<Usage pane={focused()} open onCompact={() => {}} />);
    expect(screen.getByText("Se restablece en 4 h 38 min")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Se restablece en 4 h 37 min")).toBeTruthy();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks the context ring when a plan window warns", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    focused().chat.setState({ context: { used: 50_000, window: 200_000 } });
    render(<ContextMeter />);
    expect(screen.getByRole("button", { name: "Contexto usado: 25 %" })).toBeTruthy();
    act(() => noteLimits(limits()));
    const ring = screen.getByRole("button", { name: "Contexto usado: 25 % · Cerca de un límite del plan" });
    expect(within(ring).getByRole("img", { name: "Cerca de un límite del plan" })).toBeTruthy();
  });

  it("shows the plan's limits in the account menu of the rail", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    noteLimits(limits());
    render(<Me />);
    const me = screen.getByRole("button", { name: /Ada Lovelace/ });
    expect(within(me).getByRole("img", { name: "Cerca de un límite del plan" })).toBeTruthy();
    fireEvent.click(me);
    expect(screen.getByText("Límites de uso del plan · Max")).toBeTruthy();
    expect(screen.getByText("Semanal · todos los modelos")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Ajustes" })).toBeTruthy();
  });
});

describe("what a session spent", () => {
  it("adds up each reply, live and replayed, and starts over with a new session", async () => {
    ipc.commands.replay.mockResolvedValue([
      { kind: "task", at: 1, text: "a", files: [], images: [] },
      { kind: "agent", at: 2, event: finished() },
      { kind: "task", at: 3, text: "b", files: [], images: [] },
      { kind: "agent", at: 4, event: finished({ tokensIn: 600, tokensOut: 30, millis: 100_000 }) },
    ] satisfies SessionEntry[]);
    await act(async () => load("s1"));
    expect(spentOf(focused()).getState()).toEqual({ replies: 2, tokensIn: 1200, tokensOut: 120, millis: 200_000 });

    act(() => ipc.heard!("s1", finished({ tokensIn: 300, tokensOut: 5, millis: 1000 })));
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(spentOf(focused()).getState()).toEqual({ replies: 3, tokensIn: 1500, tokensOut: 125, millis: 201_000 });

    render(<Usage pane={focused()} open={false} onCompact={() => {}} />);
    const stats = [...document.querySelectorAll(".usage-stats div")].map((stat) => [stat.querySelector("dt")?.textContent, stat.querySelector("dd")?.textContent]);
    expect(stats).toEqual([
      ["Tokens de entrada", "1,5k"],
      ["Tokens de salida", "125"],
      ["Respuestas", "3"],
      ["Tiempo trabajando", "3 min 21 s"],
    ]);

    act(() => blank(""));
    expect(spentOf(focused()).getState().replies).toBe(0);
  });

  it("says how long Claude worked", () => {
    expect(workedFor(12_400)).toBe("12 s");
    expect(workedFor(3_725_000)).toBe("1 h 2 min");
    showLanguage("de");
    expect(workedFor(200_000)).toBe("3 min 20 s");
  });
});
