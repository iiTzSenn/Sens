import type { Pane } from "../panes/store";

interface Walk {
  at: number;
  draft: string;
  shown: string;
}

const walks = new WeakMap<Pane, Walk>();

const COPIED = [
  "box-sizing",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "text-transform",
  "text-indent",
  "tab-size",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

export function asked(pane: Pane) {
  const said: string[] = [];
  const { turns } = pane.chat.getState();
  for (let at = turns.length - 1; at >= 0; at--) {
    const turn = turns[at];
    if (turn.kind !== "you" || !turn.text.trim() || said.at(-1) === turn.text) continue;
    said.push(turn.text);
  }
  return said;
}

export function recall(pane: Pane, older: boolean): string | null {
  const text = pane.desk.getState().text;
  const was = walks.get(pane);
  const walk = was && was.at >= 0 && was.shown === text ? was : { at: -1, draft: text, shown: text };
  const said = asked(pane);
  const at = walk.at + (older ? 1 : -1);
  if (at < -1 || at >= said.length) return null;
  const shown = at === -1 ? walk.draft : said[at];
  walks.set(pane, { at, draft: walk.draft, shown });
  return shown;
}

function rowOf(field: HTMLTextAreaElement, at: number) {
  const style = getComputedStyle(field);
  const line = parseFloat(style.lineHeight);
  if (!line || !field.clientWidth) return 0;
  const mirror = document.createElement("div");
  for (const name of COPIED) mirror.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", boxSizing: "border-box", width: `${field.clientWidth}px`, whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  mirror.textContent = field.value.slice(0, at);
  const mark = mirror.appendChild(document.createElement("span"));
  mark.textContent = "​";
  document.body.appendChild(mirror);
  const row = Math.round((mark.offsetTop - parseFloat(style.paddingTop || "0")) / line);
  mirror.remove();
  return row;
}

export function onEdge(field: HTMLTextAreaElement, older: boolean) {
  const { selectionStart: from, selectionEnd: to, value } = field;
  if (from !== to) return false;
  if (older) return !value.slice(0, from).includes("\n") && rowOf(field, from) === 0;
  return !value.slice(from).includes("\n") && rowOf(field, from) === rowOf(field, value.length);
}
