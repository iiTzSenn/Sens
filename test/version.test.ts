import { describe, expect, it } from "vitest";
import { disagreement, versions } from "../scripts/version";

describe("the desktop app's version", () => {
  it("is the same in every file that writes it", () => {
    expect(disagreement()).toEqual([]);
    expect(Object.values(versions())[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names the tag a release of it must carry", () => {
    const [version] = Object.values(versions());
    expect(disagreement(`v${version}`)).toEqual([]);
    expect(disagreement("v0.0.0")).toEqual([`la etiqueta v0.0.0 no es v${version}`]);
  });
});
