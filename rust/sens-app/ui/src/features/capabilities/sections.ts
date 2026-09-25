import type { Listing } from "../../ipc/types";
import { ICONS } from "../../shared/icons.js";
import { plain } from "../market/search.js";

export type SectionId =
  | "code"
  | "agents"
  | "data"
  | "cloud"
  | "security"
  | "design"
  | "productivity"
  | "communication"
  | "business"
  | "finance"
  | "science"
  | "learning"
  | "lifestyle"
  | "other";

type Ruled = Exclude<SectionId, "other">;

interface Rule {
  sources?: string[];
  categories?: string[];
  words: string;
}

const RULES: Record<Ruled, Rule> = {
  lifestyle: {
    words:
      "travel* trip trips hotel* flight* airline* airport* booking* vacation* tours tourism restaurant* food foods grocer* food-delivery ride rides uber taxi hike* hiking outdoor* audiobook* books recipe* cooking cook fitness workout* sport sports movie* tv concert* stubhub ticketmaster nonprofit* charit* donat* dating pet pets weather horoscope divination tarot astrolog* i-ching parenting mother motherhood mothers wellness meditation mindfulness spotify dnd dungeon* tabletop shopping entertainment live-event*",
  },
  science: {
    sources: ["life-sciences"],
    categories: ["life-sciences", "math", "science"],
    words:
      "science sciences scientific scientist* academic* papers research-paper* arxiv pubmed biorxiv medrxiv genom* genetic* bioinformatic* biolog* biomedical protein* molecul* chemistry chemical* chembl clinical medical medicine healthcare patient* drug* pharma* laborator* physics mathematic* math astronom* climate ecolog* neuroscien* citation* scholar* icd-10 npi hipaa fhir ehr gene genes sequencing single-cell rna dna crispr microscop* olympiad theorem* wolfram computational peer-review*",
  },
  finance: {
    sources: ["financial-services"],
    categories: ["finance"],
    words:
      "finance financial fintech payment* stripe paypal invoice* invoicing billing accounting accountant* bookkeeping tax taxes payroll expense* budgeting banking bank-account* bank-statement* trading trader* stock stocks equit* invest investing investment investments investor* portfolio* crypto* cryptocurrenc* blockchain ethereum bitcoin defi web3 erc-20 evm wallet* dcf lbo valuation* private-equity venture cap-table quickbooks xero netsuite ramp brex onchain on-chain solana stablecoin* apy yield yields capital credit-score* credit-card* credit-risk underwriting insurance insurer* funds hedge asset-management wealth advisor* pricing-model* earnings sec-filing* 10-k filings ledger* treasury fund",
  },
  security: {
    categories: ["security"],
    words:
      "security secure vulnerab* cve cves owasp pentest* penetration-test* threat* malware compliance soc2 soc-2 gdpr secret secrets encrypt* authentication oauth sso iam access-control firewall supply-chain sast dast sbom guardrail* zero-trust privacy access-review exploit* red-team risk risks audit-log* sonarqube semgrep snyk vanta crowdstrike zscaler auth0 stytch clerk workos malwarebytes permission*",
  },
  design: {
    categories: ["design"],
    words:
      "design designs designer* figma ui ux css tailwind canva image images photo* video* audio sound music podcast* 3d blender animation* animate illustrat* icon icons font fonts typograph* palette color colors colour* diagram* excalidraw mermaid tldraw drawing sketch* logo logos svg visual* infographic* creative artwork generative-art pixel-art midjourney mockup* wireframe* storyboard* comic* game games gaming unity unreal-engine gif gifs media cms website websites landing-page* webflow wix miro whiteboard* accessibility a11y adobe cloudinary p5 shader*",
  },
  data: {
    categories: ["database"],
    words:
      "data database databases sql postgres postgresql mysql sqlite mongodb mongo redis supabase snowflake bigquery databricks dbt clickhouse elasticsearch neo4j warehouse* etl analytics analyst* dashboard* bi looker tableau metabase spreadsheet* excel csv queries query dataset* vector vectors embedding* statistic* causal jupyter notebook notebooks pandas scrap* crawl* airflow kafka spark duckdb data-catalog* metadata pinecone qdrant zilliz cockroachdb planetscale neon prisma airtable insight* metric* a-b-test* experimentation dataverse cosmos-db spanner firestore",
  },
  cloud: {
    categories: ["deployment", "monitoring"],
    words:
      "cloud aws gcp azure kubernetes k8s docker container* terraform pulumi ansible helm devops deploy* hosting serverless cloudflare vercel netlify heroku railway fly.io ci-cd cicd cluster* github-actions buildkite infrastructure infra monitoring observability logs logging tracing sentry datadog grafana prometheus new-relic dynatrace honeycomb pagerduty incident* sre uptime alert* alerting linux sandbox* gcloud compute-engine ec2 lambda edge-function* on-call rootly fastly cdn dns godaddy hostinger",
  },
  communication: {
    words:
      "slack email* e-mail gmail outlook inbox* mail teams discord telegram whatsapp mattermost feishu lark imessage zoom meeting* transcript* transcrib* sms phone voice chat chats messaging message messages channel channels notification* phone-call* video-call* twilio resend translation translations translator*",
  },
  business: {
    words:
      "marketing marketer* seo sem aeo ads advertis* campaign* crm salesforce hubspot pipedrive sales prospect* lead-gen* lead-generation outreach outbound gtm go-to-market copywrit* social-media twitter linkedin instagram tiktok influencer* newsletter* blog blogs blogging ecommerce e-commerce shopify woocommerce storefront* merchant* customer customers customer-support helpdesk zendesk intercom support-ticket* recruit* hiring hr human-resources job-search job-board* job-posting* career* legal law laws lawyer* attorney* counsel litigat* court* contract-review contracts nda ndas patent* jobs grant grants funder* fundrais* proposal* tender* legislation government* federal public-sector support-issue* procurement conference* trade-show* startups founder* business* competitor* brand brands branding enrichment revenue churn b2b companies buyer* product-manag* prd prds roadmap* stakeholder* okr* leadership coaching consult*",
  },
  learning: {
    categories: ["learning"],
    words:
      "learning learner* education* educational teach* teacher* tutor* tutorial* courses online-course* lesson* student* study studying quiz* flashcard* exam exams school* universit* curriculum academy training coursera explanatory beginner*",
  },
  code: {
    categories: ["development", "testing", "developer tools", "migration"],
    words:
      "code coding coder* programming programmer* developer developers development refactor* debug* bug bugs lint* compiler* typescript javascript python rust golang java kotlin swift swiftui ruby php csharp c# c++ cobol dotnet react jsx tsx vue angular svelte nextjs next.js node nodejs deno django rails laravel flutter android ios macos xcode api apis sdk sdks git github gitlab pull-request pull-requests pr prs diff diffs commit commits test tests testing tdd e2e playwright cypress jest pytest lsp language-server ide vscode frontend backend fullstack full-stack codebase codebases repositor* repo repos spec spec-driven sdlc code-review framework frameworks library libraries crate crates npm package packages regex cli terminal shell bash powershell scaffold* boilerplate snippet* docstring* architecture mobile web-app webapp wordpress html dependenc* monorepo migration* graphql postman spring abap types type-checking tmux edge-case* engineer* engineering software devtools",
  },
  productivity: {
    categories: ["productivity"],
    words:
      "productivity notes note-taking obsidian notion docs document documents documentation writer* writing draft drafts drafting essay* proofread* grammar pdf pdfs docx markdown wiki wikis knowledge knowledge-base confluence calendar* schedul* task-management todo todos to-do project-management jira linear asana trello monday clickup kanban planning planner* journal* google-drive dropbox organize organizing summar* bookmark* time-tracking habit* personal-assistant presentation* slide slides powerpoint pptx office forms todoist goodnotes egnyte meeting-notes enterprise-search",
  },
  agents: {
    categories: ["automation"],
    words:
      "agent agents agentic subagent* multi-agent orchestrat* llm llms language-model* foundation-model* ai-model* prompt prompts prompting memory context-window context-engineering rag machine-learning ml deep-learning neural openai gpt gemini huggingface hugging-face fine-tun* inference eval evals evaluation* benchmark* statusline status-line workflow-automation agentic-workflow* automation automations automat* n8n zapier skill-creator claude-md claude-code autonomous token-usage token-cost* usage-limits rate-limit* session sessions hooks compaction mcp-server* personality",
  },
};

