import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import type { Capabilities, Listing, SourceState } from "../../ipc/types";
import { compact, stem, when } from "../../shared/format.js";
import { localeNow } from "../../shared/i18n";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { ViewSeek } from "../../shared/ViewParts";
import { project } from "../project/store";
import { t } from "./copy";
import { ListingFace } from "./Face";
import { addListing } from "./forms";
import { CapSwitch } from "./Installed";
import {
  KIND_IDS,
  SOURCE_IDS,
  badgeName,
  exploreList,
  installedItem,
  kindChip,
  kindName,
  originFor,
  sourceChip,
  specOf,
  type Place,
} from "./kinds";
import { connectable, featured, sectionRows } from "./picks";
import { SECTION_ICONS, SECTION_IDS, sectionOf, tallyBySection, type SectionId } from "./sections";
import { capabilities, loadMarket, openDetail, pickKind, pickPlace, pickSource, rank, seek, showMore } from "./store";

const number = (value: number) => value.toLocaleString(localeNow());
const sectionName = (id: SectionId) => t.sectionNames[id];
const sourceName = (source: SourceState) => (t.sourceNames as Record<string, string>)[source.id] || source.id;

export function Explore({ hidden }: { hidden: boolean }) {
  const market = useStore(capabilities, (s) => s.market);
  const fault = useStore(capabilities, (s) => s.marketFault);
  const asking = useStore(capabilities, (s) => s.marketAsking);
  const hitsFault = useStore(capabilities, (s) => s.hitsFault);
  const hits = useStore(capabilities, (s) => s.hits);
  const query = useStore(capabilities, (s) => s.query);
  const kind = useStore(capabilities, (s) => s.kind);
  const source = useStore(capabilities, (s) => s.source);
  const place = useStore(capabilities, (s) => s.place);
  const cardFault = useStore(capabilities, (s) => s.exploreFault);
  const root = useStore(project, (s) => s.root);

  const listings = market?.listings;
  const list = useMemo(() => (listings ? exploreList(listings, hits, query, kind, source, rank, place) : null), [listings, hits, query, kind, source, place]);
  const counts = useMemo(() => (list ? tallyBySection(list.matched) : null), [list]);

  const failed = (market?.sources || []).filter((one) => one.error).map((one) => `${sourceName(one)}: ${one.error}`);
  if (hitsFault) failed.push(`skills.sh: ${hitsFault}`);
  const newest = Math.max(0, ...(market?.sources || []).map((one) => one.fetchedAt || 0));
  const at: Place = place === "home" && list?.needle ? "all" : place;

  return (
    <div id="caps-explore" role="tabpanel" aria-labelledby="caps-mode-explore" hidden={hidden}>
      <ViewSeek
        id="market-seek"
        input="market-search"
        label={t.seekMarket}
        placeholder={listings?.length ? t.seekMarketHint(number(listings.length)) : t.seekMarketHintPlain}
        value={query}
        change={seek}
      />
      <div className="mk-filters">
        <Chips id="market-kinds" label={t.kind} ids={KIND_IDS} at={kind} name={kindChip} pick={pickKind} />
        <Chips id="market-sources" label={t.source} ids={SOURCE_IDS} at={source} name={sourceChip} pick={pickSource} />
        <span className="mk-target" id="market-target" title={root}>
          <Icon svg={ICONS.project} />
          {root ? t.addsTo(stem(root)) : t.noProject}
        </span>
      </div>
      <p className={failed.length ? "none fault" : "none"} id="market-note" hidden={!failed.length}>
        {failed.length ? t.couldNotUpdate(failed.join(" · ")) : ""}
      </p>
      {cardFault && (
        <p className="none fault" role="alert">
          {cardFault}
        </p>
      )}
      {!list || !counts ? (
        <p className={fault ? "none fault" : "none"} id="market-list">
          {fault || t.loadingCatalogue}
        </p>
      ) : (
        <div className="mk-layout">
          <Places at={at} total={list.matched.length} counts={counts} />
          <div className="mk-main" id="market-list" aria-live="polite">
            {at === "home" ? <Home listings={list.matched} /> : <Browse at={at} found={list.found} needle={list.needle} query={query} />}
          </div>
        </div>
      )}
      <p className="view-foot" id="market-foot">
        <span id="market-when">{newest ? t.catalogueOf(when(newest)) : ""}</span>
        <button className="link-btn" id="market-refresh" disabled={asking} onClick={() => loadMarket(true)}>
          {asking ? t.refreshing : t.refresh}
        </button>
      </p>
    </div>
  );
}

