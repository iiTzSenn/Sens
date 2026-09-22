import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "rust", "sens-app");
const bundleDir = path.join(appDir, "target", "release", "bundle", "nsis");
const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");

const unsigned = process.argv.includes("--unsigned");
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

if (!signing) {
  console.log("  sin firmar: Windows enseñará el aviso de SmartScreen a quien lo descargue.");
  process.exit(0);
}

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
