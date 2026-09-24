import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "rust", "sens-app");
const setupDir = path.join(root, "rust", "sens-setup");
const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const publicKey = path.join(appDir, "updater.pub");
const version = JSON.parse(readFileSync(path.join(appDir, "tauri.conf.json"), "utf8")).version;
const app = path.join(appDir, "target", "release", "sens-app.exe");
const setup = path.join(setupDir, "target", "release", "sens-setup.exe");
const payload = path.join(setupDir, "target", "payload", "sens-app.br");
const installerDir = path.join(setupDir, "target", "installer");
const installer = path.join(installerDir, `Sens_${version}_x64-setup.exe`);

const unsigned = process.argv.includes("--unsigned");
const withoutUpdater = process.argv.includes("--no-updater");
const updaterKey = Boolean((process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || "").trim());
const thumbprint = (process.env.SENS_SIGN_THUMBPRINT ?? "").trim();
const command = (process.env.SENS_SIGN_COMMAND ?? "").trim();
const timestampUrl = (process.env.SENS_SIGN_TIMESTAMP ?? "http://timestamp.digicert.com").trim();

if (process.platform !== "win32") {
  console.error("este instalador es de Windows: sens-setup y Authenticode.");
  console.error("en macOS hace falta notarización, que es otra historia y otro certificado.");
  process.exit(1);
}

if (!existsSync(cli)) {
  console.error("falta @tauri-apps/cli. Instálalo con: npm ci");
  process.exit(1);
}

if (!thumbprint && !command && !unsigned) {
  console.error("no hay con qué firmar, y un instalador sin firmar no sale de aquí por accidente.");
  console.error("  SENS_SIGN_THUMBPRINT=<huella>   un certificado del almacén de Windows");
  console.error("  SENS_SIGN_COMMAND='firma %1'    tu propia herramienta: Key Vault, token EV, relic");
  console.error("  --unsigned                      constrúyelo sin firmar, a sabiendas");
  process.exit(1);
}

if (!updaterKey && !withoutUpdater) {
  console.error("no hay clave para firmar la actualización, y sin .sig las copias instaladas no verán esta versión.");
  console.error("  TAURI_SIGNING_PRIVATE_KEY_PATH=<ruta>   la clave de npx tauri signer generate");
  console.error("  TAURI_SIGNING_PRIVATE_KEY=<contenido>   la misma clave, en texto");
  console.error("  TAURI_SIGNING_PRIVATE_KEY_PASSWORD      su contraseña");
  console.error("  --no-updater                            constrúyelo sin .sig, a sabiendas");
  process.exit(1);
}

if (command && !command.includes("%1")) {
  console.error("a SENS_SIGN_COMMAND le falta el %1 donde va el fichero a firmar.");
  process.exit(1);
}

const signtool = thumbprint ? findSigntool() : null;
if (thumbprint && !signtool) {
  console.error("no encuentro signtool.exe en el Windows SDK (Program Files (x86)\\Windows Kits\\10\\bin).");
  console.error("instala el SDK de Windows o firma con SENS_SIGN_COMMAND.");
  process.exit(1);
}

const signing = Boolean(thumbprint || command);

build(appDir, {});
if (signing) seal(app);

pack(app, payload);
console.log(`\n  ${path.relative(root, payload)}  (${megabytes(payload)} MB, de ${megabytes(app)} MB)`);

build(setupDir, { SENS_PAYLOAD: payload });
rmSync(installerDir, { recursive: true, force: true });
mkdirSync(installerDir, { recursive: true });
copyFileSync(setup, installer);
if (signing) seal(installer);

console.log(`\n  ${path.relative(root, app)}  (${megabytes(app)} MB)`);
console.log(`  ${path.relative(root, installer)}  (${megabytes(installer)} MB)`);
if (!signing) console.log("  sin firmar: Windows enseñará el aviso de SmartScreen a quien lo descargue.");

const updaterSeal = `${installer}.sig`;
rmSync(updaterSeal, { force: true });

if (withoutUpdater) {
  console.log("  sin .sig: las copias instaladas no verán esta versión.");
  process.exit(0);
}

