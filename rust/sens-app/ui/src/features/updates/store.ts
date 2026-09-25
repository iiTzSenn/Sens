import { getVersion } from "@tauri-apps/api/app";
import { createStore } from "zustand/vanilla";
import { commands, events } from "../../ipc/commands";
import type { Release, UpdateStage } from "../../ipc/types";
import { profile } from "../profile/store";
import { t } from "./copy";

const UPDATE_EVERY = 12 * 60 * 60 * 1000;

// What Sens knows about its own updates. The title bar pill, the update panel
// and the settings block all paint from here.
export const updates = createStore(() => ({
  current: "",
  latest: null as Release | null,
  installable: true,
  checked: false,
  checking: false,
  fault: "",
  // Where an install is, while one runs.
  stage: null as UpdateStage | null,
}));

type Updates = ReturnType<typeof updates.getState>;

let timer = 0;
const automatic = () => profile.getState().person.checkUpdates !== false;

export function updateState({ checking, fault, latest, checked }: Updates) {
  if (checking) return t.checking;
  if (fault) return fault;
  if (latest) return t.available(latest.version);
  if (checked) return t.latest;
  return "";
}

export async function checkUpdates(manual: boolean) {
  updates.setState({ checking: true, fault: "" });
  try {
    const found = await commands.updateCheck(manual);
    updates.setState(({ checked }) => ({
      latest: found.latest,
      installable: found.installable,
      checked: checked || manual || found.installable,
    }));
  } catch (reason) {
    updates.setState({ fault: String(reason) });
  }
  updates.setState({ checking: false });
}

function schedule() {
  clearInterval(timer);
  timer = automatic() ? window.setInterval(() => checkUpdates(false), UPDATE_EVERY) : 0;
}

export async function startUpdates() {
  events.update((stage) => updates.setState({ stage }));
  try {
    updates.setState({ current: await getVersion() });
  } catch {}
  schedule();
  if (automatic()) await checkUpdates(false);
}

export async function setAutomatic(on: boolean) {
  await commands.setUpdateCheck(on);
  profile.setState(({ person }) => ({ person: { ...person, checkUpdates: on } }));
  schedule();
}
