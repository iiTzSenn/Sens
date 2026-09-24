import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Link, Todo } from "../../ipc/types";
import { FoldedText } from "../../shared/Folded";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { LinesCard } from "../../shared/LinesCard";
import { openOutside } from "../../shared/outside";
import { languageOf } from "../../shared/syntax/languages";
import { Terminal } from "../../shared/Terminal";
import { project } from "../project/store";
import { showFile } from "../files/view";
import { aimSite } from "../web/store";
import { SHELLS, describe, editOf, hitsOf, hostOf, relative, searchSummary } from "./looks";
import type { Step as StepPart } from "./turns";

// Diffs in the chat show this many rows until asked for more.
export const DIFF_PREVIEW = 14;
// Search results, this many.
const RESULT_CAP = 12;
const STRIP_CAP = 4;
const FAVICONS = "https://icons.duckduckgo.com/ip3/";

// A tool call: a line saying what it does, opening to what it did. A step with
// nothing to show does not open; a failed one opens by itself.
export function Step({ part }: { part: StepPart }) {
  const { name, input, state, links } = part;
  const look = describe(name, input);
  const box = useRef<HTMLDetailsElement>(null);
  const shown = outcome(part);
  const body = [links.length > 0 && <Sources key="sources" links={links} />, ...(shown.nodes ?? [])].filter(Boolean);
  if (name === "TodoWrite" && state === "running") body.push(<TodoList key="todos" todos={input.todos} />);
  const empty = body.length === 0;

  useEffect(() => {
    if (state === "failed" && box.current) box.current.open = true;
  }, [state]);

  return (
    <details className={empty ? "step empty" : "step"} data-state={state} ref={box}>
      <summary onClick={(event) => empty && event.preventDefault()}>
        <span className="step-icon">{look.site ? <Favicon url={look.site} /> : <Icon svg={look.icon} />}</span>
        <span className="step-verb">{look.verb}</span>
        {look.link ? (
          <button
            type="button"
            className={look.mono ? "step-target mono" : "step-target"}
            title={look.target}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              showFile(look.link!);
            }}
          >
            {look.target}
          </button>
        ) : (
          <span className={look.mono ? "step-target mono" : "step-target"} title={look.target}>
            {look.target}
          </span>
        )}
        <Strip links={links} />
        <span className="step-meta">{shown.meta ?? look.meta ?? ""}</span>
        <span className="step-state" />
      </summary>
      <div className="step-body">{body}</div>
    </details>
  );
}

// What a finished call shows, by tool: a terminal, a diff, results, a page.
function outcome({ name, input, state, output, detail }: StepPart): { nodes?: ReactNode[]; meta?: string } {
  if (state === "running" || state === "stopped") return {};
  const failed = state === "failed";
  if (SHELLS.has(name)) {
    const stdout = typeof detail?.stdout === "string" ? detail.stdout : output;
    const stderr = typeof detail?.stderr === "string" ? detail.stderr : "";
    return { nodes: [<Ran key="ran" command={String(input.command || "")} stdout={stdout} stderr={stderr} failed={failed} />] };
  }
  if (failed) return { nodes: [<Output key="out" text={output} bad />] };

  const edit = editOf(name, input, detail);
  if (edit) {
    const meta = detail?.type === "create" ? `+${edit.plus}` : `+${edit.plus} −${edit.minus}`;
    return { nodes: [<LinesCard key="diff" rows={edit.rows} preview={DIFF_PREVIEW} language={languageOf(edit.path, input.content || "")} />], meta };
  }
  if (name === "Read") {
    const lines = detail?.file?.numLines;
    return { nodes: [], meta: lines ? `${lines} líneas` : "" };
  }
  if (name === "Glob" || name === "Grep") {
    const lines = hitsOf(output);
    const count = name === "Glob" && detail?.numFiles !== undefined ? detail.numFiles : lines.length;
    return { nodes: lines.length ? [<Results key="hits" lines={lines} />] : [], meta: `${count} ${count === 1 ? "resultado" : "resultados"}` };
  }
  if (name === "TodoWrite") return { nodes: [<TodoList key="todos" todos={input.todos} />] };
  if (name === "WebFetch") {
    return { nodes: [<WebLink key="link" url={String(input.url || "")} />, output.trim() && <FoldedText key="page" text={output} />].filter(Boolean) as ReactNode[] };
  }
  if (name === "WebSearch") {
    const summary = searchSummary(output);
    return { nodes: summary ? [<FoldedText key="summary" text={summary} />] : [] };
  }
  if (name === "Task" || name === "Agent") return { nodes: output.trim() ? [<FoldedText key="said" text={output} />] : [] };
  return { nodes: output.trim() ? [<Output key="out" text={output} />] : [] };
}