const sealed = spawnSync(process.execPath, [cli, "signer", "sign", "--app-version", version, installer], { cwd: appDir, stdio: "inherit" });
if (sealed.status !== 0 || !existsSync(updaterSeal)) {
  console.error("  no pude firmar la actualización.");
  process.exit(sealed.status || 1);
}

if (keyId(updaterSeal) !== keyId(publicKey)) {
  rmSync(updaterSeal, { force: true });
  console.error("  el .sig está hecho con otra clave que la de rust/sens-app/updater.pub: las copias instaladas lo rechazarían.");
  process.exit(1);
}

console.log(`  actualización: ${path.basename(updaterSeal)} · versión ${version} · clave ${keyId(publicKey)}`);

function build(dir, env) {
  const built = spawnSync(process.execPath, [cli, "build", "--no-bundle"], { cwd: dir, stdio: "inherit", env: { ...process.env, ...env } });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

function pack(from, to) {
  const bytes = readFileSync(from);
  const header = Buffer.alloc(8);
  header.writeBigUInt64LE(BigInt(bytes.length));
  const stream = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, Buffer.concat([header, stream]));
}

function seal(file) {
  const signed = thumbprint
    ? spawnSync(signtool, ["sign", "/sha1", thumbprint, "/fd", "sha256", "/tr", timestampUrl, "/td", "sha256", file], { stdio: "inherit" })
    : signWith(command, file);
  if (signed.status !== 0) {
    console.error(`  no pude firmar ${path.basename(file)}.`);
    process.exit(signed.status || 1);
  }

  const found = authenticode(file);
  console.log(`  ${path.basename(file)} · firma: ${found.status}${found.signer ? ` · ${found.signer}` : ""} · ${found.stamped ? "con sello de tiempo" : "SIN sello de tiempo"}`);

  if (found.status !== "Valid") {
    console.error("  esa firma no la acepta Windows, así que este instalador no se publica.");
    process.exit(1);
  }
  if (!found.stamped) {
    console.error("  sin sello de tiempo la firma muere con el certificado: los que ya lo descargaron se quedan con un aviso.");
    process.exit(1);
  }
}

function signWith(line, file) {
  const { cmd, args } = asCommand(line);
  return spawnSync(cmd, args.map((arg) => arg.replaceAll("%1", file)), { stdio: "inherit" });
}

function findSigntool() {
  const kits = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (!existsSync(kits)) return null;
  const versions = readdirSync(kits)
    .filter((name) => /^\d+(\.\d+)*$/.test(name))
    .sort((a, b) => compareVersions(b, a));
  const candidates = [...versions.map((name) => path.join(kits, name, "x64", "signtool.exe")), path.join(kits, "x64", "signtool.exe")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function megabytes(file) {
  return (statSync(file).size / 1048576).toFixed(1);
}

function asCommand(line) {
  const parts = [];
  let word = "";
  let quoted = false;
  let started = false;
  for (const letter of line) {
    if (letter === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(letter)) {
      if (word || started) parts.push(word);
      word = "";
      started = false;
      continue;
    }
    word += letter;
  }
  if (word || started) parts.push(word);
  return { cmd: parts[0], args: parts.slice(1) };
}

function keyId(file) {
  const lines = Buffer.from(readFileSync(file, "utf8").trim(), "base64").toString("utf8").split("\n");
  return Buffer.from(Buffer.from(lines[1] ?? "", "base64").subarray(2, 10)).reverse().toString("hex").toUpperCase();
}

function authenticode(file) {
  const quoted = file.replaceAll("'", "''");
  const probe = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$s = Get-AuthenticodeSignature -FilePath '${quoted}'; "$($s.Status)|$($s.SignerCertificate.Subject)|$($null -ne $s.TimeStamperCertificate)"`,
    ],
    { encoding: "utf8" },
  );
  const [status, signer, stamped] = (probe.stdout ?? "").trim().split("|");
  return { status: status || "desconocida", signer: signer || "", stamped: stamped === "True" };
}
