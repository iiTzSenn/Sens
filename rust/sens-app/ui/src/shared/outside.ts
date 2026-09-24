import { commands } from "../ipc/commands";
import { warn } from "../features/chat/state";

// A web address or a file in the system's own browser or app; the chat says
// why when the system refuses.
export const openOutside = (target: string) => commands.openExternal(target).catch((reason) => warn(String(reason)));
