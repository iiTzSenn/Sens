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
  // The file panel on the right.
  showSource: (_title: string, _node: Node): void => {},
  showTool: (_tool: string): void => {},
  // A file's text in that panel, as if opened from `home`.
  present: (_path: string, _text: string, _change: null, _home: string): void => {},
  showSite: async (_path: string, _home: string): Promise<void> => {},
  outward: (_target: string): void => {},
  // The shared dialog, wide, for a picture.
  preview: (_title: string, _back: HTMLElement, _node: Node): void => {},
  // Opens a session of a project in the chat.
  resume: (_home: string, _id: string): void => {},
  // The session open in the chat, and whether a tool panel is on screen.
  session: (): string => "",
  panelShows: (_tool: string): boolean => false,
  // Opens a file of the project in the file panel, with the agent's edits marked.
  openTouched: (_path: string): void => {},
  // The chat's renderers: a diff, a new file's lines, folded text.
  diffView: (_hunks: unknown[], _preview: number): Node => document.createElement("div"),
  addedView: (_text: string, _preview: number) => ({ node: document.createElement("div") as Node, lines: 0 }),
  folded: (_text: string): Node => document.createElement("div"),
};
