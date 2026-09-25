import type { Listing } from "../../ipc/types";

const SHARED_HOSTS = new Set([
  "github.com",
  "gist.github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  "npmjs.com",
  "pypi.org",
  "skills.sh",
  "goo.gle",
  "gumroad.com",
  "medium.com",
  "substack.com",
  "notion.site",
  "notion.so",
  "docs.google.com",
  "sites.google.com",
  "readme.io",
  "intercom.help",
  "zendesk.com",
  "freshdesk.com",
  "helpscoutdocs.com",
  "mintlify.app",
  "apidocumentation.com",
  "readthedocs.io",
  "gitbook.io",
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "run.app",
  "fly.dev",
  "onrender.com",
  "railway.app",
  "replit.app",
  "localhost",
]);

const COUNTRY_SECOND = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or"]);

const BRANDS: Record<string, string> = {
  adobe: "adobe.com",
  amplitude: "amplitude.com",
  amzn: "amazon.com",
  apollo: "apollo.io",
  asana: "asana.com",
  astronomer: "astronomer.io",
  atlassian: "atlassian.com",
  auth0: "auth0.com",
  aws: "aws.amazon.com",
  awslabs: "aws.amazon.com",
  azurecosmosdb: "azure.microsoft.com",
  "bigdata-com": "bigdata.com",
  blackrock: "blackrock.com",
  blockscout: "blockscout.com",
  box: "box.com",
  buildkite: "buildkite.com",
  chromedevtools: "developer.chrome.com",
  circlebackai: "circleback.ai",
  "clay-run": "clay.com",
  clickhouse: "clickhouse.com",
  cloudflare: "cloudflare.com",
  cockroachdb: "cockroachlabs.com",
  coderabbitai: "coderabbit.ai",
  "common-room": "commonroom.io",
  "confident-ai": "confident-ai.com",
  context7: "context7.com",
  coursera: "coursera.org",
  crowdstrike: "crowdstrike.com",
  daloopa: "daloopa.com",
  discord: "discord.com",
  doist: "todoist.com",
  excalidraw: "excalidraw.com",
  expo: "expo.dev",
  fastly: "fastly.com",
  figma: "figma.com",
  firebase: "firebase.google.com",
  firecrawl: "firecrawl.dev",
  forcedotcom: "salesforce.com",
  "get-convex": "convex.dev",
  getsentry: "sentry.io",
  github: "github.com",
  gitlab: "gitlab.com",
  harness: "harness.io",
  honeycombio: "honeycomb.io",
  huggingface: "huggingface.co",
  intercom: "intercom.com",
  intuit: "intuit.com",
  "laravel-boost": "laravel.com",
  "learn-with-coursera": "coursera.org",
  linear: "linear.app",
  makenotion: "notion.so",
  mercadopago: "mercadopago.com",
  microsoft: "microsoft.com",
  microsoftdocs: "learn.microsoft.com",
  miro: "miro.com",
  modelcontextprotocol: "modelcontextprotocol.io",
  neondatabase: "neon.tech",
  netlify: "netlify.com",
  opentargets: "opentargets.org",
  oracle: "oracle.com",
  pagerduty: "pagerduty.com",
  "pinecone-io": "pinecone.io",
  playwright: "playwright.dev",
  postmanlabs: "postman.com",
  pydantic: "pydantic.dev",
  "qodo-ai": "qodo.ai",
  salesforceairesearch: "salesforce.com",
  sap: "sap.com",
  semgrep: "semgrep.dev",
  shopify: "shopify.com",
  slackapi: "slack.com",
  "slack-by-salesforce": "slack.com",
  sonatype: "sonatype.com",
  spotify: "spotify.com",
  stripe: "stripe.com",
  supabase: "supabase.com",
  "supabase-community": "supabase.com",
  telegram: "telegram.org",
  terraform: "terraform.io",
  timescale: "timescale.com",
  ui5: "sap.com",
  vercel: "vercel.com",
  zapier: "zapier.com",
  "zoom-plugin": "zoom.us",
  zscaler: "zscaler.com",
};

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const shared = (host: string) => [...SHARED_HOSTS].some((one) => host === one || host.endsWith(`.${one}`));

export function siteOfHost(host: string) {
  const clean = host.toLowerCase().replace(/^www\./, "");
  if (!HOST.test(clean) || shared(clean)) return "";
  const labels = clean.split(".");
  const keep = labels.length > 2 && labels.at(-1)!.length === 2 && COUNTRY_SECOND.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export const siteOfUrl = (url: string) => siteOfHost(hostOf(url));

const squeeze = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function siteOf(listing: Pick<Listing, "name" | "title" | "homepage" | "author" | "badge">): string {
  const home = hostOf(listing.homepage);
  const owner = home === "github.com" ? new URL(listing.homepage).pathname.split("/")[1]?.toLowerCase() || "" : "";
  const sites = [owner ? BRANDS[owner] || "" : siteOfHost(home), siteOfHost(listing.author || "")].filter(Boolean);
  const title = squeeze(`${listing.title}${listing.name}`);
  const named = sites.find((site) => title.includes(squeeze(site.split(".").at(-2) || site)));
  if (named || sites.length) return named || sites[0];
  if (listing.badge === "anthropic" || listing.badge === "partner") return BRANDS[listing.name.toLowerCase()] || "";
  return "";
}

export function monogramOf(title: string) {
  const words = title
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return "·";
  const letters = words.length > 1 ? [words[0][0], words[1][0]] : [words[0][0]];
  return letters.join("").toUpperCase();
}

const faces = new WeakMap<object, string>();

export function faceOf(listing: Listing) {
  let site = faces.get(listing);
  if (site === undefined) {
    site = siteOf(listing);
    faces.set(listing, site);
  }
  return site;
}
