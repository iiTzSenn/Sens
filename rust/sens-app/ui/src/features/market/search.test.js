import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedSearch, createMarketRanker } from "./search.js";

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const requests = [];
  const search = vi.fn((query) => new Promise((resolve, reject) => requests.push({ query, resolve, reject })));
  const changed = vi.fn();
  const task = createDebouncedSearch({ search, changed, delay: 100 });
  return { task, search, changed, requests };
}

describe("market search", () => {
  it("only sends the last query in a typing burst", async () => {
    const { task, search } = setup();
    task.schedule("rea");
    task.schedule("react");
    await vi.advanceTimersByTimeAsync(100);
    expect(search).toHaveBeenCalledExactlyOnceWith("react");
  });

  it.each(["resolve", "reject"])("ignores obsolete requests that %s after a new search", async (outcome) => {
    const { task, changed, requests } = setup();
    task.schedule("react");
    await vi.advanceTimersByTimeAsync(100);
    task.schedule("rust");
    await vi.advanceTimersByTimeAsync(100);
    requests[1].resolve(["rust"]);
    await vi.advanceTimersByTimeAsync(0);
    const calls = changed.mock.calls.length;
    requests[0][outcome](outcome === "resolve" ? ["react"] : new Error("old failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(changed).toHaveBeenLastCalledWith({ pending: false, hits: ["rust"], error: "" });
  });

  it.each([["", true], ["react", false]])("invalidates pending results when query=%s enabled=%s", async (query, enabled) => {
    const { task, changed, requests } = setup();
    task.schedule("react");
    await vi.advanceTimersByTimeAsync(100);
    task.schedule(query, enabled);
    requests[0].resolve(["react"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith({ pending: false, hits: [], error: "" });
  });

  it("distinguishes repeated identical queries by request, not text", async () => {
    const { task, changed, requests } = setup();
    task.schedule("react");
    await vi.advanceTimersByTimeAsync(100);
    task.schedule("react");
    requests[0].resolve(["obsolete"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith({ pending: true, hits: [], error: "" });
  });

  it("keeps the last hits on screen until the next answer, and drops them when disabled", async () => {
    const { task, changed, requests } = setup();
    task.schedule("react");
    await vi.advanceTimersByTimeAsync(100);
    requests[0].resolve(["react"]);
    await vi.advanceTimersByTimeAsync(0);
    task.schedule("reactj");
    expect(changed).toHaveBeenLastCalledWith({ pending: true, hits: ["react"], error: "" });
    task.schedule("reactj", false);
    expect(changed).toHaveBeenLastCalledWith({ pending: false, hits: [], error: "" });
  });

  it("reports failures from the active request", async () => {
    const { task, changed, requests } = setup();
    task.schedule("react");
    await vi.advanceTimersByTimeAsync(100);
    requests[0].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith({ pending: false, hits: [], error: "Error: offline" });
  });
});

it("ranks names before descriptions, keeping order and ignoring accents", () => {
  const rank = createMarketRanker();
  const items = [
    { name: "other", title: "Other", description: "código" },
    { name: "code", title: "Código", description: "" },
    { name: "extra", title: "Código extra", description: "" },
    { name: "unrelated", title: "Other", description: "" },
  ];
  expect(rank(items, "codigo")).toEqual([items[1], items[2], items[0]]);
  expect(rank(items.slice(0, 2), "codigo")).toEqual([items[1], items[0]]);
});
