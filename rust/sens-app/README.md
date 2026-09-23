# `sens-app` — the desktop app, and how it gets signed

A Tauri window over `sens-agent`: the file tree on the left, the live trace of a
task in the middle, the session history to replay. The engine is linked in, not
shelled out to, so the installer carries one binary and no runtime.

## Building it

```bash
npm ci
npm run app:installer -- --unsigned --no-updater
```

That produces `rust/sens-app/target/release/bundle/nsis/Sens_<version>_x64-setup.exe`
— about 3 MB, roughly 90 seconds from a cold `target/`. The Tauri CLI downloads
NSIS on the first run and checks its hash.

`npm run app:dev` opens the window with the UI reloading from disk.

## Signing it

`--unsigned` is there so you can build one on purpose. Without it the script
refuses to produce an installer at all, because an unsigned one that reaches
someone's browser is a SmartScreen warning with your name on it.

Point it at a certificate in one of two ways:

```bash
SENS_SIGN_THUMBPRINT=A1B1...A0B0 npm run app:installer
```

the thumbprint of a code-signing certificate in your Windows store (import the
`.pfx` with `Import-PfxCertificate -CertStoreLocation Cert:\CurrentUser\My`, the
thumbprint is on the certificate's Details tab), or

```bash
SENS_SIGN_COMMAND='"C:\path\signtool.exe" sign /f cert.pfx /p ... /fd sha256 /tr http://timestamp.digicert.com /td sha256 %1' npm run app:installer
```

your own signing tool, for a hardware token, Azure Key Vault or anything else
that does not live in the certificate store. `%1` is where the file goes, and
the command is split respecting quotes, so paths with spaces are fine.

`SENS_SIGN_TIMESTAMP` overrides the timestamp server, which defaults to
DigiCert's. Timestamping is not optional here: without it the signature dies
the day the certificate expires, and everyone who already downloaded the
installer starts seeing a warning.

Tauri signs the app binary, the NSIS plugin DLLs and the installer. The script
then reads the signature back off the finished installer with
`Get-AuthenticodeSignature` and fails unless Windows itself calls it `Valid`
and timestamped — the build log saying "Successfully signed" is not the same
thing as Windows accepting it.

## Updates, and the key that makes them safe

Sens checks GitHub for a newer release when it opens and every 12 hours, shows
it in the top bar, and installs it with one click: it downloads the installer,
checks its signature, runs it with `/P /UPDATE /R` and closes. NSIS installs per
user, so there is no UAC prompt, and `/R` opens Sens again when it is done.

A release only counts if it carries both `Sens_<version>_x64-setup.exe` and
`Sens_<version>_x64-setup.exe.sig`. The `.sig` is a minisign signature made
with a private key that never enters this repository; the public half is
[`updater.pub`](updater.pub), compiled into the app. The app refuses an
installer whose signature does not match that key, or whose signed version is
not the one the release announces, so an old signed installer cannot be passed
off as a new one.

Create the key once, from an interactive terminal, because it asks for a
password:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.tauri\sens-updater.key"
```

and copy `sens-updater.key.pub` over `updater.pub`. Keep the private key and its
password somewhere safe: losing either means installed copies accept no further
versions, and everyone has to reinstall by hand.

Then build with it:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\sens-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
npm run app:installer -- --unsigned
```

The script signs the installer after Authenticode has finished with it (the
Authenticode signature changes the bytes), binds the signature to the version
in `tauri.conf.json`, and fails if the `.sig` was made with a key other than the
one in `updater.pub`. Without a key it refuses to build unless you pass
`--no-updater`.

Publish both files:

```bash
gh release create v0.12.0 --title "..." --notes "..." Sens_0.12.0_x64-setup.exe Sens_0.12.0_x64-setup.exe.sig
```

The notes are what the update panel shows. Copies older than 0.12.0 have no
updater and need one manual install.

## What a certificate buys, and what it does not

You need an **OV code-signing certificate** (an SSL certificate will not work).
It removes "unknown publisher" and puts your name on the installer.

It does not remove the SmartScreen warning on day one. Microsoft removed the
special treatment of EV certificates in 2024, so EV and OV now build reputation
the same way: by the same certificate signing release after release until
enough people have downloaded it without trouble. Changing certificates starts
that over.

## In CI

The `installer` job in [.github/workflows/release.yml](../../.github/workflows/release.yml)
builds it on a tag. It needs two secrets:

| Secret | What goes in it |
| --- | --- |
| `WINDOWS_CERTIFICATE` | the `.pfx`, base64 — `certutil -encode certificate.pfx cert.txt` |
| `WINDOWS_CERTIFICATE_PASSWORD` | the export password of that `.pfx` |
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of `sens-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

The job imports it, hands the thumbprint to the script, and throws if the
secret is missing rather than quietly shipping something unsigned. The
installer and its `.sig` are uploaded as a workflow artifact and, when a release
exists for the tag, attached to it.

## How this was tested without a real certificate

With a throwaway self-signed one, which is enough to prove every step but the
last. `openssl req -x509 ... -addext "extendedKeyUsage=codeSigning"` into a
`.pfx`, then `SENS_SIGN_COMMAND` pointing at `signtool`:

```
Successfully signed: ...\bundle\nsis\Sens_0.1.0_x64-setup.exe

  rust\sens-app\target\release\bundle\nsis\Sens_0.1.0_x64-setup.exe  (3.0 MB)
  firma: UnknownError · CN=Sens local pipeline test · con sello de tiempo
  esa firma no la acepta Windows, así que este instalador no se publica.
```

`UnknownError` is Windows saying the chain leads to a root it does not trust,
which is exactly what a self-signed certificate should produce — and the script
refusing is exactly what it should do with it. Unpacking the installer showed
the binary inside carrying the same signature and the same timestamp, so the
signing covers the payload and not just the wrapper.
