# Ajustes y proveedores

Fecha: 2026-09-23 · Ámbito: `rust/sens-agent` (`process.rs`, `account.rs`),
`rust/sens-app` (`providers.rs`, `main.rs`, `ui/index.html`). Implementado.

## Decisiones

- Ajustes deja de ser un diálogo y pasa a ser una vista, con secciones **General**
  (el nombre) y **Proveedores**. Se abre desde el menú del perfil; «Conectar Claude
  Code…» del selector de modelos abre Ajustes › Proveedores.
- «Conectar manualmente» Claude Code significa gestionar su sesión y, si se quiere,
  entrar con una clave de API. No se elige la ruta del ejecutable: Sens lo busca
  solo (ver «Claude Code en el ordenador»).
- Sens sigue sin tocar credenciales de la suscripción: el inicio y el cierre de
  sesión los hace el propio `claude` (`auth login --claudeai|--console`,
  `auth logout`).

## Cómo entra Claude Code

| Método | Qué hace Sens |
| --- | --- |
| Suscripción de Claude | «Iniciar sesión» abre `claude auth login --claudeai` en una ventana |
| Consola de Anthropic | «Iniciar sesión» abre `claude auth login --console` |
| Clave de API | guarda la clave cifrada y la pasa como `ANTHROPIC_API_KEY` |

- `providers.json` en la carpeta de datos: `{ "claude": { "method", "sealedKey" } }`.
  La clave se cifra con DPAPI (`CryptProtectData`, ligado al usuario de Windows) y
  nunca vuelve a la UI: solo `keyHint` (`sk-ant-…WXYZ`). Solo se aceptan claves que
  empiezan por `sk-ant-`. Elegir «Clave de API» sin clave guardada no persiste nada:
  solo muestra el campo.
- Con «Clave de API» elegida, **todos** los `claude` que lanza Sens la llevan:
  `sens_agent::process::claude()` construye el comando con el entorno que el host
  fija con `process::set_environment` (al arrancar y en cada cambio), y el chat la
  recibe en `Settings.env`, así que cambiar de método reinicia su proceso en el
  siguiente mensaje. Claude Code la reconoce: `auth status` dice
  `apiKeySource: "ANTHROPIC_API_KEY"`, y la UI lo muestra como «Conectado con clave
  de API» sin el aviso naranja.

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `providers_state` | `invoke("providers_state")` | `[{ id, vendor, label, method, keyHint, version, account, error }]` |
| `set_provider_method` | `invoke("set_provider_method", { id, method })` | `null`; `apiKey` sin clave es error |
| `save_api_key` | `invoke("save_api_key", { id, key })` | `null`; deja el método en `apiKey` |
| `forget_api_key` | `invoke("forget_api_key", { id })` | `null`; si estaba en `apiKey`, vuelve a `subscription` |
| `provider_sign_in` | `invoke("provider_sign_in", { method })` | `null`; abre la ventana de login |
| `provider_sign_out` | `invoke("provider_sign_out")` | `null` |
| `claude_code_install` | `invoke("claude_code_install")` | la versión instalada; emite `claude-code` con `{ stage, done, total }` |

`providers_state` lleva además `installed`: sin Claude Code es `false`, con `version`
y `error` vacíos y `account` a `null`.

`claude_sign_in` desaparece. `providers_state` recorre `catalog::PROVIDERS`, así
que un proveedor nuevo es una entrada más ahí y su tarjeta sale sola.

## Inicio de sesión con OAuth

- El botón «Iniciar sesión con Claude» (o «con la Consola») está siempre en la
  tarjeta, también con sesión abierta, para cambiar de cuenta. Debajo, tres pasos:
  se abre el navegador en claude.ai (o console.anthropic.com), autorizas a Claude
  Code y te da un código, y si te lo pide lo pegas en la ventana de Claude Code.
- `provider_sign_in` lanza `claude auth login --claudeai|--console` en una consola
  propia (`CREATE_NEW_CONSOLE`) y **espera a que termine**: sale bien → Sens relee
  la cuenta; se cierra sin terminar → «no terminaste el inicio de sesión». Ya no se
  sondea la cuenta cada 2 s, que se quedaba 5 minutos esperando si volvías a entrar
  con la misma cuenta.
- El código de autorización nunca pasa por Sens: lo genera claude.ai y lo recibe el
  propio `claude`. Las condiciones de Anthropic prohíben a una app de terceros
  recogerlo o reenviarlo.

## Claude Code en el ordenador

Actualizado el 2026-09-24. Sens trabaja siempre a través de Claude Code: el chat, los
modelos, el título y la cuenta son `claude`. Tampoco hay otra puerta legal a la
suscripción, porque el inicio de sesión de Pro o Max solo lo puede hacer Claude Code.
Lo que sí cambia es que el usuario ya no tiene que instalarlo a mano.

### Dónde lo busca

`sens_agent::process::located()` se consulta en cada lanzamiento, así que un
Claude Code instalado con Sens abierto aparece al pulsar «Comprobar otra vez»:

1. cada carpeta del PATH de Sens: `claude.exe`, o el binario del paquete de npm
   (`node_modules/@anthropic-ai/claude-code/bin/claude.exe`) junto al `claude.cmd`;
2. `.local\bin` bajo `HOME` si existe y si no bajo el perfil de usuario, la misma
   regla que usa el instalador oficial (`HOME ?? os.homedir()`);
3. `%APPDATA%\npm` y `%LOCALAPPDATA%\Microsoft\WinGet\Links`.

Antes solo valía `claude.exe` en el PATH con el que arrancó Sens, y fallaba en tres
casos reales: el instalador oficial de Windows no añade `.local\bin` al PATH (lo
pide a mano: «Native installation exists but … is not in your PATH»); npm deja un
`claude.cmd`, que `Command::new("claude")` no encuentra; y el PATH de un proceso no
se refresca, así que instalar con Sens abierto no servía de nada.

### Cómo lo instala

`claude_code_install` repite lo que hace `https://claude.ai/install.ps1`, sin
PowerShell:

| Paso | Qué hace |
| --- | --- |
| versión | `downloads.claude.ai/claude-code-releases/latest`, solo si es `N.N.N` |
| manifiesto | `…/<versión>/manifest.json` → `platforms.win32-x64.checksum` y `size` |
| descarga | `…/<versión>/win32-x64/claude.exe` a `claude-code/` en la carpeta de datos |
| verificación | SHA-256 del fichero contra el manifiesto; si no coincide, no se ejecuta |
| instalación | `claude.exe install latest`, oculto: deja el lanzador en `.local\bin` |

Es por usuario y sin UAC. La descarga temporal se borra al terminar y, si Windows la
retiene, al abrir Sens. Solo corre una instalación a la vez. Una prueba ignorada
(`the_real_install_lands_in_a_throwaway_profile`) la hace de verdad contra un perfil
desechable; hay que cambiar `HOME` además de `USERPROFILE`, o `claude install`
actualiza el Claude Code real del usuario.

### En la tarjeta

- La tarjeta enseña siempre los tres métodos, también sin Claude Code.
- Sin Claude Code dice «Falta Claude Code en este ordenador», con «Instalar ahora»
  y «Comprobar otra vez». Conectar lo instala antes: «Iniciar sesión» instala y
  abre el login; «Guardar clave» guarda la clave e instala.
- La barra de progreso sale del evento `claude-code`: descarga con porcentaje,
  verificación e instalación.
