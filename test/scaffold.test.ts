import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index";

describe("sens scaffold", () => {
  it("exposes a version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
