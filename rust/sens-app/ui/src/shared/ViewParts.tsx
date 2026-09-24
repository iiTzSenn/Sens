import { useRef, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { project } from "../features/project/store";
import { stem } from "./format.js";
import { Icon } from "./Icon";
import { ICONS } from "./icons.js";

// The pieces the views repeat above their lists. `prefix` names the view's ids:
// `${prefix}-tabs`, `${prefix}-tab-<id>`, `${prefix}-list`, `${prefix}-project`.

// Tabs that carry a count; the arrow keys move between them.
export function CountTabs<T extends string>({
  prefix,
  label,
  tabs,
  at,
  count,
  pick,
}: {
  prefix: string;
  label: string;
  tabs: [T, string][];
  at: T;
  count: (tab: T) => number;
  pick: (tab: T) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const ids = tabs.map(([id]) => id);

  function onKeyDown(event: KeyboardEvent) {
    const step = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    const next = ids[(ids.indexOf(at) + step + ids.length) % ids.length];
    pick(next);
    bar.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <div className="tabs" id={`${prefix}-tabs`} role="tablist" aria-label={label} ref={bar} onKeyDown={onKeyDown}>
      {tabs.map(([id, text]) => (
        <button
          key={id}
          className="tab"
          role="tab"
          id={`${prefix}-tab-${id}`}
          data-tab={id}
          aria-controls={`${prefix}-list`}
          aria-selected={id === at}
          tabIndex={id === at ? 0 : -1}
          onClick={() => pick(id)}
        >
          {text} <span className="count">{count(id)}</span>
        </button>
      ))}
    </div>
  );
}

export function ViewSeek({
  id,
  input,
  label,
  placeholder,
  value,
  change,
  hidden = false,
}: {
  id: string;
  input: string;
  label: string;
  placeholder: string;
  value: string;
  change: (value: string) => void;
  hidden?: boolean;
}) {
  return (
    <div className="seek view-seek" id={id} role="search" hidden={hidden}>
      <Icon svg={ICONS.search} />
      <input
        className="field"
        id={input}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );
}

// The open project and what the view counts in it, or what to do without one.
export function ProjectFocus({
  prefix,
  tally,
  unopened,
  note,
}: {
  prefix: string;
  tally: (root: string) => string;
  unopened: string;
  note: string;
}) {
  const root = useStore(project, (s) => s.root);
  return (
    <div className="view-focus">
      <span className="label" id={`${prefix}-project`} title={root}>
        {root ? stem(root) : "Sin proyecto"}
      </span>
      <p className="tally" id={`${prefix}-tally`} aria-live="polite">
        {root ? tally(root) : unopened}
      </p>
      <p className="note">{note}</p>
    </div>
  );
}
