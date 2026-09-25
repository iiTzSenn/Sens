import { useEffect, useRef } from "react";
import { looks } from "./copy";
import { LANGUAGES, type Language } from "./i18n";

const REFOCUS_WITHIN = 1000;

let pickedAt = Number.NEGATIVE_INFINITY;

export function LanguagePicker({ chosen, pick }: { chosen: Language; pick: (language: Language) => void }) {
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (performance.now() - pickedAt > REFOCUS_WITHIN) return;
    const frame = requestAnimationFrame(() => group.current?.querySelector<HTMLInputElement>("input:checked")?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  function choose(language: Language) {
    pickedAt = performance.now();
    pick(language);
  }

  return (
    <div className="modes languages" role="radiogroup" aria-label={looks.language} ref={group}>
      {LANGUAGES.map(({ id, name, tag }) => (
        <label key={id} className="mode-choice">
          <input type="radio" name="language" value={id} checked={chosen === id} onChange={() => choose(id)} />
          <span lang={tag}>{name}</span>
        </label>
      ))}
    </div>
  );
}
