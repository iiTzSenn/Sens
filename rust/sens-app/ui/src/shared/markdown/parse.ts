// The Markdown the chat speaks, as a tree: the subset models write (headings,
// lists, fences, tables, quotes, rules, inline code, emphasis and links),
// nothing that would need HTML.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] };

export interface List {
  kind: "list";
  ordered: boolean;
  start?: number;
  // Each item: its text, and the lists nested under it, in order.
  items: (Inline | List)[][];
}

export type Block =
  | { kind: "p"; inline: Inline[] }
  | { kind: "h"; level: number; inline: Inline[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "hr" }
  | { kind: "quote"; inline: Inline[] }
  | List;

export const FENCE = /^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/;
const HEAD = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const INLINE = /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|(?<!\w)_(?!\s)(.+?)_(?!\w)|!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;
const WEB = /^https?:\/\//i;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;

// Only web addresses become links; any other target leaves its label as text.
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const plain = (piece: string) => piece && out.push({ kind: "text", text: piece });
  let last = 0;
  for (const found of text.matchAll(INLINE)) {
    const [all, , code, strong, underStrong, em, underEm, label, url] = found;
    plain(text.slice(last, found.index));
    if (code !== undefined) out.push({ kind: "code", text: code });
    else if (strong !== undefined || underStrong !== undefined) out.push({ kind: "strong", children: inline(strong ?? underStrong) });
    else if (em !== undefined || underEm !== undefined) out.push({ kind: "em", children: inline(em ?? underEm) });
    else if (WEB.test(url)) out.push({ kind: "link", url, children: inline(label || url) });
    else out.push(...inline(label));
    last = found.index + all.length;
  }
  plain(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => inline(cell.trim()));

// Lists nest by indentation: a deeper item opens a list inside the item above
// it, a shallower one closes lists until one is as shallow.
function listInto(lists: { depth: number; list: List }[], page: Block[], item: RegExpMatchArray) {
  const [, indent, bullet, number, text] = item;
  const depth = indent.replace(/\t/g, "    ").length;
  const ordered = !bullet;
  while (lists.length && depth < lists.at(-1)!.depth) lists.pop();

  let top = lists.at(-1);
  if (!top || depth > top.depth || top.list.ordered !== ordered) {
    const list: List = { kind: "list", ordered, items: [] };
    if (number) list.start = Number(number);
    const deeper = top && depth > top.depth;
    if (top && !deeper) lists.pop();
    const parent = deeper ? top!.list.items.at(-1) : lists.at(-1)?.list.items.at(-1);
    (parent ?? page).push(list);
    top = { depth, list };
    lists.push(top);
  }
  top.list.items.push(inline(text));
}

export function parse(source: string): Block[] {
  const page: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let words: string[] = [];
  let lists: { depth: number; list: List }[] = [];

  const paragraph = () => {
    if (words.length) page.push({ kind: "p", inline: inline(words.join(" ")) });
    words = [];
  };
  const settle = () => {
    paragraph();
    lists = [];
  };

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const fence = line.match(FENCE);
    if (fence) {
      settle();
      const code = [];
      while (++at < lines.length && !lines[at].trim().startsWith(fence[1])) code.push(lines[at]);
      page.push({ kind: "code", language: fence[2], text: code.join("\n") });
      continue;
    }
    const head = line.match(HEAD);
    if (head) {
      settle();
      page.push({ kind: "h", level: head[1].length, inline: inline(head[2]) });
      continue;
    }
    if (ROW.test(line) && RULE.test(lines[at + 1] || "")) {
      settle();
      const rows = [line, lines[++at]];
      while (ROW.test(lines[at + 1] || "")) rows.push(lines[++at]);
      page.push({ kind: "table", head: cells(rows[0]), rows: rows.slice(2).map(cells) });
      continue;
    }
    if (BREAK.test(line)) {
      settle();
      page.push({ kind: "hr" });
      continue;
    }
    const quote = line.match(QUOTE);
    if (quote) {
      settle();
      const said = [quote[1]];
      while (QUOTE.test(lines[at + 1] || "")) said.push(lines[++at].match(QUOTE)![1]);
      page.push({ kind: "quote", inline: inline(said.join(" ")) });
      continue;
    }
    const item = line.match(ITEM);
    if (item) {
      paragraph();
      listInto(lists, page, item);
      continue;
    }
    if (!line.trim()) {
      paragraph();
      continue;
    }
    if (lists.length && /^\s+\S/.test(line)) {
      lists.at(-1)!.list.items.at(-1)!.push({ kind: "text", text: " " }, ...inline(line.trim()));
      continue;
    }
    lists = [];
    words.push(line.trim());
  }
  settle();
  return page;
}

// A text being written arrives cut anywhere: a link half typed, a code span or
// emphasis still open. Mended, it draws as it will once finished. A fence
// still open is left as it is.
export function mended(source: string) {
  const fences = source.split("\n").filter((line) => FENCE.test(line)).length;
  if (fences % 2) return source;
  let text = source.replace(/!?\[([^\]]*)\]\([^)]*$/, "$1").replace(/!?\[([^\]\n]*)$/, "$1");
  if ((text.match(/`/g) || []).length % 2) text += "`";
  const bare = text.replace(/`[^`]*`/g, "");
  const closers = [];
  if ((bare.replace(/\*\*/g, "").replace(/^\s*\*\s/gm, "").match(/\*/g) || []).length % 2) closers.push("*");
  if ((bare.match(/\*\*/g) || []).length % 2) closers.push("**");
  if ((bare.match(/__/g) || []).length % 2) closers.push("__");
  return text + closers.join("");
}

// A reply split where the page may be cut without changing how it reads:
// at blank lines outside fences.
export function splitBlocks(text: string) {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const marker = line.match(FENCE);
    if (marker) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : marker[1];
    if (!fence && !marker && !line.trim()) {
      if (lines.length) blocks.push(lines.join("\n"));
      lines = [];
      continue;
    }
    lines.push(line);
  }
  if (lines.length) blocks.push(lines.join("\n"));
  return blocks;
}

// How much text a tree shows, the way the fade counts it.
export function textLength(blocks: Block[]): number {
  const ofInline = (nodes: (Inline | List)[]): number =>
    nodes.reduce((sum, node) => sum + (node.kind === "text" || node.kind === "code" ? node.text.length : node.kind === "list" ? ofList(node) : ofInline(node.children)), 0);
  const ofList = (list: List) => list.items.reduce((sum, item) => sum + ofInline(item), 0);
  return blocks.reduce((sum, block) => {
    switch (block.kind) {
      case "p":
      case "h":
      case "quote":
        return sum + ofInline(block.inline);
      case "code":
        return sum + block.text.length;
      case "table":
        return sum + [block.head, ...block.rows].flat().reduce((cellSum, cell) => cellSum + ofInline(cell), 0);
      case "list":
        return sum + ofList(block);
      default:
        return sum;
    }
  }, 0);
}
