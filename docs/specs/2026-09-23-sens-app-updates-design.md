# Actualizaciones de la app

Fecha: 2026-09-23 · Ámbito: `rust/sens-app` (`update.rs`, `profile.rs`, `main.rs`,
`ui/index.html`, `updater.pub`), `rust/sens-agent` (`chat.rs`),
`scripts/app-installer.mjs`, `.github/workflows/release.yml`. Implementado.

## Decisiones

- Sens avisa de una versión nueva y la instala con un clic: «Actualizar y
  reiniciar». Nada se descarga ni se instala sin ese clic.
- Actualizador propio en Rust sobre el agente HTTP de `web.rs`. No se usa
  `tauri-plugin-updater`: traería `reqwest` junto a `ureq`, exigiría un
  `latest.json` por release y su endpoint `releases/latest` se rompe cuando una
  release solo de npm queda marcada como Latest (los tags `v*` son compartidos).
- Cada instalador lleva una firma minisign (`.exe.sig`) hecha con una clave
  privada que solo tiene Sofía. La app trae embebida la pública y no instala nada
  que no la pase. HTTPS y el `digest` de GitHub no bastan: con la cuenta de GitHub
  comprometida, cualquiera podría subir un `.exe`.
- La instalación es por usuario (`%LOCALAPPDATA%\Sens`, sin UAC). El instalador
  NSIS de Tauri ya acepta `/P` (pasivo), `/UPDATE` y `/R` (reabre la app al
  terminar), así que aplicar una versión es lanzarlo y cerrar Sens.
- Las copias ya instaladas (0.11.0 y anteriores) no tienen este código: necesitan
  una instalación manual de la 0.12.0, la primera que lo trae. De ahí en adelante
  se actualizan solas.

## Qué release cuenta

`GET https://api.github.com/repos/iiTzSenn/Sens/releases?per_page=20`, sin token
(60 peticiones/h por IP). Gana la de versión más alta entre las releases que:

- no es borrador ni prerelease;
- trae **a la vez** `Sens_<v>_x64-setup.exe` y `Sens_<v>_x64-setup.exe.sig`,
  con `<v>` sacado del tag sin la `v`;
- tiene una versión mayor que `CARGO_PKG_VERSION`.

Las versiones se comparan como tres números (mayor.menor.parche): `0.9.0` es menor
que `0.10.0`. Un tag que no se lee así se ignora. Las releases solo de npm y las que
no tienen `.sig` (v0.10.0, v0.11.0) quedan fuera solas.

## Motor: `update.rs`

- `latest(current) -> Result<Option<Release>, String>`: la consulta de arriba.
  `Release { version, notes, page, size, installer, signature }`, donde `notes` es
  el cuerpo de la release, `page` su `html_url` y `size` los bytes del `.exe`.
- `install(base, report)`: vuelve a pedir la última release y descarga el `.sig` y
  el `.exe` con `web::text`/`web::bytes` (tope de 64 MB). Verifica la firma en
  memoria y, solo si pasa, escribe el `.exe` en `<datos>/updates/`. Después lanza
  `setup.exe /P /UPDATE /R` como proceso aparte. `report` recibe cada etapa. Si
  el instalador arranca, el comando hace `app.exit(0)`, y el `RunEvent::Exit` que
  ya existe apaga el motor y mata los `claude`. Si no arranca, devuelve el error y
  Sens sigue abierto.
- `verify(key, bytes, signature, version)`: el crate `minisign-verify`. Tanto
  `updater.pub` como el `.sig` son el texto minisign en base64, como los escribe
  `tauri signer`. Se decodifican con `base64`, luego
  `PublicKey::decode`/`Signature::decode`, y `verify(bytes, &signature, false)`:
  solo firmas prehash, que es lo que produce `tauri signer`. Además, el comentario
  de confianza (cubierto por la firma) tiene que llevar `version:<v>` con la versión
  de la release. Así un instalador antiguo firmado no pasa por uno nuevo.
- `sweep(base)`: borra `<datos>/updates/`. Corre en `setup` al arrancar.
- La clave pública entra con `include_str!("../updater.pub")`.
- En las builds de desarrollo (`cfg!(debug_assertions)`), `update_check` sin
  `manual` no hace ninguna petición y `update_install` se niega: instalaría sobre
  `%LOCALAPPDATA%\Sens` y cerraría la sesión de `app:dev`.

`Engine::working() -> usize` en `sens-agent/src/chat.rs` cuenta las sesiones con
un turno en curso o con tareas en segundo plano.

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `update_check` | `invoke("update_check", { manual })` | `{ latest: { version, notes, page, size } \| null, installable }` |
| `update_install` | `invoke("update_install")` | vuelve a consultar, descarga, verifica y aplica la última; si todo va bien, la app se cierra; si falla, rechaza con el mensaje |
| `chat_working` | `invoke("chat_working")` | número de sesiones trabajando |
| `set_update_check` | `invoke("set_update_check", { on })` | `null`; guarda el interruptor |

- Evento `"update"`: `{ version, stage }` con `stage` = `downloading`, `verifying`
  o `installing`.
- `profile` devuelve también `checkUpdates`, que vale `true` si falta en
  `profile.json`. `save_profile` sigue guardando solo el nombre y **no** pisa el
  interruptor.

## Interfaz

- **Comprobación**: al cargar, si `checkUpdates` está activo, y después cada 12 h,
  la UI llama a `update_check({ manual: false })`. Si falla, no se ve nada; el error
  queda para Ajustes.
