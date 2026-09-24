import { createStore } from "zustand/vanilla";

// The project open in Sens, and the files the agent edited in this session.
// app.js still decides both and mirrors them here until the rail and the chat
// move; the React zones only read them.
export const project = createStore(() => ({
  root: "",
  touched: new Set<string>(),
}));

export const noteTouched = (paths: Iterable<string>) => project.setState({ touched: new Set(paths) });
