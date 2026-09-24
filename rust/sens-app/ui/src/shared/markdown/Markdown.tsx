import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import { ICONS } from "../icons.js";
import { openOutside } from "../outside";
import { languageNamed } from "../syntax/languages";
import { usePainted } from "../syntax/paint";
import { parse, type Block, type Inline, type List } from "./parse";

// Text that just arrived fades in: each stamp says where a new stretch began
// (in characters of shown text) and when.
export interface Fade {
  stamps: { from: number; time: number }[];
  now: number;
}

// Where the renderer is in the shown text, for the fade.
interface Cursor {
  at: number;
  fade?: Fade;
}

export function Markdown({ text, fade, className }: { text: string; fade?: Fade; className?: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  const cursor: Cursor = { at: 0, fade };
  return <div className={className ? `prose ${className}` : "prose"}>{blocks.map((block, at) => <Fragment key={at}>{renderBlock(block, cursor)}</Fragment>)}</div>;
}

function renderBlock(block: Block, cursor: Cursor): ReactNode {
  switch (block.kind) {
    case "p":
      return <p>{spell(block.inline, cursor)}</p>;
    case "h": {
      const Heading = `h${block.level}` as "h1";
      return <Heading>{spell(block.inline, cursor)}</Heading>;
    }
    case "quote":
      return <blockquote>{spell(block.inline, cursor)}</blockquote>;
    case "hr":
      return <hr />;
    case "code":
      cursor.at += block.text.length;
      return <CodeBlock text={block.text} language={block.language} />;
    case "table":
      return (
        <div className="table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, at) => (
                  <th key={at}>{spell(cell, cursor)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) => (
                    <td key={column}>{spell(cell, cursor)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list":
      return renderList(block, cursor);
  }
}

function renderList(list: List, cursor: Cursor) {
  const items = list.items.map((item, at) => <li key={at}>{spell(item, cursor)}</li>);
  return list.ordered ? <ol start={list.start}>{items}</ol> : <ul>{items}</ul>;
}

function spell(nodes: (Inline | List)[], cursor: Cursor) {
  return nodes.map((node, at) => <Fragment key={at}>{renderInline(node, cursor)}</Fragment>);
}

function renderInline(node: Inline | List, cursor: Cursor): ReactNode {
  switch (node.kind) {
    case "text":
      return faded(node.text, cursor);
    case "code":
      return <code>{faded(node.text, cursor)}</code>;
    case "strong":
      return <strong>{spell(node.children, cursor)}</strong>;
    case "em":
      return <em>{spell(node.children, cursor)}</em>;
    case "link":
      return (
        <a
          href={node.url}
          title={node.url}
          onClick={(event) => {
            event.preventDefault();
            openOutside(node.url);
          }}
        >
          {spell(node.children, cursor)}
        </a>
      );
    case "list":
      return renderList(node, cursor);
  }
}

// A stretch of text, cut where the fade's stamps fall inside it: what came
// after a stamp fades in as far along as its age says.
function faded(text: string, cursor: Cursor): ReactNode {
  const start = cursor.at;
  const end = start + text.length;
  cursor.at = end;
  const stamps = cursor.fade?.stamps ?? [];
  if (!stamps.length || end <= stamps[0].from) return text;
  const bounds = [start, ...stamps.map((stamp) => stamp.from).filter((at) => at > start && at < end), end];
  return bounds.slice(0, -1).map((from, at) => {
    const piece = text.slice(from - start, bounds[at + 1] - start);
    const stamp = stamps.findLast((one) => one.from <= from);
    if (!stamp) return piece;
    return (
      <span key={at} className="fresh" style={{ animationDelay: `-${Math.round(cursor.fade!.now - stamp.time)}ms` }}>
        {piece}
      </span>
    );
  });
}

// Longer blocks than this show folded until asked.
const CODE_FOLD = 30;

const TONGUES: Record<string, string> = {
  js: "amber", mjs: "amber", cjs: "amber", jsx: "amber", json: "amber",
  zig: "amber", jsonc: "amber", json5: "amber",
  ts: "azure", tsx: "azure", mts: "azure", cts: "azure", css: "azure", scss: "azure", sass: "azure", less: "azure",
  vue: "azure", svelte: "azure", c: "azure", h: "azure", cc: "azure", cpp: "azure", hpp: "azure", cxx: "azure",
  lua: "azure", dart: "azure", r: "azure",
  rs: "ember", rust: "ember", toml: "ember", sh: "ember", bash: "ember", zsh: "ember", fish: "ember",
  shell: "ember", ps1: "ember", psm1: "ember", powershell: "ember", pwsh: "ember", bat: "ember", cmd: "ember",
  java: "ember", swift: "ember", scala: "ember", erl: "ember",
  py: "moss", python: "moss", pyi: "moss", ipynb: "moss", go: "moss", sql: "moss", rb: "moss", ruby: "moss",
  clj: "moss", csv: "moss", tsv: "moss",
  html: "iris", htm: "iris", md: "iris", markdown: "iris", mdx: "iris", yaml: "iris", yml: "iris", xml: "iris", svg: "iris",
  php: "iris", cs: "iris", kt: "iris", kts: "iris", ex: "iris", exs: "iris", hs: "iris", graphql: "iris", gql: "iris",
  diff: "stone", patch: "stone", txt: "stone", log: "stone", ini: "stone", cfg: "stone", conf: "stone", env: "stone",
  dockerfile: "stone", proto: "stone", lock: "stone",
};

// A fenced block: its language, a copy button, and its code colored.
export function CodeBlock({ text, language = "" }: { text: string; language?: string }) {
  const painted = usePainted(text, languageNamed(language));
  const lines = text.split("\n").length;
  const [unfolded, setUnfolded] = useState(false);
  const folded = lines > CODE_FOLD && !unfolded;

  return (
    <div className="codeblock" data-tongue={TONGUES[language.toLowerCase()]} data-folded={lines > CODE_FOLD ? String(folded) : undefined}>
      <div className="codeblock-head">
        <span className="tongue" />
        <span>{language || "código"}</span>
        <CopyButton text={text} />
      </div>
      <pre>
        <code>
          {painted
            ? painted.lines.map((runs, at) => (
                <Fragment key={at}>
                  {at > 0 && "\n"}
                  {runs.map(([piece, look], run) => (look < 0 ? piece : <span key={run} style={painted.looks[look]}>{piece}</span>))}
                </Fragment>
              ))
            : text}
        </code>
      </pre>
      {folded && (
        <button className="unfold" type="button" onClick={() => setUnfolded(true)}>
          Mostrar las {lines} líneas
        </button>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [fault, setFault] = useState("");

  useEffect(() => {
    if (!copied) return;
    const back = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(back);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (reason) {
      setFault(String(reason));
    }
  }

  return (
    <button className="copy" type="button" title={fault || "Copiar"} aria-label="Copiar" onClick={copy}>
      <Icon svg={copied ? ICONS.check : ICONS.copy} />
    </button>
  );
}
