import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  palette,
  radius,
  motion,
  type PaletteToken,
} from "../src/brand/tokens.js";
import { markSvg, markMonoSvg, cutPath, cutWidth } from "../src/brand/mark.js";

const root = path.join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const appShell = () => read("rust/sens-app/ui/index.html");

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

  it("keeps the desktop shell free of a stylesheet it cannot resolve", () => {
    expect(appShell()).not.toContain("<link rel=\"stylesheet\"");
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
    "rust/sens-app/ui/index.html",
    "src/cli/ui.ts",
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
    expect(shell).toContain("composerBox.dataset.busy");
  });

  it("gives the composer an attach, a dictate and one send control", () => {
    for (const control of ["attach", "dictate", "send"]) {
      expect(shell, control).toContain(`id="${control}"`);
    }
    expect(shell).toContain('.composer .box[data-busy="true"] .send .halt');
    expect(shell).toContain('invoke("chat_stop", { sessionId: current })');
    expect(shell).toContain('composerBox.dataset.stopping = "true";');
  });

  it("spends signal on the send button, the one key action", () => {
    expect(shell).toContain(".send { background: var(--focus);");
  });

  it("builds the model picker from the backend catalogue", () => {
    expect(shell).toContain('invoke("providers")');
    expect(shell).toContain('invoke("models", { provider: provider.id })');
    expect(shell).not.toContain("claude-sonnet-5");
    expect(shell).not.toContain("claude-haiku");
  });

  it("tells the user when dictation is not available here", () => {
    expect(shell).toContain("window.SpeechRecognition || window.webkitSpeechRecognition");
    expect(shell).toContain("dictateBtn.disabled = true;");
  });

  it("gives the loader a new rhythm each lap instead of one loop", () => {
    expect(shell).toContain("function lapKeyframes(name)");
    expect(shell).toContain("animationiteration");
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
      ["if (error) node.open = true;", "a failed step opens on its error"],
      ['run.failed ? "Terminó con error"', "a failed command says so"],
      ['answersText(answers) || "Permitido" : "Rechazado"', "a settled permission names its outcome"],
      ['note.textContent = "Sin respuesta";', "an expired question says it went unanswered"],
      ['el("span", "state", file.state)', "a changed file carries its status letter"],
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

  it("runs the terminal spinner on the signal scan, not a generic green", () => {
    const cli = read("src/cli/ui.ts");
    expect(cli).toContain("scan.frames");
    expect(cli).not.toContain('color: "green"');
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