export const SECTION_IDS: SectionId[] = [
  "code",
  "agents",
  "data",
  "cloud",
  "security",
  "design",
  "productivity",
  "communication",
  "business",
  "finance",
  "science",
  "learning",
  "lifestyle",
  "other",
];

export const SECTION_ICONS: Record<SectionId, string> = {
  code: ICONS.code,
  agents: ICONS.workflow,
  data: ICONS.database,
  cloud: ICONS.cloud,
  security: ICONS.shield,
  design: ICONS.palette,
  productivity: ICONS.fileText,
  communication: ICONS.message,
  business: ICONS.briefcase,
  finance: ICONS.banknote,
  science: ICONS.flask,
  learning: ICONS.graduation,
  lifestyle: ICONS.plane,
  other: ICONS.shapes,
};

const BY_WEIGHT = Object.keys(RULES) as Ruled[];
const SOURCE_WEIGHT = 6;
const CATEGORY_WEIGHT = 4;
const NAME_WEIGHT = 3;

const SAID_CAP = 600;

interface Index {
  exact: Map<string, Ruled[]>;
  stems: Map<string, Ruled[]>;
  phrases: Map<string, [string, Ruled[]][]>;
  leads: Set<string>;
  sizes: number[];
}

function indexOf(): Index {
  const exact = new Map<string, Ruled[]>();
  const stems = new Map<string, Ruled[]>();
  const phrases = new Map<string, [string, Ruled[]][]>();
  const leads = new Set<string>();
  for (const id of BY_WEIGHT) {
    for (const word of RULES[id].words.split(/\s+/).filter(Boolean)) {
      const stem = word.endsWith("*");
      const key = (stem ? word.slice(0, -1) : word).replace(/-/g, " ");
      const first = key.split(" ")[0];
      if (key !== first) leads.add(first);
      if (!stem) exact.set(key, [...(exact.get(key) || []), id]);
      else if (key !== first) phrases.set(first, [...(phrases.get(first) || []), [key, [id]]]);
      else stems.set(key, [...(stems.get(key) || []), id]);
    }
  }
  const sizes = [...new Set([...stems.keys()].map((key) => key.length))].sort((a, b) => b - a);
  return { exact, stems, phrases, leads, sizes };
}

