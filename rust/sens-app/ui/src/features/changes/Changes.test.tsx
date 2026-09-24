// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shell } from "../../app/shell";
import { viewer } from "../files/view";
import { noteEdit, project } from "../project/store";
import { forgetTasks, noteTask, settleTasks } from "../tasks/store";
import { TaskTally, TasksPanel } from "../tasks/TasksPanel";
import { ChangeTotals, ChangesPanel } from "./Changes";
import { changes, loadChanges } from "./store";

const ipc = vi.hoisted(() => ({
  commands: { changes: vi.fn(), openFile: vi.fn(), taskOutput: vi.fn(), stopTask: vi.fn() },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));

const DIFF = [
  "diff --git a/src/app.js b/src/app.js",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

let header: HTMLElement;

// Each panel with its header's count, as the tool panel draws them.
const showChanges = () => {
  render(<ChangeTotals />, { container: header });
  return render(<ChangesPanel />);
};
const showTasks = () => {
  render(<TaskTally />, { container: header });
  return render(<TasksPanel />);
};

beforeEach(() => {
  header = document.createElement("span");
  document.body.append(header);
  changes.setState(changes.getInitialState(), true);
  forgetTasks();
  project.setState({ root: "C:/demo", session: "s1" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.changes.mockResolvedValue({ diff: DIFF, fresh: ["notes.md"] });
  ipc.commands.openFile.mockResolvedValue("a\nb\nc");
  shell.setState({ ...shell.getInitialState(), toolsOpen: true, tool: "changes" }, true);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const row = (name: string) => screen.getByText(name, { selector: ".change .name" }).closest("details") as HTMLDetailsElement;

describe("changes panel", () => {
  it("lists what differs from the last commit and totals it in the header", async () => {
    showChanges();
    await act(async () => loadChanges());
    expect(header.textContent).toBe("2 ficheros+1−1");
    expect(row("app.js").querySelector(".state")?.textContent).toBe("M");
    expect(row("notes.md").querySelector(".state")?.textContent).toBe("A");
    expect(row("app.js").querySelector(".dirname")?.textContent).toBe("src");
    expect(row("notes.md").querySelector(".marks")?.textContent).toBe("nuevo");
  });

  it("says why there is nothing to list", async () => {
    ipc.commands.changes.mockResolvedValue(null);
    showChanges();
    expect(screen.getByText("Leyendo cambios…")).toBeTruthy();
    await act(async () => loadChanges());
    expect(screen.getByText("Esta carpeta no está en un repositorio git.")).toBeTruthy();
  });

  it("draws the diff when a row opens, and counts a new file once read", async () => {
    showChanges();
    await act(async () => loadChanges());
    await act(async () => fireEvent(row("app.js"), new Event("toggle")));
    expect(row("app.js").querySelector(".diff")).toBeNull();

    await act(async () => {
      row("app.js").open = true;
      fireEvent(row("app.js"), new Event("toggle"));
    });
    expect([...row("app.js").querySelectorAll(".diff .row")].map((line) => line.className)).toEqual(["row del", "row add"]);

    await act(async () => {
      row("notes.md").open = true;
      fireEvent(row("notes.md"), new Event("toggle"));
    });
    expect(ipc.commands.openFile).toHaveBeenCalledWith("C:/demo", "notes.md");
    expect(row("notes.md").querySelector(".marks")?.textContent).toBe("+3−0");
  });

  it("marks what the agent touched and jumps to the file panel", async () => {
    showChanges();
    await act(async () => loadChanges());
    act(() => noteEdit({ path: "src/app.js", lines: [1], plus: 1, minus: 0 }));
    expect(row("app.js").dataset.touched).toBe("true");
    await act(async () => fireEvent.click(row("app.js").querySelector(".jump")!));
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "files" });
    await act(async () => {});
    expect(viewer.getState()).toMatchObject({ title: "src/app.js", opened: "src/app.js" });
  });
});

describe("tasks panel", () => {
  it("counts running tasks in the header and settles the ones Rust dropped", () => {
    showTasks();
    expect(screen.getByText(/Aquí verás los subagentes/)).toBeTruthy();
    act(() => noteTask({ kind: "taskStarted", id: "t1", runner: "local_agent", description: "Revisar" }));
    expect(header.textContent).toBe("1 en marcha");
    act(() => settleTasks([]));
    expect(header.textContent).toBe("1 tarea");
    expect(screen.getByText("Revisar").closest("details")?.dataset.state).toBe("stopped");
  });

  it("reads a command's output when opened and stops it on request", async () => {
    ipc.commands.taskOutput.mockResolvedValue("hola\n\n");
    showTasks();
    act(() => {
      noteTask({ kind: "tool", name: "Bash", id: "c1", input: { command: "npm test" } });
      noteTask({ kind: "taskStarted", id: "t1", runner: "local_bash", description: "Tests", tool: "c1" });
      noteTask({ kind: "toolDone", output: "written to: C:/x/tasks/t1.output", detail: { backgroundTaskId: "t1" } });
    });
    const card = screen.getByText("Tests").closest("details") as HTMLDetailsElement;
    expect(card.querySelector(".terminal-command")?.textContent).toBe("$npm test");

    await act(async () => {
      card.open = true;
      fireEvent(card, new Event("toggle"));
    });
    expect(ipc.commands.taskOutput).toHaveBeenCalledWith("C:/x/tasks/t1.output");
    expect(card.querySelector(".terminal-output")?.textContent).toBe("hola");

    await act(async () => fireEvent.click(screen.getByText("Detener")));
    expect(ipc.commands.stopTask).toHaveBeenCalledWith("s1", "t1");
    expect(screen.getByText("Detener")).toHaveProperty("disabled", true);
  });
});
