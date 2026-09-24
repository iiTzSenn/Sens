// A diff as the rows a card draws: removed, added and context lines with the
// number each has in its file, and a gap between hunks.

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export type RowKind = "add" | "del" | "" | "gap";

export interface Row {
  kind: RowKind;
  num?: number;
  text: string;
}

// Context and added rows count in the file after, removed ones in the file
// before. `added` lists the new lines, for the viewer to mark.
export function patchRows(hunks: Hunk[]) {
  const rows: Row[] = [];
  const added: number[] = [];
  let plus = 0;
  let minus = 0;
  for (const hunk of hunks) {
    if (rows.length) rows.push({ kind: "gap", text: "" });
    let before = hunk.oldStart;
    let after = hunk.newStart;
    for (const line of hunk.lines) {
      const text = line.slice(1);
      if (line[0] === "+") {
        rows.push({ kind: "add", num: after, text });
        added.push(after++);
        plus++;
      } else if (line[0] === "-") {
        rows.push({ kind: "del", num: before++, text });
        minus++;
      } else if (line[0] === " ") {
        rows.push({ kind: "", num: after, text });
        before++;
        after++;
      }
    }
  }
  return { rows, plus, minus, added };
}

// A new file: every line added.
export const addedRows = (text: string): Row[] => String(text).split("\n").map((line, at) => ({ kind: "add", num: at + 1, text: line }));

// A replacement asked for, before it happens: no line numbers yet.
export const replacedRows = (before: string, after: string): Row[] => [
  ...String(before).split("\n").map((text): Row => ({ kind: "del", text })),
  ...String(after).split("\n").map((text): Row => ({ kind: "add", text })),
];
