import { useStore } from "zustand";
import type { Listing } from "../../ipc/types";
import { compact, when } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { BADGES, KIND_CHIPS, KIND_ICONS, KIND_NAMES, SOURCE_CHIPS, exploreList, originFor } from "./kinds";
import { capabilities, loadMarket, openDetail, pickKind, pickSource, rank, seek, showMore } from "./store";

export function Explore({ hidden }: { hidden: boolean }) {
  const market = useStore(capabilities, (s) => s.market);
  const asking = useStore(capabilities, (s) => s.marketAsking);
  const hitsFault = useStore(capabilities, (s) => s.hitsFault);
  const query = useStore(capabilities, (s) => s.query);
  const kind = useStore(capabilities, (s) => s.kind);
  const source = useStore(capabilities, (s) => s.source);

  const failed = (market?.sources || []).filter((one) => one.error).map((one) => `${one.label}: ${one.error}`);
  if (hitsFault) failed.push(`skills.sh: ${hitsFault}`);
  const newest = Math.max(0, ...(market?.sources || []).map((one) => one.fetchedAt || 0));

  return (
    <div id="caps-explore" role="tabpanel" aria-labelledby="caps-mode-explore" hidden={hidden}>
      <div className="seek view-seek" id="market-seek" role="search">
        <Icon svg={ICONS.search} />
        <input
          className="field"
          id="market-search"
          placeholder="Busca plugins, skills o conectores…"
          aria-label="Buscar en el mercado"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => seek(event.target.value)}
        />
      </div>
      <div className="chips" id="market-kinds" role="group" aria-label="Tipo">
        <span className="chips-label">Tipo</span>
        {KIND_CHIPS.map(([id, label]) => (
          <button key={id} className="chip" data-kind={id} aria-pressed={id === kind} onClick={() => pickKind(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="chips" id="market-sources" role="group" aria-label="Fuente">
        <span className="chips-label">Fuente</span>
        {SOURCE_CHIPS.map(([id, label]) => (
          <button key={id} className="chip" data-source={id} aria-pressed={id === source} onClick={() => pickSource(id)}>
            {label}
          </button>
        ))}
      </div>
      <p className={failed.length ? "none fault" : "none"} id="market-note" hidden={!failed.length}>
        {failed.length ? `No pude actualizar ${failed.join(" · ")}` : ""}
      </p>
      <MarketList />
      <p className="view-foot" id="market-foot">
        <span id="market-when">{newest ? `Catálogo del ${when(newest)}` : ""}</span>
        <button className="link-btn" id="market-refresh" disabled={asking} onClick={() => loadMarket(true)}>
          {asking ? "Actualizando…" : "Actualizar catálogo"}
        </button>
      </p>
    </div>
  );
}

function MarketList() {
  const market = useStore(capabilities, (s) => s.market);
  const fault = useStore(capabilities, (s) => s.marketFault);
  const hits = useStore(capabilities, (s) => s.hits);
  const seeking = useStore(capabilities, (s) => s.seeking);
  const query = useStore(capabilities, (s) => s.query);
  const kind = useStore(capabilities, (s) => s.kind);
  const source = useStore(capabilities, (s) => s.source);
  const shown = useStore(capabilities, (s) => s.shown);
  const caps = useStore(capabilities, (s) => s.caps);

  let list;
  let left = 0;
  if (!market) {
    list = <p className={fault ? "none fault" : "none"}>{fault || "Cargando el catálogo…"}</p>;
  } else {
    const { needle, found } = exploreList(market.listings, hits, query, kind, source, rank);
    if (!found.length) {
      list = <p className="none">{seeking && needle.length >= 2 ? "Buscando también en skills.sh…" : "Nada coincide."}</p>;
    } else {
      left = found.length - shown;
      list = (
        <div className="card-grid" role="list">
          {found.slice(0, shown).map((listing) => (
            <MarketCard key={listing.id} listing={listing} installed={Boolean(originFor(caps, listing.id))} />
          ))}
        </div>
      );
    }
  }

  return (
    <>
      <div className="view-list" id="market-list" aria-live="polite">
        {list}
      </div>
      <div className="market-more">
        <button className="quiet" id="market-more" hidden={left <= 0} onClick={showMore}>
          {`Ver más (${left})`}
        </button>
      </div>
    </>
  );
}

function MarketCard({ listing, installed }: { listing: Listing; installed: boolean }) {
  const said = listing.description || listing.category || listing.author;
  const by = listing.installs ? `${compact(listing.installs)} instalaciones` : listing.author;
  return (
    <div className="card opens" role="listitem">
      <div className="card-top">
        <span className="card-art">
          <Icon svg={KIND_ICONS[listing.kind]} />
        </span>
        <span className="label">{KIND_NAMES[listing.kind]}</span>
      </div>
      <button className="card-main" title={said} onClick={() => openDetail(listing.id)}>
        <span className="name">{listing.title}</span>
        <span className="sub">{said}</span>
      </button>
      <div className="card-foot">
        <span className="badge">{BADGES[listing.badge]}</span>
        {by && by !== BADGES[listing.badge] && <span>{by}</span>}
        {listing.login && (
          <span className="key" title="Pide iniciar sesión" aria-label="Pide iniciar sesión">
            <Icon svg={ICONS.keyRound} />
          </span>
        )}
        {installed && <span className="installed">Instalada</span>}
      </div>
    </div>
  );
}
