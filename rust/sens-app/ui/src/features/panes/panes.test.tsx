// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../ipc/types";
import { closePane, openBeside, resume } from "../../app/session";
import { hearChat } from "../chat/store";
import { currentSettings } from "../composer/store";
import { choose, models } from "../models/store";
import { project } from "../project/store";
import { rail } from "../rail/store";
import { drag, lift } from "./drag";
import { Panes } from "./Panes";
import { focused, panes } from "./store";

const ipc = vi.hoisted(() => {
  const made: Record<string, ReturnType<typeof vi.fn>> = {};
  return {
    made,
    commands: new Proxy(made, { get: (all, name: string) => (all[name] ??= vi.fn(async () => undefined)) }),
    heard: null as ((session: string, event: ChatEvent) => void) | null,
  };
});

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: new Proxy(
    { chat: (heard: (session: string, event: ChatEvent) => void) => ((ipc.heard = heard), Promise.resolve(() => {})) },
    { get: (known: Record<string, unknown>, name: string) => known[name] ?? (() => Promise.resolve(() => {})) },
  ),
}));

const card = (id: string) => ({ id, label: id, description: "", latest: true, efforts: ["low", "high"], effort: "high", thinking: "toggle" as const });
const SPACES = [{ root: "C:/demo", name: "demo", activeAt: 1, trusted: false, sessions: ["s1", "s2", "s3"].map((id) => ({ id, title: `Sesión ${id}`, startedAt: 1, tasks: 1, archived: false })) }];
const settle = () => act(async () => new Promise((done) => setTimeout(done)));
const pointer = (type: string, x: number, y: number) => window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0 }));
const titles = () => [...document.querySelectorAll(".pane-title")].map((title) => title.textContent);

beforeAll(() => {
  hearChat();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const wide = this.matches("section.chat, .panes") ? 1000 : 100;
    return { left: 0, top: 0, right: wide, bottom: 600, width: wide, height: 600, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
});

beforeEach(() => {
  for (const one of Object.values(ipc.made)) one.mockReset().mockResolvedValue(undefined);
  ipc.commands.replay.mockResolvedValue([]);
  ipc.commands.chatTasks.mockResolvedValue([]);
  ipc.commands.workspaces.mockResolvedValue(structuredClone(SPACES));
  models.setState({ catalog: [{ id: "claude", vendor: "Anthropic", label: "Claude Code" }], known: { claude: [card("opus"), card("sonnet")] }, hidden: new Set() });
  const lone = panes.getState().open.find((pane) => pane === focused())!;
  panes.setState({ open: [lone], focus: lone.id, share: 0.5 });
  lone.chat.setState(lone.chat.getInitialState(), true);
  lone.desk.setState({ root: "C:/demo", session: "s1", choice: { provider: "claude", model: "opus" } });
  project.setState({ view: "" });
  rail.setState({ spaces: structuredClone(SPACES) });
  drag.setState(drag.getInitialState(), true);
});

afterEach(cleanup);

describe("two sessions side by side", () => {
  it("opens a session beside, follows the pane you use, and remembers the layout", async () => {
    render(
      <section className="chat">
        <Panes />
      </section>,
    );
    await act(async () => openBeside("C:/demo", "s2"));
    expect(titles()).toEqual(["Sesión s1", "Sesión s2"]);
    expect(project.getState().session).toBe("s2");
    expect(JSON.parse(localStorage.getItem("sens.panes")!).panes.map((one: { session: string }) => one.session)).toEqual(["s1", "s2"]);

    fireEvent.pointerDown(document.querySelectorAll(".pane")[0]);
    await settle();
    expect(project.getState().session).toBe("s1");
    expect(document.querySelectorAll(".pane")[0].getAttribute("data-focus")).toBe("true");

    const replays = ipc.commands.replay.mock.calls.length;
    await act(async () => resume("C:/demo", "s2"));
    expect(project.getState().session).toBe("s2");
    expect(ipc.commands.replay.mock.calls.length).toBe(replays);

    await act(async () => closePane(panes.getState().open[1]));
    expect(document.querySelectorAll(".pane")).toHaveLength(1);
    expect(project.getState().session).toBe("s1");
  });

  it("sends what each session says to its own pane, and keeps a model for each", async () => {
    await act(async () => openBeside("C:/demo", "s2"));
    const [left, right] = panes.getState().open;
    act(() => choose("claude", "sonnet", right));
    expect(currentSettings(left).model).toBe("opus");
    expect(currentSettings(right).model).toBe("sonnet");

    act(() => ipc.heard!("s1", { kind: "said", text: "para la izquierda" }));
    act(() => ipc.heard!("s2", { kind: "said", text: "para la derecha" }));
    const said = (pane: typeof left) => pane.chat.getState().turns.flatMap((turn) => (turn.kind === "reply" ? turn.parts : [])).map((part) => (part.kind === "said" ? part.text : ""));
    expect(said(left)).toEqual(["para la izquierda"]);
    expect(said(right)).toEqual(["para la derecha"]);
  });

  it("previews where a dragged session lands, and opens it there once dropped", async () => {
    render(
      <section className="chat">
        <Panes />
      </section>,
    );
    const row = document.createElement("button");
    lift({ button: 0, clientX: 10, clientY: 10, currentTarget: row } as never, { home: "C:/demo", id: "s3", title: "Sesión s3", folder: "demo" });
    act(() => pointer("pointermove", 20, 12));
    act(() => pointer("pointermove", 800, 300));
    expect(drag.getState().target).toEqual({ kind: "open", side: "right" });
    expect(document.querySelector(".snap-hint")?.textContent).toBe("Suelta para abrirla aquí");
    expect(document.querySelector(".snap-stay-title")?.textContent).toBe("Sesión s1");

    act(() => pointer("pointermove", 200, 300));
    expect(drag.getState().target).toEqual({ kind: "open", side: "left" });
    await act(async () => pointer("pointerup", 200, 300));
    await settle();
    expect(titles()).toEqual(["Sesión s3", "Sesión s1"]);
    expect(project.getState().session).toBe("s3");
  });

  it("offers to swap a pane once there are two, and leaves everything as it was on Escape", async () => {
    render(
      <section className="chat">
        <Panes />
      </section>,
    );
    await act(async () => openBeside("C:/demo", "s2"));
    lift({ button: 0, clientX: 10, clientY: 10, currentTarget: document.createElement("button") } as never, { home: "C:/demo", id: "s3", title: "Sesión s3", folder: "demo" });
    act(() => pointer("pointermove", 800, 300));
    expect(drag.getState().target).toEqual({ kind: "replace", side: "right" });
    expect(document.querySelector(".snap-hint")?.textContent).toBe("Suelta para ponerla en lugar de «Sesión s2»");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(drag.getState().phase).toBe("cancelling");
    await settle();
    expect(titles()).toEqual(["Sesión s1", "Sesión s2"]);
  });
});