const SILENCE = /^\(\w+ completed with no output\)$/;

// A command's run: stdout, then stderr in red; a line when it failed or said nothing.
export function Ran({ command, stdout, stderr, failed }: { command: string; stdout?: string; stderr?: string; failed?: boolean }) {
  const ran = stdout !== undefined;
  const out = ran && !SILENCE.test(stdout.trim()) ? stdout.replace(/\s+$/, "") : "";
  const err = (stderr || "").replace(/\s+$/, "");
  const said = !ran ? "" : failed ? "Terminó con error" : out || err ? "" : "Sin salida";
  const output =
    out || err ? (
      <>
        {out}
        {out && err && "\n"}
        {err && <span className="stderr">{err}</span>}
      </>
    ) : undefined;
  return <Terminal command={command} output={output} state={!ran ? undefined : failed ? "failed" : "done"} foot={said} />;
}

const Output = ({ text, bad = false }: { text: string; bad?: boolean }) => (
  <pre className={bad ? "out fault" : "out"}>{String(text || "").replace(/\s+$/, "")}</pre>
);

const TODO_ICON = { completed: ICONS.check, in_progress: ICONS.dot, pending: ICONS.circle };

function TodoList({ todos = [] }: { todos?: Todo[] }) {
  return (
    <ul className="todos">
      {todos.map((todo, at) => (
        <li key={at} data-status={todo.status}>
          <Icon svg={TODO_ICON[todo.status] || TODO_ICON.pending} />
          <span>{todo.status === "in_progress" ? todo.activeForm || todo.content : todo.content}</span>
        </li>
      ))}
    </ul>
  );
}

// `path:line:text` lines open the file; anything that looks like a path does too.
function Results({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false);
  const root = project.getState().root;
  return (
    <div className="results">
      {(all ? lines : lines.slice(0, RESULT_CAP)).map((line, at) => {
        const hit = line.match(/^(.+?):(\d+)[:-](.*)$/);
        const path = relative(hit ? hit[1] : line.trim());
        const opens = Boolean(root) && !/\s{2,}/.test(path) && /[\\/.]/.test(path);
        const inside = (
          <>
            <span className="path">{path}</span>
            {hit && <span className="at">{hit[2]}</span>}
            {hit && <span className="hit">{hit[3].trim()}</span>}
          </>
        );
        return opens ? (
          <button key={at} type="button" className="result" title={line} onClick={() => showFile(path)}>
            {inside}
          </button>
        ) : (
          <div key={at} className="result" title={line}>
            {inside}
          </div>
        );
      })}
      {!all && lines.length > RESULT_CAP && (
        <button className="unfold" type="button" onClick={() => setAll(true)}>
          Mostrar {lines.length - RESULT_CAP} más
        </button>
      )}
    </div>
  );
}

export function WebLink({ url }: { url: string }) {
  return (
    <button type="button" className="weblink" title={url} onClick={() => openOutside(url)}>
      <Icon svg={ICONS.link} />
      <span>{url}</span>
    </button>
  );
}

// A site's icon, or the globe until it loads (or when it never does).
function Favicon({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  return (
    <span className="favicon">
      {!loaded && <Icon svg={ICONS.globe} />}
      {host && <img alt="" referrerPolicy="no-referrer" src={`${FAVICONS}${host}.ico`} hidden={!loaded} onLoad={() => setLoaded(true)} />}
    </span>
  );
}

// The sites a search consulted: their icons on the line, the list inside.
function Strip({ links }: { links: Link[] }) {
  if (!links.length) return <span className="sources" hidden />;
  return (
    <span className="sources" title={links.map((link) => hostOf(link.url)).join(" · ")}>
      {links.slice(0, STRIP_CAP).map((link) => (
        <Favicon key={link.url} url={link.url} />
      ))}
      {links.length > STRIP_CAP && <span className="more">+{links.length - STRIP_CAP}</span>}
    </span>
  );
}

function Sources({ links }: { links: Link[] }) {
  return (
    <div className="results">
      {links.map((link) => (
        <button key={link.url} type="button" className="result cited" title={link.url} onClick={() => aimSite(link.url)}>
          <Favicon url={link.url} />
          <span className="path">{link.title || hostOf(link.url)}</span>
          <span className="hit">{hostOf(link.url)}</span>
        </button>
      ))}
    </div>
  );
}
