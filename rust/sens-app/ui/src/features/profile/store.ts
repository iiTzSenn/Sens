import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { Profile } from "../../ipc/types";

// Who uses Sens: the rail footer paints it, settings edits it, and updates
// read whether to check on their own.
export const profile = createStore<{ person: Profile; fault: string }>(() => ({
  person: { name: "", checkUpdates: true, welcomed: true, seen: "" },
  fault: "",
}));

export async function loadProfile() {
  try {
    profile.setState({ person: await commands.profile(), fault: "" });
  } catch (reason) {
    profile.setState({ fault: String(reason) });
  }
}

export async function saveProfileName(name: string) {
  await commands.saveProfile(name);
  await loadProfile();
}
