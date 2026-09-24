// What `git diff` says, file by file, as the changes panel lists it.

import type { Hunk } from "../../shared/rows";

export type { Hunk };

export interface DiffFile {
  path: string;
  from: string;
  state: "A" | "M" | "D" | "R";
  hunks: Hunk[];
  plus: number;
  minus: number;
  binary: boolean;
  // Untracked: git has no diff for it, so its lines are read when unfolded.
  fresh: boolean;
}

function diffPath(text: string) {
  const clean = text.replace(/\t.*$/, "");
  return clean === "/dev/null" ? "" : clean.replace(/^[ab]\//, "");
}

// `a/x b/x` from the `diff --git` line: the path is the first half.
function diffedFile(pair: string): DiffFile {
  return {
    path: pair.slice(2, 2 + Math.floor((pair.length - 5) / 2)),
    from: "",
    state: "M",
    hunks: [],
    plus: 0,
    minus: 0,
    binary: false,
    fresh: false,
  };
}

export const freshFile = (path: string): DiffFile => ({
  path,
  from: "",
  state: "A",
  hunks: [],
  plus: 0,
  minus: 0,
  binary: false,
  fresh: true,
});

function readHeader(file: DiffFile, line: string) {
  if (line.startsWith("new file")) file.state = "A";
  else if (line.startsWith("deleted file")) file.state = "D";
  else if (line.startsWith("rename from ")) [file.state, file.from] = ["R", line.slice(12)];
  else if (line.startsWith("rename to ")) file.path = line.slice(10);
  else if (line.startsWith("+++ ")) file.path = diffPath(line.slice(4)) || file.path;
  else if (line.startsWith("Binary files")) file.binary = true;
}

export function diffedFiles(diff: string) {
  const found: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  for (const line of diff.split("\n").map((raw) => raw.replace(/\r$/, ""))) {
    if (line.startsWith("diff --git ")) {
      file = diffedFile(line.slice(11));
      found.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const head = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (head) {
      hunk = { oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] };
      file.hunks.push(hunk);
    } else if (!hunk) {
      readHeader(file, line);
    } else if (/^[ +-]/.test(line)) {
      hunk.lines.push(line);
      if (line[0] === "+") file.plus++;
      if (line[0] === "-") file.minus++;
    }
  }
  return found;
}
