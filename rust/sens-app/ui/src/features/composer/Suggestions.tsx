import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";
import { useStore } from "zustand";
import { commands } from "../../ipc/commands";
import type { Entry, Slash } from "../../ipc/types";
import { FileIcon } from "../../shared/FileIcon";
import { workOf, worktreePending, type Pane } from "../panes/store";
import { writeMessage } from "./store";
import { applied, commandOf, inFolder, mentionOf, rankFiles, rankSlashes, triggerAt } from "./suggest";

const FILE_PAUSE = 120;

type Item = { key: string; kind: "file"; path: string } | { key: string; kind: "command"; slash: Slash };

export type Suggest = ReturnType<typeof useSuggestions>;

export function useSuggestions(pane: Pane, text: string, field: RefObject<HTMLTextAreaElement | null>, listId: string) {
  const root = useStore(pane.desk, () => workOf(pane));
  const slashes = useStore(pane.desk, (s) => s.slashes);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<Entry[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState("");

  const trigger = useMemo(() => (focused ? triggerAt(text, caret) : null), [focused, text, caret]);
  const key = trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : "";
  const seeking = trigger?.kind === "file" ? trigger.query : null;

  useEffect(() => {
    if (seeking === null || !root) return setFound([]);
    let current = true;
    const soon = setTimeout(() => {
      commands.findFiles(root, seeking).then(
        (entries) => current && setFound(entries),
        () => current && setFound([]),
      );
    }, FILE_PAUSE);
    return () => {
      current = false;
      clearTimeout(soon);
    };
  }, [seeking, root]);

  const items: Item[] = useMemo(() => {
    if (!trigger) return [];
    if (trigger.kind === "command") return rankSlashes(slashes, trigger.query).map((slash) => ({ key: slash.name, kind: "command", slash }));
    return rankFiles(found, trigger.query).map((file) => ({ key: file.path, kind: "file", path: file.path }));
  }, [trigger, slashes, found]);

  useEffect(() => setActive(0), [key]);

  const open = Boolean(trigger) && key !== dismissed && items.length > 0;
  const at = Math.min(active, Math.max(items.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;

  function pick(index: number) {
    const item = items[index];
    if (!item || !trigger) return;
    const insert = item.kind === "command" ? commandOf(item.slash.name) : mentionOf(worktreePending(pane) ? inFolder(root, item.path) : item.path);
    const next = applied(text, trigger, insert);
    writeMessage(next.text, pane);
    setCaret(next.caret);
    requestAnimationFrame(() => field.current?.setSelectionRange(next.caret, next.caret));
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || event.nativeEvent.isComposing) return false;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) setActive((at + step + items.length) % items.length);
    else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) pick(at);
    else if (event.key === "Escape") setDismissed(key);
    else return false;
    event.preventDefault();
    return true;
  }

  return {
    open,
    items,
    active: at,
    kind: trigger?.kind ?? "file",
    listId,
    optionId,
    pick,
    hover: setActive,
    keyDown,
    follow: (event: SyntheticEvent<HTMLTextAreaElement>) => setCaret(event.currentTarget.selectionStart),
    focus: () => setFocused(true),
    blur: () => setFocused(false),
  };
}

export function Suggestions({ suggest }: { suggest: Suggest }) {
  if (!suggest.open) return null;
  return (
    <div className="sheet menu suggest" id={suggest.listId} role="listbox" aria-label={suggest.kind === "file" ? "Ficheros del proyecto" : "Comandos de Claude Code"}>
      {suggest.items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          id={suggest.optionId(index)}
          className="menu-item suggest-row"
          role="option"
          aria-selected={index === suggest.active}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => suggest.hover(index)}
          onClick={() => suggest.pick(index)}
        >
          {item.kind === "file" ? (
            <>
              <FileIcon path={item.path} />
              <span className="suggest-name">{item.path}</span>
            </>
          ) : (
            <>
              <span className="suggest-name">/{item.slash.name}</span>
              {item.slash.hint && <span className="suggest-hint">{item.slash.hint}</span>}
              <span className="suggest-said">{item.slash.description}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