function Chips<T extends string>({
  id,
  label,
  ids,
  at,
  name,
  pick,
}: {
  id: string;
  label: string;
  ids: T[];
  at: T;
  name: (id: T) => string;
  pick: (id: T) => void;
}) {
  return (
    <div className="chips" id={id} role="group" aria-label={label}>
      <span className="chips-label">{label}</span>
      {ids.map((one) => (
        <button key={one} className="chip" data-value={one} aria-pressed={one === at} onClick={() => pick(one)}>
          {name(one)}
        </button>
      ))}
    </div>
  );
}

function Places({ at, total, counts }: { at: Place; total: number; counts: Record<SectionId, number> }) {
  const place = (id: Place, icon: string, label: string, count: number | null) => (
    <button key={id} className="mk-place" data-place={id} aria-current={id === at ? "true" : undefined} onClick={() => pickPlace(id)}>
      <Icon svg={icon} />
      <span className="mk-place-name">{label}</span>
      {count !== null && <span className="count">{number(count)}</span>}
    </button>
  );
  return (
    <nav className="mk-places" aria-label={t.sections}>
      {place("home", ICONS.compass, t.discover, null)}
      {place("all", ICONS.grid, t.everything, total)}
      <span className="mk-rule" aria-hidden="true" />
      {SECTION_IDS.filter((id) => counts[id] > 0 || id === at).map((id) => place(id, SECTION_ICONS[id], sectionName(id), counts[id]))}
    </nav>
  );
}

function Home({ listings }: { listings: Listing[] }) {
  const top = useMemo(() => featured(listings), [listings]);
  const tools = useMemo(() => connectable(listings), [listings]);
  const rows = useMemo(() => sectionRows(listings, new Set([...top, ...tools].map((listing) => listing.id))), [listings, top, tools]);
  return (
    <div className="mk-home">
      <ol className="mk-steps" aria-label={t.steps}>
        <li>
          <Icon svg={ICONS.download} />
          <span>
            <b>{t.stepInstall}</b>
            {t.stepInstallSaid}
          </span>
        </li>
        <li>
          <Icon svg={ICONS.toggle} />
          <span>
            <b>{t.stepEnable}</b>
            {t.stepEnableSaid}
          </span>
        </li>
        <li>
          <Icon svg={ICONS.message} />
          <span>
            <b>{t.stepUse}</b>
            {t.stepUseSaid}
          </span>
        </li>
      </ol>
      {top.length > 0 && <Shelf id="featured" title={t.startHere} said={t.startHereSaid} listings={top} />}
      {tools.length > 0 && (
        <Shelf
          id="connect"
          title={t.connectTools}
          said={t.connectToolsSaid}
          listings={tools}
          more={() => {
            pickKind("connector");
            pickPlace("all");
          }}
        />
      )}
      {rows.map((row) => (
        <Shelf key={row.id} id={row.id} icon={SECTION_ICONS[row.id]} title={sectionName(row.id)} count={row.count} listings={row.picks} more={() => pickPlace(row.id)} />
      ))}
      {!top.length && !tools.length && !rows.length && <p className="none">{t.nothingMatches}</p>}
    </div>
  );
}

function Shelf({
  id,
  icon,
  title,
  said,
  count,
  listings,
  more,
}: {
  id: string;
  icon?: string;
  title: string;
  said?: string;
  count?: number;
  listings: Listing[];
  more?: () => void;
}) {
  return (
    <section className="mk-shelf" data-shelf={id} aria-labelledby={`mk-shelf-${id}`}>
      <div className="mk-shelf-head">
        {icon && <Icon svg={icon} />}
        <h3 id={`mk-shelf-${id}`}>{title}</h3>
        {count !== undefined && <span className="count">{number(count)}</span>}
        {more && (
          <button className="mk-see" onClick={more} aria-label={t.seeAllOf(title)}>
            {t.seeAll}
            <Icon svg={ICONS.arrow} />
          </button>
        )}
      </div>
      {said && <p className="mk-shelf-said">{said}</p>}
      <div className="mk-grid" role="list">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </section>
  );
}

