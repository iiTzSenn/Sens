// What the React zones still borrow from app.js while both run. app.js fills
// it in on start; each entry goes away when the zone that owns it moves.
export const legacy = {
  openUpdate: (_from: HTMLElement): void => {},
  readAccount: async (): Promise<unknown> => undefined,
  refreshModels: (): void => {},
};
