// What Rust sends, mirrored by hand from its serde types until they are
// generated. Each one names the type it follows.

/** profile::Profile, rust/sens-app/src/profile.rs */
export interface Profile {
  name: string;
  checkUpdates: boolean;
  welcomed: boolean;
  seen: string;
  notify: boolean;
}

/** update::Release, rust/sens-app/src/update.rs */
export interface Release {
  version: string;
  notes: string;
  page: string;
  size: number;
}

/** update::Stage, rust/sens-app/src/update.rs: where an install is */
export type UpdateStage = "downloading" | "verifying" | "installing";

/** update::Check, rust/sens-app/src/update.rs */
export interface UpdateCheck {
  latest: Release | null;
  installable: boolean;
}

export interface News {
  version: string;
  title: string;
  notes: string;
  page: string;
  published: string;
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

/** files::Entry, rust/sens-app/src/files.rs: one row of a folder */
export interface Entry {
  name: string;
  path: string;
  dir: boolean;
  // Matched by .gitignore: shown, but dimmed.
  ignored: boolean;
}

export type Opened =
  | { kind: "text"; text: string }
  | { kind: "picture"; data: string; bytes: number }
  | { kind: "tooBig"; bytes: number; cap: number }
  | { kind: "binary"; bytes: number };

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
  stage: "downloading" | "verifying" | "installing" | "updating";
  done: number;
  total: number;
}

/** session::Summary, rust/sens-agent/src/session.rs */
export interface SessionSummary {
  id: string;
  title: string;
  startedAt: number;
  tasks: number;
  archived: boolean;
}

/** projects::Workspace, rust/sens-app/src/projects.rs: a project Sens worked in */
export interface Workspace {
  root: string;
  name: string;
  activeAt: number;
  sessions: SessionSummary[];
  trusted: boolean;
}

/** browser::Frame, rust/sens-app/src/browser.rs: where the page goes, in window pixels */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** browser::Heard, rust/sens-app/src/browser.rs, the payload of the "browser" event */
export type Heard =
  | { kind: "loading" | "loaded"; url: string }
  | { kind: "titled"; title: string }
  | { kind: "said"; level: string; text: string };

export interface TerminalOpened {
  id: number;
  shell: string;
}

export interface TerminalReading {
  ask: number;
  terminal: number | null;
  lines: number;
  within: string[];
}

export type TerminalHeard = { kind: "out"; id: number; data: string } | { kind: "ended"; id: number; code: number | null };

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
}

// What a tool was called with, by the fields the chat reads.
export interface ToolInput {
  file_path?: string;
  notebook_path?: string;
  path?: string;
  command?: string;
  description?: string;
  pattern?: string;
  url?: string;
  query?: string;
  prompt?: string;
  todos?: Todo[];
  subagent_type?: string;
  skill?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  plan?: string;
  questions?: Question[];
  [field: string]: unknown;
}

// What Claude Code adds to a tool's result, by the fields the chat reads.
export interface ToolDetail {
  stdout?: string;
  stderr?: string;
  structuredPatch?: { oldStart: number; newStart: number; lines: string[] }[];
  filePath?: string;
  type?: string;
  content?: string;
  file?: { numLines?: number };
  numFiles?: number;
  [field: string]: unknown;
}

/** chat::Link, rust/sens-agent/src/chat.rs */
export interface Link {
  url: string;
  title: string;
}

export interface Suggestion {
  type: string;
  mode?: string;
}

export type Answers = Record<string, string | string[]>;

export interface Asking {
  kind: "asking";
  request: string;
  tool: string;
  input: ToolInput;
  suggestions: Suggestion[] | null;
}

export interface Finished {
  kind: "finished";
  ok: boolean;
  stopped: boolean;
  millis: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  context?: number;
  window?: number;
  error: string;
}

export interface LimitWindow {
  utilization: number | null;
  resetsAt: number | null;
}

export interface Overage {
  status: string;
  using: boolean;
  resetsAt: number | null;
  disabled: string;
}

