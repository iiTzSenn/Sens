// Helpers for exposing the dashboard beyond localhost: local-network IPs, an
// access token, a terminal hyperlink, and cookie parsing. Exposure is opt-in
// (`--host` / `--tunnel`) because the dashboard has write endpoints (toggling
// rules, writing .mcp.json).

import os from "node:os";
import { randomBytes } from "node:crypto";

/** This machine's non-internal IPv4 addresses (for the Network URL). */
export function lanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

/** A short random token gating access when the dashboard is exposed. */
export function makeToken(): string {
  return randomBytes(12).toString("hex");
}

const ESC = String.fromCharCode(27); // \e
const BEL = String.fromCharCode(7); // \a

/** Wrap a label as a clickable terminal hyperlink (OSC 8). Terminals that don't
 * support it simply render the label text, so it degrades cleanly. */
export function terminalLink(label: string, url: string): string {
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`;
}

/** Read one cookie value from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
