import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { openOutside } from "../../shared/outside";
import { t } from "./copy";
import { addressOf, aim, goBack, goForward, holdFrame, pickWidth, reloadSite, syncBrowser, toggleLog, web } from "./store";

const WIDTHS = [0, 390, 768, 1280];

// The web panel's body: its bar, the frame the native page is laid over, and
// its console. The address bar (Address) and "open outside" (Outside) go in
// the panel's header.
export function Web() {
  return (
    <>
      <Bar />
      <Page />
      <Log />
    </>
  );
}

// What is typed stays while the field has the focus; otherwise the bar follows
// the page.
export function Address() {
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
        placeholder={t.typing}
        aria-label={t.address}
        autoComplete="off"
        spellCheck={false}
        title={title || undefined}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
    </form>
  );
}

export function Outside() {
  const url = useStore(web, (s) => s.url);
  if (!url) return null;
  return (
    <button className="icon-btn" id="site-out" title={t.openOutside} aria-label={t.openOutside} onClick={() => openOutside(url)}>
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
      <button className="icon-btn" id="site-back" title={t.back} aria-label={t.back} disabled={!shown} onClick={goBack}>
        <Icon svg={ICONS.back} />
      </button>
      <button className="icon-btn" id="site-forward" title={t.forward} aria-label={t.forward} disabled={!shown} onClick={goForward}>
        <Icon svg={ICONS.forward} />
      </button>
      <button className="icon-btn" id="site-reload" title={t.reload} aria-label={t.reload} disabled={!shown} data-loading={String(loading)} onClick={reloadSite}>
        <Icon svg={ICONS.refresh} />
      </button>
      <div className="segment" id="site-widths" role="group" aria-label={t.width}>
        {WIDTHS.map((one) => (
          <button key={one} aria-pressed={width === one} onClick={() => pickWidth(one)}>
            {one || t.auto}
          </button>
        ))}
      </div>
      <button
        className="icon-btn"
        id="site-console"
        title={t.console}
        aria-label={t.console}
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
          {t.waiting}
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
