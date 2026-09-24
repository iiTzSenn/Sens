// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, SessionEntry } from "../../ipc/types";
import { shell } from "../../app/shell";
import { composer } from "../composer/store";
import { project } from "../project/store";
import { rail } from "../rail/store";
import { focused } from "../panes/store";
import { blank, hearChat, hello, load, notice, send } from "./store";
import { Thread } from "./Thread";
import { heard, opening, type Reply } from "./turns";

const ipc = vi.hoisted(() => ({
  commands: {
    replay: vi.fn(),
    chatBusy: vi.fn(),
    chatTasks: vi.fn(),
    openSession: vi.fn(),
    chatSend: vi.fn(),
    chatStop: vi.fn(),
    chatAnswer: vi.fn(),
    artifactData: vi.fn(),
    workspaces: vi.fn(),
    titleSession: vi.fn(),
    repo: vi.fn(),
    folder: vi.fn(),
    openFile: vi.fn(),
  },
  heard: null as ((session: string, event: ChatEvent) => void) | null,
}));

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: { chat: (heard: (session: string, event: ChatEvent) => void) => ((ipc.heard = heard), Promise.resolve(() => {})) },
}));

const SETTINGS = { provider: "claude", model: "claude-demo", effort: "", thinking: true, mode: "default" };
const tell = (event: ChatEvent) => act(() => ipc.heard!("s1", event));
const settle = () => act(async () => new Promise((done) => setTimeout(done, 50)));

beforeAll(() => {
  hearChat();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLCanvasElement.prototype.getContext = () => null;
});

beforeEach(() => {
  project.setState({ view: "", touched: new Map() });
  focused().chat.setState(focused().chat.getInitialState(), true);
  focused().desk.setState({ root: "C:/demo", session: "" });
  blank("");
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.workspaces.mockResolvedValue([]);
  ipc.commands.openSession.mockResolvedValue("s1");
  ipc.commands.folder.mockResolvedValue([]);
  ipc.commands.openFile.mockResolvedValue({ kind: "text", text: "" });
  shell.setState(shell.getInitialState(), true);
});

afterEach(cleanup);

describe("the thread as data", () => {
  const run = (events: ChatEvent[], live = true) => events.reduce((reply: Reply, event) => heard(reply, event, live), opening());

  it("builds text from deltas, and settles it with the full text", () => {
    const reply = run([
      { kind: "delta", thinking: true, text: "pienso" },
      { kind: "delta", thinking: false, text: "Ho" },
      { kind: "delta", thinking: false, text: "la" },
      { kind: "thought", text: "pienso bien" },
      { kind: "said", text: "Hola." },
    ]);
    expect(reply.parts.map((part) => [part.kind, "text" in part ? part.text : ""])).toEqual([
      ["thought", "pienso bien"],
      ["said", "Hola."],
    ]);
    expect(reply.open).toBeNull();
  });

  it("closes a turn: questions expire, running tools stop, and it says how it went", () => {
    const reply = run([
      { kind: "tool", id: "t1", name: "Bash", input: { command: "ls" } },
      { kind: "tool", id: "t2", name: "ToolSearch", input: {} },
      { kind: "asking", request: "r1", tool: "Bash", input: { command: "rm x" }, suggestions: null },
      { kind: "finished", ok: true, stopped: true, millis: 4200, turns: 1, tokensIn: 1, tokensOut: 1500, error: "" },
    ]);
    expect(reply.parts.map((part) => (part.kind === "step" ? part.state : part.kind === "ask" ? part.state : part.kind === "foot" ? part.text : part.kind))).toEqual([
      "stopped",
      "expired",
      "4,2 s · 1,5k tokens · detenido",
    ]);
    expect(reply.closed).toBe(true);
  });

  it("keeps the sources a tool consulted, once each", () => {
    const reply = run([
      { kind: "tool", id: "t1", name: "WebSearch", input: { query: "vite" } },
      { kind: "consulted", tool: "t1", links: [{ url: "https://vite.dev", title: "Vite" }] },
      { kind: "consulted", tool: "t1", links: [{ url: "https://vite.dev", title: "Vite" }, { url: "https://rolldown.rs", title: "" }] },
    ]);
    const step = reply.parts[0];
    expect(step.kind === "step" && step.links.map((link) => link.url)).toEqual(["https://vite.dev", "https://rolldown.rs"]);
  });
});

