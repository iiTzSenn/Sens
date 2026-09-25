import type { Artifact } from "../../ipc/types";
import { PAGE, TEXTUAL } from "../../shared/format.js";
import { ICONS } from "../../shared/icons.js";
import { plain } from "../market/search.js";
import { t } from "./copy";

export type ShelfTab = "all" | Artifact["kind"];

export const SHELF_TABS: ShelfTab[] = ["all", "image", "file", "link"];

export const shelfTabs = () => SHELF_TABS.map((id): [ShelfTab, string] => [id, t.tabs[id]]);

export const KIND_ICON: Record<Artifact["kind"], string> = { image: ICONS.image, file: ICONS.fileText, link: ICONS.link };

export const kindOf = (item: Artifact) => t.kinds[item.kind] || t.kinds.file;

export const keeps = (tab: ShelfTab, item: Artifact) => tab === "all" || item.kind === tab;

export const sessionOf = (item: Artifact) => (item.session ? item.sessionTitle || t.untitled : "");

export const originOf = (item: Artifact) => [item.project, sessionOf(item)].filter(Boolean).join(" · ");

export const saying = (needle: string) => (item: Artifact) =>
  plain([item.name, item.project, sessionOf(item)].filter(Boolean).join("\n")).includes(needle);

export const pictureKey = (item: Artifact) => `${item.at}:${item.target}`;

export const keptTally = (kept: number) => (kept ? t.kept(kept) : t.keptNone);

// Pictures open in the dialog, text and pages in the file panel, the rest in
// the system: links in the browser, other files with their app.
export function howToOpen(item: Artifact): "picture" | "text" | "outside" {
  if (item.kind === "image") return "picture";
  if (item.kind === "link") return "outside";
  if (PAGE.test(item.name) || TEXTUAL.test(item.name)) return "text";
  return "outside";
}
