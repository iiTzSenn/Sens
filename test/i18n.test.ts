import { describe, it, expect } from "vitest";
import { LANGS, MESSAGES, i18nClientScript } from "../src/dashboard/i18n";

const enKeys = Object.keys(MESSAGES.en).sort();

describe("i18n dictionary", () => {
  it("ships English as the base locale", () => {
    expect(MESSAGES.en).toBeDefined();
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it("every locale has exactly the same keys as English", () => {
    for (const code of Object.keys(MESSAGES)) {
      expect(Object.keys(MESSAGES[code]).sort(), `locale ${code}`).toEqual(enKeys);
    }
  });

  it("no message is empty", () => {
    for (const code of Object.keys(MESSAGES)) {
      for (const key of enKeys) {
        expect(MESSAGES[code][key]?.length, `${code}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("placeholders in a locale match the English string's placeholders", () => {
    const ph = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of enKeys) {
      const want = ph(MESSAGES.en[key]);
      for (const code of Object.keys(MESSAGES)) {
        expect(ph(MESSAGES[code][key]), `${code}.${key}`).toEqual(want);
      }
    }
  });

  it("LANGS and MESSAGES cover the same set of locale codes", () => {
    const langCodes = LANGS.map((l) => l.code).sort();
    expect(langCodes).toEqual(Object.keys(MESSAGES).sort());
    expect(new Set(langCodes).size, "no duplicate codes").toBe(langCodes.length);
  });

  it("declares the expected 25 locales including RTL", () => {
    expect(LANGS.length).toBe(25);
    expect(LANGS.filter((l) => l.rtl).map((l) => l.code).sort()).toEqual(["ar", "fa", "he"]);
  });

  it("client script serializes both LANGS and I18N", () => {
    const js = i18nClientScript();
    expect(js).toContain("var LANGS=");
    expect(js).toContain("var I18N=");
    // valid, self-contained JS (no template-literal / script-closing hazards)
    expect(js).not.toContain("</script>");
    expect(js).not.toContain("`");
  });
});
