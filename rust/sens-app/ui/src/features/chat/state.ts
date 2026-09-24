import { createStore } from "zustand/vanilla";
import { nextKey, type Piece, type Turn } from "./turns";

// The chat of the session on screen: its turns; whether Claude is working
// (`busy`) and being stopped; the hint the empty chat shows; whether a
// session is being drawn back, which skips the entry animations; and how many
// turns ended, for what reads the project again after one.
export const chat = createStore(() => ({
  turns: [] as Turn[],
  busy: false,
  stopping: false,
  hint: "",
  replaying: false,
  ended: 0,
}));

// A line the app adds to the chat: a branch switched, something refused.
export function notice(parts: Piece[], tone: "" | "warn" = "") {
  chat.setState(({ turns }) => ({ turns: [...turns, { kind: "notice", key: nextKey(), parts, tone }] }));
}

export const warn = (text: string) => notice([text], "warn");
