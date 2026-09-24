import { useRef, useState } from "react";
import { useStore } from "zustand";
import type { Capabilities } from "../../ipc/types";
import { EmptyView } from "../../shared/EmptyView";
import { stem } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet } from "../../shared/useSheet";
import { CountTabs, ProjectFocus, ViewSeek } from "../../shared/ViewParts";
import { plain } from "../market/search.js";
import { project } from "../project/store";
import { confirmRemoval } from "./forms";
import { CAP_TABS, CAP_TAB_LIST, entriesOf, matching, tallyOf, type CapTab, type Entry, type Item, type Spec } from "./kinds";
import { capabilities, openDetail, openSkill, pickTab, toggle } from "./store";

export function Installed({ hidden }: { hidden: boolean }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const tab = useStore(capabilities, (s) => s.tab);
  const loadFault = useStore(capabilities, (s) => s.loadFault);
  const listFault = useStore(capabilities, (s) => s.listFault);
  const [search, setSearch] = useState("");
  const entries = entriesOf(caps);

  return (
    <div id="caps-installed" role="tabpanel" aria-labelledby="caps-mode-installed" hidden={hidden}>
      <ProjectFocus
        prefix="caps"
        tally={() => tallyOf(caps)}
        unopened="Abre un proyecto para activar capacidades."
        note="El agente las carga a partir de tu próximo mensaje en este proyecto."
      />
      <div className="view-head">
        <CountTabs
          prefix="caps"
          label="Tipos de capacidad"
          tabs={CAP_TAB_LIST}
          at={tab}
          count={(id) => entries.filter(CAP_TABS[id].keeps).length}
          pick={pickTab}
        />
      </div>
      <ViewSeek
        id="caps-seek"
        input="caps-search"
        label="Buscar una skill, plugin o servidor"
        placeholder="Buscar una skill, plugin o servidor…"
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
        Tú decides qué se activa en cada proyecto.
      </p>
    </div>
  );
}

function CapList({ caps, entries, tab, search }: { caps: Capabilities; entries: Entry[]; tab: CapTab; search: string }) {
  if (!entries.length) {
    const [lead, said] = CAP_TABS[tab].empty;
    return <EmptyView art={ICONS.capabilities} lead={lead} said={said} />;
  }
  const needle = plain(search.trim());
  const shown = needle ? entries.filter(matching(needle)) : entries;
  if (!shown.length) return <p className="none">Nada coincide.</p>;
  return (
    <div className="card-grid" role="list">
      {shown.map(({ spec, item }) => (
        <CapCard key={`${spec.origin}:${item.name}`} spec={spec} item={item} caps={caps} />
      ))}
    </div>
  );
}

function CapCard({ spec, item, caps }: Entry & { caps: Capabilities }) {
  const detail = spec.detail(item);
  const origin = caps.origins[`${spec.origin}:${item.name}`];
  const opens = origin ? () => openDetail(origin.listing) : spec.readable ? () => openSkill(item.name) : null;
  const text = (
    <>
      <span className="name">{item.name}</span>
      <span className={spec.mono ? "sub mono" : "sub"}>{detail}</span>
    </>
  );
  return (
    <div className={opens ? "card opens" : "card"} role="listitem">
      <div className="card-top">
        <span className="card-art">
          <Icon svg={spec.icon} />
        </span>
        <span className="label">{spec.label}</span>
      </div>
      {opens ? (
        <button className="card-main" title={detail} onClick={opens}>
          {text}
        </button>
      ) : (
        <div className="card-main" title={detail}>
          {text}
        </div>
      )}
      <div className="card-controls">
        <CapMore spec={spec} item={item} />
        <CapSwitch spec={spec} item={item} />
      </div>
    </div>
  );
}

// A second click while Rust is still answering the first is ignored.
export function CapSwitch({ spec, item, where }: { spec: Spec; item: Item; where?: "listFault" | "detailFault" }) {
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
      aria-label={root ? `Activar ${item.name} en ${stem(root)}` : `Activar ${item.name}`}
      disabled={!root}
      aria-disabled={!root}
      aria-checked={item.enabled}
      onClick={flip}
    />
  );
}

function CapMore({ spec, item }: { spec: Spec; item: Item }) {
  const menu = useSheet();
  const title = `Acciones de ${item.name}`;
  return (
    <span className="card-more">
      <button
        className="round"
        ref={menu.anchor}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <Icon svg={ICONS.ellipsis} />
      </button>
      <div className="sheet menu drop" role="menu" aria-label={title} {...menu.sheet}>
        <button
          className="menu-item"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            menu.shut();
            confirmRemoval(spec, item.name, menu.anchor.current!);
          }}
        >
          Quitar
        </button>
      </div>
    </span>
  );
}
