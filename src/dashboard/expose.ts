import os from "node:os";
import { randomBytes } from "node:crypto";

export function lanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

export function makeToken(): string {
  return randomBytes(12).toString("hex");
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

export function terminalLink(label: string, url: string): string {
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
