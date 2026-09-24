import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClaudeCodeProgress, Method, Profile, ProviderState, UpdateCheck } from "./types";

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
};

// One listener per channel, registered by the store that owns it, never by a
// component: StrictMode mounts twice and would hear everything twice.
export const events = {
  claudeCode: (heard: (progress: ClaudeCodeProgress) => void): Promise<UnlistenFn> =>
    listen<ClaudeCodeProgress>("claude-code", ({ payload }) => heard(payload)),
};
