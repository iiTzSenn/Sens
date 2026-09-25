import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Artifact } from "../../ipc/types";
import { resume } from "../../app/session";
import { EmptyView } from "../../shared/EmptyView";
import { ago, when } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSeen } from "../../shared/useSeen";
import { CountTabs, ProjectFocus, ViewSeek } from "../../shared/ViewParts";
import { plain } from "../market/search.js";
import { t } from "./copy";
import { KIND_ICON, keeps, keptTally, kindOf, originOf, pictureKey, saying, sessionOf, shelfTabs, type ShelfTab } from "./items";
import { artifacts, openArtifact, pickTab, picture } from "./store";

export function Shelf() {
  const items = useStore(artifacts, (s) => s.items);
  const tab = useStore(artifacts, (s) => s.tab);
  const loadFault = useStore(artifacts, (s) => s.loadFault);
  const listFault = useStore(artifacts, (s) => s.listFault);
  const [search, setSearch] = useState("");

  return (
    <>
      <header className="view-top">
        <div>
          <h1 className="label">{t.title}</h1>
          <p>{t.lead}</p>
        </div>
      </header>
      <ProjectFocus
        prefix="shelf"
        tally={(root) => keptTally(items.filter((item) => item.root === root).length)}
        unopened={t.unopened}
        note={t.note}
      />
      <div className="view-head">
        <CountTabs
          prefix="shelf"
          label={t.kindsLabel}
          tabs={shelfTabs()}
          at={tab}
          count={(id) => items.filter((item) => keeps(id, item)).length}
          pick={pickTab}
        />
      </div>
      <ViewSeek
        id="shelf-seek"
        input="shelf-search"
        label={t.search}
        placeholder={t.searching}
        value={search}
        change={setSearch}
        hidden={!items.length}
      />
      <div className="view-list" id="shelf-list" role="tabpanel" aria-labelledby={`shelf-tab-${tab}`}>
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
            <ShelfList items={items.filter((item) => keeps(tab, item))} tab={tab} search={search} />
          </>
        )}
      </div>
      <p className="view-foot" id="shelf-foot">
        <Icon svg={ICONS.shieldCheck} />
        {t.foot}
      </p>
    </>
  );
}

function ShelfList({ items, tab, search }: { items: Artifact[]; tab: ShelfTab; search: string }) {
  if (!items.length) {
    return (
      <EmptyView
        art={ICONS.shelf}
        lead={t.emptyLead}
        said={t.emptySaid}
      />
    );
  }
  const needle = plain(search.trim());
  const shown = needle ? items.filter(saying(needle)) : items;
  if (!shown.length) return <p className="none">{t.noMatch}</p>;
  if (tab === "image") {
    return (
      <div className="thumbs">
        {shown.map((item) => (
          <Thumb key={pictureKey(item)} item={item} />
        ))}
      </div>
    );
  }
  return (
    <div className="card-grid" role="list">
      {shown.map((item) => (
        <ArtifactCard key={pictureKey(item)} item={item} />
      ))}
    </div>
  );
}

function ArtifactCard({ item }: { item: Artifact }) {
  return (
    <div className="card opens" role="listitem">
      <div className="card-top">
        <span className="card-art">
          <Icon svg={KIND_ICON[item.kind] || ICONS.fileText} />
        </span>
        <span className="label">{kindOf(item)}</span>
      </div>
      <button className="card-main" title={item.target} onClick={(event) => openArtifact(item, event.currentTarget)}>
        <span className={item.kind === "link" ? "name url" : "name"}>{item.name}</span>
        <span className="sub">{item.project}</span>
      </button>
      <div className="card-controls">
        <Origin item={item} />
        <span className="at" title={when(item.at)}>
          {ago(item.at)}
        </span>
      </div>
    </div>
  );
}

function Origin({ item }: { item: Artifact }) {
  if (!item.session) {
    return (
      <span className="from" data-empty="true">
        {t.noSession}
      </span>
    );
  }
  const said = sessionOf(item);
  const session = item.session;
  return (
    <button className="from" title={t.openSession(said)} onClick={() => resume(item.root, session)}>
      {said}
    </button>
  );
}

// The picture is read once the thumbnail comes near the visible part of the view.
function Thumb({ item }: { item: Artifact }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState("");
  const [fault, setFault] = useState("");
  const key = pictureKey(item);
  const seen = useSeen(frame, { root: () => document.getElementById("shelf"), margin: "200px" });

  useEffect(() => {
    if (seen) picture(item).then(setSrc, (reason) => setFault(String(reason)));
  }, [seen, key]);

  return (
    <button
      className="thumb"
      aria-label={item.name}
      title={[item.name, originOf(item)].filter(Boolean).join(" · ")}
      onClick={(event) => openArtifact(item, event.currentTarget)}
    >
      <span className="frame" ref={frame} title={fault || undefined}>
        {src ? <img alt={item.name} decoding="async" src={src} /> : <Icon svg={ICONS.image} />}
      </span>
      <span className="name">{item.name}</span>
    </button>
  );
}
