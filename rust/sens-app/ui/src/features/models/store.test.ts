// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Card, Provider } from "../../ipc/types";
import { accountLine, models, readAccount, refreshModels } from "./store";

const ipc = vi.hoisted(() => ({
  commands: {
    models: vi.fn(),
    claudeAccount: vi.fn(),
  },
}));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands }));

const CLAUDE: Provider = { id: "claude", vendor: "Anthropic", label: "Claude Code" };
const MAX: Account = { billing: "subscription", plan: "max", source: "", email: "ada@example.com" };
const card = (id: string): Card => ({ id, label: id, description: "", latest: true, efforts: [], effort: "", thinking: "toggle" });

beforeEach(() => {
  localStorage.clear();
  for (const command of Object.values(ipc.commands)) command.mockReset();
  models.setState({ ...models.getInitialState(), catalog: [CLAUDE], known: { claude: [card("claude-opus-5-5")] }, limits: null }, true);
});

describe("an account Claude Code cannot be asked about", () => {
  it("reads as Claude Code missing when it is not installed", async () => {
    ipc.commands.claudeAccount.mockResolvedValue(null);

    await readAccount();

    expect(models.getState()).toMatchObject({ account: null, accountFault: "missing" });
    expect(accountLine()).toEqual({ text: "Falta Claude Code", warn: true });
  });

  it("shows what went wrong as it was said, whatever the words", async () => {
    ipc.commands.claudeAccount.mockRejectedValue("no encuentro Claude Code en este ordenador");

    await readAccount();

    expect(models.getState()).toMatchObject({ account: null, accountFault: "no encuentro Claude Code en este ordenador" });
    expect(accountLine().text).toBe("no encuentro Claude Code en este ordenador");
  });

  it("clears the fault once the account reads again", async () => {
    ipc.commands.claudeAccount.mockResolvedValueOnce(null).mockResolvedValueOnce(MAX);

    await readAccount();
    await readAccount();

    expect(models.getState()).toMatchObject({ account: MAX, accountFault: "" });
  });
});

describe("the models of a Claude Code that is not installed", () => {
  it("keeps the models it knew and says nothing", async () => {
    ipc.commands.models.mockResolvedValue(null);

    await refreshModels();

    expect(models.getState().known.claude.map((one) => one.id)).toEqual(["claude-opus-5-5"]);
    expect(models.getState().note).toBe("");
  });

  it("learns the models offered and names a real failure", async () => {
    ipc.commands.models.mockResolvedValueOnce([card("claude-sonnet-5")]);
    await refreshModels();
    expect(models.getState().known.claude.map((one) => one.id)).toEqual(["claude-sonnet-5"]);

    ipc.commands.models.mockRejectedValueOnce("Claude Code tardó demasiado en decir sus modelos");
    await refreshModels();
    expect(models.getState().known.claude.map((one) => one.id)).toEqual(["claude-sonnet-5"]);
    expect(models.getState().note).toBe("Claude Code: Claude Code tardó demasiado en decir sus modelos");
  });
});
