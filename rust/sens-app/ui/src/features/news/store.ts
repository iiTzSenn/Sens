import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { News } from "../../ipc/types";
import { project } from "../project/store";

declare global {
  interface Window {
    __SENS_NEWS__?: boolean;
  }
}

export const news = createStore(() => ({
  told: null as News[] | null,
  loading: false,
  fault: "",
  owed: false,
}));

const set = news.setState;

export function newsAtStart() {
  if (window.__SENS_NEWS__ !== true) return;
  set({ owed: true });
  project.setState({ view: "news" });
  loadNews();
}

export async function loadNews() {
  const { told, loading } = news.getState();
  if (told || loading) return;
  set({ loading: true, fault: "" });
  try {
    const found = await commands.news();
    set({ told: found });
    if (found.length) await settle();
  } catch (reason) {
    set({ fault: String(reason) });
  }
  set({ loading: false });
}

async function settle() {
  if (!news.getState().owed) return;
  set({ owed: false });
  await commands.sawNews().catch(() => {});
}

export function closeNews() {
  project.setState({ view: "" });
  return settle();
}
