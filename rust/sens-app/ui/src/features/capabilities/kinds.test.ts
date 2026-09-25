import { describe, expect, it } from "vitest";
import type { Capabilities, Detail, Listing } from "../../ipc/types";
import {
  NO_CAPS,
  envOf,
  exploreList,
  firstLine,
  installedItem,
  listed,
  originFor,
  runsOf,
  searchesSkillsSh,
  specOf,
  tallyOf,
} from "./kinds";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({ ...NO_CAPS, ...over });
const skill = (name: string, enabled = true) => ({ name, description: "", enabled });
const plugin = (name: string, enabled = true) => ({ name, description: "", version: "", enabled });
const server = (name: string, enabled = true) => ({ name, command: "npx", args: [], envKeys: [], kind: "stdio", url: "", enabled });

const listing = (id: string, over: Partial<Listing> = {}): Listing => ({
  id,
  kind: "skill",
  name: id,
  title: id,
  description: "",
  author: "",
  badge: "community",
  source: "",
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

describe("tally", () => {
  it.each([
    [caps(), "Nada activo en este proyecto"],
    [caps({ skills: [skill("a")] }), "1 skill activa en este proyecto"],
    [caps({ skills: [skill("a"), skill("b")] }), "2 skills activas en este proyecto"],
    [caps({ servers: [server("a")] }), "1 MCP activo en este proyecto"],
    [caps({ plugins: [plugin("a")], skills: [skill("b"), skill("c", false)] }), "1 plugin y 1 skill activos en este proyecto"],
    [
      caps({ plugins: [plugin("a"), plugin("b")], skills: [skill("c")], servers: [server("d")] }),
      "2 plugins, 1 skill y 1 MCP activos en este proyecto",
    ],
  ])("counts what is on", (state, said) => {
    expect(tallyOf(state)).toBe(said);
  });
});

describe("server form parsing", () => {
  it("reads one argument per line and KEY=value pairs", () => {
    expect(listed(" -y \n\n@scope/server \r\n")).toEqual(["-y", "@scope/server"]);
    expect(envOf("TOKEN = abc=def\n\nMODE=fast")).toEqual({ TOKEN: "abc=def", MODE: "fast" });
  });

  it("says which line is wrong", () => {
    expect(() => envOf("TOKEN=a\nno equals")).toThrow("Variables de entorno, línea 2: escribe CLAVE=valor.");
    expect(() => envOf("1BAD=a")).toThrow("línea 1");
    expect(() => envOf("A=1\nA=2")).toThrow("Variables de entorno: A está repetida.");
  });
});

describe("provenance", () => {
  const installed = caps({
    plugins: [plugin("fmt")],
    origins: { "plugin:fmt": { listing: "market/fmt", revision: "r1", version: "1.0.0", installedAt: 1 } },
  });

  it("finds what a listing installed and the item it became", () => {
    const origin = originFor(installed, "market/fmt");
    expect(origin).toMatchObject({ kind: "plugin", name: "fmt", revision: "r1" });
    expect(specOf(origin!).list).toBe("plugins");
    expect(installedItem(installed, origin!)).toEqual(plugin("fmt"));
    expect(originFor(installed, "market/other")).toBeNull();
  });

  it("keeps a name that has a colon in it", () => {
    const origin = originFor(caps({ origins: { "server:a:b": { listing: "x", revision: "", version: "", installedAt: 0 } } }), "x");
    expect(origin).toMatchObject({ kind: "server", name: "a:b" });
  });
});

describe("explore list", () => {
  const byName = (list: Listing[]) => list.map((one) => one.id);
  const keep = (list: Listing[]) => list;
  const catalogue = [listing("a", { kind: "plugin", badge: "anthropic" }), listing("b", { badge: "partner" }), listing("c")];

  it("filters by kind and by source group", () => {
    expect(byName(exploreList(catalogue, [], "", "skill", "all", keep).found)).toEqual(["b", "c"]);
    expect(byName(exploreList(catalogue, [], "", "all", "anthropic", keep).found)).toEqual(["a", "b"]);
  });

  it("adds skills.sh hits only while searching, and never twice", () => {
    const hits = [listing("c"), listing("d", { badge: "skillsSh" })];
    expect(byName(exploreList(catalogue, hits, "", "all", "all", keep).found)).toEqual(["a", "b", "c"]);
    const { needle, found } = exploreList(catalogue, hits, "  Ñu ", "all", "all", keep);
    expect(needle).toBe("nu");
    expect(byName(found)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps one section when asked, and counts from everything that matched", () => {
    const list = [listing("sql", { description: "Query your database" }), listing("pay", { description: "Payments and invoices" })];
    const { matched, found } = exploreList(list, [], "", "all", "all", keep, "finance");
    expect(byName(matched)).toEqual(["sql", "pay"]);
    expect(byName(found)).toEqual(["pay"]);
    expect(byName(exploreList(list, [], "", "all", "all", keep, "home").found)).toEqual(["sql", "pay"]);
  });

  it("only asks skills.sh when skills can show up", () => {
    expect(searchesSkillsSh("all", "all")).toBe(true);
    expect(searchesSkillsSh("skill", "skillsSh")).toBe(true);
    expect(searchesSkillsSh("plugin", "all")).toBe(false);
    expect(searchesSkillsSh("all", "anthropic")).toBe(false);
  });
});

describe("detail helpers", () => {
  it("takes the first line of the readme, past front matter and heading marks", () => {
    expect(firstLine("---\nname: x\n---\n\n## Hola mundo\n\nmás")).toBe("Hola mundo");
    expect(firstLine("")).toBe("");
  });

  it("lists what a plugin runs", () => {
    const detail = {
      parts: {
        skills: [],
        commands: [],
        agents: [],
        hooks: [{ event: "PostToolUse", command: "fmt" }],
        servers: [{ name: "db", launch: "npx db" }],
        lsp: [],
        bin: ["bin/tool"],
      },
    } as unknown as Detail;
    expect(runsOf(detail)).toEqual([
      ["Hook · PostToolUse", "fmt"],
      ["MCP · db", "npx db"],
      ["Ejecutable", "bin/tool"],
    ]);
  });
});