describe("the chat", () => {
  it("invites to start, or to pick a folder first", () => {
    hello();
    render(<Thread />);
    expect(document.querySelector(".hello-hint")?.textContent).not.toBe("");
    act(() => focused().desk.setState({ root: "" }));
    act(() => hello());
    expect(screen.getByText("Elige una carpeta de trabajo para empezar.")).toBeTruthy();
  });

  it("sends a message, opens the session, and follows the reply to its end", async () => {
    render(<Thread />);
    await act(async () => send({ message: { text: "Hola", files: ["a.ts"], images: [] }, shownFiles: ["a.ts"], pictures: [] }, SETTINGS));
    expect(ipc.commands.chatSend).toHaveBeenCalledWith("C:/demo", "s1", { text: "Hola", files: ["a.ts"], images: [] }, SETTINGS);
    expect(project.getState().session).toBe("s1");
    expect(screen.getByText("Hola", { selector: ".body-text" })).toBeTruthy();
    expect(screen.getByText("a.ts", { selector: ".asked-files span" })).toBeTruthy();
    expect(focused().chat.getState().busy).toBe(true);
    expect(document.querySelector(".live-said")?.textContent).toBe("Enviando…");

    tell({ kind: "started", model: "claude-demo" });
    tell({ kind: "delta", thinking: true, text: "pienso" });
    await settle();
    expect(document.querySelector(".thought")?.getAttribute("data-live")).toBe("true");
    expect(document.querySelector(".live-said")?.textContent).toBe("Trabajando…");
    tell({ kind: "delta", thinking: false, text: "Aquí **va**" });
    expect(document.querySelector(".live-said")?.textContent).toBe("Escribiendo…");
    tell({ kind: "said", text: "Aquí **va** todo." });
    tell({ kind: "finished", ok: true, stopped: false, millis: 1000, turns: 1, tokensIn: 1, tokensOut: 20, error: "" });
    await settle();
    expect(document.querySelector(".said strong")?.textContent).toBe("va");
    expect(document.querySelector(".said")?.textContent).toBe("Aquí va todo.");
    expect(document.querySelector(".reply-foot")?.textContent).toBe("1 s · 20 tokens");
    expect(document.querySelector(".reply-foot .foot-count")?.textContent).toBe("20");
    expect(document.querySelector(".thought")?.getAttribute("data-live")).toBe("false");
    expect(document.querySelector(".live")).toBeNull();
    expect(focused().chat.getState().busy).toBe(false);
    expect(focused().chat.getState().ended).toBe(1);
  });

  it("says why a message could not go", async () => {
    ipc.commands.chatSend.mockRejectedValue("Claude sigue trabajando en esta sesión.");
    render(<Thread />);
    await act(async () => send({ message: { text: "Otra", files: [], images: [] }, shownFiles: [], pictures: [] }, SETTINGS));
    expect(screen.getByText("Claude sigue trabajando en esta sesión.", { selector: ".reply-fault" })).toBeTruthy();
    expect(focused().chat.getState().busy).toBe(false);
  });

  it("shows what tools did: a command's output, an edit as a diff, results that open", async () => {
    focused().desk.setState({ session: "s1" });
    render(<Thread />);
    tell({ kind: "tool", id: "t1", name: "Bash", input: { command: "npm test" } });
    tell({ kind: "toolDone", id: "t1", output: "", error: true, detail: { stdout: "1 failed", stderr: "boom" } });
    tell({ kind: "tool", id: "t2", name: "Edit", input: { file_path: "C:/demo/src/app.ts" } });
    tell({
      kind: "toolDone",
      id: "t2",
      output: "",
      error: false,
      detail: { structuredPatch: [{ oldStart: 3, newStart: 3, lines: [" a", "-b", "+c"] }] },
    });
    tell({ kind: "tool", id: "t3", name: "Grep", input: { pattern: "todo" } });
    tell({ kind: "toolDone", id: "t3", output: "Found 1 file\nsrc/app.ts:4:// todo", error: false, detail: null });

    const [bash, edit, grep] = [...document.querySelectorAll<HTMLDetailsElement>("details.step")];
    expect(bash.dataset.state).toBe("failed");
    expect(bash.open).toBe(true);
    expect(bash.querySelector(".terminal-output")?.textContent).toBe("1 failed\nboom");
    expect(bash.querySelector(".terminal-foot")?.textContent).toBe("Terminó con error");

    expect(edit.querySelector(".step-meta")?.textContent).toBe("+1 −1");
    expect([...edit.querySelectorAll(".diff .row")].map((row) => row.className)).toEqual(["row", "row del", "row add"]);
    expect(project.getState().touched.get("src/app.ts")).toEqual({ add: new Set([4]), plus: 1, minus: 1 });

    expect(grep.querySelector(".step-meta")?.textContent).toBe("1 resultado");
    fireEvent.click(within(grep).getByRole("button", { name: /src\/app.ts/ }));
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "files" });
  });

  it("asks for permission, and answers with what you chose", async () => {
    focused().desk.setState({ session: "s1" });
    render(<Thread />);
    tell({ kind: "asking", request: "r1", tool: "Bash", input: { command: "rm -rf dist", description: "Limpia" }, suggestions: [{ type: "setMode", mode: "acceptEdits" }] });
    const ask = document.querySelector(".ask") as HTMLElement;
    expect(ask.dataset.state).toBe("waiting");
    expect(ask.querySelector(".ask-title")?.textContent).toBe("Claude quiere ejecutar");
    expect(ask.querySelector(".terminal-command")?.textContent).toBe("$rm -rf dist");
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Permitir y aceptar ediciones" })));
    expect(ipc.commands.chatAnswer).toHaveBeenCalledWith("s1", "r1", { allow: true, remember: true });
    expect(composer.getState().mode).toBe("acceptEdits");
    expect(ask.dataset.state).toBe("allowed");
    expect(ask.querySelector(":scope > .ask-note")?.textContent).toBe("Permitido");
  });

  it("asks until every question has an answer", async () => {
    focused().desk.setState({ session: "s1" });
    render(<Thread />);
    tell({
      kind: "asking",
      request: "r2",
      tool: "AskUserQuestion",
      input: { questions: [{ question: "¿Qué base?", options: [{ label: "Postgres" }, { label: "SQLite" }] }] },
      suggestions: null,
    });
    const ask = document.querySelector(".ask") as HTMLElement;
    fireEvent.click(within(ask).getByRole("button", { name: "Responder" }));
    expect(ask.querySelector(".ask-note")?.textContent).toBe("Responde a cada pregunta o escribe tu respuesta.");
    fireEvent.click(within(ask).getByRole("button", { name: "SQLite" }));
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Responder" })));
    expect(ipc.commands.chatAnswer).toHaveBeenCalledWith("s1", "r2", { allow: true, answers: { "¿Qué base?": "SQLite" } });
    expect(ask.querySelector(".ask-note")?.textContent).toBe("SQLite");
  });

  it("draws a saved session back, with a question still open if it is still running", async () => {
    const entries: SessionEntry[] = [
      { kind: "task", at: 1, text: "Revisa esto", files: [], images: ["pic.png"] },
      { kind: "agent", at: 2, event: { kind: "started", model: "claude-demo" } },
      { kind: "agent", at: 3, event: { kind: "said", text: "Hecho." } },
      { kind: "agent", at: 4, event: { kind: "asking", request: "r9", tool: "Bash", input: { command: "ls" }, suggestions: null } },
    ];
    ipc.commands.replay.mockResolvedValue(entries);
    ipc.commands.chatBusy.mockResolvedValue(true);
    ipc.commands.chatTasks.mockResolvedValue([]);
    ipc.commands.artifactData.mockResolvedValue("data:image/png;base64,AA");
    render(<Thread />);
    await act(async () => load("s9"));
    expect(project.getState().session).toBe("s9");
    expect(ipc.commands.artifactData).toHaveBeenCalledWith("C:/demo/pic.png");
    expect(document.querySelector(".said")?.textContent).toBe("Hecho.");
    expect((document.querySelector(".ask") as HTMLElement).dataset.state).toBe("waiting");
    expect(document.querySelector(".live-said")?.textContent).toBe("Trabajando…");
    expect(focused().chat.getState().busy).toBe(true);
  });

  it("tells the rail which sessions work, wait, or finished out of sight", () => {
    focused().desk.setState({ session: "s1" });
    const other = (event: ChatEvent) => act(() => ipc.heard!("s2", event));
    const of = (id: string) => rail.getState().activity.get(id);

    other({ kind: "started", model: "claude-demo" });
    expect(of("s2")).toBe("working");
    other({ kind: "asking", request: "r1", tool: "Bash", input: { command: "ls" }, suggestions: null });
    expect(of("s2")).toBe("waiting");
    other({ kind: "answered", request: "r1", allowed: true, answers: null });
    expect(of("s2")).toBe("working");
    other({ kind: "taskEnded" });
    expect(of("s2")).toBe("working");
    other({ kind: "finished", ok: true, stopped: false, millis: 1, turns: 1, tokensIn: 1, tokensOut: 1, error: "" });
    expect(of("s2")).toBe("done");

    tell({ kind: "started", model: "claude-demo" });
    expect(of("s1")).toBe("working");
    tell({ kind: "finished", ok: true, stopped: false, millis: 1, turns: 1, tokensIn: 1, tokensOut: 1, error: "" });
    expect(of("s1")).toBeUndefined();
  });

  it("adds notices, with a word in bold", () => {
    render(<Thread />);
    act(() => notice(["rama · ", { bold: "main" }]));
    expect(document.querySelector(".tick")?.innerHTML).toContain("rama · <b>main</b>");
  });
});
