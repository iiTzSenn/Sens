// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_LOOK, linearRgb, look, lookOf, showLook, shownOf } from "./look";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));

const system = (light: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: light && query.includes("light"), addEventListener() {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  look.setState(look.getInitialState(), true);
});

describe("a look", () => {
  it("reads only the modes and accents Sens knows, and starts dark with signal", () => {
    expect(lookOf({ mode: "light", accent: "iris" })).toEqual({ mode: "light", accent: "iris" });
    expect(lookOf({ mode: "sepia", accent: "iris" })).toEqual({ mode: "dark", accent: "iris" });
    expect(lookOf({ mode: "system", accent: "teal" })).toEqual({ mode: "system", accent: "signal" });
    expect(lookOf(undefined)).toEqual(FIRST_LOOK);
    expect(lookOf("light")).toEqual(FIRST_LOOK);
    expect(FIRST_LOOK).toEqual({ mode: "dark", accent: "signal" });
  });

  it("follows Windows only when set to system", () => {
    system(true);
    expect(shownOf("system")).toBe("light");
    expect(shownOf("dark")).toBe("dark");
    system(false);
    expect(shownOf("system")).toBe("dark");
    expect(shownOf("light")).toBe("light");
  });

  it("marks the page with the mode it shows and the accent chosen", () => {
    system(true);
    showLook({ mode: "system", accent: "ice" });

    expect(document.documentElement.dataset).toMatchObject({ mode: "light", accent: "ice" });
    expect(look.getState()).toEqual({ chosen: { mode: "system", accent: "ice" }, shown: "light" });
  });

  it("hands WebGL the accent in linear light", () => {
    const [red, green, blue] = linearRgb("#c7ff4a");
    expect(red).toBeCloseTo(0.571, 2);
    expect(green).toBe(1);
    expect(blue).toBeCloseTo(0.069, 2);
  });
});
