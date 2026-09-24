import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { openOutside } from "../../shared/outside";
import { addressOf, aim, goBack, goForward, hearBrowser, holdFrame, pickWidth, reloadSite, syncBrowser, toggleLog, web } from "./store";

const WIDTHS = [0, 390, 768, 1280];

// The web panel: the address bar in its header, "open outside" among the
// header's tools, and below them the bar, the frame the native page is laid
// over, and its console.
export function mountWeb(host: Element, address: Element, out: Element) {
  hearBrowser();
  createRoot(host).render(
    <StrictMode>
      <Web address={address} out={out} />
    </StrictMode>,
  );
}

export function Web({ address, out }: { address: Element; out: Element }) {
  return (
    <>
      {createPortal(<Address />, address)}
      {createPortal(<Outside />, out)}
      <Bar />
      <Page />
      <Log />
    </>
  );
}

// What is typed stays while the field has the focus; otherwise the bar follows
// the page.
function Address() {
  const url = useStore(web, (s) => s.url);
  const base = useStore(web, (s) => s.base);
  const title = useStore(web, (s) => s.title);
  const field = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (document.activeElement !== field.current) setTyped(addressOf(url, base));
  }, [url, base]);

  return (
    <form
      className="seek address"
      id="site-address"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        field.current?.blur();
        aim(typed);
      }}
    >
      <Icon svg={ICONS.globe} />
      <input
        ref={field}
        className="field"
        id="site-url"
        placeholder="Busca o escribe una dirección"
        aria-label="Dirección o página del proyecto"
        autoComplete="off"
        spellCheck={false}
        title={title || undefined}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
    </form>
  );
}

function Outside() {
  const url = useStore(web, (s) => s.url);
  if (!url) return null;
  return (
    <button className="icon-btn" id="site-out" title="Abrir en el navegador" aria-label="Abrir en el navegador" onClick={() => openOutside(url)}>
      <Icon svg={ICONS.external} />
    </button>
  );
}

function Bar() {
  const shown = useStore(web, (s) => Boolean(s.url));
  const width = useStore(web, (s) => s.width);
  const loading = useStore(web, (s) => s.loading);
  const logShown = useStore(web, (s) => s.logShown);
  const fault = useStore(web, (s) => s.fault);
  return (
    <div className="site-bar">
      <button className="icon-btn" id="site-back" title="Atrás" aria-label="Atrás" disabled={!shown} onClick={goBack}>
        <Icon svg={ICONS.back} />
      </button>
      <button className="icon-btn" id="site-forward" title="Adelante" aria-label="Adelante" disabled={!shown} onClick={goForward}>
        <Icon svg={ICONS.forward} />
      </button>
      <button className="icon-btn" id="site-reload" title="Recargar" aria-label="Recargar" disabled={!shown} data-loading={String(loading)} onClick={reloadSite}>
        <Icon svg={ICONS.refresh} />
      </button>
      <div className="segment" id="site-widths" role="group" aria-label="Ancho">
        {WIDTHS.map((one) => (
          <button key={one} aria-pressed={width === one} onClick={() => pickWidth(one)}>
            {one || "Auto"}
          </button>
        ))}
      </div>
      <button
        className="icon-btn"
        id="site-console"
        title="Consola"
        aria-label="Consola"
        aria-pressed={logShown}
        data-fault={String(fault)}
        hidden={!shown}
        onClick={toggleLog}
      >
        <Icon svg={ICONS.terminal} />
      </button>
    </div>
  );
}

// The native page follows this box as it moves or changes size.
function Page() {
  const shown = useStore(web, (s) => Boolean(s.url));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    holdFrame(box.current);
    const watch = new ResizeObserver(syncBrowser);
    if (box.current) watch.observe(box.current);
    addEventListener("resize", syncBrowser);
    return () => {
      watch.disconnect();
      removeEventListener("resize", syncBrowser);
      holdFrame(null);
    };
  }, []);

  return (
    <div className="site-frame" id="site-frame" ref={box}>
      {!shown && (
        <p className="site-empty" id="site-empty">
          Busca en la web o escribe una dirección: una web, tu servidor local (localhost:5173) o una página del proyecto (index.html).
        </p>
      )}
    </div>
  );
}

// The console keeps to its last line.
function Log() {
  const log = useStore(web, (s) => s.log);
  const shown = useStore(web, (s) => s.logShown);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [log, shown]);

  return (
    <div className="site-log" id="site-log" ref={box} hidden={!shown}>
      {log.map((line, at) => (
        <p key={at} data-level={line.level}>
          {line.text}
        </p>
      ))}
    </div>
  );
}
