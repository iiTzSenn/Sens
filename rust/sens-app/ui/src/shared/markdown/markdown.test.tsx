// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { paint } from "../syntax/paint";
import { Markdown } from "./Markdown";
import { mended, parse, splitBlocks, textLength } from "./parse";

afterEach(cleanup);

const html = (text: string) => {
  const { container } = render(<Markdown text={text} />);
  return container.querySelector(".prose")!;
};

describe("markdown", () => {
  it("reads headings, paragraphs, quotes, rules and fences", () => {
    const page = html(["# Título", "", "Una línea", "que sigue.", "", "> citado", "> y más", "", "---", "", "```ts", "const a = 1;", "```"].join("\n"));
    expect(page.querySelector("h1")?.textContent).toBe("Título");
    expect(page.querySelector("p")?.textContent).toBe("Una línea que sigue.");
    expect(page.querySelector("blockquote")?.textContent).toBe("citado y más");
    expect(page.querySelector("hr")).toBeTruthy();
    expect(page.querySelector(".codeblock-head")?.textContent).toBe("ts");
    expect(page.querySelector(".codeblock code")?.textContent).toBe("const a = 1;");
  });

  it("nests lists by indentation and keeps a wrapped line in its item", () => {
    const page = html(["- uno", "  - uno.a", "- dos", "  sigue", "", "3. tres", "4. cuatro"].join("\n"));
    const outer = page.querySelector(":scope > ul")!;
    expect([...outer.children].map((item) => item.firstChild?.textContent)).toEqual(["uno", "dos"]);
    expect(outer.querySelector("li > ul > li")?.textContent).toBe("uno.a");
    expect(outer.children[1].textContent).toBe("dos sigue");
    expect(page.querySelector("ol")?.getAttribute("start")).toBe("3");
  });

  it("reads tables, inline code, emphasis, and links only to the web", () => {
    const page = html(["| a | **b** |", "| --- | --- |", "| `x` | [doc](https://example.com) |", "", "Ver [aquí](fichero.md) y *esto*."].join("\n"));
    expect([...page.querySelectorAll("th")].map((cell) => cell.innerHTML)).toEqual(["a", "<strong>b</strong>"]);
    expect(page.querySelector("td code")?.textContent).toBe("x");
    expect(page.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(page.querySelectorAll("a")).toHaveLength(1);
    expect(page.querySelector("p")?.innerHTML).toBe("Ver aquí y <em>esto</em>.");
  });

  it("colors a fenced block as its language, keeping every character", async () => {
    const page = html(["```ts", "const a = 'x';", "let b;", "```"].join("\n"));
    await act(async () => {
      await paint("const a = 'x';\nlet b;", "typescript");
      await new Promise((settle) => setTimeout(settle));
    });
    const code = page.querySelector(".codeblock code")!;
    expect(code.textContent).toBe("const a = 'x';\nlet b;");
    expect([...code.querySelectorAll("span")].find((span) => span.textContent === "const")?.style.color).toBe("rgb(86, 156, 214)");
  });

  it("mends a text cut while it arrives", () => {
    expect(mended("un `trozo")).toBe("un `trozo`");
    expect(mended("**fuerte")).toBe("**fuerte**");
    expect(mended("ver [la doc](https://exa")).toBe("ver la doc");
    expect(mended("```ts\nconst")).toBe("```ts\nconst");
  });

  it("cuts a reply at blank lines outside fences, and counts its text", () => {
    expect(splitBlocks("uno\n\ndos\n```\na\n\nb\n```")).toEqual(["uno", "dos\n```\na\n\nb\n```"]);
    expect(textLength(parse("**ab** `c`\n\n- d"))).toBe(5);
  });

  it("fades in what arrived last", () => {
    const { container } = render(<Markdown text="hola mundo" fade={{ stamps: [{ from: 5, time: 900 }], now: 1000 }} />);
    const fresh = container.querySelector(".fresh") as HTMLElement;
    expect(fresh.textContent).toBe("mundo");
    expect(fresh.style.animationDelay).toBe("-100ms");
    expect(container.querySelector("p")?.textContent).toBe("hola mundo");
  });
});
