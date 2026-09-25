import { describe, expect, it } from "vitest";
import { cssOf, lines, plain, rgbOf, tokensOf } from "./ansi";

const ESC = "\x1b";

describe("ansi escapes", () => {
  it("leave text without them as it is", () => {
    expect(lines("hola\nmundo")).toEqual([[["hola", null]], [["mundo", null]]]);
    expect(plain("a\tb")).toBe("a\tb");
  });

  it("turn SGR codes into styles: the 16 colors, bold, dim, italic, underline, inverse and reset", () => {
    const [line] = lines(`${ESC}[1;31merror${ESC}[0m: ${ESC}[2;3;4mnote${ESC}[22;23;24m ${ESC}[7;92mok${ESC}[27;39m.`);
    expect(line).toEqual([
      ["error", { bold: true, fg: 1, link: undefined }],
      [": ", null],
      ["note", { dim: true, italic: true, underline: true, link: undefined }],
      [" ", null],
      ["ok", { inverse: true, fg: 10, link: undefined }],
      [".", null],
    ]);
    expect(lines(`${ESC}[44;101mx${ESC}[49m`)[0][0][1]).toMatchObject({ bg: 9 });
  });

  it("read 256 colors and truecolor, with semicolons or colons", () => {
    const styleOf = (code: string) => lines(`${ESC}[${code}mx`)[0][0][1];
    expect(styleOf("38;5;208")).toMatchObject({ fg: 208 });
    expect(styleOf("48;5;4")).toMatchObject({ bg: 4 });
    expect(styleOf("38;2;255;128;0")).toMatchObject({ fg: [255, 128, 0] });
    expect(styleOf("38:2::10:20:30")).toMatchObject({ fg: [10, 20, 30] });
    expect(styleOf("38:5:33;1")).toMatchObject({ fg: 33, bold: true });
    expect(styleOf("38;2;300;0;0")).toBeNull();
    expect(styleOf("38;5;1;4")).toMatchObject({ fg: 1, underline: true });
  });

  it("drop cursor moves, clears, titles and other controls, keeping forward moves as spaces", () => {
    const text = `${ESC}]0;npm run dev${ESC}\\${ESC}[?25l${ESC}[2J${ESC}[H${ESC}(Bready${ESC}[3Cnow${ESC}[K\x07\x00`;
    expect(plain(text)).toBe("ready   now");
    expect(plain(`half ${ESC}[3`)).toBe("half 3");
  });

  it("let a carriage return overwrite the line, as a progress bar does, and read CRLF as one break", () => {
    expect(plain("10%\r50%\r100%\ndone")).toBe("100%\ndone");
    expect(plain("kept\r\nnext")).toBe("kept\nnext");
    expect(plain("kept\r")).toBe("kept");
  });

  it("keep an OSC 8 hyperlink on the text it wraps, across a reset", () => {
    const [line] = lines(`see ${ESC}]8;;https://example.com${ESC}\\${ESC}[1mdocs${ESC}[0m here${ESC}]8;;${ESC}\\ now`);
    expect(line).toEqual([
      ["see ", null],
      ["docs", { link: "https://example.com", bold: true }],
      [" here", { link: "https://example.com" }],
      [" now", null],
    ]);
  });

  it("names the tokens each of the 16 colors takes, falling back to the roles every theme has", () => {
    expect(tokensOf(1)).toEqual(["--ansi-red", "--red"]);
    expect(tokensOf(0)).toEqual(["--ansi-black"]);
    expect(cssOf(11)).toBe("var(--ansi-bright-yellow, var(--amber))");
    expect(cssOf(0)).toBe("var(--ansi-black)");
  });

  it("knows the 256-color cube and grays", () => {
    expect(rgbOf(16)).toEqual([0, 0, 0]);
    expect(rgbOf(196)).toEqual([255, 0, 0]);
    expect(rgbOf(208)).toEqual([255, 135, 0]);
    expect(rgbOf(232)).toEqual([8, 8, 8]);
    expect(rgbOf(255)).toEqual([238, 238, 238]);
  });
});
