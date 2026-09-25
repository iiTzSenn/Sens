import type { Listing } from "../../ipc/types";
import { faceOf } from "./faces";
import { SECTION_IDS, sectionOf, type SectionId } from "./sections";

export const FEATURED = [
  "official:code-review",
  "official:feature-dev",
  "official:frontend-design",
  "official:security-guidance",
  "official:pr-review-toolkit",
  "official:commit-commands",
  "skills:webapp-testing",
  "skills:mcp-builder",
];

export const CONNECTABLE = [
  "connectors:com.microsoft/microsoft-learn-mcp",
  "connectors:io.github.antonpk1/excalidraw-mcp-app",
  "connectors:com.mermaidchart/mermaid-mcp",
  "connectors:com.tldraw/tldraw",
  "connectors:com.tigerdata/pg-aiguide",
  "connectors:io.apollographql.mcp/graphos-tools",
  "connectors:com.clerk/mcp",
  "connectors:com.wolfram/wolfram",
];

export const ROW = 6;
export const SECTION_ROW = 3;

const TRUST: Record<Listing["badge"], number> = { anthropic: 0, partner: 1, community: 2, skillsSh: 3 };

export const ordered = (list: Listing[]) =>
  list
    .map((listing, at) => ({ listing, at }))
    .sort((a, b) => TRUST[a.listing.badge] - TRUST[b.listing.badge] || Number(!a.listing.installable) - Number(!b.listing.installable) || a.at - b.at)
    .map(({ listing }) => listing);

function picked(listings: Listing[], ids: string[], fill: (listing: Listing) => boolean) {
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const chosen = ids.map((id) => byId.get(id)).filter((listing): listing is Listing => Boolean(listing?.installable));
  const taken = new Set(chosen.map((listing) => listing.id));
  for (const listing of ordered(listings)) {
    if (chosen.length >= ROW) break;
    if (!taken.has(listing.id) && listing.installable && fill(listing)) chosen.push(listing);
  }
  return chosen.slice(0, ROW);
}

export const featured = (listings: Listing[]) => picked(listings, FEATURED, (listing) => listing.badge === "anthropic");

export const connectable = (listings: Listing[]) => picked(listings, CONNECTABLE, (listing) => listing.kind === "connector");

const familyOf = (listing: Listing) => listing.author.toLowerCase() || listing.name.split("-").at(-1) || listing.name;

export function sectionRows(listings: Listing[], taken: Set<string>) {
  const rows = new Map<SectionId, { count: number; picks: Listing[] }>();
  for (const id of SECTION_IDS) rows.set(id, { count: 0, picks: [] });
  const families = new Map<SectionId, Set<string>>();
  const ranked = ordered(listings).sort((a, b) => TRUST[a.badge] - TRUST[b.badge] || Number(!faceOf(a)) - Number(!faceOf(b)));
  for (const listing of ranked) {
    const section = sectionOf(listing);
    const row = rows.get(section)!;
    row.count++;
    if (row.picks.length >= SECTION_ROW || taken.has(listing.id) || !listing.installable) continue;
    const seen = families.get(section) || new Set<string>();
    if (seen.has(familyOf(listing))) continue;
    seen.add(familyOf(listing));
    families.set(section, seen);
    row.picks.push(listing);
  }
  return SECTION_IDS.filter((id) => id !== "other" && rows.get(id)!.picks.length).map((id) => ({ id, ...rows.get(id)! }));
}