function Browse({ at, found, needle, query }: { at: Exclude<Place, "home">; found: Listing[]; needle: string; query: string }) {
  const shown = useStore(capabilities, (s) => s.shown);
  const seeking = useStore(capabilities, (s) => s.seeking);
  const left = Math.max(0, found.length - shown);
  const tail = useMore(left);
  const title = at === "all" ? t.everything : sectionName(at);

  return (
    <>
      <div className="mk-head">
        <h2 className="mk-title">
          <Icon svg={at === "all" ? ICONS.grid : SECTION_ICONS[at]} />
          {title}
        </h2>
        <p className="mk-about">
          {needle ? t.results(found.length, number(found.length), query.trim()) : at === "all" ? t.listed(found.length, number(found.length)) : t.sectionAbouts[at]}
        </p>
      </div>
      {!found.length ? (
        <p className="none">{seeking && needle.length >= 2 ? t.seekingSkillsSh : t.nothingMatches}</p>
      ) : (
        <div className="mk-grid" role="list">
          {found.slice(0, shown).map((listing) => (
            <ListingCard key={listing.id} listing={listing} section={at === "all"} />
          ))}
        </div>
      )}
      <div className="market-more" ref={tail}>
        <button className="quiet" id="market-more" hidden={left <= 0} onClick={showMore}>
          {t.showMore(number(left))}
        </button>
      </div>
    </>
  );
}

function useMore(left: number) {
  const tail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = tail.current;
    if (!node || left <= 0 || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((seen) => seen.some((one) => one.isIntersecting) && showMore(), {
      root: document.getElementById("capabilities-view"),
      rootMargin: "0px 0px 600px 0px",
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, [left]);
  return tail;
}

const bylineOf = (listing: Listing) =>
  listing.kind !== "connector" && listing.author && listing.author !== badgeName(listing.badge) ? t.by(listing.author) : "";

export function ListingCard({ listing, section = false }: { listing: Listing; section?: boolean }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const origin = originFor(caps, listing.id);
  const item = origin ? installedItem(caps, origin) : null;
  const said = listing.description || listing.category || listing.author;
  const by = [kindName(listing.kind), bylineOf(listing)].filter(Boolean).join(" · ");

  return (
    <div className="mk-card" role="listitem" data-kind={listing.kind}>
      <ListingFace listing={listing} />
      <button className="mk-card-main" title={said} onClick={() => openDetail(listing.id, listing)}>
        <span className="mk-card-name">{listing.title}</span>
        <span className="mk-card-by">{by}</span>
      </button>
      {said && <p className="mk-card-said">{said}</p>}
      <div className="mk-card-foot">
        <span className="mk-card-facts">
          <Trust badge={listing.badge} />
          {section && <span>{sectionName(sectionOf(listing))}</span>}
          {listing.tools.length > 0 && (
            <span className="mk-fact">
              <Icon svg={ICONS.wrench} />
              {t.tools(listing.tools.length)}
            </span>
          )}
          {listing.installs ? <span>{t.installs(compact(listing.installs))}</span> : null}
          {listing.login && (
            <span className="mk-fact">
              <Icon svg={ICONS.key} />
              {t.signIn}
            </span>
          )}
          {!listing.installable && !listing.login && <span>{t.notInstallable}</span>}
        </span>
        {origin && <span className="mk-state">{item?.enabled ? t.enabledTag : t.installedTag}</span>}
        <CardAction listing={listing} caps={caps} />
      </div>
    </div>
  );
}

export function Trust({ badge }: { badge: Listing["badge"] }) {
  const vouched = badge === "anthropic" || badge === "partner";
  return (
    <span className="mk-trust" data-badge={badge}>
      {vouched && <Icon svg={ICONS.badge} />}
      {badgeName(badge)}
    </span>
  );
}

function CardAction({ listing, caps }: { listing: Listing; caps: Capabilities }) {
  const root = useStore(project, (s) => s.root);
  const adding = useStore(capabilities, (s) => s.adding.includes(listing.id));
  const origin = originFor(caps, listing.id);
  if (origin) {
    const item = installedItem(caps, origin);
    return item ? (
      <span className="mk-card-act">
        <CapSwitch spec={specOf(origin)} item={item} where="exploreFault" />
      </span>
    ) : null;
  }
  if (!listing.installable) return null;
  const label = root ? t.addTo(listing.title, stem(root)) : t.installNamed(listing.title);
  return (
    <span className="mk-card-act">
      <button className="mk-add" title={label} aria-label={label} aria-busy={adding || undefined} disabled={adding} onClick={(event) => addListing(listing, event.currentTarget)}>
        <Icon svg={ICONS.plus} />
        {adding ? t.adding : root ? t.addCard : t.installCard}
      </button>
    </span>
  );
}
