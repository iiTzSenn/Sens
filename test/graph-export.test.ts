import { describe, it, expect } from "vitest";
import {
  buildGraph,
  serializeGraph,
  isExportFormat,
  EXPORT_FORMATS,
  type GraphData,
} from "../src/dashboard/graph-export";
import type { ProjectIndex } from "../src/types";

const index: ProjectIndex = {
  schemaVersion: 4,
  root: "/x",
  createdAt: 0,
  files: [
    { path: "src/a.ts", mtimeMs: 0, exports: [] },
    { path: "src/b.ts", mtimeMs: 0, exports: [] },
  ],
  symbols: [
    { id: "src/a.ts#foo#1", name: "foo", kind: "function", file: "src/a.ts", line: 1, signature: "foo()", exported: true },
    { id: "src/a.ts#bar#2", name: "bar", kind: "function", file: "src/a.ts", line: 2, signature: "bar()", exported: false },
    { id: "src/b.ts#baz#1", name: "baz", kind: "const", file: "src/b.ts", line: 1, signature: "baz", exported: false },
  ],
  references: {},
  imports: [
    { from: "src/b.ts", to: "src/a.ts", names: ["foo"] },
    { from: "src/b.ts", to: "src/a.ts", names: ["bar"] }, // duplicate edge — should collapse
    { from: "src/a.ts", to: "external-lib", names: ["x"] }, // non-file target — dropped
    { from: "src/a.ts", to: "src/a.ts", names: ["self"] }, // self import — dropped
  ],
};
const dead = [index.symbols[1]]; // `bar` is the dead symbol

describe("buildGraph", () => {
  const g = buildGraph(index, dead);

  it("emits one node per file with symbol/export/dead counts", () => {
    expect(g.nodes.length).toBe(2);
    const a = g.nodes.find((n) => n.id === "src/a.ts")!;
    expect(a.label).toBe("a.ts");
    expect(a.symbols).toBe(2);
    expect(a.exported).toBe(1);
    expect(a.dead).toBe(1);
  });

  it("dedupes edges and drops non-file and self imports", () => {
    expect(g.links).toEqual([{ source: "src/b.ts", target: "src/a.ts" }]);
  });
});

// A graph whose ids/labels carry characters that each format must escape.
const special: GraphData = {
  nodes: [
    { id: "a&b.ts", label: "a&b.ts", symbols: 1, exported: 1, dead: 0 },
    { id: 'q"x.ts', label: 'q"x.ts', symbols: 0, exported: 0, dead: 2 },
  ],
  links: [{ source: "a&b.ts", target: 'q"x.ts' }],
};

describe("serializeGraph", () => {
  it("covers every declared format with a matching filename + non-empty body", () => {
    for (const fmt of EXPORT_FORMATS) {
      const out = serializeGraph(fmt, special, "proj");
      expect(out.body.length, fmt).toBeGreaterThan(0);
      expect(out.mime, fmt).toContain("charset=utf-8");
      expect(out.filename.endsWith("." + (fmt === "csv" ? "csv" : fmt)), fmt).toBe(true);
      expect(out.filename.startsWith("proj-graph"), fmt).toBe(true);
    }
  });

  it("sanitizes the project name in the filename", () => {
    expect(serializeGraph("json", special, "my project!").filename).toBe("my-project--graph.json");
  });

  it("GEXF: well-formed, right node/edge counts, XML-escaped", () => {
    const b = serializeGraph("gexf", special, "proj").body;
    expect(b).toContain("<gexf");
    expect((b.match(/<node /g) ?? []).length).toBe(2);
    expect((b.match(/<edge /g) ?? []).length).toBe(1);
    expect(b).toContain("a&amp;b.ts");
    expect(b).toContain("q&quot;x.ts");
    expect(b).not.toMatch(/id="a&b\.ts"/); // raw ampersand must not survive
  });

  it("GraphML: directed graph with typed node attributes", () => {
    const b = serializeGraph("graphml", special, "proj").body;
    expect(b).toContain("<graphml");
    expect(b).toContain('edgedefault="directed"');
    expect((b.match(/<node /g) ?? []).length).toBe(2);
    expect((b.match(/<edge /g) ?? []).length).toBe(1);
    expect(b).toContain('<data key="dead">2</data>');
  });

  it("DOT: digraph with escaped quotes and directed edges", () => {
    const b = serializeGraph("dot", special, "proj").body;
    expect(b).toContain("digraph sens {");
    expect(b).toContain('"a&b.ts" -> ');
    expect(b).toContain('"q\\"x.ts"'); // inner quote escaped for Graphviz
  });

  it("JSON: round-trips nodes/links and carries the project name", () => {
    const parsed = JSON.parse(serializeGraph("json", special, "proj").body);
    expect(parsed.project).toBe("proj");
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.links).toEqual([{ source: "a&b.ts", target: 'q"x.ts' }]);
  });

  it("CSV: header + one directed edge row per link", () => {
    const b = serializeGraph("csv", special, "proj").body.split("\n");
    expect(b[0]).toBe("Source,Target,Type");
    expect(b).toHaveLength(2);
    expect(b[1]).toBe('a&b.ts,"q""x.ts",Directed'); // quote-containing field is CSV-quoted
  });

  it("CSV: quotes fields containing commas", () => {
    const g: GraphData = { nodes: [], links: [{ source: "a,b", target: "c" }] };
    expect(serializeGraph("csv", g, "p").body.split("\n")[1]).toBe('"a,b",c,Directed');
  });
});

describe("isExportFormat", () => {
  it("accepts known formats and rejects others", () => {
    expect(isExportFormat("gexf")).toBe(true);
    expect(isExportFormat("csv")).toBe(true);
    expect(isExportFormat("svg")).toBe(false);
    expect(isExportFormat("")).toBe(false);
  });
});
