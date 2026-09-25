// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { News } from "../../ipc/types";
import { showLanguage } from "../../shared/i18n";
import { project } from "../project/store";
import { updates } from "../updates/store";
import { NewsView } from "./News";
import { loadNews, news, newsAtStart } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    news: vi.fn(),
    sawNews: vi.fn(),
    openExternal: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands, events: {} }));

const told = (version: string, over: Partial<News> = {}): News => ({
  version,
  title: `Lo que trae la ${version}`,
  notes: `Resumen de la ${version}.\n\n### New\n- **Algo nuevo** en la ${version}.`,
  page: `https://github.com/iiTzSenn/Sens/releases/tag/v${version}`,
  published: "2026-09-25T09:16:31Z",
  ...over,
});

function atStart(owed: boolean) {
  window.__SENS_NEWS__ = owed;
  act(() => newsAtStart());
  render(<NewsView />);
}

beforeEach(() => {
  news.setState(news.getInitialState(), true);
  updates.setState({ current: "0.20.0" });
  project.setState({ view: "" });
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  delete window.__SENS_NEWS__;
  showLanguage("es");
});

describe("the news", () => {
  it("is over the chat from the first frame after an update, and counts as seen once shown", async () => {
    ipc.commands.news.mockResolvedValue([told("0.20.0"), told("0.19.2")]);
    atStart(true);

    expect(project.getState().view).toBe("news");
    expect(screen.getByRole("status").textContent).toBe("Leyendo las notas de GitHub…");
    expect(ipc.commands.sawNews).not.toHaveBeenCalled();

    await screen.findByRole("heading", { name: "Lo que trae la 0.20.0" });
    expect(screen.getByText("Lo que trae Sens 0.20.0, y 1 versión anterior que no habías visto.")).toBeTruthy();
    const [newest, older] = screen.getAllByRole("article");
    expect(within(newest).getByText("Instalada")).toBeTruthy();
    expect(within(newest).getByText("25 de septiembre de 2026")).toBeTruthy();
    expect(within(older).queryByText("Instalada")).toBeNull();
    expect(within(older).getByRole("heading", { name: "Lo que trae la 0.19.2" })).toBeTruthy();
    expect(ipc.commands.sawNews).toHaveBeenCalledTimes(1);
  });

  it("stays away when there is nothing new", () => {
    atStart(false);

    expect(project.getState().view).toBe("");
    expect(ipc.commands.news).not.toHaveBeenCalled();
  });

  it("goes back to the chat for good when closed, even if the notes could not be read", async () => {
    ipc.commands.news.mockRejectedValue("sin conexión con GitHub");
    atStart(true);

    expect((await screen.findByRole("alert")).textContent).toBe("sin conexión con GitHub");
    expect(ipc.commands.sawNews).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cerrar novedades" })));
    expect(project.getState().view).toBe("");
    expect(ipc.commands.sawNews).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failure", async () => {
    ipc.commands.news.mockRejectedValueOnce("sin conexión con GitHub").mockResolvedValueOnce([told("0.20.0")]);
    atStart(true);
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await screen.findByRole("heading", { name: "Lo que trae la 0.20.0" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Lo que trae Sens 0.20.0.")).toBeTruthy();
    expect(ipc.commands.sawNews).toHaveBeenCalledTimes(1);
  });

  it("opened by hand, it does not count as seen again", async () => {
    ipc.commands.news.mockResolvedValue([told("0.20.0")]);
    render(<NewsView />);
    await act(async () => {
      project.setState({ view: "news" });
      await loadNews();
    });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continuar" })));
    expect(project.getState().view).toBe("");
    expect(ipc.commands.sawNews).not.toHaveBeenCalled();
  });

  it("reads the notes once however many times it opens", async () => {
    ipc.commands.news.mockResolvedValue([told("0.20.0")]);
    await act(() => loadNews());
    await act(() => loadNews());

    expect(ipc.commands.news).toHaveBeenCalledTimes(1);
  });

  it("names a version without a title and says when it brings no notes", async () => {
    ipc.commands.news.mockResolvedValue([told("0.20.0", { title: "", notes: "", published: "" })]);
    atStart(true);

    await screen.findByRole("heading", { name: "Sens 0.20.0" });
    expect(screen.getByText("Esta versión no trae notas.")).toBeTruthy();
    expect(document.querySelector("time")).toBeNull();
  });

  it("says when the installed version has no notes published yet, and is not counted as seen until closed", async () => {
    ipc.commands.news.mockResolvedValue([]);
    atStart(true);

    await screen.findByText("Sens 0.20.0 todavía no tiene notas publicadas.");
    expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
    expect(ipc.commands.sawNews).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cerrar novedades" })));
    expect(ipc.commands.sawNews).toHaveBeenCalledTimes(1);
  });

  it("opens each version on GitHub", async () => {
    ipc.commands.news.mockResolvedValue([told("0.20.0")]);
    atStart(true);
    await screen.findByRole("article");

    fireEvent.click(screen.getByRole("button", { name: "Ver en GitHub" }));
    expect(ipc.commands.openExternal).toHaveBeenCalledWith("https://github.com/iiTzSenn/Sens/releases/tag/v0.20.0");
  });

  it("speaks the language chosen, dates included", async () => {
    showLanguage("en");
    ipc.commands.news.mockResolvedValue([told("0.20.0"), told("0.19.2"), told("0.19.1")]);
    atStart(true);

    await screen.findByRole("heading", { name: "Lo que trae la 0.20.0" });
    expect(screen.getByText("What’s new in Sens 0.20.0, and in 2 earlier versions you hadn’t seen.")).toBeTruthy();
    expect(within(screen.getAllByRole("article")[0]).getByText("September 25, 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close what’s new" })).toBeTruthy();
  });
});
