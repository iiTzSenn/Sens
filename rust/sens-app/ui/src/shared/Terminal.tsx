import { Fragment, useMemo, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from "react";
import { controlled, cssOf, lines, plain, rgbOf, type Color, type Run, type Style } from "./ansi";
import { cueOf, hunkOf, marksOf, shapeOf, within, type Mark, type Shape } from "./output";
import { openOutside } from "./outside";
import { colored } from "./syntax/colored";
import { useCode } from "./syntax/code";
import { grammarOf, promptOf, shellOf, type Shell } from "./syntax/shells";

type Opener = (path: string) => void;

const DRAWN = 120_000;
const MARKED_LINE = 2_000;
const WEB = /^https?:\/\//i;

// A command and what it printed, as a terminal shows it. `state` is set once
// the command ran.
export function Terminal({
  command,
  shell,
  output,
  state,
  foot = "",
  outRef,
  open,
}: {
  command: string;
  shell?: Shell;
  output?: ReactNode;
  state?: "done" | "failed";
  foot?: string;
  outRef?: Ref<HTMLPreElement>;
  open?: Opener;
}) {
  const text = command.replace(/\r\n?/g, "\n");
  const tongue = shell ?? shellOf("", text);
  const shown = typeof output === "string" ? output && <Printed text={output} open={open} /> : output;
  return (
    <div className="terminal" data-state={state} data-shell={tongue}>
      <div className="terminal-command">
        <span className="prompt">{promptOf(tongue)}</span>
        <span className="command">
          <Command text={text} shell={tongue} />
        </span>
      </div>
      <pre className="terminal-output" ref={outRef} hidden={!shown}>
        {shown}
      </pre>
      {foot && <div className="terminal-foot">{foot}</div>}
    </div>
  );
}

export function Command({ text, shell, cap = Infinity }: { text: string; shell: Shell; cap?: number }) {
  const head = text.length > cap ? text.slice(0, cap) : text;
  const painted = useCode(head, grammarOf(shell));
  return (
    <>
      {painted ? colored(painted) : head}
      {text.slice(head.length)}
    </>
  );
}

export function Printed({ text, open }: { text: string; open?: Opener }) {
  const flat = text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text;
  const shape = useMemo(() => (controlled(flat) ? "text" : shapeOf(flat)), [flat]);
  const json = useCode(shape === "json" ? flat : "", "json");
  const drawn = useMemo(() => (shape === "json" ? null : draw(flat, shape, open)), [flat, shape, open]);
  return <>{json ? colored(json) : (drawn ?? flat)}</>;
}

function draw(text: string, shape: Shape, open?: Opener): ReactNode {
  const cut = text.length > DRAWN ? text.lastIndexOf("\n", DRAWN) + 1 || DRAWN : text.length;
  const head = text.slice(0, cut);
  const rows: Run[][] = controlled(head) ? lines(head) : head.split("\n").map((line) => (line ? [[line, null]] : []));
  const styled = rows.some((row) => row.some(([, style]) => style));
  const rest = text.slice(cut);
  return (
    <>
      {rows.map((row, at) => {
        const line = row.map(([piece]) => piece).join("");
        const kind = shape === "diff" ? hunkOf(line) : styled ? "" : cueOf(line);
        const inside = marked(row, line.length > MARKED_LINE ? [] : marksOf(line, Boolean(open)), open);
        return (
          <Fragment key={at}>
            {at > 0 && "\n"}
            {kind ? <span className={shape === "diff" ? `diff-${kind}` : `cue-${kind}`}>{inside}</span> : inside}
          </Fragment>
        );
      })}
      {rest && plain(rest)}
    </>
  );
}

function marked(row: Run[], marks: Mark[], open?: Opener): ReactNode[] {
  if (!marks.length) return row.map(runNode);
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const mark of marks) {
    nodes.push(...within(row, at, mark.from).map(runNode));
    const inside = within(row, mark.from, mark.to).map(runNode);
    nodes.push(
      mark.url ? (
        <a key={`mark${mark.from}`} href={mark.url} title={mark.url} onClick={(event) => web(event, mark.url!)}>
          {inside}
        </a>
      ) : (
        <button key={`mark${mark.from}`} type="button" className="place" title={mark.path} onClick={() => open?.(mark.path!)}>
          {inside}
        </button>
      ),
    );
    at = mark.to;
  }
  nodes.push(...within(row, at, Infinity).map(runNode));
  return nodes.map((node, spot) => <Fragment key={spot}>{node}</Fragment>);
}

const colorOf = (color: Color): string => (typeof color === "number" && color < 16 ? cssOf(color) : `rgb(${(typeof color === "number" ? rgbOf(color) : color).join(" ")})`);

const rich = (color?: Color) => color !== undefined && (typeof color !== "number" || color >= 16);

function lookOf(style: Style): { className?: string; css: CSSProperties } {
  const fg = style.inverse ? (style.bg ?? "ground") : style.fg;
  const bg = style.inverse ? (style.fg ?? "text") : style.bg;
  const css: Record<string, string> = {};
  const names: string[] = [];
  if (fg === "ground") css.color = "var(--ground)";
  else if (fg !== undefined && rich(fg)) {
    css["--fg"] = colorOf(fg);
    names.push("ansi-rgb");
  } else if (fg !== undefined) css.color = colorOf(fg);
  if (bg === "text") css.background = "var(--dim)";
  else if (bg !== undefined) css.background = colorOf(bg);
  if (style.bold) names.push("ansi-bold");
  if (style.dim) names.push("ansi-dim");
  if (style.italic) names.push("ansi-italic");
  if (style.underline || style.strike) css.textDecorationLine = [style.underline && "underline", style.strike && "line-through"].filter(Boolean).join(" ");
  if (style.hidden) names.push("ansi-hidden");
  return { className: names.join(" ") || undefined, css: css as CSSProperties };
}

function runNode([piece, style]: Run, at: number): ReactNode {
  if (!style) return <Fragment key={at}>{piece}</Fragment>;
  const { className, css } = lookOf(style);
  const span = (
    <span key={at} className={className} style={css}>
      {piece}
    </span>
  );
  if (!style.link || !WEB.test(style.link)) return span;
  return (
    <a key={at} href={style.link} title={style.link} onClick={(event) => web(event, style.link!)}>
      {span}
    </a>
  );
}

function web(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();
  openOutside(url);
}
