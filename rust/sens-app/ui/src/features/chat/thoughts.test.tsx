// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../ipc/types";
import { seconds } from "../../shared/format.js";
import { showLanguage } from "../../shared/i18n";
import { focused } from "../panes/store";
import { Thread } from "./Thread";
import { heard, opening, type Reply, type Thought } from "./turns";
import { grouped, titleOf, tookOf } from "./work";

const counted = vi.hoisted(() => ({ titles: 0 }));

vi.mock("./work", async (actual) => {
  const real = await actual<typeof import("./work")>();
  return {
    ...real,
    titleOf: (...args: Parameters<typeof real.titleOf>) => {
      counted.titles += 1;
      return real.titleOf(...args);
    },
  };
});

const run = (events: ChatEvent[], live = false, from: Reply = opening()) => events.reduce((reply: Reply, event) => heard(reply, event, live), from);
const finished = (extra: Partial<Extract<ChatEvent, { kind: "finished" }>> = {}): ChatEvent => ({
  kind: "finished",
  ok: true,
  stopped: false,
  millis: 0,
  turns: 1,
  tokensIn: 1,
  tokensOut: 0,
  error: "",
  ...extra,
});
const tool = (id: string, name: string, input = {}): ChatEvent => ({ kind: "tool", id, name, input });
const done = (id: string, error = false): ChatEvent => ({ kind: "toolDone", id, output: "", error, detail: null });
const shown = (...turns: Reply[]) => act(() => focused().chat.setState({ turns }));

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

beforeEach(() => {
  focused().chat.setState(focused().chat.getInitialState(), true);
  focused().desk.setState({ root: "C:/demo", session: "" });
});

afterEach(() => {
  cleanup();
  showLanguage("es");
  vi.restoreAllMocks();
});

describe("what a thought is about", () => {
  it("takes its first heading once it ends, and follows the newest while it is written", () => {
    const text = "**Checking the session store**\n\nIt keeps turns.\n\n**Planning the fix**\n\nThen";
    expect(titleOf(text, false)).toBe("Checking the session store");
    expect(titleOf(text, true)).toBe("Planning the fix");
    expect(titleOf("# Reading `turns.ts`\nbody", false)).toBe("Reading turns.ts");
  });

  it("falls back to its first sentence, without Markdown, and to the newest whole one while live", () => {
    expect(titleOf("The user wants **`turns.ts`** to [group](https://x.dev) parts. Then more.", false)).toBe("The user wants turns.ts to group parts");
    expect(titleOf("- Look at the store first:\n- then the thread", false)).toBe("Look at the store first");
    expect(titleOf("First I read it. Now I compare the two", true)).toBe("First I read it");
    expect(titleOf("Still wri", true)).toBe("");
    expect(titleOf("x".repeat(400), false)).toHaveLength(160);
  });

  it("ends a Japanese or Chinese sentence at its full stop, with no space after it", () => {
    expect(titleOf("まずファイルを読みます。次にテストを実行します。", false)).toBe("まずファイルを読みます");
    expect(titleOf("先读取文件！然后比较", true)).toBe("先读取文件！");
  });
});

describe("how long a thought took", () => {
  it("counts from its first delta to the moment the next part opens, live only", () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(1000);
    const started = run([{ kind: "delta", thinking: true, text: "**Plan**" }], true);
    clock.mockReturnValue(4200);
    const reply = run([tool("t1", "Read", { file_path: "a.ts" }), { kind: "thought", text: "**Plan**\n\nRead a.ts." }], true, started);
    const thought = reply.parts[0] as Thought;
    expect(tookOf(thought)).toBe(3200);
    expect(thought.text).toBe("**Plan**\n\nRead a.ts.");

    const replayed = run([{ kind: "delta", thinking: true, text: "**Plan**" }, { kind: "thought", text: "**Plan**" }]);
    expect(tookOf(replayed.parts[0] as Thought)).toBeNull();
  });

  it("shows the title and the time on its row, and its text as Markdown once opened", () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(0);
    const live = run([{ kind: "delta", thinking: true, text: "**Reading the store**\n\nIt keeps **turns**.\n\n**Grouping parts**\n" }], true);
    render(<Thread />);
    shown(live);
    const row = document.querySelector("details.thought") as HTMLDetailsElement;
    expect(row.dataset.live).toBe("true");
    expect(row.querySelector(".thought-verb")?.textContent).toBe("Razonando…");
    expect(row.querySelector(".thought-title")?.textContent).toBe("Grouping parts");
    expect(row.querySelector(".thought-time")?.textContent).toBe("");

    clock.mockReturnValue(2500);
    shown(run([{ kind: "thought", text: "**Reading the store**\n\nIt keeps **turns**." }], true, live));
    expect(row.querySelector(".thought-verb")?.textContent).toBe("Razonamiento");
    expect(row.querySelector(".thought-title")?.textContent).toBe("Reading the store");
    expect(row.querySelector(".thought-time")?.textContent).toBe(seconds(2500));
    expect(row.querySelector(".thought-body")?.childElementCount).toBe(0);
    fireEvent.click(row.querySelector("summary")!);
    expect([...row.querySelectorAll(".thought-body strong")].map((bold) => bold.textContent)).toEqual(["Reading the store", "turns"]);
  });

  it("leaves a finished thought alone while the reply goes on streaming", () => {
    render(<Thread />);
    let reply = run([{ kind: "delta", thinking: true, text: "**Plan**\n" }, { kind: "thought", text: "**Plan**" }], true);
    shown(reply);
    const before = counted.titles;
    for (const text of ["Un", "a ", "res", "puesta"]) {
      reply = run([{ kind: "delta", thinking: false, text }], true, reply);
      shown(reply);
    }
    expect(counted.titles).toBe(before);
  });
});

