// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { paintCode } from "../syntax/code";
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
    expect(page.querySelector(".codeblock-head")?.textContent).toBe("TypeScript");
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
    expect([...code.querySelectorAll("span")].find((span) => span.textContent === "const")?.style.color).toBe("light-dark(rgb(0, 0, 255), rgb(86, 156, 214))");
  });

  it("names a block's language, or says it is code or text", () => {
    const labels = ["```ps1\nGet-Date\n```", "```bash\nls\n```", "```\nplain\n```", "```text\nplain\n```", "```mystery\nx\n```"].map((text) => html(text).querySelector(".codeblock-head")?.textContent);
    expect(labels).toEqual(["PowerShell", "Bash", "código", "texto", "mystery"]);
  });

  it("draws a console session: the prompt dimmed, the command in its shell, what it printed as it came", async () => {
    const session = ["PS C:\\Users\\sofia\\PRUEBASENS> Get-ChildItem -Name", "notas.txt", "C:\\demo>dir /b", "$ npm test"].join("\n");
    const page = html(["```", session, "```"].join("\n"));
    await act(async () => {
      await Promise.all([paintCode("Get-ChildItem -Name", "powershell"), paintCode("dir /b", "bat"), paintCode("npm test", "shellscript")]);
      await new Promise((settle) => setTimeout(settle));
    });
    const block = page.querySelector(".codeblock") as HTMLElement;
    expect(block.dataset.session).toBe("true");
    expect(block.querySelector(".codeblock-head")?.textContent).toBe("consola");
    expect(block.querySelector("code")?.textContent).toBe(session);
    expect([...block.querySelectorAll(".prompt")].map((prompt) => prompt.textContent)).toEqual(["PS C:\\Users\\sofia\\PRUEBASENS> ", "C:\\demo>", "$ "]);
    expect([...block.querySelectorAll(".command")].map((command) => command.textContent)).toEqual(["Get-ChildItem -Name", "dir /b", "npm test"]);
    const colorOf = (word: string) => [...block.querySelectorAll(".command span")].find((span) => span.textContent === word) as HTMLElement | undefined;
    expect(colorOf("Get-ChildItem")?.style.color).toBe("light-dark(rgb(121, 94, 38), rgb(220, 220, 170))");
    expect(colorOf("npm")?.style.color).toBe("light-dark(rgb(121, 94, 38), rgb(220, 220, 170))");
  });

  it("leaves a fenced block that is not a session as code", () => {
    const page = html(["```", "const a = 1;", "```"].join("\n"));
    expect(page.querySelector(".codeblock")?.getAttribute("data-session")).toBeNull();
    expect(page.querySelector(".prompt")).toBeNull();
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
