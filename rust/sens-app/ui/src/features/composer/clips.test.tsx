// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dialog } from "../../app/modal";
import type { You as YouTurn } from "../chat/turns";
import { You } from "../chat/You";
import { present, showFile } from "../files/view";
import { focused } from "../panes/store";
import { Composer } from "./Composer";
import { fitPicture } from "./pictures";
import { CLIPS_MOST, PICTURES_MOST, attachPaths, composer, send, takeFiles } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    attach: vi.fn(),
    stageFile: vi.fn(),
    artifactText: vi.fn(),
    openSession: vi.fn(),
    chatSend: vi.fn(),
    chatWarm: vi.fn(),
    newSessionId: vi.fn(),
    findFiles: vi.fn(),
    repo: vi.fn(),
    projectTrusted: vi.fn(),
    workspaces: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands, events: { claudeCode: () => Promise.resolve(() => {}) } }));
vi.mock("../../app/session", () => ({ resume: vi.fn(), draft: vi.fn(async () => {}), fresh: vi.fn(), chooseFolder: vi.fn(), showView: vi.fn() }));
vi.mock("../files/view", async (actual) => ({ ...(await actual<typeof import("../files/view")>()), showFile: vi.fn(), present: vi.fn() }));
vi.mock("./pictures", async (actual) => ({ ...(await actual<typeof import("./pictures")>()), fitPicture: vi.fn() }));

const fit = vi.mocked(fitPicture);
const settle = () => act(async () => new Promise((done) => setTimeout(done)));
const field = () => screen.getByRole("textbox", { name: "Mensaje para Claude" }) as HTMLTextAreaElement;
const warnings = () => focused().chat.getState().turns.flatMap((turn) => (turn.kind === "notice" && turn.tone === "warn" ? [turn.parts.join("")] : []));
const fitted = (mediaType = "image/png") => ({ width: 800, height: 600, bytes: 2048, mediaType, url: `data:${mediaType};base64,AAAA` });

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

beforeEach(() => {
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.openSession.mockResolvedValue("s1");
  ipc.commands.workspaces.mockResolvedValue([]);
  fit.mockReset().mockResolvedValue(null);
  vi.mocked(showFile).mockReset();
  vi.mocked(present).mockReset();
  composer.setState(composer.getInitialState(), true);
  dialog.setState(dialog.getInitialState(), true);
  focused().chat.setState(focused().chat.getInitialState(), true);
  focused().desk.setState(focused().desk.getInitialState(), true);
  focused().desk.setState({ root: "C:/demo", choice: { provider: "claude", model: "claude-sonnet" } });
});

afterEach(cleanup);

