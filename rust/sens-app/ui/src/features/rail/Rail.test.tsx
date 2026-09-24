// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../ipc/types";
import { Dialog } from "../../app/Dialog";
import { dialog } from "../../app/modal";
import { chooseFolder, draft, fresh, resume, showView } from "../../app/session";
import { profile } from "../profile/store";
import { project } from "../project/store";
import { Rail } from "./Rail";
import { loadRail, nameSession, noteActivity, oweRail, rail } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    workspaces: vi.fn(),
    titleSession: vi.fn(),
    renameSession: vi.fn(),
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));
vi.mock("../../app/session", () => ({ resume: vi.fn(), draft: vi.fn(async () => {}), fresh: vi.fn(), chooseFolder: vi.fn(), showView: vi.fn() }));

const SPACES: Workspace[] = [
  {
    root: "C:/demo",
    name: "demo",
    activeAt: 2,
    sessions: [
      { id: "old", title: "Probar el instalador", startedAt: 1, tasks: 2, archived: true },
      { id: "one", title: "Migrar la interfaz", startedAt: 2, tasks: 1, archived: false },
    ],
  },
  { root: "C:/web", name: "web", activeAt: 1, sessions: [] },
];

beforeEach(() => {
  localStorage.clear();
  rail.setState({ ...rail.getInitialState(), folded: new Set() }, true);
  project.setState({ root: "C:/demo", session: "one", view: "", touched: new Map() });
  profile.setState({ person: { name: "Ada Lovelace", checkUpdates: true }, fault: "" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.workspaces.mockResolvedValue(structuredClone(SPACES));
  vi.clearAllMocks();
  dialog.setState(dialog.getInitialState(), true);
});

afterEach(cleanup);

async function open() {
  render(<Rail />);
  await act(async () => loadRail());
}

const row = (title: string) => screen.getByText(title, { selector: ".session .name" }).closest(".session-row") as HTMLElement;
const dots = (title: string) => within(row(title)).getByRole("button", { name: "Gestionar sesión" });

describe("the rail", () => {
  it("lists each project's sessions, archived ones last, and marks the one on screen", async () => {
    await open();
    expect([...document.querySelectorAll(".session .name")].map((name) => name.textContent)).toEqual(["Migrar la interfaz", "Probar el instalador"]);
    expect(row("Migrar la interfaz").dataset.current).toBe("true");
    expect(row("Probar el instalador").querySelector(".kept")).toBeTruthy();
    expect(within(row("Probar el instalador")).getByRole("button", { name: /Probar/ }).title).toBe("Probar el instalador · 2 mensajes · archivada");
    expect(screen.getByRole("button", { name: "demo" }).dataset.here).toBe("true");
    expect(screen.getByText("Sin sesiones.")).toBeTruthy();

    fireEvent.click(within(row("Probar el instalador")).getByRole("button", { name: /Probar/ }));
    expect(resume).toHaveBeenCalledWith("C:/demo", "old");
    fireEvent.click(screen.getByRole("button", { name: "Sesión nueva en web" }));
    expect(draft).toHaveBeenCalledWith("C:/web");
  });

  it("marks a session while its agent works, waits for you, and once it is done", async () => {
    await open();
    const mark = () => row("Probar el instalador").querySelector<HTMLElement>(".activity");
    expect(mark()).toBeNull();

    act(() => noteActivity("old", "working"));
    expect(mark()?.dataset.activity).toBe("working");
    expect(mark()?.getAttribute("aria-label")).toBe("Trabajando");
    expect(within(row("Probar el instalador")).getByRole("button", { name: /Probar/ }).title).toBe("Probar el instalador · Trabajando · 2 mensajes · archivada");

    act(() => noteActivity("old", "waiting"));
    expect(mark()?.getAttribute("aria-label")).toBe("Esperando tu respuesta");
    act(() => noteActivity("old", "done"));
    expect(mark()?.dataset.activity).toBe("done");
    act(() => noteActivity("old", null));
    expect(mark()).toBeNull();
  });

  it("carries the most urgent mark of a folded project's sessions up to its head", async () => {
    await open();
    const head = () => document.querySelector<HTMLElement>(".fold .activity");
    act(() => {
      noteActivity("old", "done");
      noteActivity("one", "working");
    });
    expect(head()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "demo" }));
    expect(head()?.dataset.activity).toBe("working");
    act(() => noteActivity("old", "waiting"));
    expect(head()?.getAttribute("aria-label")).toBe("Esperando tu respuesta");
    act(() => {
      noteActivity("old", null);
      noteActivity("one", null);
    });
    expect(head()).toBeNull();
  });

  it("goes to a new session or a view, marking where it is", async () => {
    await open();
    const newOne = screen.getByRole("button", { name: "Sesión nueva" });
    fireEvent.click(newOne);
    expect(fresh).toHaveBeenCalled();
    act(() => project.setState({ session: "" }));
    expect(newOne.getAttribute("aria-current")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Artefactos" }));
    expect(showView).toHaveBeenCalledWith("artifacts");
    act(() => project.setState({ view: "artifacts", session: "one" }));
    expect(screen.getByRole("button", { name: "Artefactos" }).getAttribute("aria-current")).toBe("true");
    expect(row("Migrar la interfaz").dataset.current).toBe("false");
  });

  it("folds a project, and remembers it", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "demo" }));
    expect(screen.getByRole("button", { name: "demo" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".runs")?.getAttribute("data-shut")).toBe("true");
    expect(document.querySelector(".runs-inner")?.hasAttribute("inert")).toBe(true);
    expect(JSON.parse(localStorage.getItem("sens.rail.folded")!)).toEqual(["C:/demo"]);
  });

  it("renames a session in place: Enter keeps the name, Escape the old one", async () => {
    await open();
    fireEvent.click(dots("Migrar la interfaz"));
    expect(dots("Migrar la interfaz").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Renombrar" }));
    const field = screen.getByRole("textbox", { name: "Nombre de la sesión" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "  React entero  " } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(ipc.commands.renameSession).toHaveBeenCalledWith("C:/demo", "one", "React entero");
    expect(ipc.commands.workspaces).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(dots("Migrar la interfaz"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Renombrar" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Otra cosa" } });
    await act(async () => fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" }));
    expect(ipc.commands.renameSession).toHaveBeenCalledOnce();
  });

  it("archives, and deletes only once confirmed; deleting the open session starts a new one", async () => {
    await open();
    fireEvent.click(dots("Probar el instalador"));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Desarchivar" })));
    expect(ipc.commands.archiveSession).toHaveBeenCalledWith("C:/demo", "old", false);

    fireEvent.click(dots("Migrar la interfaz"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(ipc.commands.deleteSession).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Confirmar" })));
    expect(ipc.commands.deleteSession).toHaveBeenCalledWith("C:/demo", "one");
    expect(draft).toHaveBeenCalledWith("C:/demo");
  });

  it("says why a change or the list failed, once it is read again", async () => {
    await open();
    ipc.commands.archiveSession.mockRejectedValue("sin permiso");
    fireEvent.click(dots("Migrar la interfaz"));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Archivar" })));
    expect(screen.getByRole("alert").textContent).toBe("sin permiso");

    await act(async () => loadRail());
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => oweRail("no pude recordar la carpeta"));
    ipc.commands.workspaces.mockRejectedValue("disco lleno");
    await act(async () => loadRail());
    expect(screen.getByRole("alert").textContent).toBe("no pude recordar la carpeta");
  });

  it("offers to open a project when there is none", async () => {
    ipc.commands.workspaces.mockResolvedValue([]);
    render(<Rail />);
    expect(screen.queryByText("Todavía no hay sesiones.")).toBeNull();
    await act(async () => loadRail());
    fireEvent.click(screen.getByRole("button", { name: "Abrir proyecto" }));
    expect(chooseFolder).toHaveBeenCalled();
  });

  it("shows a title the model gives a session", async () => {
    await open();
    ipc.commands.titleSession.mockResolvedValue("Un título");
    await act(async () => nameSession("one"));
    expect(ipc.commands.titleSession).toHaveBeenCalledWith("C:/demo", "one");
    expect(ipc.commands.workspaces).toHaveBeenCalledTimes(2);
  });

  it("shows who uses Sens, with a menu to settings, shortcuts and about", async () => {
    await open();
    const me = screen.getByRole("button", { name: /Ada Lovelace/ });
    expect(me.querySelector(".avatar")?.textContent).toBe("AL");
    fireEvent.click(me);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ajustes" }));
    expect(showView).toHaveBeenCalledWith("settings");

    fireEvent.click(me);
    fireEvent.click(screen.getByRole("menuitem", { name: "Atajos de teclado" }));
    expect(dialog.getState()).toMatchObject({ open: true, title: "Atajos de teclado" });

    act(() => profile.setState({ person: { name: "", checkUpdates: true } }));
    expect(screen.getByText("Sin nombre").dataset.empty).toBe("true");
  });
});
