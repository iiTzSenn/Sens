import { describe, expect, it } from "vitest";
import type { Listing } from "../../ipc/types";
import { FEATURED, ROW, SECTION_ROW, featured, ordered, sectionRows } from "./picks";

const listing = (id: string, over: Partial<Listing> = {}): Listing => ({
  id,
  kind: "plugin",
  name: id.split(":").pop()!,
  title: id,
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

const ids = (list: Listing[]) => list.map((one) => one.id);

describe("picks", () => {
  it("orders by trust, then what can be installed, keeping the catalogue's order", () => {
    const list = [
      listing("a"),
      listing("b", { badge: "partner", installable: false }),
      listing("c", { badge: "partner" }),
      listing("d", { badge: "anthropic" }),
      listing("e"),
    ];
    expect(ids(ordered(list))).toEqual(["d", "c", "b", "a", "e"]);
  });

  it("keeps the curated picks in order and fills the row with Anthropic's own", () => {
    const list = [
      listing("own:x", { badge: "anthropic" }),
      listing(FEATURED[1], { badge: "anthropic" }),
      listing(FEATURED[0], { badge: "anthropic" }),
      listing(FEATURED[2], { badge: "anthropic", installable: false }),
      listing("community:y"),
    ];
    expect(ids(featured(list))).toEqual([FEATURED[0], FEATURED[1], "own:x"]);
    expect(featured(Array.from({ length: 20 }, (_, at) => listing(`own:${at}`, { badge: "anthropic" }))).length).toBe(ROW);
  });

  it("gives each section a few varied picks and the full count", () => {
    const list = [
      listing("sql-1", { category: "database", author: "Acme" }),
      listing("sql-2", { category: "database", author: "Acme" }),
      listing("sql-3", { category: "database", author: "Beta" }),
      listing("sql-4", { category: "database", author: "Gamma" }),
      listing("sql-5", { category: "database", author: "Delta" }),
      listing("sql-6", { category: "database", installable: false }),
      listing("pay", { category: "finance" }),
    ];
    const rows = sectionRows(list, new Set(["sql-3"]));
    const data = rows.find((row) => row.id === "data")!;
    expect(data.count).toBe(6);
    expect(ids(data.picks)).toEqual(["sql-1", "sql-4", "sql-5"]);
    expect(data.picks.length).toBe(SECTION_ROW);
    expect(rows.map((row) => row.id)).toEqual(["data", "finance"]);
  });
});
