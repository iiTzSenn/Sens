// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { copy, languageNow, languageOf, localeNow, showLanguage } from "./i18n";

const t = copy({
  en: { hello: "Hello", files: (count: number) => (count === 1 ? "1 file" : `${count} files`), nested: { deep: "Deep" } },
  es: { hello: "Hola", files: (count: number) => (count === 1 ? "1 fichero" : `${count} ficheros`), nested: { deep: "Hondo" } },
  fr: { hello: "Bonjour", files: (count: number) => (count <= 1 ? `${count} fichier` : `${count} fichiers`), nested: { deep: "Profond" } },
  de: { hello: "Hallo", files: (count: number) => (count === 1 ? "1 Datei" : `${count} Dateien`), nested: { deep: "Tief" } },
  ja: { hello: "こんにちは", files: (count: number) => `${count} 個のファイル`, nested: { deep: "深い" } },
  zh: { hello: "你好", files: (count: number) => `${count} 个文件`, nested: { deep: "深" } },
});

describe("i18n", () => {
  afterEach(() => showLanguage("es"));

  it("copy reads the language shown when it is read, not when it was written", () => {
    showLanguage("en");
    expect(t.hello).toBe("Hello");
    expect(t.files(2)).toBe("2 files");
    showLanguage("ja");
    expect(t.hello).toBe("こんにちは");
    expect(t.nested.deep).toBe("深い");
  });

  it("a saved language wins; without one, the first the system prefers that Sens speaks; else English", () => {
    expect(languageOf("de", ["es-ES"])).toBe("de");
    expect(languageOf(null, ["pt-BR", "fr-CA", "es"])).toBe("fr");
    expect(languageOf("klingon", ["zh_CN"])).toBe("zh");
    expect(languageOf(undefined, ["pt-BR"])).toBe("en");
  });

  it("the page and number formats follow the language", () => {
    showLanguage("zh");
    expect(languageNow()).toBe("zh");
    expect(localeNow()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
