import { afterEach, describe, expect, it } from "vitest";
import type { Artifact } from "../../ipc/types";
import { showLanguage } from "../../shared/i18n";
import { howToOpen, keeps, keptTally, kindOf, originOf, saying, sessionOf, shelfTabs } from "./items";

const artifact = (over: Partial<Artifact> = {}): Artifact => ({
  kind: "file",
  root: "C:/demo",
  project: "demo",
  name: "plan.md",
  target: "C:/demo/.sens/artifacts/plan.md",
  session: "s1",
  sessionTitle: "Migrar la interfaz",
  at: 0,
  bytes: 10,
  ...over,
});

describe("opening an artifact", () => {
  it.each([
    [artifact({ kind: "image", name: "foto.png" }), "picture"],
    [artifact({ kind: "link", name: "docs" }), "outside"],
    [artifact({ name: "plan.md" }), "text"],
    [artifact({ name: "informe.HTML" }), "text"],
    [artifact({ name: "datos.xlsx" }), "outside"],
  ])("sends %o where it opens", (item, how) => {
    expect(howToOpen(item)).toBe(how);
  });
});

describe("shelf helpers", () => {
  it("keeps every kind under Todo and one kind under its tab", () => {
    expect(keeps("all", artifact({ kind: "link" }))).toBe(true);
    expect(keeps("image", artifact({ kind: "link" }))).toBe(false);
  });

  it("names the session, or says it has no title, or nothing without one", () => {
    expect(sessionOf(artifact())).toBe("Migrar la interfaz");
    expect(sessionOf(artifact({ sessionTitle: null }))).toBe("Sesión sin título");
    expect(sessionOf(artifact({ session: null }))).toBe("");
    expect(originOf(artifact())).toBe("demo · Migrar la interfaz");
    expect(originOf(artifact({ session: null }))).toBe("demo");
  });

  it("finds by name, project or session, without accents", () => {
    expect(saying("interfaz")(artifact())).toBe(true);
    expect(saying("plan")(artifact())).toBe(true);
    expect(saying("otra")(artifact())).toBe(false);
    expect(saying("migrar")(artifact({ sessionTitle: "Migrár" }))).toBe(true);
  });

  it("counts what the project has", () => {
    expect(keptTally(0)).toBe("Todavía no hay artefactos en este proyecto");
    expect(keptTally(1)).toBe("1 artefacto de este proyecto");
    expect(keptTally(3)).toBe("3 artefactos de este proyecto");
  });
});

describe("the shelf's words", () => {
  afterEach(() => showLanguage("es"));

  it("follow the language shown, with each one's plurals", () => {
    showLanguage("en");
    expect(keptTally(0)).toBe("No artifacts in this project yet");
    expect(keptTally(3)).toBe("3 artifacts in this project");
    expect(sessionOf(artifact({ sessionTitle: null }))).toBe("Untitled session");
    expect(shelfTabs()).toEqual([["all", "All"], ["image", "Pictures"], ["file", "Files"], ["link", "Links"]]);
    showLanguage("fr");
    expect(keptTally(1)).toBe("1 artefact dans ce projet");
    expect(kindOf(artifact({ kind: "link" }))).toBe("Lien");
    showLanguage("ja");
    expect(keptTally(3)).toBe("このプロジェクトのアーティファクト 3 件");
  });
});
