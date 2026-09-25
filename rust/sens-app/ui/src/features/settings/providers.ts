import type { ClaudeCodeProgress, Method, ProviderState } from "../../ipc/types";
import { PLANS, keyed } from "../../shared/account";
import { t } from "./copy";

export const signInDoor = (method: Exclude<Method, "apiKey">) =>
  method === "subscription" ? { button: t.signInClaude, site: "claude.ai" } : { button: t.signInConsole, site: "console.anthropic.com" };

export const providerMethods = (): { id: Method; label: string; said: string }[] => [
  { id: "subscription", label: t.subscription, said: t.subscriptionSaid },
  { id: "console", label: t.console, said: t.consoleSaid },
  { id: "apiKey", label: t.apiKey, said: t.apiKeySaid },
];

export type Mood = "on" | "off" | "fault";

export function providerLine(state: ProviderState): [string, Mood] {
  if (!state.installed) return [t.notInstalled, "off"];
  if (state.error) return [state.error, "fault"];
  const found = state.account;
  if (!found || found.billing === "signedOut") return [t.signedOut, "off"];
  if (keyed(found)) return [t.withKey, "on"];
  if (found.billing === "elsewhere") return [t.usesSource(found.source), "on"];
  const plan = found.billing === "subscription" ? t.plan(PLANS[found.plan] || found.plan) : t.noPlan;
  return [[t.connected, plan, found.email].filter(Boolean).join(" · "), "on"];
}

export function claudeCodeStatus({ stage, done, total }: ClaudeCodeProgress) {
  const said = t.stage[stage];
  if (stage !== "downloading" || !total) return said;
  return t.downloaded(said, Math.floor((done / total) * 100), Math.round(total / 1024 / 1024));
}

export const signedIn = (state: ProviderState) =>
  state.installed && Boolean(state.account) && state.account?.billing !== "signedOut" && !keyed(state.account);
