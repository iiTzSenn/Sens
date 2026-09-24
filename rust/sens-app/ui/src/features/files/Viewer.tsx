import { StrictMode, memo, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { FRONT_MATTER } from "../../shared/format.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { languageOf } from "../../shared/syntax/languages";
import { usePainted, type Look, type Painted, type Runs } from "../../shared/syntax/paint";
import { useSeen } from "../../shared/useSeen";
import { project, type Edits } from "../project/store";
import { setMode, viewer, viewOf } from "./view";

// The file panel beside the tree: its name and the agent's counts in the
// header, the Código/Vista switch among the header's tools, and the text.
export function mountViewer(host: Element, head: Element, modes: Element) {
  createRoot(host).render(
    <StrictMode>
      <Viewer head={head} modes={modes} />
    </StrictMode>,
  );
}

export function Viewer({ head, modes }: { head: Element; modes: Element }) {
  const title = useStore(viewer, (s) => s.title);
  const mode = useStore(viewer, (s) => s.mode);
  const reading = mode === "view" && viewOf(title) === "reading";
  return (
    <>
      {createPortal(<Where />, head)}
      {createPortal(<Modes />, modes)}
      <Source hidden={reading} />
      {viewOf(title) === "reading" && <Reading hidden={!reading} />}
    </>
  );
}

const useEdits = () => {
  const opened = useStore(viewer, (s) => s.opened);
  return useStore(project, (s) => (opened ? s.touched.get(opened) : undefined));
};

function Where() {
  const title = useStore(viewer, (s) => s.title) || "Ningún fichero abierto";
  const edits = useEdits();
  return (
    <>
      <span className="where" title={title}>
        {title}
      </span>
      <span className="marks">
        {edits && (
          <>
            <span className="plus">+{edits.plus}</span>
            <span className="minus">−{edits.minus}</span>
          </>
        )}
      </span>
    </>
  );
}

function Modes() {
  const title = useStore(viewer, (s) => s.title);
  const mode = useStore(viewer, (s) => s.mode);
  const kind = viewOf(title);
  if (!kind) return null;
  return (
    <div className="segment">
      <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>
        Código
      </button>
      <button type="button" aria-pressed={kind === "reading" && mode === "view"} onClick={() => setMode("view")}>
        Vista
      </button>
    </div>
  );
}

// Each text opens at its top, or at the first line the agent added.
function useOpensAtTop<Box extends HTMLElement>() {
  const box = useRef<Box>(null);
  const shown = useStore(viewer, (s) => s.shown);
  useLayoutEffect(() => {
    if (!box.current) return;
    box.current.scrollTop = 0;
    box.current.querySelector('[data-touched="add"]')?.scrollIntoView({ block: "center" });
  }, [shown]);
  return box;
}

// The text as code, with its line numbers and the lines the agent added,
// colored as VS Code colors its language.
function Source({ hidden }: { hidden: boolean }) {
  const title = useStore(viewer, (s) => s.title);
  const text = useStore(viewer, (s) => s.text);
  const shown = useStore(viewer, (s) => s.shown);
  const edits = useEdits();
  const box = useOpensAtTop<HTMLDivElement>();
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const code = useMemo(() => lines.join("\n"), [lines]);
  const language = useMemo(() => languageOf(title, text.slice(0, 200)), [title, text]);
  const painted = usePainted(code, language);
  const colored = painted?.lines.length === lines.length ? painted : null;

  const blocks = [];
  for (let from = 0; from < lines.length; from += BLOCK) {
    blocks.push(<Block key={`${shown}/${from}`} from={from} lines={lines} colored={colored} edits={edits} />);
  }
  return (
    <div className="source" ref={box} hidden={hidden}>
      {title ? blocks : <p className="empty">Elige un fichero.</p>}
    </div>
  );
}

// Lines are drawn a block at a time, as the block comes near the screen, so a
// file of thousands of lines opens at once: until then a block only holds its
// height. The first one, and those with the agent's lines, are drawn at once.
const BLOCK = 200;

interface BlockProps {
  from: number;
  lines: string[];
  colored: Painted | null;
  edits?: Edits;
}

const Block = memo(function Block({ from, lines, colored, edits }: BlockProps) {
  const box = useRef<HTMLDivElement>(null);
  const to = Math.min(from + BLOCK, lines.length);
  const touched = edits ? [...edits.add].some((line) => line > from && line <= to) : false;
  const seen = useSeen(box, { root: () => box.current?.closest(".source") ?? null, margin: "1500px 0px", now: from === 0 || touched });
  if (!seen) return <div className="block" ref={box} style={{ height: `calc(var(--line) * ${to - from})` }} />;

  const rows = [];
  for (let at = from; at < to; at++) {
    rows.push(<Line key={at} number={at + 1} runs={colored?.lines[at] ?? lines[at]} looks={colored?.looks} added={edits?.add.has(at + 1) ?? false} />);
  }
  return (
    <div className="block" ref={box}>
      {rows}
    </div>
  );
});

const Line = memo(function Line({ number, runs, looks, added }: { number: number; runs: Runs | string; looks?: Look[]; added: boolean }) {
  return (
    <div className="line" data-touched={added ? "add" : undefined}>
      <span className="num">{number}</span>
      <span className="src">
        {typeof runs === "string"
          ? runs
          : runs.map(([text, look], at) => (look < 0 ? text : <span key={at} style={looks![look]}>{text}</span>))}
      </span>
    </div>
  );
});

function Reading({ hidden }: { hidden: boolean }) {
  const text = useStore(viewer, (s) => s.text);
  const box = useOpensAtTop<HTMLDivElement>();
  return (
    <div className="reading" ref={box} hidden={hidden}>
      <Markdown text={text.replace(FRONT_MATTER, "")} />
    </div>
  );
}
