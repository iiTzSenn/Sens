// What Rust sends, mirrored by hand from its serde types until they are
// generated. Each one names the type it follows.

/** profile::Profile, rust/sens-app/src/profile.rs */
export interface Profile {
  name: string;
  checkUpdates: boolean;
}

/** update::Release, rust/sens-app/src/update.rs */
export interface Release {
  version: string;
  notes: string;
  page: string;
  size: number;
}

/** update::Check, rust/sens-app/src/update.rs */
export interface UpdateCheck {
  latest: Release | null;
  installable: boolean;
}

/** providers::Method, rust/sens-app/src/providers.rs */
export type Method = "subscription" | "console" | "apiKey";

/** account::Account, rust/sens-agent/src/account.rs */
export interface Account {
  billing: "subscription" | "noPlan" | "elsewhere" | "signedOut";
  plan: string;
  source: string;
  email: string;
}

/** providers::State, rust/sens-app/src/providers.rs */
export interface ProviderState {
  id: string;
  vendor: string;
  label: string;
  method: Method;
  keyHint: string;
  version: string;
  account: Account | null;
  error: string;
  installed: boolean;
}

/** claude_code::Progress, the payload of the "claude-code" event */
export interface ClaudeCodeProgress {
  stage: "downloading" | "verifying" | "installing";
  done: number;
  total: number;
}
