import { StrictMode, useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { commands } from "../../ipc/commands";
import type { Entry } from "../../ipc/types";
import { FileIcon } from "../../shared/FileIcon";
import { parentOf } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { project } from "../project/store";
import { files, loadFolder, toggleFolder } from "./store";
import { openFile, viewer } from "./view";

const SEEK_WAIT = 120;

// The filter and the list go in .tree; the splitter beside it stays in app.js.
export function mountTree(host: Element) {
  createRoot(host).render(
    <StrictMode>
      <Tree />
    </StrictMode>,
  );
}

export function Tree() {
  const [needle, setNeedle] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const wait = setTimeout(() => setQuery(needle.trim()), SEEK_WAIT);
    return () => clearTimeout(wait);
  }, [needle]);

  return (
    <>
      <div className="filter">
        <input
          className="field"
          id="filter"
          placeholder="Buscar en la carpeta…"
          aria-label="Buscar en la carpeta"
          autoComplete="off"
          spellCheck={false}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
      </div>
      <div className="filelist" id="filelist">
        {query ? <Found query={query} /> : <Folders />}
      </div>
    </>
  );
}

function Folders() {
  const root = useStore(project, (s) => s.root);
  const folders = useStore(files, (s) => s.folders);
  const unfolded = useStore(files, (s) => s.unfolded);
  const fault = useStore(files, (s) => s.fault);

  const rows: [Entry, number][] = [];
  const missing: string[] = [];
  const walk = (path: string, depth: number) => {
    const entries = folders.get(path);
    if (!entries) return void missing.push(path);
    for (const entry of entries) {
      rows.push([entry, depth]);
      if (entry.dir && unfolded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  if (root) walk("", 0);

  useEffect(() => {
    for (const path of missing) loadFolder(path);
  });

  if (!root) return <p className="none">Sin carpeta.</p>;
  if (fault) return <Fault reason={fault} />;
  if (!folders.has("")) return null;
  if (!rows.length) return <p className="none">Carpeta vacía.</p>;
  return rows.map(([entry, depth]) => <FileRow key={entry.path} entry={entry} depth={depth} />);
}

// The last results stay until the next ones arrive, and a reload of the tree
// searches again.
function Found({ query }: { query: string }) {
  const root = useStore(project, (s) => s.root);
  const loads = useStore(files, (s) => s.loads);
  const [found, setFound] = useState<Entry[] | null>(null);
  const [fault, setFault] = useState("");

  useEffect(() => {
    if (!root) return;
    let live = true;
    commands.findFiles(root, query).then(
      (entries) => {
        if (!live) return;
        setFound(entries);
        setFault("");
      },
      (reason) => live && setFault(String(reason)),
    );
    return () => {
      live = false;
    };
  }, [root, query, loads]);

  if (!root) return <p className="none">Sin carpeta.</p>;
  if (fault) return <Fault reason={fault} />;
  if (!found) return null;
  if (!found.length) return <p className="none">Nada coincide.</p>;
  return found.map((entry) => <FileRow key={entry.path} entry={entry} depth={0} found />);
}

function Fault({ reason }: { reason: string }) {
  return (
    <p className="none fault" role="alert">
      {reason}
    </p>
  );
}

// A folder is touched when the agent edited something inside it.
function FileRow({ entry, depth, found = false }: { entry: Entry; depth: number; found?: boolean }) {
  const open = useStore(files, (s) => entry.dir && s.unfolded.has(entry.path));
  const opened = useStore(viewer, (s) => s.opened === entry.path);
  const count = useStore(files, (s) => s.symbols.get(entry.path));
  const touched = useStore(project, (s) =>
    entry.dir ? [...s.touched.keys()].some((path) => path.startsWith(`${entry.path}/`)) : s.touched.has(entry.path),
  );

  return (
    <button
      type="button"
      className={entry.dir ? "filerow folder" : "filerow"}
      title={entry.path}
      data-path={entry.path}
      style={{ "--depth": String(depth) } as CSSProperties}
      data-ignored={entry.ignored ? "true" : undefined}
      aria-expanded={entry.dir ? open : undefined}
      aria-current={opened ? "true" : undefined}
      data-touched={String(touched)}
      onClick={() => (entry.dir ? toggleFolder(entry.path) : openFile(entry.path))}
    >
      {entry.dir ? (
        <span className="glyph">
          <Icon svg={open ? ICONS.open : ICONS.shut} />
        </span>
      ) : (
        <FileIcon path={entry.name} />
      )}
      <span className="name">{entry.name}</span>
      {found && <span className="dirname">{parentOf(entry.path)}</span>}
      {count ? <span className="n">{String(count)}</span> : null}
    </button>
  );
}
