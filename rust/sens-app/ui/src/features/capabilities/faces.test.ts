import { describe, expect, it } from "vitest";
import type { Listing } from "../../ipc/types";
import { monogramOf, siteOf, siteOfHost } from "./faces";

const face = (over: Partial<Pick<Listing, "name" | "title" | "homepage" | "author" | "badge">>) =>
  siteOf({ name: "x", title: "x", homepage: "", author: "", badge: "community", ...over });

describe("faces", () => {
  it("reduces a host to the site that owns it", () => {
    expect(siteOfHost("help.tickettailor.com")).toBe("tickettailor.com");
    expect(siteOfHost("www.example.co.uk")).toBe("example.co.uk");
    expect(siteOfHost("someone.github.io")).toBe("");
    expect(siteOfHost("worker.acme.workers.dev")).toBe("");
    expect(siteOfHost("{url}")).toBe("");
  });

  it("takes the site from the homepage, a known GitHub owner or the author's host", () => {
    expect(face({ homepage: "https://docs.stripe.com/mcp" })).toBe("stripe.com");
    expect(face({ homepage: "https://github.com/stripe/agent-toolkit" })).toBe("stripe.com");
    expect(face({ homepage: "https://github.com/someone/tool" })).toBe("");
    expect(face({ homepage: "https://github.com/someone/tool", author: "mcp.blockscout.com" })).toBe("blockscout.com");
    expect(face({ name: "linear", badge: "partner", homepage: "https://github.com/anthropics/claude-plugins-official" })).toBe("linear.app");
    expect(face({ name: "linear", badge: "community" })).toBe("");
  });

  it("prefers the site the title names", () => {
    expect(face({ title: "Kiwi.com", homepage: "https://docs.alpic.cloud/kiwi", author: "mcp.kiwi.com" })).toBe("kiwi.com");
    expect(face({ title: "Clay", homepage: "https://www.notion.so/clay-docs", author: "api.clay.com" })).toBe("clay.com");
  });

  it("draws one or two letters when there is no site", () => {
    expect(monogramOf("ActiveCampaign")).toBe("AC");
    expect(monogramOf("code-review")).toBe("CR");
    expect(monogramOf("Formatter")).toBe("F");
    expect(monogramOf("ñandú tools")).toBe("ÑT");
    expect(monogramOf("")).toBe("·");
  });
});
