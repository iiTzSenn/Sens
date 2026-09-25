import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  accents,
  palette,
  radius,
  ramp,
  motion,
  type PaletteToken,
} from "../src/brand/tokens.js";
import { markSvg, markMonoSvg, cutPath, cutWidth } from "../src/brand/mark.js";
import { SLOTS } from "../rust/sens-app/ui/src/shared/ansi.js";

const root = path.join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

// Everything that ships in the desktop shell: not tests, not the dev-only src/dev.
const appSources = [
  "rust/sens-app/ui/index.html",
  ...readdirSync(path.join(root, "rust/sens-app/ui/src"), { recursive: true, encoding: "utf8" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /\.(css|js|ts|tsx)$/.test(file) && !/\.test\./.test(file) && !file.startsWith("dev/"))
    .map((file) => `rust/sens-app/ui/src/${file}`),
];
const appShell = () => appSources.map(read).join("\n");

const forbidden = [
  "#4f7cff",
  "#7a5cff",
  "#5566ff",
  "#7aa2ff",
  "#6f9bff",
  "#3d4cff",
  "#7196ff",
  "#a06fc0",
  "#b49ad6",
  "rgba(20,30,60",
  "rgba(10,14,22",
];

describe("brand tokens", () => {
  it("declares every palette token in the desktop shell", () => {
    const shell = appShell();
    for (const [token, value] of Object.entries(palette)) {
      expect(shell, `--sens-${token}`).toContain(`--sens-${token}: ${value};`);
    }
  });

  it("loads the stylesheet from the desktop shell's entry", () => {
    expect(read("rust/sens-app/ui/index.html")).toContain('src="/src/main.ts"');
    expect(read("rust/sens-app/ui/src/main.ts")).toContain('import "./styles.css";');
  });
});

describe("themes", () => {
  const tokens = read("rust/sens-app/ui/src/shared/tokens.css");
  const block = (selector: string) => {
    const at = tokens.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return tokens.slice(at, tokens.indexOf("}", at));
  };
  const declared = (css: string) => new Set([...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));

  it("gives every accent the whole ramp, from its own primitives", () => {
    for (const accent of accents) {
      const selector = accent === "signal" ? `:root, [data-accent="signal"]` : `[data-accent="${accent}"]`;
      const rule = block(selector);
      for (const stop of ramp) {
        expect(rule, `${accent} ${stop}`).toContain(`--accent-${stop}: var(--sens-`);
        if (accent !== "neutral") expect(palette, `${accent}-${stop}`).toHaveProperty(`${accent}-${stop}`);
      }
    }
  });

  it("offers in the interface exactly the accents the brand defines", () => {
    const look = read("rust/sens-app/ui/src/shared/look.ts");
    const offered = [...(look.match(/export const ACCENTS[^=]*= \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(offered).toEqual([...accents]);
  });

  it("sets the same roles in light and dark", () => {
    const dark = declared(block(`:root, [data-mode="dark"]`));
    const light = declared(block(`[data-mode="light"]`));
    expect([...light].sort()).toEqual([...dark].sort());
    for (const role of ["--focus", "--accent-fill", "--accent-ink", "--tint", "--glow", "--grain-1", "--primary", "--ground", "--text"]) {
      expect(dark, role).toContain(role);
    }
  });

  it("lets the accent reach every surface: only the tokens name a ramp", () => {
    for (const file of appSources.filter((one) => !one.endsWith("shared/tokens.css"))) {
      expect(read(file), file).not.toMatch(/var\(--sens-(signal|ice|iris|rose)-/);
    }
  });

  it("hides the page until it knows which mode to paint", () => {
    expect(tokens).toContain(":root:not([data-mode]) body { display: none; }");
    expect(read("rust/sens-app/ui/src/main.ts")).toContain("showLook(lookOf(window.__SENS_LOOK__));");
    expect(read("rust/sens-app/ui/src/setup/main.ts")).toContain("showLook(FIRST_LOOK);");
  });
});

describe("the light theme", () => {
  const tokens = read("rust/sens-app/ui/src/shared/tokens.css");
  const block = (selector: string) => {
    const at = tokens.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return tokens.slice(at, tokens.indexOf("}", at));
  };
  const values = (css: string) => Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = block(`[data-mode="light"]`);
  const neutralLight = block(`[data-accent="neutral"][data-mode="light"], [data-accent="neutral"] [data-mode="light"]`);
  const primitives = Object.fromEntries(Object.entries(palette).map(([token, value]) => [`--sens-${token}`, value]));
  const scope = (accent: string, mode: string) => {
    const accentRule = values(block(accent === "signal" ? `:root, [data-accent="signal"]` : `[data-accent="${accent}"]`));
    const modeRule = values(block(mode === "light" ? `[data-mode="light"]` : `:root, [data-mode="dark"]`));
    return { ...primitives, ...accentRule, ...modeRule, ...(mode === "light" && accent === "neutral" ? values(neutralLight) : {}) };
  };
  const resolve = (names: Record<string, string>, name: string): string => {
    const value = names[name];
    expect(value, name).toBeDefined();
    const alias = value.match(/^var\((--[\w-]+)\)$/);
    return alias ? resolve(names, alias[1]) : value;
  };
  const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map((value) => value / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (one: string, other: string) => {
    const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };
  const expectContrast = (names: Record<string, string>, ink: string, surface: string, least: number, accent: string) => {
    const ratio = contrast(resolve(names, ink), resolve(names, surface));
    expect(ratio, `${accent}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(least);
  };

  it("paints the page white and builds every surface from chalk, never from bone or paper", () => {
    const names = scope("signal", "light");
    expect(resolve(names, "--ground")).toBe("#ffffff");
    for (const role of ["--ground", "--panel", "--card", "--raise", "--hair", "--hair-strong", "--edge"]) {
      expect(light, role).toMatch(new RegExp(`${role}: var\\(--sens-chalk-\\d+\\);`));
    }
    expect(light).not.toMatch(/bone|paper|fbfaf6/);
    expect(neutralLight).not.toMatch(/bone|paper/);
  });

  it("keeps every light surface neutral, never warmer than its green", () => {
    for (const [token, value] of Object.entries(palette).filter(([token]) => token.startsWith("chalk-"))) {
      const [red, green, blue] = channels(value);
      expect(red, token).toBeLessThanOrEqual(green);
      expect(red, token).toBeLessThanOrEqual(blue);
    }
  });

  it("steps down from white in order: panel, card, raise, hairlines, edge", () => {
    const names = scope("signal", "light");
    const order = ["--ground", "--panel", "--card", "--raise", "--hair-strong", "--edge"].map((role) => luminance(resolve(names, role)));
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(new Set(order).size).toBe(order.length);
  });

  it("reads every text role on every light surface, in every accent", () => {
    for (const accent of accents) {
      const names = scope(accent, "light");
      for (const surface of ["--ground", "--panel", "--card", "--tint"]) {
        for (const ink of ["--text", "--dim", "--faint", "--ghost", "--focus", "--accent-text", "--accent-soft"]) expectContrast(names, ink, surface, 4.5, accent);
      }
      for (const ink of ["--text", "--dim", "--faint", "--focus"]) expectContrast(names, ink, "--raise", 4.5, accent);
      expectContrast(names, "--ghost", "--raise", 3, accent);
      expectContrast(names, "--accent-ink", "--accent-fill", 4.5, accent);
      expectContrast(names, "--accent-ink", "--accent-fill-hover", 4.5, accent);
      expectContrast(names, "--primary-ink", "--primary", 4.5, accent);
      expectContrast(names, "--primary-ink", "--primary-hover", 4.5, accent);
    }
  });

  it("keeps status colours legible on white, on panels and on hover", () => {
    const names = scope("signal", "light");
    for (const surface of ["--ground", "--panel", "--card"]) {
      for (const ink of ["--red", "--green", "--amber", "--blue"]) expectContrast(names, ink, surface, 4.5, "signal");
    }
  });

  it("gives every ANSI slot a colour that reads where output shows, in both modes", () => {
    for (const mode of ["light", "dark"]) {
      const names = scope("signal", mode);
      for (const slot of SLOTS.filter((one) => mode === "light" || one !== "black")) {
        for (const surface of ["--ground", "--panel"]) expectContrast(names, `--ansi-${slot}`, surface, 4.5, mode);
      }
    }
  });

  it("keeps the ANSI status hues on their meanings and Signal out of the terminal", () => {
    const signal = new Set(Object.entries(palette).filter(([token]) => token.startsWith("signal-")).map(([, value]) => value));
    for (const mode of ["light", "dark"]) {
      const rule = block(mode === "light" ? `[data-mode="light"]` : `:root, [data-mode="dark"]`);
      for (const [slot, meaning] of [["red", "danger"], ["green", "success"], ["yellow", "warning"], ["blue", "info"]]) {
        expect(rule, `${mode} ${slot}`).toMatch(new RegExp(`--ansi-${slot}: var\\(--sens-${meaning}[-;)]`));
        expect(rule, `${mode} bright ${slot}`).toMatch(new RegExp(`--ansi-bright-${slot}: var\\(--sens-${meaning}[-;)]`));
      }
      const names = scope("signal", mode);
      for (const slot of SLOTS) expect(signal, `${mode} ${slot}`).not.toContain(resolve(names, `--ansi-${slot}`));
    }
  });

  it("draws the featured surface off the page, with an edge that holds as a line", () => {
    for (const accent of accents) {
      const names = scope(accent, "light");
      expect(contrast(resolve(names, "--tint"), resolve(names, "--ground")), accent).toBeGreaterThan(1.05);
      expect(contrast(resolve(names, "--tint-edge"), resolve(names, "--ground")), accent).toBeGreaterThanOrEqual(1.35);
    }
  });

  it("opens the window on the colour the page paints first", () => {
    const look = read("rust/sens-app/src/look.rs");
    const before = (name: string) => {
      const found = look.match(new RegExp(`${name}: Color = Color\\(0x(\\w\\w), 0x(\\w\\w), 0x(\\w\\w), 0xff\\);`));
      expect(found, name).not.toBeNull();
      return `#${found!.slice(1, 4).join("")}`.toLowerCase();
    };
    expect(before("LIGHT_GROUND")).toBe(resolve(scope("signal", "light"), "--ground"));
    expect(before("DARK_GROUND")).toBe(resolve(scope("signal", "dark"), "--ground"));
  });
});

describe("the cut", () => {
  it("splits the body with one continuous edge-to-edge incision", () => {
    expect(cutPath.startsWith("M48 ")).toBe(true);
    expect(cutPath.trimEnd().endsWith(" 0 35")).toBe(true);
    expect(cutPath.match(/C/g)?.length).toBe(6);
  });

  it("carries the cut in signal and the body in carbon", () => {
    const svg = markSvg();
    expect(svg).toContain(palette["signal-500"]);
    expect(svg).toContain(palette["carbon-900"]);
    expect(svg).toContain(`stroke-width="${cutWidth}"`);
  });

  it("renders the one-colour variant as negative space", () => {
    const mono = markMonoSvg();
    expect(mono).toContain("mask=");
    expect(mono).toContain('stroke="#000"');
    expect(mono).toContain("currentColor");
  });

  it("thickens the cut for the micro mark", () => {
    expect(markSvg({ micro: true })).not.toContain(`stroke-width="${cutWidth}"`);
  });
});

describe("surfaces", () => {
  const surfaces = [
    ...appSources,
    "assets/sens-mark.svg",
    "docs/banner.svg",
  ];

  for (const file of surfaces) {
    it(`keeps the retired blue-purple palette out of ${file}`, () => {
      const body = read(file).toLowerCase();
      for (const colour of forbidden) expect(body).not.toContain(colour);
    });
  }

});

describe("the desktop shell", () => {
  const shell = appShell();

  it("sizes every corner from the radius scale", () => {
    const allowed = new Set([
      "var(--r-key)",
      "var(--r-control)",
      "var(--r-card)",
      "var(--r-sheet)",
      "50%",
      "999px",
      "1px",
      "0",
      "inherit",
    ]);
    for (const [, value] of shell.matchAll(/border-radius: ([^;}]+)/g)) {
      for (const corner of value.trim().split(/\s+/)) {
        expect(allowed, corner).toContain(corner);
      }
    }
  });

  it("never paints text in a border tone", () => {
    expect(shell).not.toMatch(/[^-]color: var\(--edge\)/);
    expect(shell).not.toContain("color: var(--sens-carbon-600)");
  });

  it("sets micro labels on the documented type scale", () => {
    expect(shell).not.toContain("9.5px");
    expect(shell).not.toContain("letter-spacing: .2em");
  });

  it("rings focus in signal at two pixels", () => {
    expect(shell).toContain(
      ":focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }",
    );
  });

  it("shows the scan state while the agent works, and stills it on request", () => {
    expect(shell).toContain("@keyframes orbit");
    expect(shell).toContain('.composer .box[data-busy="true"]::after');
    expect(shell).toContain("@media (prefers-reduced-motion: reduce)");
    expect(shell).toContain("data-busy={String(busy)}");
  });

  it("gives the composer an attach, a dictate and one send control", () => {
    for (const control of ["attach", "dictate", "send"]) {
      expect(shell, control).toContain(`id={id("${control}")}`);
    }
    expect(shell).toContain('.composer .box[data-busy="true"] .send .halt');
    expect(shell).toContain("await commands.chatStop(session(pane));");
    expect(shell).toContain("data-stopping={String(stopping)}");
  });

  it("spends signal on the send button, the one key action", () => {
    expect(shell).toContain(".send { background: var(--accent-fill);");
  });

  it("builds the model picker from the backend catalogue", () => {
    expect(shell).toContain('invoke<Provider[]>("providers")');
    expect(shell).toContain('invoke<Card[] | null>("models", { provider })');
    expect(shell).not.toContain("claude-sonnet-5");
    expect(shell).not.toContain("claude-haiku");
  });

  it("tells the user when dictation is not available here", () => {
    expect(shell).toContain("speech.SpeechRecognition || speech.webkitSpeechRecognition");
    expect(shell).toContain("disabled={!dictation.able}");
  });

  it("gives the loader a new rhythm each lap instead of one loop", () => {
    expect(shell).toContain("function lapKeyframes(name: string)");
    expect(shell).toContain("onAnimationIteration");
    expect(shell).toContain("var(--lap-name, orbit)");
  });

  it("owns its title bar instead of wearing the system frame", () => {
    expect(read("rust/sens-app/tauri.conf.json")).toContain('"decorations": false');
    expect(shell).toContain("-webkit-app-region: drag");
    for (const control of ["win-min", "win-max", "win-close"]) {
      expect(shell, control).toContain(`id="${control}"`);
    }
  });

  it("grants the window and dialog permissions the shell calls", () => {
    const granted = JSON.parse(
      read("rust/sens-app/capabilities/default.json"),
    ).permissions;
    for (const permission of [
      "core:window:allow-start-dragging",
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-close",
      "dialog:allow-open",
    ]) {
      expect(granted, permission).toContain(permission);
    }
  });

  it("never lets colour alone carry a state", () => {
    const paired = [
      ['.step[data-state="stopped"] .step-state { border:', "a stopped step is a ring, not a colour"],
      ['if (state === "failed" && box.current) box.current.open = true;', "a failed step opens on its error"],
      ["failed ? t.endedWithError", "a failed command says so"],
      ["allowed: (answers) => answersText(answers) || t.allowed", "a settled permission names its outcome"],
      ["refused: () => t.denied", "a refused permission says so"],
      ["expired: () => t.unanswered", "an expired question says it went unanswered"],
      ['<span className="state" data-state={file.state}', "a changed file carries its status letter"],
    ];
    for (const [snippet, why] of paired) expect(shell, why).toContain(snippet);
  });
});

describe("restraint", () => {
  const shell = appShell();
  const tight = (s: string) => s.replace(/\s+/g, "");

  it("takes its radius and motion scale from the brand tokens", () => {
    expect(shell).toContain(`--r-control: ${radius.control}px;`);
    expect(shell).toContain(`--r-card: ${radius.panel}px;`);
    expect(shell).toContain(`--r-sheet: ${radius.sheet}px;`);
    expect(shell).toContain(`--fast: ${motion.hover};`);
    expect(shell).toContain(`--slow: ${motion.panel};`);
    expect(tight(shell)).toContain(`--curve:${tight(motion.ease)};`);
  });

  it("moves on one curve, with no overshoot and no endless rotation", () => {
    const curves = new Set(
      [...shell.matchAll(/cubic-bezier\([^)]*\)/g)].map((m) => tight(m[0])),
    );
    expect([...curves]).toEqual([tight(motion.ease)]);
    expect(shell).not.toContain("rotate(360deg)");
  });

  it("carries depth in a hairline instead of a shadow", () => {
    expect(shell).not.toContain("box-shadow");
  });

  it("signs every surface with the lowercase wordmark", () => {
    expect(shell).toContain("<b>sens</b>");
    expect(shell).not.toContain('Sens<span class="dot">');
  });
});

describe("generated assets", () => {
  const files = [
    "assets/sens-mark.svg",
    "assets/sens-mark-micro.svg",
    "assets/sens-mark-mono.svg",
    "assets/sens-wordmark.svg",
    "assets/png/sens-mark-16.png",
    "assets/png/sens-mark-1024.png",
    "rust/sens-app/icons/icon.ico",
    "rust/sens-app/icons/icon.png",
  ];

  for (const file of files) {
    it(`ships ${file}`, () => {
      expect(existsSync(path.join(root, file))).toBe(true);
    });
  }

  it("leads the windows icon with its largest size and carries every size the shell asks for", () => {
    const ico = readFileSync(path.join(root, "rust/sens-app/icons/icon.ico"));
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + i * 16) || 256);
    expect(sizes[0]).toBe(256);
    for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]) {
      expect(sizes, `${size} px`).toContain(size);
    }
  });

  it("packs the windows icon as a multi-size png container", () => {
    const ico = readFileSync(path.join(root, "rust/sens-app/icons/icon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const offset = ico.readUInt32LE(entry + 12);
      expect(ico.subarray(offset, offset + 8).toString("hex")).toBe(
        "89504e470d0a1a0a",
      );
    }
  });
});
