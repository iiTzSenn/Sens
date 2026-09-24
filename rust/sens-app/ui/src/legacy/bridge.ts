import type { View } from "../features/project/store";

// What the React zones still borrow from app.js while both run. app.js fills
// it in on start; each entry goes away when the zone that owns it moves.
export const legacy = {
  openUpdate: (_from: HTMLElement): void => {},
  readAccount: async (): Promise<unknown> => undefined,
  refreshModels: (): void => {},
  // The shared dialog: `back` gets the focus when it closes.
  showPanel: (_title: string, _node: Node, _back?: HTMLElement): void => {},
  closePanel: (): void => {},
  panelReturnsTo: (_back: HTMLElement): void => {},
  // Hides or places the native browser when something covers it.
  syncBrowser: (): void => {},
  // The markdown renderer the chat uses, until it moves too.
  prose: (_text: string): HTMLElement => document.createElement("div"),
  // The tool panel on the right, and a page of `home` in its web tool.
  showTool: (_tool: string): void => {},
  showSite: async (_path: string, _home: string): Promise<void> => {},
  outward: (_target: string): void => {},
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
  // The session open in the chat, and whether a tool panel is on screen.
  session: (): string => "",
  panelShows: (_tool: string): boolean => false,
  // The chat's renderers: a diff, a new file's lines (both colored as the
  // file at `path`), folded text.
  diffView: (_hunks: unknown[], _preview: number, _path: string): Node => document.createElement("div"),
  addedView: (_text: string, _preview: number, _path: string) => ({ node: document.createElement("div") as Node, lines: 0 }),
  folded: (_text: string): Node => document.createElement("div"),
};
