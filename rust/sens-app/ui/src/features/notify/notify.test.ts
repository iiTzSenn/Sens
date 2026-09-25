// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../ipc/types";
import { profile } from "../profile/store";
import { rail } from "../rail/store";
import { notePresence, noticeOf, tellAway } from "./store";

const ipc = vi.hoisted(() => ({ commands: { notify: vi.fn() } }));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands, events: {} }));

const finished = (over: Partial<Extract<ChatEvent, { kind: "finished" }>> = {}): ChatEvent => ({ kind: "finished", ok: true, stopped: false, millis: 1, turns: 1, tokensIn: 1, tokensOut: 1, error: "", ...over });
const asking = (tool: string, input = {}): ChatEvent => ({ kind: "asking", request: "r", tool, input, suggestions: null });

beforeEach(() => {
  ipc.commands.notify.mockReset().mockResolvedValue(undefined);
  notePresence(false);
  profile.setState({ person: { name: "", checkUpdates: true, welcomed: true, seen: "", notify: true } });
  rail.setState({ spaces: [{ root: "C:/demo", name: "demo", sessions: [{ id: "s1", title: "Arreglar el login", startedAt: 0, tasks: 1, archived: false }] }] } as never);
});

afterEach(() => notePresence(true));

describe("what a notice says", () => {
  it("names what needs an answer, and how a turn ended", () => {
    expect(noticeOf(asking("Bash", { command: "npm test" }))).toBe("Necesita tu permiso: Ejecutar npm test");
    expect(noticeOf(asking("AskUserQuestion"))).toBe("Tiene una pregunta para ti.");
    expect(noticeOf(asking("ExitPlanMode"))).toBe("Tiene un plan para que lo revises.");
    expect(noticeOf(finished())).toBe("Ha terminado.");
    expect(noticeOf(finished({ ok: false }))).toBe("Terminó con un error.");
    expect(noticeOf({ kind: "failed", reason: "x" })).toBe("Se paró por un error.");
  });

  it("says nothing of a turn you stopped, or of what happens along the way", () => {
    expect(noticeOf(finished({ stopped: true }))).toBe("");
    expect(noticeOf({ kind: "said", text: "hola" })).toBe("");
  });

  it("keeps a long command short", () => {
    expect(noticeOf(asking("Bash", { command: "x".repeat(400) })).length).toBe(120);
  });
});

describe("when Sens tells", () => {
  it("only while Sens is not in front, under the session's title", () => {
    tellAway("s1", finished());
    expect(ipc.commands.notify).toHaveBeenCalledWith("Arreglar el login", "Ha terminado.");

    notePresence(true);
    tellAway("s1", finished());
    expect(ipc.commands.notify).toHaveBeenCalledTimes(1);
  });

  it("names a session not listed yet as a new one", () => {
    tellAway("s9", finished());
    expect(ipc.commands.notify).toHaveBeenCalledWith("Sesión nueva", "Ha terminado.");
  });

  it("once for a burst of questions from the same session", () => {
    const at = Date.now() + 60_000;
    tellAway("s1", asking("Bash", { command: "a" }), at);
    tellAway("s1", asking("Bash", { command: "b" }), at + 1000);
    tellAway("s2", asking("Bash", { command: "c" }), at + 1000);
    tellAway("s1", asking("Bash", { command: "d" }), at + 8000);
    expect(ipc.commands.notify.mock.calls.map(([, body]) => body)).toEqual(["Necesita tu permiso: Ejecutar a", "Necesita tu permiso: Ejecutar c", "Necesita tu permiso: Ejecutar d"]);
  });

  it("never when the notices are off", () => {
    profile.setState(({ person }) => ({ person: { ...person, notify: false } }));
    tellAway("s1", finished());
    expect(ipc.commands.notify).not.toHaveBeenCalled();
  });
});
