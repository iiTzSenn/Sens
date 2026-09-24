import { StrictMode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { commands } from "../../ipc/commands";
import { PICTURE, parentOf, plural, stem } from "../../shared/format.js";
import { FileIcon } from "../../shared/FileIcon";
import { Icon } from "../../shared/Icon";
import { LinesCard } from "../../shared/LinesCard";
import { addedRows, patchRows } from "../../shared/rows";
import { languageOf } from "../../shared/syntax/languages";
import { ICONS } from "../../shared/icons.js";
import { project } from "../project/store";
import type { DiffFile } from "./diff";
import { showFile } from "../files/view";
import { changes, unfold } from "./store";

const CHANGE_PREVIEW = 400;
const CHANGE_CAP = 300;
const CHANGE_WORD: Record<DiffFile["state"], string> = { A: "Nuevo", M: "Modificado", D: "Borrado", R: "Renombrado" };

// The list goes in the panel body; the totals, in the header app.js owns.
export function mountChanges(host: Element, totals: Element) {
  createRoot(host).render(
    <StrictMode>
      <ChangesPanel totals={totals} />
    </StrictMode>,
  );
}

export function ChangesPanel({ totals }: { totals: Element }) {
  const changed = useStore(changes, (s) => s.changed);
  const versioned = useStore(changes, (s) => s.versioned);
  const fault = useStore(changes, (s) => s.fault);
  const root = useStore(project, (s) => s.root);
  const files = changed || [];
  const quiet = !root
    ? "Sin carpeta."
    : changed === null
      ? "Leyendo cambios…"
      : !versioned
        ? "Esta carpeta no está en un repositorio git."
        : !files.length
          ? "Sin cambios desde el último commit."
          : "";

  return (
    <>
      {createPortal(<Totals files={files} />, totals)}
      {fault ? (
        <p className="none fault">{fault}</p>
      ) : quiet ? (
        <p className="none">{quiet}</p>
      ) : (
        <>
          {files.slice(0, CHANGE_CAP).map((file) => (
            <ChangeRow key={file.path} file={file} />
          ))}
          {files.length > CHANGE_CAP && (
            <p className="none">{`Y ${plural(files.length - CHANGE_CAP, "fichero más", "ficheros más")}.`}</p>
          )}
        </>
      )}
    </>
  );
}

function Totals({ files }: { files: DiffFile[] }) {
  if (!files.length) return null;
  const sum = (key: "plus" | "minus") => files.reduce((total, file) => total + file[key], 0);
  return (
    <>
      <span className="files">{plural(files.length, "fichero", "ficheros")}</span>
      <span className="plus">{`+${sum("plus")}`}</span>
      <span className="minus">{`−${sum("minus")}`}</span>
    </>
  );
}

// The body is drawn while the row is open, again after each read of git, as the
// file may have changed. A new file's lines are counted once they are read.
function ChangeRow({ file }: { file: DiffFile }) {
  const open = useStore(changes, (s) => s.unfolded.has(file.path));
  const touched = useStore(project, (s) => s.touched.has(file.path));
  const [counted, setCounted] = useState<number | null>(null);
  const plus = file.fresh ? (counted ?? file.plus) : file.plus;

  return (
    <details
      className="change"
      data-touched={String(touched)}
      open={open}
      onToggle={(event) => unfold(file.path, event.currentTarget.open)}
    >
      <summary title={file.from ? `${file.from} → ${file.path}` : file.path}>
        <span className="chev">
          <Icon svg={ICONS.shut} />
        </span>
        <span className="state" data-state={file.state} title={CHANGE_WORD[file.state] || file.state}>
          {file.state}
        </span>
        <FileIcon path={file.path} />
        <span className="name">{stem(file.path)}</span>
        <span className="dirname">{parentOf(file.path)}</span>
        <Counts file={file} plus={plus} />
        {file.state !== "D" && (
          <button
            className="jump"
            type="button"
            title="Abrir en Ficheros"
            aria-label="Abrir en Ficheros"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              showFile(file.path);
            }}
          >
            <Icon svg={ICONS.fileCode} />
          </button>
        )}
      </summary>
      <div className="change-body">{open && <ChangeBody file={file} counted={setCounted} />}</div>
    </details>
  );
}

function Counts({ file, plus }: { file: DiffFile; plus: number }) {
  return (
    <span className="marks">
      {file.binary ? (
        <span className="files">binario</span>
      ) : file.fresh && !plus ? (
        <span className="plus">nuevo</span>
      ) : (
        <>
          <span className="plus">{`+${plus}`}</span>
          <span className="minus">{`−${file.minus}`}</span>
        </>
      )}
    </span>
  );
}

// A new file has no diff: its lines are read and shown as added, and counted.
function ChangeBody({ file, counted }: { file: DiffFile; counted: (lines: number) => void }) {
  const [fresh, setFresh] = useState<{ text: string } | { fault: string } | null>(null);

  useEffect(() => {
    if (!file.fresh || file.binary || PICTURE.test(file.path)) return;
    let live = true;
    commands.openFile(project.getState().root, file.path).then(
      (text) => live && setFresh({ text }),
      (reason) => live && setFresh({ fault: String(reason) }),
    );
    return () => {
      live = false;
    };
  }, [file]);

  if (file.binary || (file.fresh && PICTURE.test(file.path))) return <p className="none">Fichero binario.</p>;
  if (file.fresh) {
    if (!fresh) return null;
    if ("fault" in fresh) return <p className="none fault">{fresh.fault}</p>;
    return <Added path={file.path} text={fresh.text} counted={counted} />;
  }
  if (!file.hunks.length) {
    return <p className="none">{file.state === "R" ? "Renombrado, sin cambios de contenido." : "Sin cambios de contenido."}</p>;
  }
  return <Patch file={file} />;
}

function Patch({ file }: { file: DiffFile }) {
  const { rows } = useMemo(() => patchRows(file.hunks), [file]);
  return <LinesCard rows={rows} preview={CHANGE_PREVIEW} language={languageOf(file.path)} />;
}

function Added({ path, text, counted }: { path: string; text: string; counted: (lines: number) => void }) {
  const rows = useMemo(() => addedRows(text), [text]);
  useEffect(() => counted(rows.length), [rows]);
  return <LinesCard rows={rows} preview={CHANGE_PREVIEW} language={languageOf(path, text)} />;
}
