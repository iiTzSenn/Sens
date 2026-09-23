import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "rust", "sens-app");
const bundleDir = path.join(appDir, "target", "release", "bundle", "nsis");
const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const publicKey = path.join(appDir, "updater.pub");
const version = JSON.parse(readFileSync(path.join(appDir, "tauri.conf.json"), "utf8")).version;

const unsigned = process.argv.includes("--unsigned");
const withoutUpdater = process.argv.includes("--no-updater");
const updaterKey = Boolean((process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || "").trim());
const thumbprint = (process.env.SENS_SIGN_THUMBPRINT ?? "").trim();
const command = (process.env.SENS_SIGN_COMMAND ?? "").trim();
const timestampUrl = (process.env.SENS_SIGN_TIMESTAMP ?? "http://timestamp.digicert.com").trim();

if (process.platform !== "win32") {
  console.error("este instalador es de Windows: NSIS y Authenticode.");
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

const signing = thumbprint
  ? { certificateThumbprint: thumbprint, digestAlgorithm: "sha256", timestampUrl }
  : command
    ? { signCommand: asCommand(command) }
    : null;

const args = ["build"];
if (signing) args.push("--config", JSON.stringify({ bundle: { windows: signing } }));

const built = spawnSync(process.execPath, [cli, ...args], { cwd: appDir, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);

const installer = newestInstaller();
if (!installer) {
  console.error(`no encuentro ningún instalador en ${path.relative(root, bundleDir)}`);
  process.exit(1);
}

console.log(`\n  ${path.relative(root, installer)}  (${(statSync(installer).size / 1048576).toFixed(1)} MB)`);

if (signing) {
  const seal = authenticode(installer);
  console.log(`  firma: ${seal.status}${seal.signer ? ` · ${seal.signer}` : ""} · ${seal.stamped ? "con sello de tiempo" : "SIN sello de tiempo"}`);

  if (seal.status !== "Valid") {
    console.error("  esa firma no la acepta Windows, así que este instalador no se publica.");
    process.exit(1);
  }
  if (!seal.stamped) {
    console.error("  sin sello de tiempo la firma muere con el certificado: los que ya lo descargaron se quedan con un aviso.");
    process.exit(1);
  }
} else {
  console.log("  sin firmar: Windows enseñará el aviso de SmartScreen a quien lo descargue.");
}

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

function newestInstaller() {
  if (!existsSync(bundleDir)) return null;
  const built = readdirSync(bundleDir)
    .filter((name) => name.endsWith(".exe"))
    .map((name) => path.join(bundleDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return built[0] ?? null;
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
