import { StrictMode, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet } from "../../shared/useSheet";
import { DetailView } from "./Detail";
import { Explore } from "./Explore";
import { serverForm, skillForm } from "./forms";
import { Installed } from "./Installed";
import { CAP_TABS } from "./kinds";
import { capabilities, consumeScroll, importSkill, showMode, type Mode } from "./store";

export function mountCapabilities(host: Element) {
  createRoot(host).render(
    <StrictMode>
      <Capabilities />
    </StrictMode>,
  );
}

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
          <h1 className="label">Capacidades</h1>
          <p>Skills, plugins y servidores MCP que Sens puede usar en tus sesiones.</p>
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

const MODES: [Mode, string][] = [
  ["installed", "Instaladas"],
  ["explore", "Explorar"],
];

function ModeSwitch({ mode }: { mode: Mode }) {
  const bar = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = mode === "installed" ? "explore" : "installed";
    showMode(next);
    bar.current?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  }

  return (
    <div className="segmented" id="caps-mode" role="tablist" aria-label="Qué ver" ref={bar} onKeyDown={onKeyDown}>
      {MODES.map(([id, label]) => (
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
          {label}
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
        Añadir
      </button>
      <div className="sheet menu drop" id="caps-menu" role="menu" aria-label="Añadir capacidad" {...menu.sheet}>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(() => skillForm(button()))}>
          Crear skill
        </button>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(importSkill)}>
          Importar carpeta
        </button>
        <button className="menu-item" role="menuitem" tabIndex={-1} onClick={() => pick(() => serverForm(button()))}>
          Añadir servidor MCP
        </button>
      </div>
    </div>
  );
}
