import { describe, expect, it, vi } from "vitest";
import { LONG_EDGE, MOST_PIXELS, SENT_CAP, drawnSize, encoded, encodings, fitPicture, fitted, typeName, type Size, type Tools } from "./pictures";

const blob = (type: string, bytes: number) => new Blob([new Uint8Array(bytes)], { type });

function tools(natural: Size | null, sizes: (type: string, size: Size) => number = () => 1000) {
  const drawn: [string, Size][] = [];
  const release = vi.fn();
  const kit: Tools = {
    decode: async () => natural && { ...natural, source: {} as CanvasImageSource, release },
    draw: async (_, size, type) => {
      drawn.push([type, size]);
      return blob(type, sizes(type, size));
    },
    urlOf: async (made) => `data:${made.type};base64,x`,
  };
  return { kit, drawn, release };
}

describe("fitting a picture for Claude", () => {
  it("keeps the long edge and the pixel count within what Claude reads", () => {
    expect(fitted({ width: 1200, height: 800 })).toEqual({ width: 1200, height: 800 });
    expect(fitted({ width: 5152, height: 1000 })).toEqual({ width: LONG_EDGE, height: 500 });
    const square = fitted({ width: 4000, height: 4000 });
    expect(square.width * square.height).toBeLessThanOrEqual(MOST_PIXELS);
    expect(square.width).toBe(square.height);
  });

  it("draws a vector large enough to read, and never beyond the limits", () => {
    expect(drawnSize("image/svg+xml", { width: 24, height: 12 })).toEqual({ width: 1600, height: 800 });
    expect(drawnSize("image/svg+xml", { width: 0, height: 0 })).toEqual({ width: 1600, height: 1600 });
    expect(drawnSize("image/bmp", { width: 16, height: 16 })).toEqual({ width: 16, height: 16 });
  });

  it("measures the size as it travels, in base64", () => {
    expect(encoded(3)).toBe(4);
    expect(encoded(4)).toBe(8);
    expect(encoded(SENT_CAP)).toBeGreaterThan(SENT_CAP);
  });

  it("tries a lossless format first for drawings and screenshots, and JPEG first for photos", () => {
    expect(encodings("image/bmp")[0]).toEqual(["image/png"]);
    expect(encodings("image/png").map(([type]) => type)).toEqual(["image/png", "image/webp", "image/jpeg"]);
    expect(encodings("image/jpeg")[0]).toEqual(["image/jpeg", 0.9]);
    expect(encodings("image/avif")[0][0]).toBe("image/jpeg");
  });

  it("names the formats as people know them", () => {
    expect(typeName("image/svg+xml")).toBe("SVG");
    expect(typeName("image/x-icon")).toBe("ICO");
    expect(typeName("image/webp")).toBe("WEBP");
  });

  it("sends a picture Claude already takes just as it is", async () => {
    const { kit, drawn, release } = tools({ width: 800, height: 600 });
    const fitted = await fitPicture(blob("image/png", 2048), kit);
    expect(fitted).toEqual({ width: 800, height: 600, bytes: 2048, mediaType: "image/png", url: "data:image/png;base64,x" });
    expect(drawn).toEqual([]);
    expect(release).toHaveBeenCalled();
  });

  it("turns a format Claude does not take into PNG, and says what it was", async () => {
    const { kit, drawn } = tools({ width: 64, height: 64 });
    const fitted = await fitPicture(blob("image/bmp", 12_000), kit);
    expect(fitted).toMatchObject({ mediaType: "image/png", width: 64, height: 64, was: { mediaType: "image/bmp", width: 64, height: 64 } });
    expect(drawn).toEqual([["image/png", { width: 64, height: 64 }]]);
  });

  it("reduces a picture too large, then tries lighter formats and sizes until it fits", async () => {
    const heavy = (type: string, size: Size) => (type === "image/jpeg" && size.width < 2000 ? 1000 : SENT_CAP);
    const { kit, drawn } = tools({ width: 6000, height: 3000 }, heavy);
    const fitted = await fitPicture(blob("image/png", 30_000_000), kit);
    expect(drawn.slice(0, 3)).toEqual([
      ["image/png", { width: LONG_EDGE, height: 1288 }],
      ["image/webp", { width: LONG_EDGE, height: 1288 }],
      ["image/jpeg", { width: LONG_EDGE, height: 1288 }],
    ]);
    expect(fitted).toMatchObject({ mediaType: "image/jpeg", width: 1932, height: 966, was: { width: 6000, height: 3000 } });
  });

  it("gives up on what the window cannot draw, so it goes as a file", async () => {
    const { kit } = tools(null);
    expect(await fitPicture(blob("image/tiff", 100), kit)).toBeNull();
  });
});
