import type { Account } from "../ipc/types";

// How Claude Code bills, read by the model picker's account line and by the
// providers settings.
export const PLANS: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise" };
export const API_KEY_SOURCE = "ANTHROPIC_API_KEY";

export const keyed = (found: Account | null | undefined) =>
  found?.billing === "elsewhere" && found.source === API_KEY_SOURCE;