export interface Limits {
  kind: "limits";
  status: string;
  window: string;
  utilization: number | null;
  resetsAt: number | null;
  threshold: number | null;
  overage: Overage | null;
  windows: Record<string, LimitWindow>;
}

export interface Slash {
  name: string;
  description: string;
  hint: string;
}

/** chat::Event, rust/sens-agent/src/chat.rs; task events go to the tasks panel as AgentEvent */
export type ChatEvent =
  | { kind: "started"; model: string }
  | { kind: "delta"; thinking: boolean; text: string }
  | { kind: "said"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "tool"; id: string; name: string; input: ToolInput }
  | { kind: "toolDone"; id: string; output: string; error: boolean; detail: ToolDetail | null }
  | Asking
  | { kind: "answered"; request: string; allowed: boolean; answers: Answers | null }
  | Limits
  | { kind: "consulted"; tool: string; links: Link[] }
  | { kind: "taskStarted" | "taskProgress" | "taskEnded" }
  | { kind: "compacted"; before: number; auto: boolean }
  | Finished
  | { kind: "failed"; reason: string };

export interface Isolation {
  path: string;
  branch: string;
  base: string;
}

/** session::Entry, rust/sens-agent/src/session.rs: a session as it was saved */
export type SessionEntry =
  | { kind: "opened"; at: number; root: string }
  | ({ kind: "isolated"; at: number } & Isolation)
  | { kind: "task"; at: number; text: string; files: string[]; images: string[] }
  | { kind: "agent"; at: number; event: ChatEvent }
  | { kind: "titled"; at: number; title: string };

// How a question is answered: allowed or not, with a mode or a message for
// the model, and the answers to a form.
export interface Decision {
  allow: boolean;
  remember?: boolean;
  mode?: string;
  message?: string;
  answers?: Answers;
}

/** chat::Message, rust/sens-agent/src/chat.rs */
export interface Message {
  text: string;
  files: string[];
  images: { mediaType: string; data: string }[];
}

/** chat::Settings, rust/sens-agent/src/chat.rs */
export interface Settings {
  provider: string;
  model: string;
  effort: string;
  thinking: boolean;
  mode: string;
}

/** catalog::Provider, rust/sens-agent/src/catalog.rs */
export interface Provider {
  id: string;
  vendor: string;
  label: string;
}

/** catalog::Card, rust/sens-agent/src/catalog.rs: a model as the picker lists it */
export interface Card {
  id: string;
  label: string;
  description: string;
  latest: boolean;
  efforts: string[];
  effort: string;
  thinking: "always" | "toggle";
}

/** artifacts::Attached, rust/sens-app/src/artifacts.rs */
export type AttachedFile = { kind: "file"; path: string; name: string; bytes: number; outside: boolean };

export type Attached =
  | AttachedFile
  | { kind: "folder"; path: string; name: string; entries: number; outside: boolean }
  | { kind: "picture"; path: string; name: string; mediaType: string; data: string; bytes: number; outside: boolean };

export interface Refused {
  name: string;
  why: "missing" | "unreadable" | "tooBig" | "project";
}

/** artifacts::Attachments, rust/sens-app/src/artifacts.rs */
export interface Attachments {
  items: Attached[];
  refused: Refused[];
}

/** git::Repo, rust/sens-app/src/git.rs */
export interface Repo {
  branch: string;
  detached: boolean;
  dirty: number;
  branches: string[];
}

export interface FoundProject {
  root: string;
  name: string;
  exists: boolean;
  sessions: number;
  already: number;
  last: number;
  suggested: boolean;
}

export interface ForeignServer {
  id: string;
  source: "claude-desktop" | "cursor" | "windsurf" | "vscode" | "codex";
  app: string;
  name: string;
  kind: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  url: string;
  envKeys: string[];
  blocked: string;
}

export interface Found {
  claude: string;
  projects: FoundProject[];
  skills: string[];
  servers: string[];
  plugins: string[];
  foreign: ForeignServer[];
}

export interface Adopted {
  sessions: number;
  projects: number;
  skipped: { root: string; reason: string }[];
}

export interface Imported {
  added: string[];
  skipped: { name: string; reason: string }[];
}
