import type { View } from "../features/project/store";

// What the React zones still borrow from app.js while both run. app.js fills
// it in on start; each entry goes away when the zone that owns it moves.
export const legacy = {
  readAccount: async (): Promise<unknown> => undefined,
  refreshModels: (): void => {},
  // The shared dialog: `back` gets the focus when it closes.
  showPanel: (_title: string, _node: Node, _back?: HTMLElement): void => {},
  closePanel: (): void => {},
  panelReturnsTo: (_back: HTMLElement): void => {},
  // The tool panel on the right.
  showTool: (_tool: string): void => {},
  // A warning in the chat, as a notice line.
  warn: (_text: string): void => {},
  // The shared dialog, wide, for a picture.
  preview: (_title: string, _back: HTMLElement, _node: Node): void => {},
  // Opens a session of a project in the chat, or a new one (`fresh` in the
  // open project, asking for a folder when there is none).
  resume: (_home: string, _id: string): void => {},
  draft: async (_home: string): Promise<void> => {},
  fresh: (): void => {},
  chooseFolder: (): void => {},
  // Puts a view over the chat, or the chat back with "".
  showView: (_view: View): void => {},
  // What the composer knows, until it moves: a model's name, the branch, the
  // permission mode, and the usage limits the chat hears.
  modelName: (id: string): string => id,
  readRepo: async (): Promise<void> => {},
  chooseMode: (_mode: string): void => {},
  noteLimits: (_windows: Record<string, { utilization?: number }>): void => {},
  // Whether a tool panel is on screen.
  panelShows: (_tool: string): boolean => false,
};
