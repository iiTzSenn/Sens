# `sens-app` — the desktop app, and how it gets signed

A Tauri window over `sens-agent`: the file tree on the left, the live trace of a
task in the middle, the session history to replay. The engine is linked in, not
shelled out to, so the installer carries one binary and no runtime.

## Building it

```bash
npm ci
npm run app:installer -- --unsigned
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

The job imports it, hands the thumbprint to the script, and throws if the
secret is missing rather than quietly shipping something unsigned. The
installer is uploaded as a workflow artifact and, when a release exists for the
tag, attached to it.

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
