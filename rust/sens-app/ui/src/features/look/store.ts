import { commands } from "../../ipc/commands";
import { look, showLook, type Look } from "../../shared/look";

export async function chooseLook(chosen: Look) {
  const before = look.getState().chosen;
  showLook(chosen);
  try {
    await commands.setLook(chosen);
  } catch (reason) {
    showLook(before);
    throw reason;
  }
}