let index: Index | null = null;

const EDGE = /^\.+|\.+$/g;

function tokensOf(text: string) {
  const tokens: string[] = [];
  for (const part of plain(text).split(/[^a-z0-9+#.À-￿]+/)) {
    const token = part.startsWith(".") || part.endsWith(".") ? part.replace(EDGE, "") : part;
    if (token) tokens.push(token);
  }
  return tokens;
}

function hitsOf(text: string) {
  index ??= indexOf();
  const { exact, stems, phrases, leads, sizes } = index;
  const found = new Map<Ruled, Set<string>>();
  const add = (ids: Ruled[] | undefined, key: string) => {
    for (const id of ids || []) {
      if (!found.has(id)) found.set(id, new Set());
      found.get(id)!.add(key);
    }
  };
  const whole = (term: string) => {
    add(exact.get(term), term);
    if (term.endsWith("s")) add(exact.get(term.slice(0, -1)), term.slice(0, -1));
    if (term.endsWith("es")) add(exact.get(term.slice(0, -2)), term.slice(0, -2));
  };
  const tokens = tokensOf(text);
  tokens.forEach((token, at) => {
    whole(token);
    for (const size of sizes) if (size <= token.length) add(stems.get(token.slice(0, size)), token.slice(0, size));
    if (!leads.has(token) || at + 1 >= tokens.length) return;
    const pair = `${token} ${tokens[at + 1]}`;
    whole(pair);
    if (at + 2 < tokens.length) whole(`${pair} ${tokens[at + 2]}`);
    for (const [key, ids] of phrases.get(token) || []) if (pair.startsWith(key)) add(ids, key);
  });
  return found;
}

type Classified = Pick<Listing, "name" | "title" | "description" | "category" | "source">;

export function scoresOf(listing: Classified) {
  const named = hitsOf(`${listing.name.replace(/[-_]+/g, " ")} ${listing.title}`);
  const said = hitsOf((listing.description || "").slice(0, SAID_CAP));
  const category = plain(listing.category || "").trim();
  const scores = {} as Record<Ruled, number>;
  for (const id of BY_WEIGHT) {
    const rule = RULES[id];
    scores[id] =
      (rule.sources?.includes(listing.source) ? SOURCE_WEIGHT : 0) +
      (rule.categories?.includes(category) ? CATEGORY_WEIGHT : 0) +
      NAME_WEIGHT * (named.get(id)?.size ?? 0) +
      (said.get(id)?.size ?? 0);
  }
  return scores;
}

export function classify(listing: Classified): SectionId {
  const scores = scoresOf(listing);
  let best: SectionId = "other";
  let top = 0;
  for (const id of BY_WEIGHT) {
    if (scores[id] > top) {
      top = scores[id];
      best = id;
    }
  }
  return best;
}

const known = new WeakMap<Listing, SectionId>();

export function sectionOf(listing: Listing): SectionId {
  let section = known.get(listing);
  if (!section) {
    section = classify(listing);
    known.set(listing, section);
  }
  return section;
}

export function tallyBySection(listings: Listing[]) {
  const counts = Object.fromEntries(SECTION_IDS.map((id) => [id, 0])) as Record<SectionId, number>;
  for (const listing of listings) counts[sectionOf(listing)]++;
  return counts;
}
