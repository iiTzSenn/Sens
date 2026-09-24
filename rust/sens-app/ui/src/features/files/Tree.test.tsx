// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../../ipc/types";
import { legacy } from "../../legacy/bridge";
import { noteTouched, project } from "../project/store";
import { files, forgetTree, loadFiles, revealFile, showOpened } from "./store";
import { Tree } from "./Tree";

const ipc = vi.hoisted(() => ({ commands: { tree: vi.fn(), folder: vi.fn(), findFiles: vi.fn() } }));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));

const entry = (path: string, dir = false): Entry => ({ name: path.split("/").pop()!, path, dir, ignored: false });

const TREE: Record<string, Entry[]> = {
  "": [entry("src", true), entry("main.py"), entry("README.md")],
  src: [entry("src/ui", true), entry("src/app.ts")],
  "src/ui": [entry("src/ui/Button.tsx")],
};

beforeEach(() => {
  files.setState(files.getInitialState(), true);
  project.setState({ root: "C:/demo", touched: new Set() });
  forgetTree();
  ipc.commands.tree.mockReset().mockResolvedValue([{ path: "main.py", symbols: 7 }]);
  ipc.commands.folder.mockReset().mockImplementation(async (_root: string, path: string) => TREE[path] ?? []);
  ipc.commands.findFiles.mockReset().mockResolvedValue([entry("src/ui/Button.tsx")]);
  legacy.view = vi.fn(async () => {});
});

afterEach(cleanup);

const names = () => [...document.querySelectorAll(".filerow .name")].map((name) => name.textContent);
const row = (name: string) => screen.getByText(name, { selector: ".filerow .name" }).closest("button")!;

async function open() {
  render(<Tree />);
  await act(async () => loadFiles());
}

describe("file tree", () => {
  it("lists the project folded, with the symbols Sens indexed", async () => {
    await open();
    expect(names()).toEqual(["src", "main.py", "README.md"]);
    expect(row("main.py").querySelector(".n")?.textContent).toBe("7");
    expect(row("main.py").querySelector("img")?.getAttribute("src")).toBe("/file-icons/python.svg");
  });

  it("opens folders, reading each once, and opens files in the viewer", async () => {
    await open();
    await act(async () => fireEvent.click(row("src")));
    expect(names()).toEqual(["src", "ui", "app.ts", "main.py", "README.md"]);
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.click(row("src")));
    await act(async () => fireEvent.click(row("src")));
    expect(ipc.commands.folder.mock.calls.filter(([, path]) => path === "src")).toHaveLength(1);

    fireEvent.click(row("app.ts"));
    expect(legacy.view).toHaveBeenCalledWith("src/app.ts");
  });

  it("reveals the folders above a file opened elsewhere, and marks it", async () => {
    await open();
    await act(async () => {
      revealFile("src/ui/Button.tsx");
      showOpened("src/ui/Button.tsx");
    });
    expect(names()).toEqual(["src", "ui", "Button.tsx", "app.ts", "main.py", "README.md"]);
    expect(row("Button.tsx").getAttribute("aria-current")).toBe("true");
  });

  it("marks what the agent touched, and the folders holding it", async () => {
    await open();
    act(() => noteTouched(["src/app.ts"]));
    expect(row("src").dataset.touched).toBe("true");
    expect(row("main.py").dataset.touched).toBe("false");
  });

  it("keeps the rows on screen while a reload reads them again", async () => {
    await open();
    let answer!: (entries: Entry[]) => void;
    ipc.commands.folder.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    let reload!: Promise<void>;
    await act(async () => {
      reload = loadFiles();
    });
    expect(names()).toEqual(["src", "main.py", "README.md"]);
    await act(async () => {
      answer([entry("src", true), entry("nuevo.rs")]);
      await reload;
    });
    expect(names()).toEqual(["src", "nuevo.rs"]);
  });

  it("searches the project after a pause, and says when nothing matches", async () => {
    vi.useFakeTimers();
    await open();
    fireEvent.change(screen.getByLabelText("Buscar en la carpeta"), { target: { value: "button" } });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(ipc.commands.findFiles).toHaveBeenCalledWith("C:/demo", "button");
    expect(row("Button.tsx").querySelector(".dirname")?.textContent).toBe("src/ui");

    ipc.commands.findFiles.mockResolvedValue([]);
    fireEvent.change(screen.getByLabelText("Buscar en la carpeta"), { target: { value: "zzz" } });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(screen.getByText("Nada coincide.")).toBeTruthy();
    vi.useRealTimers();
  });

  it("says why a folder could not be read, and that there is no folder yet", async () => {
    ipc.commands.folder.mockRejectedValue("sin permiso");
    await open();
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");
    cleanup();
    act(() => project.setState({ root: "" }));
    render(<Tree />);
    expect(screen.getByText("Sin carpeta.")).toBeTruthy();
  });
});