- **Aviso**: una pastilla en la barra superior, a la izquierda de `#tools`: el icono
  Lucide `circle-arrow-down` en `info` y el número de versión en texto neutro. Signal
  no, porque es información neutra. Es un `<button>` con `aria-label` «Actualización
  disponible: Sens X». Se queda hasta que se actualiza; no hay «omitir esta versión».
- **Panel**: `showPanel("Sens X", …)` con:
  - la línea «Tienes la Y · N MB»;
  - las notas con `prose()` y el enlace «Ver en GitHub» (`open_external`);
  - los botones **«Actualizar y reiniciar»** y «Más tarde».
- **Al actualizar**:
  - Antes de nada se llama a `chat_working`. Si da más de 0, se pide confirmación:
    «Hay N sesiones trabajando y se detendrán. ¿Actualizar igualmente?».
  - Después, el botón se desactiva y una línea `role="status"` sigue el evento:
    «Descargando…», «Verificando la firma…», «Instalando: Sens se cerrará y volverá
    a abrirse».
  - Si falla, el mensaje sale en `.note.fault` y el botón pasa a «Reintentar».
- **Ajustes › General**, bloque «Actualizaciones»:
  - la versión instalada;
  - el estado: «Estás en la última versión», «X disponible» (con un botón que abre
    el panel) o el error de la última comprobación;
  - el botón «Buscar actualizaciones» (`manual: true`);
  - el interruptor «Buscar al abrir Sens».
  - Con `installable: false`, el bloque dice «Build de desarrollo: comprueba pero
    no instala» y el panel no ofrece instalar.

## Errores

| Situación | Qué pasa |
| --- | --- |
| Sin red, tiempo agotado, API sin cuota | Mensajes de `web.rs`. La comprobación automática calla; la manual y el panel lo enseñan |
| Falta el `.sig` o el `.exe` de la versión | Esa release no cuenta |
| Firma inválida o de otra clave | «La firma no coincide; no se instala». No se escribe nada en disco |
| El instalador no arranca | Error en el panel, Sens no se cierra |
| NSIS falla con Sens ya cerrado | Lo dice su propia ventana (en `/P` se muestra) y queda la versión anterior |

## Publicar una versión

- **Clave, una vez.** Desde una terminal interactiva, porque pide la contraseña:
  `npx tauri signer generate -w "$env:USERPROFILE\.tauri\sens-updater.key"`.
  - El `.key.pub` se sube como `rust/sens-app/updater.pub`.
  - La privada y su contraseña no entran en el repo. Si se pierden, las copias
    instaladas no aceptan más versiones y toca reinstalar a mano.
- **`scripts/app-installer.mjs`** trata las dos firmas por separado:
  - Authenticode sigue como está, opcional con `--unsigned`.
  - La firma del actualizador es obligatoria. Con `TAURI_SIGNING_PRIVATE_KEY_PATH`
    (o `TAURI_SIGNING_PRIVATE_KEY` con el contenido) y
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, el script ejecuta
    `tauri signer sign --app-version <versión de tauri.conf.json>` sobre el
    instalador y deja el `.exe.sig` a su lado.
  - Firma después de Authenticode, porque esa firma cambia los bytes del `.exe`.
  - Si el `.sig` no lleva el mismo id de clave que `updater.pub`, lo borra y falla:
    las copias instaladas lo rechazarían.
  - Sin clave, se niega («sin .sig, las copias instaladas no verán esta versión»),
    salvo con `--no-updater`.
- **La release** lleva los dos ficheros:
  `gh release create vX --title … --notes … Sens_X_x64-setup.exe Sens_X_x64-setup.exe.sig`.
  Las notas son lo que verá el panel.
- **CI**: el job `installer` recibe los secretos `TAURI_SIGNING_PRIVATE_KEY` y
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` y sube también `*.exe.sig`. Sigue
  necesitando el certificado Authenticode para correr, y eso queda aparte.

## Pruebas

- **Unitarias en `update.rs`**:
  - Comparación de versiones, con `0.9.0 < 0.10.0` y tags ilegibles.
  - Selección de release sobre un JSON de ejemplo: borradores, prereleases,
    releases solo de npm, una sin `.sig`, una más antigua que la actual, y gana la
    versión más alta aunque la API no la liste primero.
  - Verificación con un par de claves de prueba sin contraseña, con la pública, el
    contenido y su `.sig` como constantes del test. La firma buena pasa; fallan el
    contenido alterado, la clave ajena, una versión distinta de la firmada y un texto
    que no es minisign.
  - La clave embebida no es ninguna de las de prueba.
- **`profile`**: un `profile.json` sin `checkUpdates` carga `true`, y `save_profile`
  no lo pisa.
- **En vivo, `#[ignore]`**: `latest("0.0.0")` contra la API real, como
  `the_real_catalogs`.
- **UI**: un simulador extra sobre el `mock.js` del arnés (`updates-mock.js`)
  cubre `update_check`, `update_install`, `chat_working`, `set_update_check` y el
  evento. Hay que recorrer:
  - la pastilla y el panel;
  - las tres etapas, un fallo y el reintento;
  - la confirmación con sesiones trabajando;
  - el bloque de Ajustes en sus tres estados y con `installable: false`.
- **De extremo a extremo**: instalar a mano la 0.12.0 firmada, publicar la 0.12.1 y
  comprobar que la pastilla sale, que instala sin UAC y que Sens vuelve a abrirse
  en la 0.12.1.

## Fuera de alcance

Certificado Authenticode, macOS y Linux, arm64, canales o prereleases,
actualizaciones parciales (delta), volver a una versión anterior, avisar tras
actualizar.
