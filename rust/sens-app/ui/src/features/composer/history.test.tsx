// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "../chat/turns";
import { focused } from "../panes/store";
import { Composer } from "./Composer";
import { composer } from "./store";

vi.mock("../../ipc/commands", () => ({
  commands: new Proxy({}, { get: () => vi.fn(async () => undefined) }),
  events: { claudeCode: () => Promise.resolve(() => {}) },
}));
vi.mock("../../app/session", () => ({ resume: vi.fn(), draft: vi.fn(async () => {}), fresh: vi.fn(), chooseFolder: vi.fn(), showView: vi.fn() }));

const you = (text: string, key: number): Turn => ({ kind: "you", key, text, files: [], pictures: [] });
const said = (key: number): Turn => ({ kind: "notice", key, parts: ["respuesta"], tone: "" });
const field = () => screen.getByRole("textbox", { name: "Mensaje para Claude" }) as HTMLTextAreaElement;
const value = () => field().value;
const caret = () => [field().selectionStart, field().selectionEnd];

function write(text: string, at = text.length) {
  fireEvent.change(field(), { target: { value: text } });
  field().setSelectionRange(at, at);
}

function press(key: "ArrowUp" | "ArrowDown", extra: Record<string, unknown> = {}) {
  const event = fireEvent.keyDown(field(), { key, ...extra });
  return !event;
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

beforeEach(() => {
  composer.setState(composer.getInitialState(), true);
  focused().chat.setState(focused().chat.getInitialState(), true);
  focused().desk.setState(focused().desk.getInitialState(), true);
  focused().desk.setState({ root: "C:/demo" });
  focused().chat.setState({ turns: [you("primero", 1), said(2), you("segundo\ncon dos líneas", 3), said(4), you("tercero", 5), you("tercero", 6)] });
  render(<Composer />);
  fireEvent.focus(field());
});

afterEach(cleanup);

describe("the messages sent before, with the arrow keys", () => {
  it("walks back newest first and forward again, then returns the draft being written", () => {
    write("borrador");
    expect(press("ArrowUp")).toBe(true);
    expect(value()).toBe("tercero");
    expect(caret()).toEqual([7, 7]);

    press("ArrowUp");
    expect(value()).toBe("segundo\ncon dos líneas");
    expect(caret()).toEqual([22, 22]);
    field().setSelectionRange(0, 0);
    press("ArrowUp");
    expect(value()).toBe("primero");
    expect(press("ArrowUp")).toBe(false);
    expect(value()).toBe("primero");

    press("ArrowDown");
    expect(value()).toBe("segundo\ncon dos líneas");
    press("ArrowDown");
    expect(value()).toBe("tercero");
    press("ArrowDown");
    expect(value()).toBe("borrador");
    expect(press("ArrowDown")).toBe(false);
  });

  it("recalls the messages of a replayed session as well", () => {
    act(() => focused().chat.setState({ turns: [you("de la sesión guardada", 7), { kind: "notice", key: 8, parts: ["sesión"], tone: "" }] }));
    press("ArrowUp");
    expect(value()).toBe("de la sesión guardada");
  });

  it("leaves the arrows to the text while the caret is not on the first or last line", () => {
    write("una\ndos", 5);
    expect(press("ArrowUp")).toBe(false);
    expect(value()).toBe("una\ndos");
    field().setSelectionRange(1, 1);
    expect(press("ArrowDown")).toBe(false);
    expect(value()).toBe("una\ndos");
  });

  it("leaves the arrows alone with a selection, a modifier or a composition under way", () => {
    write("hola");
    field().setSelectionRange(0, 4);
    expect(press("ArrowUp")).toBe(false);
    field().setSelectionRange(4, 4);
    expect(press("ArrowUp", { shiftKey: true })).toBe(false);
    expect(press("ArrowUp", { isComposing: true })).toBe(false);
    expect(value()).toBe("hola");
  });

  it("does nothing going forward when no message was recalled", () => {
    write("hola");
    expect(press("ArrowDown")).toBe(false);
    expect(value()).toBe("hola");
  });

  it("makes an edited message the new draft", () => {
    press("ArrowUp");
    write("tercero y algo más");
    press("ArrowUp");
    expect(value()).toBe("tercero");
    press("ArrowDown");
    expect(value()).toBe("tercero y algo más");
  });

  it("gives the arrows to the suggestions while they show, and keeps them shut on a recalled command", () => {
    act(() => {
      focused().desk.setState({ slashes: [{ name: "compact", description: "Resume", hint: "" }, { name: "context", description: "Contexto", hint: "" }] });
      focused().chat.setState({ turns: [you("hola", 1), you("/compact", 2)] });
    });
    write("/co");
    expect(screen.getByRole("listbox")).toBeTruthy();
    press("ArrowUp");
    expect(value()).toBe("/co");

    write("");
    press("ArrowUp");
    expect(value()).toBe("/compact");
    expect(screen.queryByRole("listbox")).toBeNull();
    press("ArrowUp");
    expect(value()).toBe("hola");
  });
});
