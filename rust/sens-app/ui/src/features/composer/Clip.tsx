import type { MouseEvent } from "react";
import { FileIcon } from "../../shared/FileIcon";
import { shared } from "../../shared/copy";
import { stem, weigh } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { t } from "./copy";
import { typeName } from "./pictures";
import type { File, Picture } from "./store";
import "./clips.css";

export interface Shown {
  kind: "file" | "folder" | "text";
  path: string;
  name: string;
  meta: string;
  lines?: string[];
}

const EXTENSION = /\.([a-z0-9]{1,10})$/i;
const FOLDER = /[\\/]$/;
const ABSOLUTE = /^([a-z]:)?[\\/]/i;
const SHELF = /(^|[\\/])\.sens[\\/]/;
const PASTED = /(^|[\\/])pasted-text(-\d+)?\.txt$/i;
const SPLIT_FROM = 18;
const TAIL = 10;
const PREVIEW = 2;

export const isFolder = (path: string) => FOLDER.test(path);
export const isPastedText = (path: string) => PASTED.test(path);
export const inProject = (path: string) => !ABSOLUTE.test(path);

export const typeOf = (name: string) => EXTENSION.exec(name)?.[1].toUpperCase() ?? t.file;

export const lineCount = (text: string) => text.replace(/\n+$/, "").split("\n").length;

export const firstLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim())
    .slice(0, PREVIEW);

const where = (path: string) => {
  if (!inProject(path) || SHELF.test(path)) return "";
  const parent = path.replace(FOLDER, "").split(/[\\/]/).slice(0, -1).join("/");
  return parent;
};

const joined = (...parts: string[]) => parts.filter(Boolean).join(" · ");

export function shownOfFile(file: File): Shown {
  if (file.kind === "folder") return { kind: "folder", path: file.path, name: file.name, meta: joined(t.folder, file.entries === undefined ? "" : t.items(file.entries)) };
  if (file.kind === "text" && file.text !== undefined)
    return { kind: "text", path: file.path, name: t.pastedText, meta: joined(t.pastedText, t.lines(lineCount(file.text))), lines: firstLines(file.text) };
  return { kind: "file", path: file.path, name: file.name, meta: joined(typeOf(file.name), weigh(file.bytes)) };
}

export function shownOfPath(path: string, text?: string): Shown {
  const name = stem(path.replace(FOLDER, ""));
  if (isFolder(path)) return { kind: "folder", path, name, meta: joined(t.folder, where(path)) };
  if (isPastedText(path)) return { kind: "text", path, name: t.pastedText, meta: joined(t.pastedText, text === undefined ? "" : t.lines(lineCount(text))), lines: text === undefined ? [] : firstLines(text) };
  return { kind: "file", path, name, meta: joined(typeOf(name), where(path)) };
}

export function pictureTitle(picture: Picture) {
  const { was } = picture;
  const converted = was && was.mediaType !== picture.mediaType ? t.converted(typeName(was.mediaType), typeName(picture.mediaType)) : "";
  const reduced = was && picture.width && picture.height && was.width > picture.width ? t.reduced(picture.width, picture.height) : "";
  return joined(picture.name, typeName(picture.mediaType), weigh(picture.bytes), converted, reduced);
}

function Name({ name }: { name: string }) {
  if (name.length < SPLIT_FROM)
    return (
      <span className="clip-name">
        <span className="clip-head">{name}</span>
      </span>
    );
  const cut = name.length - TAIL;
  return (
    <span className="clip-name">
      <span className="clip-head">{name.slice(0, cut)}</span>
      <span className="clip-tail">{name.slice(cut)}</span>
    </span>
  );
}

function Face({ shown }: { shown: Shown }) {
  return (
    <>
      <span className="clip-icon">{shown.kind === "folder" ? <Icon svg={ICONS.folderSmall} /> : <FileIcon path={shown.kind === "text" ? "pasted.txt" : shown.name} />}</span>
      <span className="clip-words">
        {shown.kind === "text" && shown.lines?.length ? (
          <span className="clip-lines">
            {shown.lines.map((line, at) => (
              <span key={at}>{line}</span>
            ))}
          </span>
        ) : (
          <Name name={shown.name} />
        )}
        <span className="clip-meta">{shown.meta}</span>
      </span>
    </>
  );
}

export function ClipCard({ shown, open, remove, inline }: { shown: Shown; open?: (from: HTMLElement) => void; remove?: () => void; inline?: () => void }) {
  const label = shown.kind === "text" ? shown.meta : shown.name;
  return (
    <div className="clip" data-kind={shown.kind} role="listitem">
      {open ? (
        <button type="button" className="clip-face" title={shown.path} aria-label={t.openFile(label)} onClick={(event: MouseEvent<HTMLButtonElement>) => open(event.currentTarget)}>
          <Face shown={shown} />
        </button>
      ) : (
        <span className="clip-face" title={shown.path}>
          <Face shown={shown} />
        </span>
      )}
      {(inline || remove) && (
        <span className="clip-acts">
          {inline && (
            <button type="button" className="clip-act" title={t.asText} aria-label={t.asText} onClick={inline}>
              <Icon svg={ICONS.pencil} />
            </button>
          )}
          {remove && (
            <button type="button" className="clip-act clip-drop" title={shared.remove(label)} aria-label={shared.remove(label)} onClick={remove}>
              <Icon svg={ICONS.remove} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export function PictureTile({ src, name, title, label, open, remove }: { src: string; name: string; title: string; label?: string; open: (from: HTMLElement) => void; remove?: () => void }) {
  return (
    <div className="clip-picture" role="listitem">
      <button type="button" className="clip-sight" title={title} aria-label={label ?? t.seePicture(name)} onClick={(event: MouseEvent<HTMLButtonElement>) => src && open(event.currentTarget)}>
        <img src={src || undefined} alt="" draggable={false} />
      </button>
      {remove && (
        <button type="button" className="clip-act clip-drop" title={shared.remove(name)} aria-label={shared.remove(name)} onClick={remove}>
          <Icon svg={ICONS.remove} />
        </button>
      )}
    </div>
  );
}
