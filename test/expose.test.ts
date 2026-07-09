import { describe, it, expect } from "vitest";
import { parseTunnelUrl } from "../src/dashboard/tunnel";
import { readCookie, lanIps, makeToken, terminalLink } from "../src/dashboard/expose";

describe("tunnel url parsing", () => {
  it("parses a cloudflared quick-tunnel URL", () => {
    const line = "2026-07-09 INF |  https://blue-cat-run-123.trycloudflare.com  |";
    expect(parseTunnelUrl(line)).toBe("https://blue-cat-run-123.trycloudflare.com");
  });
  it("parses an ngrok URL", () => {
    expect(parseTunnelUrl('msg="started tunnel" url=https://ab12cd.ngrok-free.app')).toBe(
      "https://ab12cd.ngrok-free.app",
    );
  });
  it("returns null for an unrelated line", () => {
    expect(parseTunnelUrl("connection established, waiting for edge")).toBeNull();
  });
});

describe("expose helpers", () => {
  it("reads a cookie value from a header", () => {
    expect(readCookie("a=1; sens_token=abc123; b=2", "sens_token")).toBe("abc123");
    expect(readCookie("a=1", "sens_token")).toBeNull();
    expect(readCookie(undefined, "sens_token")).toBeNull();
  });
  it("makes a non-empty hex token", () => {
    expect(makeToken()).toMatch(/^[0-9a-f]{8,}$/);
  });
  it("wraps a label as an OSC 8 terminal hyperlink carrying the url", () => {
    const link = terminalLink("ngrok", "https://ngrok.com/download");
    expect(link).toContain("https://ngrok.com/download");
    expect(link).toContain("ngrok");
    expect(link).toContain("]8;;"); // OSC 8 marker
  });
  it("lists LAN IPs as strings without throwing", () => {
    const ips = lanIps();
    expect(Array.isArray(ips)).toBe(true);
    for (const ip of ips) expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});
