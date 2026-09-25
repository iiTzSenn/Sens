import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet } from "../../shared/useSheet";
import "./capabilities.css";
import { t } from "./copy";
import { DetailView } from "./Detail";
import { Explore } from "./Explore";
import { serverForm, skillForm } from "./forms";
import { Installed } from "./Installed";
import { CAP_TABS, entriesOf } from "./kinds";
import { capabilities, consumeScroll, importSkill, showMode, type Mode } from "./store";

export function Capabilities() {
  const mode = useStore(capabilities, (s) => s.mode);
  const detailing = useStore(capabilities, (s) => Boolean(s.detailing));
  const scrollTo = useStore(capabilities, (s) => s.scrollTo);

  useLayoutEffect(() => {
    if (scrollTo === null) return;
    const view = document.getElementById("capabilities-view");
    if (view) view.scrollTop = scrollTo;
    consumeScroll();
  }, [scrollTo]);

  return (
    <>
      <header className="view-top">
        <div>
          <h1 className="label">{t.title}</h1>
          <p>{t.lede}</p>
        </div>
        <ModeSwitch mode={mode} />
        <AddMenu hidden={mode !== "installed" || detailing} />
      </header>
      <Installed hidden={detailing || mode !== "installed"} />
      <Explore hidden={detailing || mode !== "explore"} />
      <DetailView hidden={!detailing} />
    </>
  );
}

const MODES: Mode[] = ["installed", "explore"];

function ModeSwitch({ mode }: { mode: Mode }) {
  const bar = useRef<HTMLDivElement>(null);
  const caps = useStore(capabilities, (s) => s.caps);
  const count = entriesOf(caps).length;

  function onKeyDown(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = mode === "installed" ? "explore" : "installed";
    showMode(next);
    bar.current?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  }

  return (
    <div className="segmented" id="caps-mode" role="tablist" aria-label={t.modes} ref={bar} onKeyDown={onKeyDown}>
      {MODES.map((id) => (
        <button
          key={id}
          role="tab"
          id={`caps-mode-${id}`}
          data-mode={id}
          aria-controls={`caps-${id}`}
          aria-selected={id === mode}
          tabIndex={id === mode ? 0 : -1}
          onClick={() => showMode(id)}
        >
          {id === "installed" ? t.installedMode : t.exploreMode}
          {id === "installed" && count > 0 && <span className="count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

// "Añadir" does what the tab calls for: the menu, the market, or the MCP form.
function AddMenu({ hidden }: { hidden: boolean }) {
  const tab = useStore(capabilities, (s) => s.tab);
  const menu = useSheet();
  const action = CAP_TABS[tab].add;
  const button = () => menu.anchor.current!;

  function add() {
    if (action === "menu") menu.toggle();
    else if (action === "explore") showMode("explore");
    else serverForm(button());
  }

  function pick(then: () => unknown) {
    menu.shut();
    button().focus();
    then();
  }

  return (
    <div className="view-add" id="caps-add-box" hidden={hidden}>
      <button
        className="quiet"
        id="caps-add"
        ref={menu.anchor}
        aria-haspopup={action === "menu" ? "menu" : undefined}
        aria-expanded={action === "menu" ? menu.open : undefined}
        onClick={add}
      >
        <Icon svg={ICONS.plus} />
        {t.add}
      </button>
      <div className="sheet menu drop" id="caps-menu" role="menu" aria-label={t.addMenu} {...menu.sheet}>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(() => skillForm(button()))}>
          {t.createSkill}
        </button>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(importSkill)}>
          {t.importFolder}
        </button>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(() => serverForm(button()))}>
          {t.addServer}
        </button>
      </div>
    </div>
  );
}
