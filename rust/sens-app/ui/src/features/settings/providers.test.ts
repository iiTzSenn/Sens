import { describe, expect, it } from "vitest";
import type { Account, ProviderState } from "../../ipc/types";
import { claudeCodeStatus, providerLine, signedIn } from "./providers";

const account = (over: Partial<Account> = {}): Account => ({
  billing: "subscription",
  plan: "max",
  source: "claude.ai",
  email: "demo@example.com",
  ...over,
});

const provider = (over: Partial<ProviderState> = {}): ProviderState => ({
  id: "claude",
  vendor: "Anthropic",
  label: "Claude Code",
  method: "subscription",
  keyHint: "",
  version: "2.1.0",
  account: account(),
  error: "",
  installed: true,
  ...over,
});

describe("provider line", () => {
  it.each([
    ["missing Claude Code", provider({ installed: false }), "Falta Claude Code en este ordenador", "off"],
    ["an error", provider({ error: "no responde" }), "no responde", "fault"],
    ["no account", provider({ account: null }), "Sin sesión", "off"],
    ["signed out", provider({ account: account({ billing: "signedOut" }) }), "Sin sesión", "off"],
    ["an API key", provider({ account: account({ billing: "elsewhere", source: "ANTHROPIC_API_KEY" }) }), "Conectado con clave de API", "on"],
    ["another source", provider({ account: account({ billing: "elsewhere", source: "Bedrock" }) }), "Claude Code usa Bedrock", "on"],
    ["a subscription", provider(), "Conectado · Suscripción Max · demo@example.com", "on"],
    ["an unknown plan", provider({ account: account({ plan: "edu" }) }), "Conectado · Suscripción edu · demo@example.com", "on"],
    ["no plan", provider({ account: account({ billing: "noPlan" }) }), "Conectado · sin plan Pro ni Max · demo@example.com", "on"],
  ])("describes %s", (_, state, text, mood) => {
    expect(providerLine(state)).toEqual([text, mood]);
  });

  it("counts a key as connected but not as a sign-in to leave", () => {
    expect(signedIn(provider())).toBe(true);
    expect(signedIn(provider({ account: account({ billing: "elsewhere", source: "ANTHROPIC_API_KEY" }) }))).toBe(false);
    expect(signedIn(provider({ installed: false }))).toBe(false);
  });
});

describe("Claude Code install status", () => {
  it("shows the download share once the size is known", () => {
    expect(claudeCodeStatus({ stage: "downloading", done: 0, total: 0 })).toBe("Descargando Claude Code…");
    expect(claudeCodeStatus({ stage: "downloading", done: 60 * 1048576, total: 240 * 1048576 })).toBe(
      "Descargando Claude Code… 25 % de 240 MB",
    );
    expect(claudeCodeStatus({ stage: "installing", done: 1, total: 1 })).toBe("Instalando Claude Code…");
  });
});
