import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Account,
  Adopted,
  Artifact,
  Attachments,
  Card,
  Capabilities,
  Changes,
  ChatEvent,
  ClaudeCodeProgress,
  Decision,
  Detail,
  Entry,
  Found,
  Frame,
  Heard,
  Imported,
  Listing,
  Market,
  Message,
  Method,
  NewServer,
  Opened,
  Profile,
  Provider,
  ProviderState,
  Repo,
  SessionEntry,
  Settings,
  UpdateCheck,
  UpdateStage,
  Workspace,
} from "./types";

export type CapabilityKind = "skill" | "server" | "plugin";

// Every call from the shell to Rust, typed.
export const commands = {
  profile: () => invoke<Profile>("profile"),
  saveProfile: (name: string) => invoke<void>("save_profile", { name }),
  setUpdateCheck: (on: boolean) => invoke<void>("set_update_check", { on }),
  setWelcomed: (on: boolean) => invoke<void>("set_welcomed", { on }),
  welcomeScan: () => invoke<Found>("welcome_scan"),
  welcomeAdopt: (roots: string[]) => invoke<Adopted>("welcome_adopt", { roots }),
  welcomeServers: (ids: string[], roots: string[]) => invoke<Imported>("welcome_servers", { ids, roots }),
  updateCheck: (manual: boolean) => invoke<UpdateCheck>("update_check", { manual }),
  // Downloads, verifies and installs the update, then Sens restarts.
  updateInstall: () => invoke<void>("update_install"),
  // How many sessions are working right now, in any project.
  chatWorking: () => invoke<number>("chat_working"),
  providersState: () => invoke<ProviderState[]>("providers_state"),
  // The providers Sens can chat through, and the models each offers now.
  providers: () => invoke<Provider[]>("providers"),
  models: (provider: string) => invoke<Card[]>("models", { provider }),
  claudeAccount: () => invoke<Account>("claude_account"),
  setProviderMethod: (id: string, method: Method) => invoke<void>("set_provider_method", { id, method }),
  saveApiKey: (id: string, key: string) => invoke<void>("save_api_key", { id, key }),
  forgetApiKey: (id: string) => invoke<void>("forget_api_key", { id }),
  providerSignIn: (method: Method) => invoke<void>("provider_sign_in", { method }),
  providerSignOut: () => invoke<void>("provider_sign_out"),
  claudeCodeInstall: () => invoke<string>("claude_code_install"),
  claudeCodeNewer: () => invoke<string | null>("claude_code_newer"),
  claudeCodeUpdate: () => invoke<string>("claude_code_update"),

  capabilities: (root: string) => invoke<Capabilities>("capabilities", { root }),
  setCapability: (kind: CapabilityKind, root: string, name: string, enabled: boolean) =>
    invoke<void>(`set_${kind}`, { root, name, enabled }),
  removeCapability: (kind: CapabilityKind, name: string) => invoke<void>(`remove_${kind}`, { name }),
  skillText: (name: string) => invoke<string>("skill_text", { name }),
  createSkill: (root: string, name: string, description: string, body: string) =>
    invoke<void>("create_skill", { root, name, description, body }),
  importSkill: (root: string, path: string) => invoke<string>("import_skill", { root, path }),
  addServer: (root: string, server: NewServer) => invoke<void>("add_server", { root, server }),

  market: (refresh: boolean) => invoke<Market>("market", { refresh }),
  marketSearch: (query: string) => invoke<Listing[]>("market_search", { query }),
  marketDetail: (id: string) => invoke<Detail>("market_detail", { id }),
  marketFile: (id: string, path: string) => invoke<string>("market_file", { id, path }),
  marketInstall: (root: string, id: string, values: Record<string, string>) =>
    invoke<string>("market_install", { root, id, values }),
  marketUpdate: (id: string, name: string) => invoke<void>("market_update", { id, name }),

  // A session and its chat with Claude Code.
  replay: (root: string, id: string) => invoke<SessionEntry[]>("replay", { root, id }),
  newSessionId: () => invoke<string>("new_session_id"),
  openSession: (root: string, id: string | null) => invoke<string>("open_session", { root, id }),
  chatWarm: (root: string, sessionId: string, settings: Settings) => invoke<void>("chat_warm", { root, sessionId, settings }),
  chatSend: (root: string, sessionId: string, message: Message, settings: Settings) =>
    invoke<void>("chat_send", { root, sessionId, message, settings }),
  chatStop: (sessionId: string) => invoke<void>("chat_stop", { sessionId }),
  chatAnswer: (sessionId: string, request: string, decision: Decision) => invoke<void>("chat_answer", { sessionId, request, decision }),
  chatBusy: (sessionId: string) => invoke<boolean>("chat_busy", { sessionId }),
  // The background tasks still running in a session.
  chatTasks: (sessionId: string) => invoke<string[]>("chat_tasks", { sessionId }),

  workspaces: () => invoke<Workspace[]>("workspaces"),
  // A title the model suggests once a session has something to name, if it has none yet.
  titleSession: (root: string, id: string) => invoke<string | null>("title_session", { root, id }),
  renameSession: (root: string, id: string, title: string) => invoke<string>("rename_session", { root, id, title }),
  archiveSession: (root: string, id: string, archived: boolean) => invoke<void>("archive_session", { root, id, archived }),
  deleteSession: (root: string, id: string) => invoke<void>("delete_session", { root, id }),

  artifacts: () => invoke<Artifact[]>("artifacts"),
  // A data: URL, ready for an <img>.
  artifactData: (path: string) => invoke<string>("artifact_data", { path }),
  artifactText: (path: string) => invoke<string>("artifact_text", { path }),
  openExternal: (target: string) => invoke<void>("open_external", { target }),

  // The address a page of the project is served at, for the browser.
  previewUrl: (root: string, path: string) => invoke<string>("preview_url", { root, path }),
  browserOpen: (url: string, frame: Frame, zoom: number) => invoke<void>("browser_open", { url, frame, zoom }),
  browserPlace: (frame: Frame, zoom: number) => invoke<void>("browser_place", { frame, zoom }),
  browserShow: (shown: boolean) => invoke<void>("browser_show", { shown }),
  browserAct: (act: "back" | "forward" | "reload" | "close") => invoke<void>("browser_act", { act }),

  folder: (root: string, path: string) => invoke<Entry[]>("folder", { root, path }),
  findFiles: (root: string, needle: string) => invoke<Entry[]>("find_files", { root, needle }),
  changes: (root: string) => invoke<Changes | null>("changes", { root }),
  openFile: (root: string, path: string) => invoke<Opened>("open_file", { root, path }),
  // Files or pictures to send with a message: pictures come back as data.
  attach: (root: string, paths: string[]) => invoke<Attachments>("attach", { root, paths }),
  repo: (root: string) => invoke<Repo | null>("repo", { root }),
  checkout: (root: string, branch: string) => invoke<Repo>("checkout", { root, branch }),
  remember: (root: string) => invoke<void>("remember", { root }),
  trustProject: (root: string, trusted: boolean) => invoke<void>("trust_project", { root, trusted }),
  projectTrusted: (root: string) => invoke<boolean>("project_trusted", { root }),
  lastProject: () => invoke<string | null>("last_project"),
  taskOutput: (path: string) => invoke<string>("task_output", { path }),
  stopTask: (sessionId: string, taskId: string) => invoke<void>("chat_stop_task", { sessionId, taskId }),
};

// One listener per channel, registered by the store that owns it, never by a
// component: StrictMode mounts twice and would hear everything twice.
export const events = {
  claudeCode: (heard: (progress: ClaudeCodeProgress) => void): Promise<UnlistenFn> =>
    listen<ClaudeCodeProgress>("claude-code", ({ payload }) => heard(payload)),
  browser: (heard: (what: Heard) => void): Promise<UnlistenFn> => listen<Heard>("browser", ({ payload }) => heard(payload)),
  welcome: (heard: (done: number, total: number) => void): Promise<UnlistenFn> =>
    listen<{ done: number; total: number }>("welcome", ({ payload }) => heard(payload.done, payload.total)),
  update: (heard: (stage: UpdateStage) => void): Promise<UnlistenFn> =>
    listen<{ version: string; stage: UpdateStage }>("update", ({ payload }) => heard(payload.stage)),
  chat: (heard: (session: string, event: ChatEvent) => void): Promise<UnlistenFn> =>
    listen<{ session: string; event: ChatEvent }>("chat", ({ payload }) => heard(payload.session, payload.event)),
};
