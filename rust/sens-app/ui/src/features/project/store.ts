import { createStore } from "zustand/vanilla";

// The project open in Sens. app.js still decides it and mirrors it here until
// the rail and the chat move; the React zones only read it.
export const project = createStore(() => ({ root: "" }));
