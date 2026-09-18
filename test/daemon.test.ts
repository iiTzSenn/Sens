import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startDaemon } from "../src/daemon/server";
import { queryViaDaemon, hookViaDaemon, daemonRunning } from "../src/daemon/client";
import { socketPath } from "../src/daemon/protocol";
import { runHookPayload } from "../src/hook";

/**
 * The daemon's contract is that it is never required. Everything here checks
 * one of two things: that it gives the *same* answer as the in-process path,
 * or that its absence degrades to null rather than to an error.
 */

let root: string;
let stop: (() => Promise<void>) | null = null;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sens-daemon-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "a.ts"),
    "export function alpha() { return beta(); }\nexport function beta() { return 1; }\n",
  );
});

afterEach(async () => {
  if (stop) await stop();
  stop = null;
  rmSync(root, { recursive: true, force: true });
});

async function serve(): Promise<void> {
  const d = await startDaemon(root);
  stop = d.close;
}

describe("daemon", () => {
  it("answers a query with the same text as the in-process path", async () => {
    const { runQuery } = await import("../src/queries");
    const direct = await runQuery(root, "who_uses", { name: "beta" });

    await serve();
    const viaSocket = await queryViaDaemon(root, "who_uses", { name: "beta" });
    expect(viaSocket).toBe(direct);
    expect(viaSocket).toContain("beta");
  });

  it("runs a whole hook payload identically to the local path", async () => {
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "beta" },
      session_id: "test",
    });
    const direct = await runHookPayload(root, raw);

    await serve();
    expect(await hookViaDaemon(root, raw)).toBe(direct);
    expect(direct).toContain("permissionDecision");
  });

  it("returns null when no daemon is running, instead of throwing", async () => {
    expect(await daemonRunning(root)).toBe(false);
    expect(await queryViaDaemon(root, "find_symbol", { name: "alpha" })).toBeNull();
    expect(await hookViaDaemon(root, "{}")).toBeNull();
  });

  it("reports running only while it is listening", async () => {
    expect(await daemonRunning(root)).toBe(false);
    await serve();
    expect(await daemonRunning(root)).toBe(true);
    await stop!();
    stop = null;
    expect(await daemonRunning(root)).toBe(false);
  });

  it("stays silent, not erroneous, for a query it does not know", async () => {
    await serve();
    // `ok:false` reaches the client as null, so the caller falls back locally.
    expect(await queryViaDaemon(root, "no_such_query" as never, {} as never)).toBeNull();
  });

  it("serves a file edit made after it started", async () => {
    // The daemon holds a warm engine, so this is the case that would go stale
    // if it ever skipped the freshness check.
    await serve();
    expect(await queryViaDaemon(root, "find_symbol", { name: "gamma" })).not.toContain("gamma");

    writeFileSync(path.join(root, "src", "b.ts"), "export function gamma() { return 3; }\n");
    expect(await queryViaDaemon(root, "find_symbol", { name: "gamma" })).toContain("gamma");
  });

  it("gives each project root its own address", () => {
    expect(socketPath(root)).not.toBe(socketPath(path.join(root, "otro")));
  });

  it("is opt-out via SENS_NO_DAEMON", async () => {
    await serve();
    process.env.SENS_NO_DAEMON = "1";
    try {
      expect(await queryViaDaemon(root, "find_symbol", { name: "alpha" })).toBeNull();
    } finally {
      delete process.env.SENS_NO_DAEMON;
    }
  });
});