describe("attaching", () => {
  it("shows a file as a card with its type icon, name and a quiet type · size line", async () => {
    ipc.commands.attach.mockResolvedValue({ items: [{ kind: "file", path: "src/informe-trimestral-definitivo.pdf", name: "informe-trimestral-definitivo.pdf", bytes: 1_572_864, outside: false }], refused: [] });
    render(<Composer />);
    await act(() => attachPaths(["C:/demo/src/informe-trimestral-definitivo.pdf"]));

    const card = screen.getByRole("listitem");
    expect(card.querySelector(".clip-icon img")?.getAttribute("src")).toMatch(/pdf\.svg$/);
    expect(card.querySelector(".clip-head")?.textContent).toBe("informe-trimestral-defi");
    expect(card.querySelector(".clip-tail")?.textContent).toBe("nitivo.pdf");
    expect(card.querySelector(".clip-meta")?.textContent).toBe("PDF · 1,5 MB");
    expect(within(card).getByRole("button", { name: "Quitar informe-trimestral-definitivo.pdf" })).toBeTruthy();
  });

  it("opens a project file in the viewer, and drops a card from its own button", async () => {
    focused().desk.setState({ attached: [{ path: "src/app.ts", name: "app.ts", bytes: 10, outside: false, kind: "file" }] });
    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir app.ts" }));
    expect(showFile).toHaveBeenCalledWith("src/app.ts");
    fireEvent.click(screen.getByRole("button", { name: "Quitar app.ts" }));
    expect(focused().desk.getState().attached).toEqual([]);
    expect(screen.queryByRole("list", { name: "Adjuntos" })).toBeNull();
  });

  it("attaches a dropped folder for Claude to explore, and says why others were left out", async () => {
    ipc.commands.attach.mockResolvedValue({
      items: [{ kind: "folder", path: "src/components/", name: "components", entries: 24, outside: false }],
      refused: [
        { name: "nada.txt", why: "missing" },
        { name: "demo", why: "project" },
        { name: "video.mov", why: "tooBig" },
      ],
    });
    render(<Composer />);
    await act(() => attachPaths(["src/components", "nada.txt", "C:/demo", "C:/fuera/video.mov"]));

    expect(focused().desk.getState().attached).toEqual([{ path: "src/components/", name: "components", bytes: 0, outside: false, kind: "folder", entries: 24 }]);
    expect(screen.getByText("Carpeta · 24 elementos", { selector: ".clip-meta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir components" })).toBeNull();
    expect(warnings()).toEqual([
      "nada.txt no existe",
      "demo es la carpeta del proyecto · Claude ya trabaja en ella",
      "video.mov pasa de 20 MB · lo que viene de fuera del proyecto se adjunta hasta ese tamaño",
    ]);
  });

  it("converts a picture Claude does not take, and sends it as a file when the window cannot draw it", async () => {
    ipc.commands.attach.mockResolvedValue({
      items: [
        { kind: "picture", path: "logo.svg", name: "logo.svg", mediaType: "image/svg+xml", data: btoa("<svg/>"), bytes: 6, outside: false },
        { kind: "picture", path: "scan.avif", name: "scan.avif", mediaType: "image/avif", data: btoa("avif"), bytes: 4, outside: false },
      ],
      refused: [],
    });
    fit.mockResolvedValueOnce({ ...fitted(), width: 1600, height: 1600, was: { mediaType: "image/svg+xml", width: 0, height: 0 } }).mockResolvedValueOnce(null);
    render(<Composer />);
    await act(() => attachPaths(["logo.svg", "scan.avif"]));

    expect((fit.mock.calls[0][0] as Blob).type).toBe("image/svg+xml");
    const [picture] = focused().desk.getState().pasted;
    expect(picture).toMatchObject({ name: "logo.svg", mediaType: "image/png" });
    const tile = screen.getByRole("button", { name: "Ver logo.svg" });
    expect(tile.title).toBe("logo.svg · PNG · 2 KB · convertida de SVG a PNG");
    expect(focused().desk.getState().attached).toEqual([{ path: "scan.avif", name: "scan.avif", bytes: 4, outside: false, kind: "file" }]);
  });

  it("opens a picture larger on click, and removes it from its corner", async () => {
    focused().desk.setState({ pasted: [{ name: "captura.png", ...fitted() }] });
    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "Ver captura.png" }));
    expect(dialog.getState()).toMatchObject({ open: true, title: "captura.png" });
    fireEvent.click(screen.getByRole("button", { name: "Quitar captura.png" }));
    expect(focused().desk.getState().pasted).toEqual([]);
  });

  it("keeps the counts sane and says what was left out", async () => {
    focused().desk.setState({
      pasted: Array.from({ length: PICTURES_MOST }, (_, at) => ({ name: `p${at}.png`, ...fitted() })),
      attached: Array.from({ length: CLIPS_MOST - 1 }, (_, at) => ({ path: `f${at}.ts`, name: `f${at}.ts`, bytes: 1, outside: false })),
    });
    ipc.commands.attach.mockResolvedValue({
      items: [
        { kind: "file", path: "otro.ts", name: "otro.ts", bytes: 1, outside: false },
        { kind: "file", path: "y-otro.ts", name: "y-otro.ts", bytes: 1, outside: false },
        { kind: "picture", path: "mas.png", name: "mas.png", mediaType: "image/png", data: "", bytes: 1, outside: false },
      ],
      refused: [],
    });
    fit.mockResolvedValue(fitted());
    await act(() => attachPaths(["otro.ts", "y-otro.ts", "mas.png"]));

    expect(focused().desk.getState().pasted).toHaveLength(PICTURES_MOST);
    expect(focused().desk.getState().attached.at(-1)?.path).toBe("otro.ts");
    expect(warnings()).toEqual(["Hasta 20 imágenes por mensaje · el resto no se adjuntó", "Hasta 50 adjuntos por mensaje · el resto no se adjuntó"]);
  });

  it("marks the box while files are dragged over it", () => {
    render(<Composer />);
    expect(screen.queryByText("Suelta para adjuntar")).toBeNull();
    act(() => composer.setState({ dropping: true }));
    expect(document.querySelector(".box")?.getAttribute("data-drop")).toBe("true");
    expect(screen.getByText("Suelta para adjuntar")).toBeTruthy();
  });
});

