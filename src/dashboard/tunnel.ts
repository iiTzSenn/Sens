import { spawn, type ChildProcess } from "node:child_process";

export interface Tunnel {
  url: string;
  provider: string;
  stop: () => void;
}

export function parseTunnelUrl(line: string): string | null {
  const cf = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (cf) return cf[0];
  const ng = line.match(/https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.(?:app|io|dev)/i);
  if (ng) return ng[0];
  return null;
}

const PROVIDERS: { cmd: string; args: (port: number) => string[] }[] = [
  { cmd: "cloudflared", args: (p) => ["tunnel", "--url", `http://localhost:${p}`] },
  { cmd: "ngrok", args: (p) => ["http", String(p), "--log", "stdout", "--log-format", "logfmt"] },
];

export function startTunnel(port: number, timeoutMs = 20000): Promise<Tunnel | null> {
  return new Promise((resolve) => {
    let idx = 0;
    const tryNext = (): void => {
      if (idx >= PROVIDERS.length) return resolve(null);
      const prov = PROVIDERS[idx++];
      let child: ChildProcess;
      try {
        child = spawn(prov.cmd, prov.args(port), { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        return tryNext();
      }
      let settled = false;
      const done = (t: Tunnel | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (t) resolve(t);
        else {
          try {
            child.kill();
          } catch {

          }
          tryNext();
        }
      };
      const onData = (buf: Buffer): void => {
        const url = parseTunnelUrl(buf.toString());
        if (url) done({ url, provider: prov.cmd, stop: () => { try { child.kill(); } catch {  } } });
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", () => done(null));
      const timer = setTimeout(() => done(null), timeoutMs);
    };
    tryNext();
  });
}
