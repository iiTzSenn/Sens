import { useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Capabilities, Listing, Server } from "../../ipc/types";
import { EmptyView } from "../../shared/EmptyView";
import { stem } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet } from "../../shared/useSheet";
import { CountTabs, ProjectFocus, ViewSeek } from "../../shared/ViewParts";
import { plain } from "../market/search.js";
import { project } from "../project/store";
import { t } from "./copy";
import { Face, ListingFace } from "./Face";
import { siteOfUrl } from "./faces";
import { confirmRemoval } from "./forms";
import { CAP_TABS, capTabList, entriesOf, matching, tallyOf, type CapTab, type Entry, type Item, type Spec } from "./kinds";
import { capabilities, openDetail, openSkill, pickTab, toggle, updateInstalled, type Where } from "./store";

export function Installed({ hidden }: { hidden: boolean }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const tab = useStore(capabilities, (s) => s.tab);
  const loadFault = useStore(capabilities, (s) => s.loadFault);
  const listFault = useStore(capabilities, (s) => s.listFault);
  const [search, setSearch] = useState("");
  const entries = entriesOf(caps);

  return (
    <div id="caps-installed" role="tabpanel" aria-labelledby="caps-mode-installed" hidden={hidden}>
      <ProjectFocus prefix="caps" tally={() => tallyOf(caps)} unopened={t.unopened} note={t.loadsNote} />
      <div className="view-head">
        <CountTabs
          prefix="caps"
          label={t.kindTabs}
          tabs={capTabList()}
          at={tab}
          count={(id) => entries.filter(CAP_TABS[id].keeps).length}
          pick={pickTab}
        />
      </div>
      <ViewSeek
        id="caps-seek"
        input="caps-search"
        label={t.seekInstalled}
        placeholder={t.seekInstalledHint}
        value={search}
        change={setSearch}
        hidden={!entries.length}
      />
      <div className="view-list" id="caps-list" role="tabpanel" aria-labelledby={`caps-tab-${tab}`}>
        {loadFault ? (
          <p className="none fault" role="alert">
            {loadFault}
          </p>
        ) : (
          <>
            {listFault && (
              <p className="none fault" role="alert">
                {listFault}
              </p>
            )}
            <CapList caps={caps} entries={entries.filter(CAP_TABS[tab].keeps)} tab={tab} search={search} />
          </>
        )}
      </div>
      <p className="view-foot" id="caps-foot">
        <Icon svg={ICONS.shieldCheck} />
        {t.yourChoice}
      </p>
    </div>
  );
}

function CapList({ caps, entries, tab, search }: { caps: Capabilities; entries: Entry[]; tab: CapTab; search: string }) {
  const root = useStore(project, (s) => s.root);
  const market = useStore(capabilities, (s) => s.market);
  const byId = useMemo(() => new Map((market?.listings || []).map((listing) => [listing.id, listing])), [market]);
  if (!entries.length) {
    const [lead, said] = CAP_TABS[tab].empty();
    return <EmptyView art={ICONS.capabilities} lead={lead} said={said} />;
  }
  const needle = plain(search.trim());
  const shown = needle ? entries.filter(matching(needle)) : entries;
  if (!shown.length) return <p className="none">{t.nothingMatches}</p>;
  const row = (entry: Entry) => {
    const origin = caps.origins[`${entry.spec.origin}:${entry.item.name}`];
    return <CapRow key={`${entry.spec.origin}:${entry.item.name}`} {...entry} listing={origin ? byId.get(origin.listing) || null : null} caps={caps} />;
  };
  if (!root) return <CapGroup id="installed" title={t.installedGroup} rows={shown.map(row)} />;
  const on = shown.filter(({ item }) => item.enabled);
  const off = shown.filter(({ item }) => !item.enabled);
  return (
    <>
      {on.length > 0 && <CapGroup id="on" title={t.groupOn(stem(root))} rows={on.map(row)} />}
      {off.length > 0 && <CapGroup id="off" title={t.groupOff(stem(root))} rows={off.map(row)} />}
    </>
  );
}

