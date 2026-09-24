import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { Artifact } from "../../ipc/types";
import { legacy } from "../../legacy/bridge";
import { PAGE } from "../../shared/format.js";
import { store, stored } from "../../shared/storage.js";
import { present } from "../files/view";
import { SHELF_TABS, howToOpen, pictureKey, type ShelfTab } from "./items";

const TAB_KEY = "sens.artifacts.tab";
const kept = stored(TAB_KEY, "all");

// `loadFault` replaces the list; `listFault` sits on top of it until the next
// thing opened from there.
export const artifacts = createStore(() => ({
  items: [] as Artifact[],
  loadFault: "",
  listFault: "",
  tab: (SHELF_TABS.some(([id]) => id === kept) ? kept : "all") as ShelfTab,
}));

const set = artifacts.setState;

// Each picture is read once, for its thumbnail and its preview alike, and
// forgotten once the artifact is gone.
const pictures = new Map<string, Promise<string>>();

export function picture(item: Artifact) {
  const key = pictureKey(item);
  if (!pictures.has(key)) {
    pictures.set(
      key,
      commands.artifactData(item.target).catch((reason) => {
        pictures.delete(key);
        throw reason;
      }),
    );
  }
  return pictures.get(key)!;
}

export async function loadShelf() {
  try {
    const items = await commands.artifacts();
    const live = new Set(items.map(pictureKey));
    for (const key of pictures.keys()) if (!live.has(key)) pictures.delete(key);
    set({ items, loadFault: "" });
  } catch (reason) {
    set({ items: [], loadFault: String(reason) });
  }
}

export function pickTab(tab: ShelfTab) {
  store(TAB_KEY, tab);
  set({ tab, listFault: "" });
}

async function showPicture(item: Artifact, back: HTMLElement) {
  const img = document.createElement("img");
  img.className = "sight";
  img.alt = item.name;
  img.src = await picture(item);
  legacy.preview(item.name, back, img);
}

async function showText(item: Artifact) {
  present(item.target, await commands.artifactText(item.target), item.root);
  if (PAGE.test(item.name)) return legacy.showSite(item.target, item.root);
  legacy.showTool("files");
}

const OPENERS = {
  picture: showPicture,
  text: showText,
  outside: (item: Artifact) => commands.openExternal(item.target),
};

export async function openArtifact(item: Artifact, back: HTMLElement) {
  set({ listFault: "" });
  try {
    await OPENERS[howToOpen(item)](item, back);
  } catch (reason) {
    set({ listFault: String(reason) });
  }
}
