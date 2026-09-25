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
    notify: vi.fn(),
    isolateSession: vi.fn(),
  },
  heard: null as ((session: string, event: ChatEvent) => void) | null,
}));

const painting = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../../shared/syntax/paint", async (actual) => {
  const real = await actual<typeof import("../../shared/syntax/paint")>();
  return {
    ...real,
    paintRows: (...args: Parameters<typeof real.paintRows>) => {
      painting.calls += 1;
      return real.paintRows(...args);
    },
  };
});

vi.mock("../../ipc/commands", () => ({
  commands: ipc.commands,
  events: { chat: (heard: (session: string, event: ChatEvent) => void) => ((ipc.heard = heard), Promise.resolve(() => {})) },
}));

const SETTINGS = { provider: "claude", model: "claude-demo", effort: "", thinking: true, mode: "default" };
const tell = (event: ChatEvent) => act(() => ipc.heard!("s1", event));
const settle = () => act(async () => new Promise((done) => setTimeout(done, 50)));

function later<T>() {
  let done!: (value: T) => void;
  const promise = new Promise<T>((settle) => (done = settle));
  return { promise, done };
}

beforeAll(() => {
  hearChat();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
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
    expect(reply.parts.map((part) => (part.kind === "step" ? part.state : part.kind === "ask" ? part.state : part.kind))).toEqual(["stopped", "expired", "foot"]);
    expect(reply.parts[2]).toMatchObject({ millis: 4200, tokens: 1500, stopped: true });
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

describe("a session in a worktree of its own", () => {
  const worktree = { path: "C:/demo/.sens/worktrees/ab12cd34", branch: "sens/ab12cd34", base: "main" };
  const repo = { branch: "main", detached: false, dirty: 0, branches: ["main"] };
  const hola = () => send({ message: { text: "Hola", files: [], images: [] }, shownFiles: [], pictures: [] }, SETTINGS);

  it("gets its worktree before its first message goes, and then works there", async () => {
    focused().desk.setState({ isolate: true, repo });
    ipc.commands.isolateSession.mockResolvedValue(worktree);
    render(<Thread />);
    await act(hola);

    expect(ipc.commands.isolateSession).toHaveBeenCalledWith("C:/demo", "s1");
    expect(ipc.commands.isolateSession.mock.invocationCallOrder[0]).toBeLessThan(ipc.commands.chatSend.mock.invocationCallOrder[0]);
    expect(focused().desk.getState().worktree).toEqual(worktree);
    expect(project.getState()).toMatchObject({ root: "C:/demo", work: worktree.path });
  });

  it("sends nothing when the worktree cannot be made, says why, and the next try works in the project folder", async () => {
    focused().desk.setState({ isolate: true, repo });
    ipc.commands.isolateSession.mockRejectedValue("el proyecto no tiene ningún commit del que partir");
    render(<Thread />);
    await act(hola);

    expect(ipc.commands.chatSend).not.toHaveBeenCalled();
    expect(document.querySelector(".reply-fault")?.textContent).toBe(
      "No pude crear el worktree: el proyecto no tiene ningún commit del que partir. Si vuelves a enviar, Claude trabajará en la carpeta del proyecto.",
    );
    expect(project.getState().work).toBe("C:/demo");

    await act(hola);
    expect(ipc.commands.isolateSession).toHaveBeenCalledTimes(1);
    expect(ipc.commands.chatSend).toHaveBeenCalledTimes(1);
  });

  it("hands over what was attached before the worktree existed from the project folder", async () => {
    focused().desk.setState({ isolate: true, repo });
    ipc.commands.isolateSession.mockResolvedValue(worktree);
    await act(() => send({ message: { text: "Hola", files: ["spec.md", "C:/fuera/notas.md"], images: [] }, shownFiles: [], pictures: [] }, SETTINGS));

    expect(ipc.commands.chatSend).toHaveBeenCalledWith("C:/demo", "s1", { text: "Hola", files: ["C:/demo/spec.md", "C:/fuera/notas.md"], images: [] }, SETTINGS);
  });

  it("sends to the session it began with, even if another is opened while the worktree is made", async () => {
    focused().desk.setState({ isolate: true, repo });
    let made!: (isolation: typeof worktree) => void;
    ipc.commands.isolateSession.mockReturnValue(new Promise((done) => (made = done)));
    const sending = send({ message: { text: "Hola", files: [], images: [] }, shownFiles: [], pictures: [] }, SETTINGS);
    await act(() => new Promise((done) => setTimeout(done, 0)));
    act(() => blank("s2"));
    made(worktree);
    await act(() => sending);

    expect(ipc.commands.chatSend).toHaveBeenCalledWith("C:/demo", "s1", expect.anything(), SETTINGS);
    expect(focused().desk.getState()).toMatchObject({ session: "s2", worktree: null });
  });

  it("stays in the project folder when not asked, or outside a repository", async () => {
    focused().desk.setState({ isolate: false, repo });
    await act(hola);
    blank("");
    focused().desk.setState({ isolate: true, repo: null });
    await act(hola);
    expect(ipc.commands.isolateSession).not.toHaveBeenCalled();
  });

  it("comes back with a saved session, which never asks for another", async () => {
    focused().desk.setState({ isolate: true, repo });
    ipc.commands.replay.mockResolvedValue([]);
    ipc.commands.replay.mockResolvedValueOnce([
      { kind: "opened", at: 0, root: "C:/demo" },
      { kind: "isolated", at: 1, ...worktree },
      { kind: "task", at: 2, text: "a", files: [], images: [] },
    ] satisfies SessionEntry[]);
    ipc.commands.chatBusy.mockResolvedValue(false);
    ipc.commands.chatTasks.mockResolvedValue([]);
    await act(async () => load("s7"));

    expect(focused().desk.getState()).toMatchObject({ worktree, isolate: false });
    expect(project.getState().work).toBe(worktree.path);
    await act(async () => load("s8"));
    expect(focused().desk.getState().worktree).toBeNull();
  });
});

describe("how full the context is", () => {
  const finished = (context: number | undefined, window: number | undefined): ChatEvent => ({ kind: "finished", ok: true, stopped: false, millis: 1, turns: 1, tokensIn: 1, tokensOut: 1, context, window, error: "" });

  it("follows each turn that says it, and forgets it with a new session", async () => {
    render(<Thread />);
    await act(async () => send({ message: { text: "Hola", files: [], images: [] }, shownFiles: [], pictures: [] }, SETTINGS));
    tell(finished(52_000, 200_000));
    expect(focused().chat.getState().context).toEqual({ used: 52_000, window: 200_000 });
    tell(finished(undefined, undefined));
    expect(focused().chat.getState().context).toEqual({ used: 52_000, window: 200_000 });
    blank("");
    expect(focused().chat.getState().context).toBeNull();
  });

  it("comes back with a saved session, from its last turn", async () => {
    ipc.commands.replay.mockResolvedValue([
      { kind: "task", at: 1, text: "a", files: [], images: [] },
      { kind: "agent", at: 2, event: finished(10_000, 200_000) },
      { kind: "task", at: 3, text: "b", files: [], images: [] },
      { kind: "agent", at: 4, event: finished(90_000, 1_000_000) },
    ] satisfies SessionEntry[]);
    ipc.commands.chatBusy.mockResolvedValue(false);
    ipc.commands.chatTasks.mockResolvedValue([]);
    await act(async () => load("s7"));
    expect(focused().chat.getState().context).toEqual({ used: 90_000, window: 1_000_000 });
  });

  it("marks a compaction in the reply, saying whether Claude Code chose it", () => {
    const reply = heard(opening(), { kind: "compacted", before: 154_000, auto: true }, true);
    render(<Thread />);
    act(() => focused().chat.setState({ turns: [reply, heard(opening(), { kind: "compacted", before: 0, auto: false }, true)] }));
    expect([...document.querySelectorAll(".reply-note")].map((note) => note.textContent)).toEqual(["Claude Code compactó la conversación · tenía 154k tokens", "Conversación compactada"]);
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
    expect(screen.getByText("a.ts", { selector: ".sent-files .clip-head" })).toBeTruthy();
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
    expect(edit.querySelector(".diff")).toBeNull();
    fireEvent.click(edit.querySelector("summary")!);
    expect([...edit.querySelectorAll(".diff .row")].map((row) => row.className)).toEqual(["row", "row del", "row add"]);
    expect(project.getState().touched.get("src/app.ts")).toEqual({ add: new Set([4]), plus: 1, minus: 1 });

    expect(grep.querySelector(".step-meta")?.textContent).toBe("1 resultado");
    fireEvent.click(grep.querySelector("summary")!);
    fireEvent.click(within(grep).getByRole("button", { name: /src\/app.ts/ }));
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "files" });
  });

  it("leaves what was already drawn alone while a reply streams", async () => {
    focused().desk.setState({ session: "s1" });
    render(<Thread />);
    const edited = (id: string) => {
      tell({ kind: "tool", id, name: "Edit", input: { file_path: "C:/demo/src/app.ts" } });
      tell({ kind: "toolDone", id, output: "", error: false, detail: { structuredPatch: [{ oldStart: 3, newStart: 3, lines: [" a", "-b", "+c"] }] } });
    };
    edited("t1");
    tell({ kind: "finished", ok: true, stopped: false, millis: 1, turns: 1, tokensIn: 1, tokensOut: 1, error: "" });
    edited("t2");
    const closed = painting.calls;
    await settle();
    expect(painting.calls).toBe(closed);
    for (const summary of document.querySelectorAll("details.step > summary")) fireEvent.click(summary);
    await settle();
    const painted = painting.calls;
    expect(painted).toBe(closed + 2);

    for (const text of ["Un", "a ", "res", "puesta"]) tell({ kind: "delta", thinking: false, text });
    fireEvent.scroll(document.querySelector(".thread")!);
    await settle();

    expect(document.querySelectorAll(".diff")).toHaveLength(2);
    expect(painting.calls).toBe(painted);
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

  it("draws a running session's history first, then what it said while being read, each thing once", async () => {
    const read = later<SessionEntry[]>();
    ipc.commands.replay.mockReturnValue(read.promise);
    ipc.commands.chatBusy.mockResolvedValue(true);
    ipc.commands.chatTasks.mockResolvedValue([]);
    render(<Thread />);
    let loading!: Promise<void>;
    act(() => void (loading = load("s1")));
    tell({ kind: "said", text: "Hecho." });
    tell({ kind: "tool", id: "t1", name: "Bash", input: { command: "npm test" } });
    tell({ kind: "delta", thinking: false, text: "Sigo" });
    read.done([
      { kind: "task", at: 1, text: "Revisa esto", files: [], images: [] },
      { kind: "agent", at: 2, event: { kind: "started", model: "claude-demo" } },
      { kind: "agent", at: 3, event: { kind: "said", text: "Hecho." } },
    ]);
    await act(async () => loading);

    const replies = focused().chat.getState().turns.filter((turn): turn is Reply => turn.kind === "reply");
    expect(replies).toHaveLength(1);
    expect(replies[0].parts.map((part) => (part.kind === "step" ? part.id : part.kind === "said" ? part.text : part.kind))).toEqual(["Hecho.", "t1", "Sigo"]);
    expect(document.querySelector(".live-said")?.textContent).toBe("Escribiendo…");
    expect(focused().chat.getState().busy).toBe(true);
  });

  it("closes the turn a running session ended while it was being read", async () => {
    const read = later<SessionEntry[]>();
    ipc.commands.replay.mockReturnValue(read.promise);
    ipc.commands.chatBusy.mockResolvedValue(false);
    ipc.commands.chatTasks.mockResolvedValue([]);
    render(<Thread />);
    let loading!: Promise<void>;
    act(() => void (loading = load("s1")));
    tell({ kind: "finished", ok: true, stopped: false, millis: 1000, turns: 1, tokensIn: 1, tokensOut: 20, error: "" });
    read.done([
      { kind: "task", at: 1, text: "Revisa esto", files: [], images: [] },
      { kind: "agent", at: 2, event: { kind: "said", text: "Hecho." } },
    ]);
    await act(async () => loading);

    expect(focused().chat.getState().turns.filter((turn) => turn.kind === "reply")).toHaveLength(1);
    expect(document.querySelector(".reply-foot")?.textContent).toBe("1 s · 20 tokens");
    expect(document.querySelector(".live")).toBeNull();
    expect(focused().chat.getState().busy).toBe(false);
  });

  it("does not leave working a turn the saved session already closed", async () => {
    ipc.commands.replay.mockResolvedValue([
      { kind: "task", at: 1, text: "Revisa esto", files: [], images: [] },
      { kind: "agent", at: 2, event: { kind: "said", text: "Hecho." } },
      { kind: "agent", at: 3, event: { kind: "finished", ok: true, stopped: false, millis: 1, turns: 1, tokensIn: 1, tokensOut: 1, error: "" } },
    ]);
    ipc.commands.chatBusy.mockResolvedValue(true);
    ipc.commands.chatTasks.mockResolvedValue([]);
    render(<Thread />);
    await act(async () => load("s1"));

    expect(focused().chat.getState().turns.filter((turn) => turn.kind === "reply")).toHaveLength(1);
    expect(document.querySelector(".live")).toBeNull();
    expect(focused().chat.getState().busy).toBe(false);
  });

  it("shows only the session opened last when two are opened quickly", async () => {
    const first = later<SessionEntry[]>();
    ipc.commands.replay.mockReturnValueOnce(first.promise).mockResolvedValueOnce([{ kind: "task", at: 1, text: "Soy la segunda", files: [], images: [] }]);
    ipc.commands.chatBusy.mockResolvedValue(false);
    ipc.commands.chatTasks.mockResolvedValue([]);
    render(<Thread />);
    let loading!: Promise<void>;
    act(() => void (loading = load("s7")));
    await act(async () => load("s8"));
    first.done([{ kind: "task", at: 1, text: "Soy la primera", files: [], images: [] }]);
    await act(async () => loading);

    expect(project.getState().session).toBe("s8");
    expect(focused().chat.getState().turns.map((turn) => (turn.kind === "you" ? turn.text : turn.kind))).toEqual(["Soy la segunda"]);
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