function CapGroup({ id, title, rows }: { id: string; title: string; rows: ReactNode[] }) {
  return (
    <section className="cap-group" data-group={id} aria-labelledby={`cap-group-${id}`}>
      <h3 className="label" id={`cap-group-${id}`}>
        {title} <span className="count">{rows.length}</span>
      </h3>
      <div className="cap-rows" role="list">
        {rows}
      </div>
    </section>
  );
}

const serverSite = (item: Item) => siteOfUrl((item as Server).url || "");

function CapRow({ spec, item, caps, listing }: Entry & { caps: Capabilities; listing: Listing | null }) {
  const detail = spec.detail(item);
  const origin = caps.origins[`${spec.origin}:${item.name}`];
  const opens = origin ? () => openDetail(origin.listing, listing) : spec.readable ? () => openSkill(item.name) : null;
  const stale = Boolean(origin && listing?.revision && listing.revision !== origin.revision);
  const facts = [spec.label(), listing ? listing.title !== item.name && listing.title : "", origin ? origin.version && `v${origin.version}` : t.local].filter(Boolean);
  const text = (
    <>
      <span className="cap-row-name">{item.name}</span>
      {detail && <span className={spec.mono ? "cap-row-said mono" : "cap-row-said"}>{detail}</span>}
    </>
  );
  return (
    <div className="cap-row" role="listitem" data-on={item.enabled}>
      {listing ? <ListingFace listing={listing} /> : <Face title={item.name} site={serverSite(item)} icon={spec.icon} />}
      <div className="cap-row-body">
        {opens ? (
          <button className="cap-row-main" title={detail} onClick={opens}>
            {text}
          </button>
        ) : (
          <div className="cap-row-main" title={detail}>
            {text}
          </div>
        )}
        <span className="cap-row-facts">
          {facts.join(" · ")}
          {stale && (
            <span className="cap-stale">
              <Icon svg={ICONS.updateReady} />
              {t.updateReady}
            </span>
          )}
        </span>
      </div>
      <div className="cap-row-controls">
        <CapMore spec={spec} item={item} listing={stale ? listing : null} opens={origin ? opens : null} />
        <CapSwitch spec={spec} item={item} />
      </div>
    </div>
  );
}

// A second click while Rust is still answering the first is ignored.
export function CapSwitch({ spec, item, where }: { spec: Spec; item: Item; where?: Where }) {
  const root = useStore(project, (s) => s.root);
  const waiting = useRef(false);

  async function flip() {
    if (waiting.current || !root) return;
    waiting.current = true;
    await toggle(spec, item.name, where);
    waiting.current = false;
  }

  return (
    <button
      className="switch"
      role="switch"
      aria-label={root ? t.enableIn(item.name, stem(root)) : t.enable(item.name)}
      title={root ? t.enableIn(item.name, stem(root)) : t.openToEnable}
      disabled={!root}
      aria-disabled={!root}
      aria-checked={item.enabled}
      onClick={flip}
    />
  );
}

function CapMore({ spec, item, listing, opens }: { spec: Spec; item: Item; listing: Listing | null; opens: (() => void) | null }) {
  const menu = useSheet();
  const title = t.actionsOf(item.name);
  const pick = (then: () => unknown) => {
    menu.shut();
    then();
  };
  return (
    <span className="card-more">
      <button className="round" ref={menu.anchor} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <Icon svg={ICONS.ellipsis} />
      </button>
      <div className="sheet menu drop" role="menu" aria-label={title} {...menu.sheet}>
        {opens && (
          <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(opens)}>
            {t.details}
          </button>
        )}
        {listing && (
          <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(() => updateInstalled(listing, item.name, "listFault"))}>
            {t.update}
          </button>
        )}
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(() => confirmRemoval(spec, item.name, menu.anchor.current!))}>
          {opens ? t.uninstall : t.remove}
        </button>
      </div>
    </span>
  );
}
