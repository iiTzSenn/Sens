import { createStore } from "zustand/vanilla";

// What the agent changed in a file this session: the lines it added, and how
// many it added and removed.
export interface Edits {
  add: Set<number>;
  plus: number;
  minus: number;
}

// The project open in Sens, and the files the agent edited in this session.
// app.js still decides both until the rail and the chat move; the React zones
// only read them.
export const project = createStore(() => ({
  root: "",
  touched: new Map<string, Edits>(),
}));

export function noteEdit({ path, lines, plus, minus }: { path: string; lines: number[]; plus: number; minus: number }) {
  project.setState(({ touched }) => {
    const known = touched.get(path);
    const edits = {
      add: new Set([...(known?.add ?? []), ...lines]),
      plus: (known?.plus ?? 0) + plus,
      minus: (known?.minus ?? 0) + minus,
    };
    return { touched: new Map(touched).set(path, edits) };
  });
}

export const forgetEdits = () => project.setState({ touched: new Map() });
