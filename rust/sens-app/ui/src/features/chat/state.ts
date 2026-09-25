import { createStore, type StoreApi } from "zustand/vanilla";
import type { Finished } from "../../ipc/types";
import { focused, type Pane } from "../panes/store";
import { nextKey, type Piece } from "./turns";

// A line the app adds to the chat: a branch switched, something refused.
export function notice(parts: Piece[], tone: "" | "warn" = "", pane: Pane = focused()) {
  pane.chat.setState(({ turns }) => ({ turns: [...turns, { kind: "notice", key: nextKey(), parts, tone }] }));
}

export const warn = (text: string, pane?: Pane) => notice([text], "warn", pane);

export interface Spent {
  replies: number;
  tokensIn: number;
  tokensOut: number;
  millis: number;
}

const NOTHING: Spent = { replies: 0, tokensIn: 0, tokensOut: 0, millis: 0 };

const spending = new WeakMap<Pane, StoreApi<Spent>>();

export function spentOf(pane: Pane) {
  let spent = spending.get(pane);
  if (!spent) spending.set(pane, (spent = createStore<Spent>(() => NOTHING)));
  return spent;
}

export const spend = (pane: Pane, { tokensIn, tokensOut, millis }: Finished) =>
  spentOf(pane).setState((spent) => ({
    replies: spent.replies + 1,
    tokensIn: spent.tokensIn + (tokensIn || 0),
    tokensOut: spent.tokensOut + (tokensOut || 0),
    millis: spent.millis + (millis || 0),
  }));

export const unspent = (pane: Pane) => spentOf(pane).setState(NOTHING, true);
