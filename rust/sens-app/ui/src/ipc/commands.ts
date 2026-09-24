import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Artifact,
  Capabilities,
  Changes,
  ClaudeCodeProgress,
  Detail,
  Entry,
  Frame,
  Heard,
  IndexedFile,
  Listing,
  Market,
  Method,
  NewServer,
  Profile,
  ProviderState,
  UpdateCheck,
  Workspace,
} from "./types";

export type CapabilityKind = "skill" | "server" | "plugin";

// Every call from the migrated zones to Rust, typed. app.js still calls invoke
// directly until its zones move here.
export const commands = {
  profile: () => invoke<Profile>("profile"),
  saveProfile: (name: string) => invoke<void>("save_profile", { name }),
  setUpdateCheck: (on: boolean) => invoke<void>("set_update_check", { on }),
  updateCheck: (manual: boolean) => invoke<UpdateCheck>("update_check", { manual }),
  providersState: () => invoke<ProviderState[]>("providers_state"),
  setProviderMethod: (id: string, method: Method) => invoke<void>("set_provider_method", { id, method }),
  saveApiKey: (id: string, key: string) => invoke<void>("save_api_key", { id, key }),
  forgetApiKey: (id: string) => invoke<void>("forget_api_key", { id }),
  providerSignIn: (method: Method) => invoke<void>("provider_sign_in", { method }),
  providerSignOut: () => invoke<void>("provider_sign_out"),
  claudeCodeInstall: () => invoke<string>("claude_code_install"),

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

  tree: (root: string) => invoke<IndexedFile[]>("tree", { root }),
  folder: (root: string, path: string) => invoke<Entry[]>("folder", { root, path }),
  findFiles: (root: string, needle: string) => invoke<Entry[]>("find_files", { root, needle }),
  changes: (root: string) => invoke<Changes | null>("changes", { root }),
  openFile: (root: string, path: string) => invoke<string>("open_file", { root, path }),
  taskOutput: (path: string) => invoke<string>("task_output", { path }),
  stopTask: (sessionId: string, taskId: string) => invoke<void>("chat_stop_task", { sessionId, taskId }),
};

// One listener per channel, registered by the store that owns it, never by a
// component: StrictMode mounts twice and would hear everything twice.
export const events = {
  claudeCode: (heard: (progress: ClaudeCodeProgress) => void): Promise<UnlistenFn> =>
    listen<ClaudeCodeProgress>("claude-code", ({ payload }) => heard(payload)),
  browser: (heard: (what: Heard) => void): Promise<UnlistenFn> => listen<Heard>("browser", ({ payload }) => heard(payload)),
};
