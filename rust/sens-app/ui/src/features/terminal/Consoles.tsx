import "@xterm/xterm/css/xterm.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useStore } from "zustand";
import { shell } from "../../app/shell";
import { stem } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { project } from "../project/store";
import { closeConsole, consoles, nameOf, openConsole, screenOf, settle, shareConsole, showConsole, type Console } from "./store";

export function ConsoleTabs() {
  const open = useStore(consoles, (s) => s.open);
  const shown = useStore(consoles, (s) => s.shown);
  if (!open.length) return <span className="tool-name">Terminal</span>;
  return (
    <div className="console-tabs" role="tablist" aria-label="Terminales">
      {open.map((one) => (
        <div key={one.id} className="console-tab" data-ended={one.ended ? "true" : undefined} title={`${one.shell} · ${one.root || "~"}`}>
          <button
            type="button"
            role="tab"
            className="console-pick"
            id={`console-tab-${one.id}`}
            aria-selected={one.id === shown}
            aria-controls={`console-${one.id}`}
            onClick={() => showConsole(one.id)}
          >
            <Icon svg={ICONS.terminal} />
            <span>{nameOf(one)}</span>
          </button>
          <button type="button" className="console-shut" title="Cerrar esta terminal" aria-label={`Cerrar la terminal ${nameOf(one)}`} onClick={() => closeConsole(one.id)}>
            <Icon svg={ICONS.dismiss} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConsoleTools() {
  const root = useStore(project, (s) => s.work);
  const opening = useStore(consoles, (s) => s.opening);
  const shown = useStore(consoles, (s) => s.shown);
  const label = root ? `Nueva terminal en ${stem(root)}` : "Nueva terminal";
  return (
    <>
      <button
        className="icon-btn"
        id="console-share"
        title="Añadir al mensaje lo seleccionado, o lo que se ve si no hay selección"
        aria-label="Añadir al mensaje"
        disabled={!shown}
        onClick={shareConsole}
      >
        <Icon svg={ICONS.messagePlus} />
      </button>
      <button className="icon-btn" id="console-new" title={label} aria-label={label} disabled={opening} onClick={() => openConsole()}>
        <Icon svg={ICONS.plus} />
      </button>
    </>
  );
}

export function ConsolePanel() {
  const open = useStore(consoles, (s) => s.open);
  const shown = useStore(consoles, (s) => s.shown);
  const opening = useStore(consoles, (s) => s.opening);
  const here = useStore(shell, (s) => s.toolsOpen && s.tool === "terminal");
  const root = useStore(project, (s) => s.work);
  const body = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (here) settle();
  }, [here, shown]);

  useEffect(() => {
    const box = body.current;
    if (!box) return;
    let frame = 0;
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => settle(false));
    });
    watch.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, []);

  return (
    <div className="console" id="console" ref={body}>
      {open.map((one) => (
        <Slot key={one.id} one={one} shown={one.id === shown} />
      ))}
      {!open.length && (
        <div className="console-none">
          <p className="none">{opening ? "Abriendo la terminal…" : "No hay ninguna terminal abierta."}</p>
          {!opening && (
            <button type="button" className="quiet" onClick={() => openConsole()}>
              {root ? `Abrir una en ${stem(root)}` : "Abrir una"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Slot({ one, shown }: { one: Console; shown: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const screen = screenOf(one.id);
    if (screen && slot.current && screen.parentElement !== slot.current) slot.current.appendChild(screen);
  }, [one.id]);
  return <div className="console-slot" id={`console-${one.id}`} role="tabpanel" aria-labelledby={`console-tab-${one.id}`} hidden={!shown} ref={slot} />;
}