describe("pasting", () => {
  const taken = () => focused().desk.getState().attached.length + focused().desk.getState().pasted.length > 0;
  const paste = async (files: File[], text = "", until = () => true) => {
    await act(async () => fireEvent.paste(field(), { clipboardData: { files, getData: (kind: string) => (kind === "text/plain" ? text : "") } }));
    await act(() => vi.waitFor(() => expect(until()).toBe(true)));
  };

  it("fits a pasted picture of any format instead of refusing it", async () => {
    fit.mockResolvedValue(fitted());
    render(<Composer />);
    await paste([new File(["bmp"], "", { type: "image/bmp" })], "", taken);
    expect(focused().desk.getState().pasted).toEqual([{ name: "imagen pegada", ...fitted() }]);
    expect(ipc.commands.stageFile).not.toHaveBeenCalled();
  });

  it("keeps a pasted file that is not a picture in the session's shelf, attached by path", async () => {
    ipc.commands.stageFile.mockImplementation(async (name: string) => ({ kind: "file", path: `C:/datos/staged/1-0/${name}`, name, bytes: 4, outside: true }));
    render(<Composer />);
    await paste([new File(["%PDF"], "contrato.pdf", { type: "application/pdf" })], "", taken);

    expect(ipc.commands.stageFile).toHaveBeenCalledWith("contrato.pdf", btoa("%PDF"));
    expect(focused().desk.getState().attached).toEqual([{ path: "C:/datos/staged/1-0/contrato.pdf", name: "contrato.pdf", bytes: 4, outside: true, kind: "file" }]);
    expect(screen.queryByRole("button", { name: "Abrir contrato.pdf" })).toBeNull();
  });

  it("turns a very long text into a pasted text card, and back into the message on request", async () => {
    ipc.commands.stageFile.mockImplementation(async (name: string, data: string) => ({ kind: "file", path: `C:/datos/staged/1-0/${name}`, name, bytes: atob(data).length, outside: true }));
    const long = Array.from({ length: 60 }, (_, at) => `línea ${at + 1}`).join("\n");
    render(<Composer />);
    fireEvent.change(field(), { target: { value: "Mira el log" } });
    await paste([], long, taken);

    const card = screen.getByRole("listitem");
    expect(field().value).toBe("Mira el log");
    expect([...card.querySelectorAll(".clip-lines span")].map((line) => line.textContent)).toEqual(["línea 1", "línea 2"]);
    expect(card.querySelector(".clip-meta")?.textContent).toBe("Texto pegado · 60 líneas");
    expect(ipc.commands.stageFile.mock.calls[0][0]).toBe("pasted-text.txt");

    fireEvent.click(within(card).getByRole("button", { name: "Pegar como texto" }));
    expect(focused().desk.getState().attached).toEqual([]);
    expect(field().value).toBe(`Mira el log\n\n${long}`);
  });

  it("leaves a short text to paste as usual", async () => {
    render(<Composer />);
    await paste([], "una línea");
    expect(ipc.commands.stageFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Adjuntos" })).toBeNull();
  });

  it("refuses a pasted file too big to keep, saying how big it may be", async () => {
    const huge = new File(["x"], "disco.iso", { type: "application/octet-stream" });
    Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
    await act(() => takeFiles([huge]));
    expect(ipc.commands.stageFile).not.toHaveBeenCalled();
    expect(warnings()).toEqual(["disco.iso pasa de 20 MB · lo que viene de fuera del proyecto se adjunta hasta ese tamaño"]);
  });
});

describe("sending what is attached", () => {
  it("goes with files alone, by path, and the sent turn shows the same cards", async () => {
    focused().desk.setState({
      attached: [
        { path: "src/app.tsx", name: "app.tsx", bytes: 10, outside: false, kind: "file" },
        { path: "docs/", name: "docs", bytes: 0, outside: false, kind: "folder", entries: 3 },
        { path: "C:/datos/staged/1-0/pasted-text.txt", name: "pasted-text.txt", bytes: 20, outside: true, kind: "text", text: "primera\nsegunda\ntercera" },
      ],
    });
    render(<Composer />);
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveProperty("disabled", false);
    await act(() => send(""));

    expect(ipc.commands.chatSend.mock.calls[0][2]).toEqual({ text: "", files: ["src/app.tsx", "docs/", "C:/datos/staged/1-0/pasted-text.txt"], images: [] });
    cleanup();
    render(<You turn={focused().chat.getState().turns.find((one) => one.kind === "you") as YouTurn} />);
    expect(document.querySelector(".body-text")).toBeNull();
    const metas = [...document.querySelectorAll(".sent-files .clip-meta")].map((meta) => meta.textContent);
    expect(metas).toEqual(["TSX · src", "Carpeta", "Texto pegado · 3 líneas"]);
    expect([...document.querySelectorAll(".clip-lines span")].map((line) => line.textContent)).toEqual(["primera", "segunda"]);
    expect(ipc.commands.artifactText).not.toHaveBeenCalled();
  });
});

describe("a sent message", () => {
  const turn = (files: string[], pictures: YouTurn["pictures"] = []): YouTurn => ({ kind: "you", key: 1, text: "Revisa", files, pictures });

  it("reads back its files as the same cards when a session is replayed", async () => {
    ipc.commands.artifactText.mockResolvedValue("uno\n\ndos\ntres\n");
    render(<You turn={turn(["src/app.tsx", ".sens/artifacts/s1/informe.pdf", "C:/Users/ana/docs/", ".sens/artifacts/s1/pasted-text-1.txt"])} />);
    await settle();

    expect(ipc.commands.artifactText).toHaveBeenCalledWith("C:/demo/.sens/artifacts/s1/pasted-text-1.txt");
    const cards = screen.getAllByRole("listitem");
    expect(cards.map((card) => card.querySelector(".clip-meta")?.textContent)).toEqual(["TSX · src", "PDF", "Carpeta", "Texto pegado · 4 líneas"]);
    expect(cards.map((card) => card.getAttribute("data-kind"))).toEqual(["file", "file", "folder", "text"]);
    expect(cards[2].querySelector(".clip-head")?.textContent).toBe("docs");
  });

  it("opens a project file in the viewer and a pasted text as text, and leaves the rest as they are", async () => {
    ipc.commands.artifactText.mockResolvedValue("hola");
    render(<You turn={turn(["src/app.tsx", "C:/fuera/plan.pdf", ".sens/artifacts/s1/pasted-text.txt"])} />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Abrir app.tsx" }));
    expect(showFile).toHaveBeenCalledWith("src/app.tsx");
    expect(screen.queryByRole("button", { name: "Abrir plan.pdf" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Abrir Texto pegado/ }));
    expect(present).toHaveBeenCalledWith("Texto pegado", "hola", "C:/demo");
  });

  it("shows its pictures as thumbnails that open larger, and one alone a little bigger", async () => {
    render(<You turn={turn([], ["data:image/png;base64,AAAA"])} />);
    expect(document.querySelector(".sent-pictures")?.getAttribute("data-single")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Ver imagen" }));
    expect(dialog.getState()).toMatchObject({ open: true, title: "Imagen enviada" });
  });
});
