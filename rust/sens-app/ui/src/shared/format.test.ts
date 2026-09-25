import { afterEach, describe, expect, it } from "vitest";
import { shared } from "./copy";
import { ago, compact, seconds, weigh, when } from "./format.js";
import { showLanguage } from "./i18n";

const YESTERDAY = (() => {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  return day.getTime();
})();
const LONG_AGO = new Date(2020, 8, 12, 14, 5).getTime();

describe("format", () => {
  afterEach(() => showLanguage("es"));

  it("writes durations, counts, sizes and days in Spanish as it always has", () => {
    expect(seconds(46500)).toBe("46,5 s");
    expect(seconds(90000)).toBe("1 min 30 s");
    expect(seconds(3_725_000)).toBe("1 h 2 min");
    expect(seconds(7_200_000)).toBe("2 h");
    expect(compact(950)).toBe("950");
    expect(compact(4000)).toBe("4k");
    expect(compact(12500)).toBe("12,5k");
    expect(compact(1_500_000)).toBe("1,5M");
    expect(weigh(4)).toBe("4 B");
    expect(weigh(240 * 1024)).toBe("240 KB");
    expect(weigh(1.2 * 1024 * 1024)).toBe("1,2 MB");
    expect(ago(YESTERDAY)).toBe("ayer");
    expect(ago(LONG_AGO)).toBe("12 sept");
    expect(when(LONG_AGO)).toBe("12 sept, 14:05");
  });

  it("follows English", () => {
    showLanguage("en");
    expect(seconds(46500)).toBe("46.5 s");
    expect(seconds(90000)).toBe("1 min 30 s");
    expect(compact(12500)).toBe("12.5k");
    expect(weigh(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(ago(YESTERDAY)).toBe("yesterday");
    expect(ago(LONG_AGO)).toBe("Sep 12");
  });

  it("follows German", () => {
    showLanguage("de");
    expect(seconds(46500)).toBe("46,5 s");
    expect(compact(1_500_000)).toBe("1,5M");
    expect(weigh(1.2 * 1024 * 1024)).toBe("1,2 MB");
    expect(ago(YESTERDAY)).toBe("gestern");
    expect(ago(LONG_AGO)).toBe("12. Sept");
  });

  it("follows French, which counts in octets", () => {
    showLanguage("fr");
    expect(seconds(46500)).toBe("46,5 s");
    expect(weigh(4)).toBe("4 o");
    expect(weigh(240 * 1024)).toBe("240 Ko");
    expect(weigh(1.2 * 1024 * 1024)).toBe("1,2 Mo");
    expect(ago(YESTERDAY)).toBe("hier");
  });

  it("follows Japanese", () => {
    showLanguage("ja");
    expect(seconds(46500)).toBe("46.5 秒");
    expect(seconds(90000)).toBe("1 分 30 秒");
    expect(seconds(3_725_000)).toBe("1 時間 2 分");
    expect(compact(12500)).toBe("12.5k");
    expect(weigh(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(ago(YESTERDAY)).toBe("昨日");
    expect(ago(LONG_AGO)).toBe("9月12日");
  });

  it("shares words every language has", () => {
    showLanguage("zh");
    expect(seconds(90000)).toBe("1 分 30 秒");
    expect(seconds(3_725_000)).toBe("1 小时 2 分钟");
    expect(shared.showAll).toBe("显示全部");
    showLanguage("en");
    expect(shared.noProject).toBe("No project");
  });
});
