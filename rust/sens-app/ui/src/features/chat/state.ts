import { focused, type Pane } from "../panes/store";
import { nextKey, type Piece } from "./turns";

// A line the app adds to the chat: a branch switched, something refused.
export function notice(parts: Piece[], tone: "" | "warn" = "", pane: Pane = focused()) {
  pane.chat.setState(({ turns }) => ({ turns: [...turns, { kind: "notice", key: nextKey(), parts, tone }] }));
}

export const warn = (text: string, pane?: Pane) => notice([text], "warn", pane);
