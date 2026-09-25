import { describe, expect, it } from "vitest";
import type { Listing } from "../../ipc/types";
import { t } from "./copy";
import { SECTION_IDS, classify, sectionOf, tallyBySection } from "./sections";

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: over.name || "x",
  kind: "plugin",
  name: "x",
  title: "x",
  description: "",
  author: "",
  badge: "community",
  source: "community",
  category: "",
  version: "",
  homepage: "",
  installs: null,
  login: false,
  tools: [],
  installable: true,
  revision: "",
  ...over,
});

describe("sections", () => {
  it.each([
    [{ name: "neon", category: "database" }, "data"],
    [{ name: "10x-genomics", source: "life-sciences", description: "Cloud analysis workflows" }, "science"],
    [{ name: "dcf-model", source: "financial-services" }, "finance"],
    [{ name: "helper", description: "Deploys to Kubernetes with GitHub Actions and Terraform" }, "cloud"],
    [{ name: "slack", title: "Slack", description: "Posts code review notes" }, "communication"],
    [{ name: "flaky", description: "Investigate flaky tests in your repository" }, "code"],
    [{ name: "hotels", title: "Trivago", description: "Find your ideal hotel at the best price." }, "lifestyle"],
    [{ name: "memory-bank", description: "Persistent memory for agents across sessions" }, "agents"],
    [{ name: "figma", title: "Figma", description: "Bring files into your workflow" }, "design"],
    [{ name: "i-ching", description: "Divination with three coins" }, "lifestyle"],
    [{ name: "zzz", description: "Nothing to see" }, "other"],
  ])("puts %o in %s", (over, section) => {
    expect(classify(listing(over as Partial<Listing>))).toBe(section);
  });

  it("weighs the category and the name above loose words in the description", () => {
    expect(classify(listing({ name: "ledger", description: "Written in TypeScript with a CLI" }))).toBe("finance");
    expect(classify(listing({ name: "tool", category: "security", description: "A python CLI" }))).toBe("security");
  });

  it("classifies each listing once and counts every section", () => {
    const one = listing({ name: "stripe", description: "Payments" });
    expect(sectionOf(one)).toBe("finance");
    expect(sectionOf(one)).toBe(sectionOf(one));
    const counts = tallyBySection([one, listing({ name: "sql", category: "database" }), listing({ name: "zzz" })]);
    expect(counts).toMatchObject({ finance: 1, data: 1, other: 1, code: 0 });
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it("names and describes every section", () => {
    expect(Object.keys(t.sectionNames).sort()).toEqual([...SECTION_IDS].sort());
    expect(Object.keys(t.sectionAbouts).sort()).toEqual([...SECTION_IDS].sort());
    expect(SECTION_IDS.at(-1)).toBe("other");
  });
});
