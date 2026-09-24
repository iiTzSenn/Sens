import type { ClaudeCodeProgress, Method, ProviderState } from "../../ipc/types";
import { PLANS, keyed } from "../../shared/account";

export const CLAUDE_CODE_WEIGHT = "unos 230 MB";

const CLAUDE_CODE_STAGES: Record<ClaudeCodeProgress["stage"], string> = {
  downloading: "Descargando Claude Code…",
  verifying: "Comprobando la descarga…",
  installing: "Instalando Claude Code…",
  updating: "Actualizando Claude Code…",
};

export const SIGN_IN_DOORS: Record<Exclude<Method, "apiKey">, { button: string; site: string }> = {
  subscription: { button: "Iniciar sesión con Claude", site: "claude.ai" },
  console: { button: "Iniciar sesión con la Consola", site: "console.anthropic.com" },
};

export const PROVIDER_METHODS: { id: Method; label: string; said: string }[] = [
  { id: "subscription", label: "Suscripción de Claude", said: "Pro o Max. Inicias sesión en el navegador con tu cuenta de Claude." },
  { id: "console", label: "Consola de Anthropic", said: "Facturación por uso. Inicias sesión con tu cuenta de la Consola." },
  { id: "apiKey", label: "Clave de API", said: "Pegas una clave de la Consola. Se factura por uso y tiene prioridad sobre la suscripción." },
];

export type Mood = "on" | "off" | "fault";

export function providerLine(state: ProviderState): [string, Mood] {
  if (!state.installed) return ["Falta Claude Code en este ordenador", "off"];
  if (state.error) return [state.error, "fault"];
  const found = state.account;
  if (!found || found.billing === "signedOut") return ["Sin sesión", "off"];
  if (keyed(found)) return ["Conectado con clave de API", "on"];
  if (found.billing === "elsewhere") return [`Claude Code usa ${found.source}`, "on"];
  const plan = found.billing === "subscription" ? `Suscripción ${PLANS[found.plan] || found.plan}`.trim() : "sin plan Pro ni Max";
  return [["Conectado", plan, found.email].filter(Boolean).join(" · "), "on"];
}

export function claudeCodeStatus({ stage, done, total }: ClaudeCodeProgress) {
  const said = CLAUDE_CODE_STAGES[stage];
  if (stage !== "downloading" || !total) return said;
  return `${said} ${Math.floor((done / total) * 100)} % de ${Math.round(total / 1024 / 1024)} MB`;
}

export const signedIn = (state: ProviderState) =>
  state.installed && Boolean(state.account) && state.account?.billing !== "signedOut" && !keyed(state.account);