describe("a long run of work", () => {
  const work: ChatEvent[] = [
    { kind: "thought", text: "**Plan**" },
    tool("t1", "Bash", { command: "npm test" }),
    done("t1", true),
    tool("t2", "Read", { file_path: "a.ts" }),
    done("t2"),
    tool("t3", "Read", { file_path: "b.ts" }),
    done("t3"),
    tool("t4", "Edit", { file_path: "a.ts" }),
    done("t4"),
  ];

  it("keeps each part in one group whose key stays as parts arrive", () => {
    const early = run(work.slice(0, 3));
    const [first] = grouped(early.parts);
    const later = grouped(run([...work.slice(3), { kind: "said", text: "Hecho." }], false, early).parts);
    expect(later.map((piece) => piece.kind)).toEqual(["run", "said"]);
    expect(later[0].key).toBe(first.key);
    expect(later[0].kind === "run" && later[0].parts).toHaveLength(5);
  });

  it("shows as it happens, then folds into one line that marks what failed and opens to all of it", () => {
    render(<Thread />);
    const live = run([{ kind: "said", text: "Miro." }, ...work], true);
    shown(live);
    const group = document.querySelector("details.run") as HTMLDetailsElement;
    const bash = group.querySelector("details.step");
    expect(group.dataset.folded).toBe("false");
    expect(group.open).toBe(true);
    expect((group.querySelector(".run-head") as HTMLElement).hidden).toBe(true);

    shown(run([{ kind: "said", text: "Hecho." }, finished()], true, live));
    expect(document.querySelector("details.run")).toBe(group);
    expect(group.querySelector("details.step")).toBe(bash);
    expect(group.dataset.folded).toBe("true");
    expect(group.dataset.failed).toBe("true");
    expect(group.open).toBe(false);
    expect(group.querySelector(".run-verb")?.textContent).toBe("Trabajó");
    expect(group.querySelector(".run-tally")?.textContent).toBe("1 comando · 2 ficheros leídos · 1 edición");
    expect(group.querySelector(".run-failed")?.textContent).toBe("1 con error");
    expect(group.querySelectorAll("details.step")).toHaveLength(4);
    expect(group.querySelectorAll("details.thought")).toHaveLength(1);

    act(() => {
      group.open = true;
      fireEvent(group, new Event("toggle"));
    });
    shown(run([{ kind: "said", text: "Hecho." }, finished()], true, live));
    expect(group.open).toBe(true);
  });

  it("says how long the work took when it was seen live", () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(1000);
    let reply = run([tool("t1", "Read"), tool("t2", "Read"), tool("t3", "Read"), tool("t4", "Read"), tool("t5", "Grep")], true);
    clock.mockReturnValue(73_000);
    reply = run([done("t1"), done("t2"), done("t3"), done("t4"), done("t5"), finished()], true, reply);
    showLanguage("en");
    render(<Thread />);
    shown(reply);
    expect(document.querySelector(".run-tally")?.textContent).toBe("4 files read · 1 search");
    expect(document.querySelector(".run-verb")?.textContent).toBe("Worked");
    expect(document.querySelector(".run-time")?.textContent).toBe(seconds(72_000));
  });

  it("leaves a short run as it is, and a replayed one without a time", () => {
    render(<Thread />);
    shown(run([...work.slice(0, 5), finished()]), run([...work, finished()]));
    const [short, long] = [...document.querySelectorAll<HTMLDetailsElement>("details.run")];
    expect(short.dataset.folded).toBe("false");
    expect(long.dataset.folded).toBe("true");
    expect(long.querySelector(".run-time")?.textContent).toBe("");
  });
});

describe("the foot of a reply", () => {
  const reply = () => run([{ kind: "said", text: "Hecho." }, finished({ millis: 12_000, tokensOut: 20, stopped: true })]);

  it("says how long it took, what it wrote and whether it was stopped", () => {
    render(<Thread />);
    shown(reply());
    expect(document.querySelector(".reply-foot")?.textContent).toBe(`${seconds(12_000)} · 20 tokens · detenido`);
    expect(document.querySelector(".reply-foot .foot-count")?.textContent).toBe("20");
  });

  it("says it in the language shown", () => {
    showLanguage("ja");
    render(<Thread />);
    shown(reply());
    expect(document.querySelector(".reply-foot")?.textContent).toBe(`${seconds(12_000)} · 20 トークン · 停止`);
    expect(document.querySelector(".reply-foot .foot-count")?.textContent).toBe("20");
  });

  it("asks for a folder in the language shown", () => {
    showLanguage("en");
    focused().desk.setState({ root: "" });
    render(<Thread />);
    expect(document.querySelector(".hello-hint")?.textContent).toBe("Choose a working folder to start.");
  });
});
