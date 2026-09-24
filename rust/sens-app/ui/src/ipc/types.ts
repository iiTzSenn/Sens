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

/** capabilities::Skill, rust/sens-app/src/capabilities.rs */
export interface Skill {
  name: string;
  description: string;
  enabled: boolean;
}

/** capabilities::Plugin */
export interface Plugin {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
}

/** capabilities::Server: `url` is set for remote servers, `command` for local ones */
export interface Server {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  kind: string;
  url: string;
  enabled: boolean;
}

/** capabilities::Provenance: where an installed capability came from */
export interface Provenance {
  listing: string;
  revision: string;
  version: string;
  installedAt: number;
}

/** capabilities::Capabilities, keyed `kind:name` in `origins` */
export interface Capabilities {
  skills: Skill[];
  servers: Server[];
  plugins: Plugin[];
  origins: Record<string, Provenance>;
}

/** capabilities::NewServer */
export interface NewServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** market::Listing, rust/sens-app/src/market.rs */
export interface Listing {
  id: string;
  kind: "plugin" | "skill" | "connector";
  name: string;
  title: string;
  description: string;
  author: string;
  badge: "anthropic" | "partner" | "community" | "skillsSh";
  source: string;
  category: string;
  version: string;
  homepage: string;
  installs: number | null;
  login: boolean;
  tools: string[];
  installable: boolean;
  revision: string;
}

/** market::SourceState */
export interface SourceState {
  id: string;
  label: string;
  fetchedAt: number;
  error: string;
}

/** market::Market */
export interface Market {
  listings: Listing[];
  sources: SourceState[];
}

/** market::Part */
export interface Part {
  name: string;
  path: string;
  description: string;
}

/** market::Parts: what a listing brings and what it runs */
export interface Parts {
  skills: Part[];
  commands: Part[];
  agents: Part[];
  hooks: { event: string; command: string }[];
  servers: { name: string; launch: string }[];
  lsp: string[];
  bin: string[];
}

/** market::Need: a value the install asks for */
export interface Need {
  name: string;
  description: string;
  secret: boolean;
  required: boolean;
  default: string;
}

/** market::Detail */
export interface Detail {
  listing: Listing;
  readme: string;
  license: string;
  files: { path: string; size: number }[];
  parts: Parts;
  needs: Need[];
}

/** artifacts::Artifact, rust/sens-app/src/artifacts.rs: something a session left */
export interface Artifact {
  kind: "image" | "file" | "link";
  root: string;
  project: string;
  name: string;
  target: string;
  session: string | null;
  sessionTitle: string | null;
  at: number;
  bytes: number | null;
}

/** git::Changes, rust/sens-app/src/git.rs: null outside a repository */
export interface Changes {
  diff: string;
  fresh: string[];
}

/**
 * The fields of an agent event (rust/sens-agent) that the tasks panel reads.
 * The chat gets the whole event; `kind` says which fields are there.
 */
export interface AgentEvent {
  kind: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: string;
  detail?: { backgroundTaskId?: string };
  runner?: string;
  description?: string;
  prompt?: string;
  tool?: string;
  status?: string;
  summary?: string;
  doing?: string;
  last?: string;
  tools?: number;
  tokens?: number;
  millis?: number;
}

/** claude_code::Progress, the payload of the "claude-code" event */
export interface ClaudeCodeProgress {
  stage: "downloading" | "verifying" | "installing";
  done: number;
  total: number;
}
