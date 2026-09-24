import type { Artifact } from "../../ipc/types";
import { PAGE, TEXTUAL } from "../../shared/format.js";
import { ICONS } from "../../shared/icons.js";
import { plain } from "../market/search.js";

export type ShelfTab = "all" | Artifact["kind"];

export const SHELF_TABS: [ShelfTab, string][] = [
  ["all", "Todo"],
  ["image", "Imágenes"],
  ["file", "Ficheros"],
  ["link", "Enlaces"],
];

export const KIND_ICON: Record<Artifact["kind"], string> = { image: ICONS.image, file: ICONS.fileText, link: ICONS.link };
export const KIND_LABEL: Record<Artifact["kind"], string> = { image: "Imagen", file: "Fichero", link: "Enlace" };

export const keeps = (tab: ShelfTab, item: Artifact) => tab === "all" || item.kind === tab;

export const sessionOf = (item: Artifact) => (item.session ? item.sessionTitle || "Sesión sin título" : "");

export const originOf = (item: Artifact) => [item.project, sessionOf(item)].filter(Boolean).join(" · ");

export const saying = (needle: string) => (item: Artifact) =>
  plain([item.name, item.project, sessionOf(item)].filter(Boolean).join("\n")).includes(needle);

export const pictureKey = (item: Artifact) => `${item.at}:${item.target}`;

export const keptTally = (kept: number) =>
  kept ? `${kept} ${kept === 1 ? "artefacto" : "artefactos"} de este proyecto` : "Todavía no hay artefactos en este proyecto";

// Pictures open in the dialog, text and pages in the file panel, the rest in
// the system: links in the browser, other files with their app.
export function howToOpen(item: Artifact): "picture" | "text" | "outside" {
  if (item.kind === "image") return "picture";
  if (item.kind === "link") return "outside";
  if (PAGE.test(item.name) || TEXTUAL.test(item.name)) return "text";
  return "outside";
}
