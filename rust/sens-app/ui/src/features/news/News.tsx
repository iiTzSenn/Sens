import { useStore } from "zustand";
import type { News } from "../../ipc/types";
import { shared } from "../../shared/copy";
import { localeNow } from "../../shared/i18n";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { openOutside } from "../../shared/outside";
import { updates } from "../updates/store";
import { t } from "./copy";
import { closeNews, loadNews, news } from "./store";

const RELEASES = "https://github.com/iiTzSenn/Sens/releases";

function day(published: string) {
  const at = new Date(published);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString(localeNow(), { day: "numeric", month: "long", year: "numeric" });
}

function lead(told: News[] | null) {
  if (!told?.length) return t.leadAll;
  const [newest, ...before] = told;
  if (!before.length) return t.leadOne(newest.version);
  return t.leadMore(newest.version, before.length);
}

export function NewsView() {
  const told = useStore(news, (s) => s.told);
  const loading = useStore(news, (s) => s.loading);
  const fault = useStore(news, (s) => s.fault);
  const current = useStore(updates, (s) => s.current);
  return (
    <>
      <header className="view-top news-top">
        <div>
          <h1 className="label">{t.title}</h1>
          <p>{lead(told)}</p>
        </div>
        <button className="icon-btn" id="news-close" title={shared.close} aria-label={t.close} onClick={closeNews}>
          <Icon svg={ICONS.dismiss} />
        </button>
      </header>
      {loading && (
        <p className="news-state" role="status">
          {t.reading}
        </p>
      )}
      {fault && !loading && (
        <div className="news-state">
          <p className="fault" role="alert">
            {fault}
          </p>
          <div className="news-actions">
            <button className="quiet" onClick={loadNews}>
              {shared.retry}
            </button>
            <button className="quiet" onClick={() => openOutside(RELEASES)}>
              <Icon svg={ICONS.external} />
              <span>{t.viewOnGitHub}</span>
            </button>
          </div>
        </div>
      )}
      {told?.length === 0 && <p className="news-state">{current ? t.noneYetFor(current) : t.noneYet}</p>}
      {told?.map((one) => <Version key={one.version} one={one} installed={one.version === current} />)}
      {Boolean(told?.length) && (
        <footer className="news-foot">
          <button className="primary" onClick={closeNews}>
            {t.next}
          </button>
        </footer>
      )}
    </>
  );
}

function Version({ one, installed }: { one: News; installed: boolean }) {
  const heading = `news-${one.version.replaceAll(".", "-")}`;
  const when = day(one.published);
  return (
    <article className="news-release" aria-labelledby={heading}>
      <p className="news-meta">
        <span className="news-version">{one.version}</span>
        {installed && <span className="news-now">{t.installed}</span>}
        {when && <time dateTime={one.published}>{when}</time>}
        <button className="news-link" onClick={() => openOutside(one.page)}>
          <span>{t.viewOnGitHub}</span>
          <Icon svg={ICONS.external} />
        </button>
      </p>
      <h2 id={heading}>{one.title || `Sens ${one.version}`}</h2>
      {one.notes ? <Markdown className="news-notes" text={one.notes} /> : <p className="news-none">{t.noNotes}</p>}
    </article>
  );
}
