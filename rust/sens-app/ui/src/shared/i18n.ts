import { createStore } from "zustand/vanilla";

export const LANGUAGES = [
  { id: "en", name: "English", tag: "en-US" },
  { id: "es", name: "Español", tag: "es-ES" },
  { id: "fr", name: "Français", tag: "fr-FR" },
  { id: "de", name: "Deutsch", tag: "de-DE" },
  { id: "ja", name: "日本語", tag: "ja-JP" },
  { id: "zh", name: "简体中文", tag: "zh-CN" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export const FIRST_LANGUAGE: Language = "en";

declare global {
  interface Window {
    __SENS_LANGUAGE__?: unknown;
  }
}

type Entry = string | ((...args: never[]) => string) | { readonly [key: string]: Entry };

export type Shape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : T[K] extends (...args: infer A) => string ? (...args: A) => string : Shape<T[K]>;
};

export type Translations<T> = { en: T } & { [L in Exclude<Language, "en">]: Shape<T> };

const known = (value: unknown): value is Language => LANGUAGES.some((one) => one.id === value);

export function languageOf(value: unknown, preferred: readonly string[] = globalThis.navigator?.languages ?? []): Language {
  if (known(value)) return value;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (known(base)) return base;
  }
  return FIRST_LANGUAGE;
}

export const language = createStore(() => ({ current: FIRST_LANGUAGE as Language }));

export const languageNow = () => language.getState().current;

export const localeNow = () => LANGUAGES.find((one) => one.id === languageNow())!.tag;

export function showLanguage(chosen: Language) {
  if (typeof document !== "undefined") document.documentElement.lang = LANGUAGES.find((one) => one.id === chosen)!.tag;
  language.setState({ current: chosen });
}

export function copy<const T extends Record<string, Entry>>(all: Translations<T>): Shape<T> {
  return new Proxy({} as Shape<T>, {
    get: (_, key) => {
      const now = all[languageNow()] as Record<PropertyKey, unknown>;
      return key in now ? now[key] : (all.en as Record<PropertyKey, unknown>)[key];
    },
  });
}
