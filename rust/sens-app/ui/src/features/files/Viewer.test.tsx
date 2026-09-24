// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paint } from "../../shared/syntax/paint";
import { forgetEdits, noteEdit, project } from "../project/store";
import { showSite } from "../web/store";
import { forgetViewer, openFile, present, viewer } from "./view";
import { Viewer, ViewerHead, ViewerModes } from "./Viewer";

const ipc = vi.hoisted(() => ({ commands: { openFile: vi.fn(), folder: vi.fn(), tree: vi.fn(), findFiles: vi.fn() } }));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));
vi.mock(import("../web/store"), async (original) => ({ ...(await original()), showSite: vi.fn(async () => {}) }));

const FILES: Record<string, string> = {
  "src/app.ts": "import { a } from './a';\r\nexport const app = a + 1;\r\n",
  "README.md": "---\ntitle: demo\n---\n# Demo\n\nHola.",
  "site/index.html": "<h1>Hola</h1>",
};

let head: HTMLElement;
let modes: HTMLElement;

beforeEach(() => {
  head = document.body.appendChild(document.createElement("div"));
  modes = document.body.appendChild(document.createElement("div"));
  project.setState({ root: "C:/demo", touched: new Map() });
  viewer.setState(viewer.getInitialState(), true);
  ipc.commands.openFile.mockReset().mockImplementation(async (_root: string, path: string) => FILES[path]);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  head.remove();
  modes.remove();
  forgetEdits();
});

const show = () => {
  render(<ViewerHead />, { container: head });
  render(<ViewerModes />, { container: modes });
  return render(<Viewer />);
};
const lines = () => [...document.querySelectorAll(".source .line .src")].map((line) => line.textContent);
const button = (name: string) => screen.getByRole("button", { name });

describe("file viewer", () => {
  it("says nothing is open yet", () => {
    show();
    expect(head.querySelector(".where")?.textContent).toBe("Ningún fichero abierto");
    expect(screen.getByText("Elige un fichero.")).toBeTruthy();
    expect(modes.childElementCount).toBe(0);
  });

  it("shows a project file numbered, then colored as its language", async () => {
    show();
    await act(async () => openFile("src/app.ts"));
    expect(head.querySelector(".where")?.textContent).toBe("src/app.ts");
    expect(lines()).toEqual(["import { a } from './a';", "export const app = a + 1;", ""]);
    expect(document.querySelector(".source .line .num")?.textContent).toBe("1");

    await act(async () => {
      await paint(lines().join("\n"), "typescript");
      await new Promise((settle) => setTimeout(settle));
    });
    const keyword = [...document.querySelectorAll<HTMLElement>(".source .src span")].find((span) => span.textContent === "export");
    expect(keyword?.style.color).toBeTruthy();
    expect(lines()[1]).toBe("export const app = a + 1;");
  });

  it("marks the lines the agent added, with its counts, and opens there", async () => {
    show();
    act(() => noteEdit({ path: "src/app.ts", lines: [2], plus: 1, minus: 3 }));
    await act(async () => openFile("src/app.ts"));
    const added = document.querySelectorAll('.source .line[data-touched="add"]');
    expect([...added].map((line) => line.querySelector(".num")?.textContent)).toEqual(["2"]);
    expect(head.querySelector(".marks")?.textContent).toBe("+1−3");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("draws a long file a block at a time, the agent's lines at once", async () => {
    const watched: [IntersectionObserverCallback, Element][] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private heard: IntersectionObserverCallback) {}
        observe(target: Element) {
          watched.push([this.heard, target]);
        }
        disconnect() {}
      },
    );
    ipc.commands.openFile.mockResolvedValueOnce(Array.from({ length: 450 }, (_, at) => `línea ${at + 1}`).join("\n"));
    show();
    act(() => noteEdit({ path: "notas.txt", lines: [420], plus: 1, minus: 0 }));
    await act(async () => openFile("notas.txt"));
    const numbers = () => [...document.querySelectorAll(".source .num")].map((number) => Number(number.textContent));
    expect(numbers()).toHaveLength(250);
    expect(numbers().at(-1)).toBe(450);
    expect([...document.querySelectorAll<HTMLElement>(".source .block")].map((block) => block.style.height)).toEqual(["", "calc(var(--line) * 200)", ""]);

    act(() => watched.forEach(([heard, target]) => heard([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver)));
    expect(numbers()).toHaveLength(450);
    vi.unstubAllGlobals();
  });

  it("reads Markdown as a page without its front matter, and switches to code", async () => {
    show();
    await act(async () => openFile("README.md"));
    expect(document.querySelector(".reading")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".reading h1")?.textContent).toBe("Demo");
    expect(document.querySelector(".reading .prose")?.textContent).not.toContain("title");
    expect(button("Vista").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button("Código"));
    expect(document.querySelector(".reading")?.hasAttribute("hidden")).toBe(true);
    expect(lines()[0]).toBe("---");

    // Opening it again as code keeps it as code.
    await act(async () => openFile("README.md"));
    expect(button("Código").getAttribute("aria-pressed")).toBe("true");
  });

  it("previews a page in the web panel, from the folder it came from", async () => {
    show();
    act(() => present("C:/out/site/index.html", "<h1>Hola</h1>", "C:/out"));
    fireEvent.click(button("Vista"));
    expect(showSite).toHaveBeenCalledWith("C:/out/site/index.html", "C:/out");
    expect(button("Código").getAttribute("aria-pressed")).toBe("true");
    expect(viewer.getState().opened).toBe("");
  });

  it("drops a read that a later one overtook, and forgets all on a new project", async () => {
    show();
    let answer!: (text: string) => void;
    ipc.commands.openFile.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    let slow!: Promise<void>;
    act(() => {
      slow = openFile("site/index.html");
    });
    await act(async () => openFile("src/app.ts"));
    await act(async () => {
      answer("<p>tarde</p>");
      await slow;
    });
    expect(head.querySelector(".where")?.textContent).toBe("src/app.ts");

    act(() => forgetViewer());
    expect(screen.getByText("Elige un fichero.")).toBeTruthy();
  });
});
